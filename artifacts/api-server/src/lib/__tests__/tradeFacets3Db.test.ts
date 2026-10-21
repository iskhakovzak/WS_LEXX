/**
 * Breakdown panel v3 on a scratch Postgres built from the repository migrations (0242):
 *  - the bucket SQL of size vs usual / stop gives the same keys as the TypeScript functions;
 *  - the back-fill writes entry «aggressive», adds kind, exit «flip», has_stop and size_rel from fills + structure;
 *  - GET /trades/facets returns the new columns; the /trades/page WHERE and the /stats/aggregate tail filter by them;
 *  - size_rel follows the trader's earlier trades: an edit of an earlier trade re-derives the following days, a trade
 *    moved away / hard-deleted marks that trader's following 60 days stale (0242 triggers); a stop edit marks the row.
 * Skipped when the local Postgres is down.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";

const holder = vi.hoisted(() => ({ pool: null as unknown as pg.Pool }));
vi.mock("@workspace/db", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pool: {
    query: async (...a: unknown[]) => (holder.pool.query as (...x: unknown[]) => unknown)(...a),
    connect: async () => holder.pool.connect(),
  },
}));

const { resolveMigrationsDir, runMigrationFiles } = await import("../../db/runner");
const { createScratchDb, pgAvailable } = await import("../../db/__tests__/scratchDb");
const { backfillTradeStrategies } = await import("../tradeStrategyStore");
const { buildFacetsQuery, foldFacets } = await import("../tradeFacetsQuery");
const { parseFacetQuery, facetSqlTail } = await import("../tradeFacetsSql");
const { Params, buildWhere } = await import("../tradesPageQuery");
const B = await import("../tradeFacetBuckets");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noReload = async () => {};

describe.skipIf(!available)("breakdown panel v3 on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  const ids: Record<string, number> = {};

  /** fills: [kind, role, leg, price, qty, "HH:MM:SS"] */
  type Fill = [string, string, number, number, number, string];
  type T = { trader: string; date: string; pnl: number; qty: number; entry: number; stop?: number; structure?: object; fills?: Fill[] };
  const trade = async (key: string, v: T) => {
    const { rows } = await q(
      `INSERT INTO trades (ticker, date, side, result, pnl, fees, qty, entry, stop, trader, horizon, structure)
       VALUES ('AAPL', $1, 'Long', $2, $3, 0, $4, $5, $6, $7, 'intraday', $8::jsonb) RETURNING id`,
      [v.date, v.pnl > 0 ? "win" : v.pnl < 0 ? "loss" : "be", v.pnl, v.qty, v.entry, v.stop ?? null, v.trader, v.structure ? JSON.stringify(v.structure) : null],
    );
    ids[key] = Number(rows[0].id);
    for (const [kind, role, leg, price, qty, hms] of v.fills ?? []) {
      await q(
        `INSERT INTO trade_executions (trade_id, kind, role, leg_index, price, qty, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, ($7::text || ' America/New_York')::timestamptz)`,
        [ids[key], kind, role, leg, price, qty, `${v.date} ${hms}`],
      );
    }
  };
  const row = async (key: string) =>
    (await q(`SELECT entry_kind, adds_kind, exit_kind, has_stop, size_rel, strategy_sig FROM trades WHERE id = $1`, [ids[key]])).rows[0];
  const S = { partials: 0, stopHit: false, side: "long", flipOut: false };

  beforeAll(async () => {
    db = await createScratchDb("facets3");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    // Ann's history: 10 trades of $1000 (100 × $10), 2026-05-01 … 05-10, no fills / structure.
    for (let d = 1; d <= 10; d++) await trade(`h${d}`, { trader: "Ann", date: `2026-05-${String(d).padStart(2, "0")}`, pnl: 5, qty: 100, entry: 10 });
    // 3 adds in 60 s, every add higher: aggressive + pyramid; 400 × 10.15 = $4060 → 4.06× usual.
    await trade("agg", {
      trader: "Ann", date: "2026-06-10", pnl: 100, qty: 400, entry: 10.15,
      structure: { ...S, adds: 3, maxPosition: 400, avgEntry: 10.15 },
      fills: [["entry", "entry", 0, 10, 100, "10:00:00"], ["add", "add", 1, 10.1, 100, "10:00:20"], ["add", "add", 2, 10.2, 100, "10:00:40"],
        ["add", "add", 3, 10.3, 100, "10:01:00"], ["exit", "exit", 4, 10.5, 400, "10:10:00"]],
    });
    // One add lower, 30 min later: scaled + average; stopped; stop price in the structure; 100 × 9.9 = $990 → normal.
    await trade("avg", {
      trader: "Ann", date: "2026-06-10", pnl: -40, qty: 100, entry: 9.9,
      structure: { ...S, adds: 1, stopHit: true, stopPrice: 9.6, maxPosition: 100, avgEntry: 9.9 },
      fills: [["entry", "entry", 0, 10, 50, "11:00:00"], ["add", "add", 1, 9.8, 50, "11:30:00"], ["exit", "stop", 2, 9.5, 100, "12:00:00"]],
    });
    // Reversed into the next trade (flip leg / flipOut); trades.stop set; 80 × 5 = $400 → 0.4×.
    await trade("flip", {
      trader: "Ann", date: "2026-06-10", pnl: 16, qty: 80, entry: 5, stop: 4.9,
      structure: { ...S, adds: 0, flipOut: true, maxPosition: 80, avgEntry: 5 },
      fills: [["entry", "entry", 0, 5, 80, "13:00:00"], ["exit", "flip", 1, 5.2, 80, "13:05:00"]],
    });
    // Manual, no fills / structure / history.
    await trade("plain", { trader: "Bob", date: "2026-06-10", pnl: 7, qty: 50, entry: 120 });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("bucket SQL ≡ bucket TS (size vs usual, stop)", async () => {
    for (const [ratio, stop] of [[0.4999, true], [0.5, false], [1.4999, null], [1.5, true], [2.9999, false], [3, null], [0, true], [-1, false], [null, null], [250, true]] as const) {
      const { rows } = await q(
        `SELECT ${B.sizeRelSql("v")} AS r, ${B.stopSql("v")} AS s FROM (VALUES ($1::numeric(12,4), $2::bool)) AS v(size_rel, has_stop)`, [ratio, stop],
      );
      expect(rows[0], JSON.stringify([ratio, stop])).toEqual({ r: B.sizeRelKeyOf(ratio), s: B.stopKeyOf(stop) });
    }
  });

  it("the back-fill writes the v3 columns from fills + structure", async () => {
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await row("agg")).toMatchObject({ entry_kind: "aggressive", adds_kind: "pyramid", exit_kind: "whole", has_stop: false, size_rel: 4.06, strategy_sig: "v4|15:50-16:00" });
    expect(await row("avg")).toMatchObject({ entry_kind: "scaled", adds_kind: "average", exit_kind: "stopped", has_stop: true, size_rel: 0.99 });
    expect(await row("flip")).toMatchObject({ entry_kind: "single", adds_kind: "none", exit_kind: "flip", has_stop: true, size_rel: 0.4 });
    expect(await row("plain")).toMatchObject({ entry_kind: null, adds_kind: null, exit_kind: null, has_stop: false, size_rel: null });
    // the first ten trades of the book have fewer than 10 earlier ones
    expect((await row("h10")).size_rel).toBeNull();
    expect((await backfillTradeStrategies(db.pool, 1000, noReload)).trades).toBe(0);
  });

  const facets = async (scope: string | null, raw: Record<string, string> = {}) => {
    const { sql, params } = buildFacetsQuery({ scope, facets: parseFacetQuery(raw, ["IMX"]) }, false);
    const { rows } = await q(sql, params);
    return foldFacets(rows as never, (_d, k) => k, true, []);
  };
  const keys = (list: { key: string; count: number }[]) => list.map((b) => [b.key, b.count]);

  it("GET /trades/facets: buckets of the new columns", async () => {
    const out = await facets("Ann");
    expect(out.total.count).toBe(13);
    expect(keys(out.dims.entry)).toEqual([["single", 1], ["scaled", 1], ["aggressive", 1], ["unknown", 10]]);
    expect(keys(out.dims.adds)).toEqual([["none", 1], ["pyramid", 1], ["average", 1], ["unknown", 10]]);
    expect(keys(out.dims.exit)).toEqual([["whole", 1], ["stopped", 1], ["flip", 1], ["unknown", 10]]);
    expect(keys(out.dims.stop)).toEqual([["with", 2], ["none", 11]]);
    expect(keys(out.dims.sizeRel)).toEqual([["lt05", 1], ["normal", 1], ["x3", 1], ["unknown", 10]]);
    const ex = await facets("Ann", { xAdds: "unknown" });
    expect(ex.total.count).toBe(3);
    expect(keys(ex.dims.adds)).toEqual([["none", 1], ["pyramid", 1], ["average", 1], ["unknown", 10]]); // own exclusion ignored
    expect(keys(ex.dims.sizeRel)).toEqual([["lt05", 1], ["normal", 1], ["x3", 1]]);
  });

  it("the page WHERE and the /stats/aggregate tail apply the new exclusions", async () => {
    const live = async (raw: Record<string, string>) => {
      const f = parseFacetQuery(raw, ["IMX"]);
      const p = new Params();
      const page = await q(`SELECT t.id FROM trades t WHERE ${buildWhere({ scope: null, facets: f }, p, { quality: false })} ORDER BY t.id`, p.list);
      const params: unknown[] = [];
      const agg = await q(`SELECT t.id FROM trades t WHERE t.deleted_at IS NULL${facetSqlTail(f, params)} ORDER BY t.id`, params);
      expect(agg.rows.map((r) => r.id)).toEqual(page.rows.map((r) => r.id));
      return page.rows.map((r) => Number(r.id)).sort((x, y) => x - y);
    };
    const sorted = (...k: string[]) => k.map((x) => ids[x]!).sort((x, y) => x - y);
    const v3 = { xSizeRel: "unknown" }; // leaves agg / avg / flip
    expect(await live(v3)).toEqual(sorted("agg", "avg", "flip"));
    expect(await live({ ...v3, xEntry: "aggressive" })).toEqual(sorted("avg", "flip"));
    expect(await live({ ...v3, xAdds: "pyramid,average" })).toEqual(sorted("flip"));
    expect(await live({ ...v3, xExit: "flip,stopped" })).toEqual(sorted("agg"));
    expect(await live({ ...v3, xStop: "with" })).toEqual(sorted("agg"));
    expect(await live({ ...v3, xSizeRel: "unknown,x3,lt05" })).toEqual(sorted("avg"));
    expect(await live({ xStop: "none" })).toEqual(sorted("avg", "flip"));
  });

  it("an edit of earlier trades re-derives the size of the following days", async () => {
    await q(`UPDATE trades SET qty = 300 WHERE id = ANY($1::int[])`, [["h1", "h2", "h3", "h4", "h5", "h6"].map((k) => ids[k])]);
    expect((await row("agg")).strategy_sig).not.toBeNull(); // only the edited rows are marked …
    await backfillTradeStrategies(db.pool, 1000, noReload); // … their refresh reaches 60 days ahead
    expect((await row("agg")).size_rel).toBe(1.3533); // 4060 / median(4 × 1000, 6 × 3000) = 4060 / 3000
    await q(`UPDATE trades SET qty = 100 WHERE id = ANY($1::int[])`, [["h1", "h2", "h3", "h4", "h5", "h6"].map((k) => ids[k])]);
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect((await row("agg")).size_rel).toBe(4.06);
  });

  it("a trade moved to another trader / hard-deleted marks the following 60 days stale", async () => {
    await q(`UPDATE trades SET trader = 'Bob' WHERE id = $1`, [ids.h3]);
    expect((await row("agg")).strategy_sig).toBeNull(); // 05-03 + 60 days covers 06-10
    expect((await row("h2")).strategy_sig).not.toBeNull(); // before the day: untouched
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect((await row("agg")).size_rel).toBeNull(); // 9 earlier trades left
    await q(`UPDATE trades SET trader = 'Ann' WHERE id = $1`, [ids.h3]);
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect((await row("agg")).size_rel).toBe(4.06);
    await q(`DELETE FROM trades WHERE id = $1`, [ids.h4]);
    expect((await row("agg")).strategy_sig).toBeNull();
    expect((await row("h3")).strategy_sig).not.toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect((await row("agg")).size_rel).toBeNull();
  });

  it("a stop typed in marks the trade stale; the refresh sets has_stop", async () => {
    await q(`UPDATE trades SET stop = 118 WHERE id = $1`, [ids.plain]);
    expect((await row("plain")).strategy_sig).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect((await row("plain")).has_stop).toBe(true);
  });
});
