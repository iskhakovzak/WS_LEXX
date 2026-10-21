/**
 * Filters panel v2 on a scratch Postgres built from the repository migrations (0241):
 *  - the bucket SQL (lib/tradeFacetBuckets) gives the same keys as the TypeScript functions for the same values;
 *  - the back-fill writes hold / entry / exit kind / notional / day sequence; a trade inserted earlier in a trader-day
 *    re-sequences the later ones, a soft delete / a move to another trader / a hard delete re-derives the neighbours;
 *  - GET /trades/facets returns the new columns; the /trades/page WHERE and the /stats/aggregate tail filter by them.
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
const { backfillTradeStrategies, refreshTradeStrategies } = await import("../tradeStrategyStore");
const { buildFacetsQuery, foldFacets } = await import("../tradeFacetsQuery");
const { parseFacetQuery, facetSqlTail } = await import("../tradeFacetsSql");
const { Params, buildWhere } = await import("../tradesPageQuery");
const B = await import("../tradeFacetBuckets");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noReload = async () => {};

describe.skipIf(!available)("filters panel v2 on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  const ids: Record<string, number> = {};

  type T = { trader: string; ticker: string; at: [string, string]; pnl: number; entry: number; qty: number; account?: string | null; date?: string };
  const trade = async (key: string, v: T) => {
    const date = v.date ?? "2026-06-10";
    const { rows } = await q(
      `INSERT INTO trades (ticker, date, side, result, pnl, fees, qty, entry, trader, broker_account, horizon)
       VALUES ($1, $2, 'Long', $3, $4, 0, $5, $6, $7, $8, 'intraday') RETURNING id`,
      [v.ticker, date, v.pnl > 0 ? "win" : v.pnl < 0 ? "loss" : "be", v.pnl, v.qty, v.entry, v.trader, v.account ?? null],
    );
    ids[key] = Number(rows[0].id);
    for (const [kind, hm] of [["entry", v.at[0]], ["exit", v.at[1]]] as const) {
      await q(`INSERT INTO trade_executions (trade_id, kind, price, qty, executed_at) VALUES ($1, $2, $3, $4, ($5::text || ' America/New_York')::timestamptz)`,
        [ids[key], kind, v.entry, v.qty, `${date} ${hm}`]);
    }
  };
  const seqOf = async (...keys: string[]) => {
    const { rows } = await q(`SELECT id, day_seq, prev_kind FROM trades WHERE id = ANY($1::int[])`, [keys.map((k) => ids[k])]);
    const by = new Map(rows.map((r) => [Number(r.id), [r.day_seq, r.prev_kind]]));
    return Object.fromEntries(keys.map((k) => [k, by.get(ids[k]!)]));
  };
  const sigOf = async (key: string) => (await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids[key]])).rows[0].strategy_sig;

  beforeAll(async () => {
    db = await createScratchDb("facets2");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    await trade("a", { trader: "Ann", ticker: "aapl", at: ["10:00:00", "10:00:30"], pnl: 50, entry: 4, qty: 100 });
    await trade("b", { trader: "Ann", ticker: "TSLA", at: ["11:00:00", "11:20:00"], pnl: -20, entry: 250, qty: 500, account: "ACC1" });
    await trade("c", { trader: "Ann", ticker: "TSLA", at: ["12:00:00", "14:30:00"], pnl: 0, entry: 30, qty: 100, account: "ACC1" });
    await trade("d", { trader: "Bob", ticker: "NVDA", at: ["09:00:00", "09:10:00"], pnl: 7, entry: 120, qty: 50, account: "ACC2" });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("bucket SQL ≡ bucket TS on the same values", async () => {
    const fixtures: [number | null, number | null, number | null, number | null, boolean | null, number | null, number | null][] = [
      [1, 4.99, 1999.99, 59, false, 10, 1], [2, 5, 2000, 60, false, 1, 1], [3, 9.9999, 4999.99, 299, null, 1, 2], [4, 10, 5000, 300, false, -1, 0],
      [5, 20, 10_000, 899, false, 0, 0], [6, 50, 25_000, 900, true, 0.0001, 0], [40, 100, 50_000, 3599, false, null, 5], [0, 199.9999, 99_999.99, 3600, false, 2, -2],
      [null, 200, 100_000, 14_399, false, 3, 3.5], [-1, 0, 0, 14_400, false, 1, null], [7, null, null, null, null, null, null], [8, 1e6, 1e9, -3, false, -0.0001, 0],
    ];
    for (const [seq, entry, notional, hold, overnight, pnl, fees] of fixtures) {
      const { rows } = await q(
        `SELECT ${B.seqSql("v")} AS s, ${B.priceSql("v")} AS p, ${B.sizeSql("v")} AS z, ${B.holdSql("v")} AS h, ${B.resultSql("v")} AS r
           FROM (VALUES ($1::int, $2::numeric(12,4), $3::numeric(14,2), $4::int, $5::bool, $6::numeric(14,4), $7::numeric(14,4)))
                AS v(day_seq, entry, notional, hold_sec, overnight, pnl, fees)`,
        [seq, entry, notional, hold, overnight, pnl, fees],
      );
      expect(rows[0], JSON.stringify([seq, entry, notional, hold, overnight, pnl, fees])).toEqual({
        s: B.seqKeyOf(seq), p: B.priceKeyOf(entry), z: B.sizeKeyOf(notional), h: B.holdKeyOf(hold, overnight), r: B.resultKeyOf(pnl, fees),
      });
    }
  });

  it("the back-fill writes the derived columns; a re-run picks nothing", async () => {
    const r = await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(r.changed).toBe(4);
    const { rows } = await q(`SELECT id, hold_sec, overnight, notional, day_seq, prev_kind, strategy_sig FROM trades ORDER BY id`);
    const by = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(by[ids.a!]).toMatchObject({ hold_sec: 30, overnight: false, notional: 400, day_seq: 1, prev_kind: "first", strategy_sig: "v3|15:50-16:00" });
    expect(by[ids.b!]).toMatchObject({ hold_sec: 1200, notional: 125000, day_seq: 2, prev_kind: "after-win" });
    expect(by[ids.c!]).toMatchObject({ hold_sec: 9000, day_seq: 3, prev_kind: "after-loss" });
    expect(by[ids.d!]).toMatchObject({ day_seq: 1, prev_kind: "first" });
    expect((await backfillTradeStrategies(db.pool, 1000, noReload)).trades).toBe(0);
  });

  it("an earlier trade inserted into the day re-sequences the later trades of that trader only", async () => {
    await trade("e", { trader: "Ann", ticker: "AMD", at: ["09:45:00", "09:50:00"], pnl: -1, entry: 15, qty: 10 });
    await refreshTradeStrategies([ids.e!], db.pool);
    expect(await seqOf("e", "a", "b", "c", "d")).toEqual({
      e: [1, "first"], a: [2, "after-loss"], b: [3, "after-win"], c: [4, "after-loss"], d: [1, "first"],
    });
  });

  it("a soft delete marks the trade stale; the refresh re-sequences the rest of the day", async () => {
    await q(`UPDATE trades SET deleted_at = now() WHERE id = $1`, [ids.e]);
    expect(await sigOf("e")).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("e", "a", "b", "c")).toEqual({ e: [null, null], a: [1, "first"], b: [2, "after-win"], c: [3, "after-loss"] });
  });

  it("an edited result re-derives the next trade's «before» value", async () => {
    await q(`UPDATE trades SET pnl = -3 WHERE id = $1`, [ids.a]);
    expect(await sigOf("a")).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("b")).toEqual({ b: [2, "after-loss"] });
    await q(`UPDATE trades SET pnl = 50 WHERE id = $1`, [ids.a]);
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("b")).toEqual({ b: [2, "after-win"] });
  });

  it("a trade moved to another trader: both days are re-derived; a hard delete re-derives the neighbours", async () => {
    await q(`UPDATE trades SET trader = 'Bob' WHERE id = $1`, [ids.b]);
    expect(await sigOf("a")).toBeNull(); // old neighbours
    expect(await sigOf("c")).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("a", "c", "d", "b")).toEqual({ a: [1, "first"], c: [2, "after-win"], d: [1, "first"], b: [2, "after-win"] });
    await q(`UPDATE trades SET trader = 'Ann' WHERE id = $1`, [ids.b]);
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("a", "b", "c", "d")).toEqual({ a: [1, "first"], b: [2, "after-win"], c: [3, "after-loss"], d: [1, "first"] });
    await q(`DELETE FROM trades WHERE id = $1`, [ids.a]);
    expect(await sigOf("b")).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("b", "c")).toEqual({ b: [1, "first"], c: [2, "after-loss"] });
    // put «a» back (a new id) for the facet tests below
    await trade("a", { trader: "Ann", ticker: "aapl", at: ["10:00:00", "10:00:30"], pnl: 50, entry: 4, qty: 100 });
    await backfillTradeStrategies(db.pool, 1000, noReload);
    expect(await seqOf("a", "b", "c")).toEqual({ a: [1, "first"], b: [2, "after-win"], c: [3, "after-loss"] });
  });

  it("entry / exit kind from the stored structure and the re-entry link (a structure write marks the row stale)", async () => {
    await q(`UPDATE trades SET structure = '{"adds": 1, "partials": 0, "stopHit": true}'::jsonb WHERE id = $1`, [ids.b]);
    await q(`UPDATE trades SET structure = '{"adds": 0, "partials": 2, "stopHit": false}'::jsonb, reentry_of = $2 WHERE id = $1`, [ids.c, ids.b]);
    await q(`UPDATE trades SET structure = '{"adds": 0, "partials": 0, "stopHit": false, "maxPosition": 300, "avgEntry": 4}'::jsonb WHERE id = $1`, [ids.a]);
    expect(await sigOf("b")).toBeNull();
    await backfillTradeStrategies(db.pool, 1000, noReload);
    const { rows } = await q(`SELECT id, entry_kind, exit_kind, notional FROM trades WHERE id = ANY($1::int[]) ORDER BY id`, [[ids.a, ids.b, ids.c]]);
    const by = Object.fromEntries(rows.map((x) => [x.id, [x.entry_kind, x.exit_kind, Number(x.notional)]]));
    expect(by[ids.a!]).toEqual(["single", "whole", 1200]);
    expect(by[ids.b!]).toEqual(["scaled", "stopped", 125000]);
    expect(by[ids.c!]).toEqual(["reentry", "partials", 3000]);
  });

  const facets = async (scope: string | null, raw: Record<string, string> = {}) => {
    const { sql, params } = buildFacetsQuery({ scope, facets: parseFacetQuery(raw, ["IMX"]) }, false);
    const { rows } = await q(sql, params);
    return foldFacets(rows as never, (_d, k) => k, true, []);
  };
  const keys = (list: { key: string; count: number }[]) => list.map((b) => [b.key, b.count]);

  it("GET /trades/facets: buckets of every new column", async () => {
    const out = await facets("Ann");
    expect(out.total).toEqual({ count: 3, net: 30 });
    expect(keys(out.dims.seq)).toEqual([["1", 1], ["2", 1], ["3", 1]]);
    expect(keys(out.dims.prev)).toEqual([["first", 1], ["after-win", 1], ["after-loss", 1]]);
    expect(keys(out.dims.entry)).toEqual([["single", 1], ["scaled", 1], ["reentry", 1]]);
    expect(keys(out.dims.exit)).toEqual([["whole", 1], ["partials", 1], ["stopped", 1]]);
    expect(keys(out.dims.hold)).toEqual([["lt1m", 1], ["15-60m", 1], ["1-4h", 1]]);
    expect(keys(out.dims.tickers)).toEqual([["TSLA", 2], ["AAPL", 1]]);
    expect(keys(out.dims.price)).toEqual([["lt5", 1], ["20-50", 1], ["gt200", 1]]);
    expect(keys(out.dims.size)).toEqual([["lt2k", 1], ["2-5k", 1], ["gt100k", 1]]);
    expect(keys(out.dims.accounts)).toEqual([["ACC1", 2], ["manual", 1]]);
    expect(keys(out.dims.result)).toEqual([["win", 1], ["loss", 1], ["be", 1]]);
    expect(out.dims.result.find((b) => b.key === "loss")?.net).toBe(-20);
  });

  it("an excluded new bucket drops trades from the other columns and keeps its own numbers", async () => {
    const out = await facets("Ann", { xTickers: "TSLA" });
    expect(out.total.count).toBe(1);
    expect(keys(out.dims.tickers)).toEqual([["TSLA", 2], ["AAPL", 1]]);
    expect(keys(out.dims.result)).toEqual([["win", 1]]);
    const two = await facets(null, { xAccounts: "manual", xResult: "be" });
    expect(two.total.count).toBe(2); // b (Ann, ACC1, loss) + d (Bob, ACC2, win)
    // accounts counted without its own exclusion but with «be» out (c); result without its own but with «manual» out (a)
    expect(keys(two.dims.accounts)).toEqual([["ACC1", 1], ["ACC2", 1], ["manual", 1]]);
    expect(keys(two.dims.result)).toEqual([["win", 1], ["loss", 1], ["be", 1]]);
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
    expect(await live({ xSeq: "1" })).toEqual(sorted("b", "c"));
    expect(await live({ xPrev: "first,after-loss" })).toEqual(sorted("b"));
    expect(await live({ xHold: "lt1m,1-4h" })).toEqual(sorted("b", "d"));
    expect(await live({ xTickers: "TSLA,NVDA" })).toEqual(sorted("a"));
    expect(await live({ xPrice: "gt200,lt5" })).toEqual(sorted("c", "d"));
    expect(await live({ xSize: "gt100k" })).toEqual(sorted("a", "c", "d"));
    expect(await live({ xAccounts: "ACC1,ACC2" })).toEqual(sorted("a"));
    expect(await live({ xResult: "win,be" })).toEqual(sorted("b"));
    expect(await live({ xEntry: "reentry", xExit: "stopped" })).toEqual(sorted("a", "d"));
  });
});
