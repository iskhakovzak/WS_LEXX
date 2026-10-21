/**
 * «Улучшенный поиск» + IMX on a scratch Postgres built from the repository migrations (0237):
 *  - the strategy back-fill derives every trade (fills → MOC / Day / OPG…), tags IMX trades, signs the rows; a re-run
 *    touches nothing; editing an input (trigger) or a fill (statement trigger) marks the row stale again;
 *  - GET /trades/facets SQL: buckets per column with the column's own exclusion ignored, totals, the IMX line, scope;
 *  - the /trades/page WHERE with «Исключить IMX» and excluded buckets; /stats/aggregate's facet tail.
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
const { DESK_TAGS } = await import("../deskTags");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("trade strategy + facets on a scratch database", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  const ids: Record<string, number> = {};

  const trade = async (key: string, v: { trader: string; date: string; side: string; pnl: number; tags?: string | null; fills?: [string, string][]; snap?: object; horizon?: string }) => {
    const { rows } = await q(
      `INSERT INTO trades (ticker, date, side, result, pnl, fees, qty, entry, trader, tags, horizon, context_snapshot)
       VALUES ('AAPL', $1, $2, $3, $4, 0, 100, 10, $5, $6, $7, $8::jsonb) RETURNING id`,
      [v.date, v.side, v.pnl > 0 ? "win" : "loss", v.pnl, v.trader, v.tags ?? null, v.horizon ?? "intraday", JSON.stringify(v.snap ?? {})],
    );
    ids[key] = Number(rows[0].id);
    for (const [kind, ts] of v.fills ?? []) {
      await q(`INSERT INTO trade_executions (trade_id, kind, price, qty, executed_at) VALUES ($1, $2, 10, 100, ($3::text || ' America/New_York')::timestamptz)`, [ids[key], kind, ts]);
    }
  };

  beforeAll(async () => {
    db = await createScratchDb("facets");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    await trade("imx", { trader: "Kirill", date: "2026-06-10", side: "Long", pnl: 50, tags: "ORB", fills: [["entry", "2026-06-10 14:00:00"], ["exit", "2026-06-10 15:59:58"]] });
    await trade("day", { trader: "Kirill", date: "2026-06-11", side: "Short", pnl: -20, tags: "FOMO, myTag", fills: [["entry", "2026-06-11 10:00:00"], ["exit", "2026-06-11 11:00:00"]] });
    await trade("opg", { trader: "Kirill", date: "2025-03-03", side: "Long", pnl: 30, snap: { openedAt: "2025-03-03T09:30:05", closedAt: "2025-03-03T09:40:00" } });
    await trade("other", { trader: "Olga", date: "2026-06-10", side: "Long", pnl: 999, fills: [["entry", "2026-06-10 15:51:00"], ["exit", "2026-06-10 15:58:00"]] });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("the back-fill derives, tags and signs every trade; a re-run picks nothing", async () => {
    const r = await backfillTradeStrategies();
    expect(r.trades).toBe(4);
    const { rows } = await q(`SELECT id, strategy, entry_sec, tags, strategy_sig FROM trades ORDER BY id`);
    const by = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(by[ids.imx!]).toMatchObject({ strategy: "MOC", entry_sec: 14 * 3600, tags: "ORB, IMX", strategy_sig: "v1|15:50-16:00" });
    expect(by[ids.day!]).toMatchObject({ strategy: "Day", entry_sec: 10 * 3600, tags: "FOMO, myTag" });
    expect(by[ids.opg!]).toMatchObject({ strategy: "OPG", entry_sec: 9 * 3600 + 30 * 60 + 5, tags: null });
    expect((await backfillTradeStrategies()).trades).toBe(0);
  });

  it("an edited input or a changed fill marks the row stale; the refresh re-derives it", async () => {
    await q(`UPDATE trades SET notes = 'x' WHERE id = $1`, [ids.day]);
    expect((await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids.day])).rows[0].strategy_sig).not.toBeNull();
    await q(`UPDATE trade_executions SET executed_at = ('2026-06-11 15:55:00' || ' America/New_York')::timestamptz WHERE trade_id = $1 AND kind = 'exit'`, [ids.day]);
    expect((await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids.day])).rows[0].strategy_sig).toBeNull();
    expect((await backfillTradeStrategies()).trades).toBe(1);
    expect((await q(`SELECT strategy, tags FROM trades WHERE id = $1`, [ids.day])).rows[0]).toEqual({ strategy: "MOC", tags: "FOMO, myTag, IMX" });
    // back to a day trade: the IMX tag goes away
    await q(`UPDATE trade_executions SET executed_at = ('2026-06-11 11:00:00' || ' America/New_York')::timestamptz WHERE trade_id = $1 AND kind = 'exit'`, [ids.day]);
    await refreshTradeStrategies([ids.day!]);
    expect((await q(`SELECT strategy, tags FROM trades WHERE id = $1`, [ids.day])).rows[0]).toEqual({ strategy: "Day", tags: "FOMO, myTag" });
  });

  it("a tag edit between the read and the write wins (guarded update); the next run derives from the edited tags", async () => {
    const exitAt = (ts: string) => q(`UPDATE trade_executions SET executed_at = ($2::text || ' America/New_York')::timestamptz WHERE trade_id = $1 AND kind = 'exit'`, [ids.day, ts]);
    await exitAt("2026-06-11 15:55:00"); // an IMX trade again: the refresh wants to add the IMX tag
    const racing = {
      query: async (sql: string, params?: unknown[]) => {
        if (/UPDATE trades t SET strategy =/.test(sql)) await q(`UPDATE trades SET tags = 'edited' WHERE id = $1`, [ids.day]);
        return db.pool.query(sql, params);
      },
    };
    expect((await refreshTradeStrategies([ids.day!], racing as never)).changed).toBe(1);
    expect((await q(`SELECT strategy, tags, strategy_sig FROM trades WHERE id = $1`, [ids.day])).rows[0]).toEqual({ strategy: "Day", tags: "edited", strategy_sig: null });
    expect((await backfillTradeStrategies()).trades).toBe(1);
    expect((await q(`SELECT strategy, tags FROM trades WHERE id = $1`, [ids.day])).rows[0]).toEqual({ strategy: "MOC", tags: "edited, IMX" });
    // back to the fixture (the facet tests below count it as a Day trade tagged «FOMO, myTag»)
    await exitAt("2026-06-11 11:00:00");
    await q(`UPDATE trades SET tags = 'FOMO, myTag' WHERE id = $1`, [ids.day]);
    await refreshTradeStrategies([ids.day!]);
    expect((await q(`SELECT strategy, tags FROM trades WHERE id = $1`, [ids.day])).rows[0]).toEqual({ strategy: "Day", tags: "FOMO, myTag" });
  });

  const facets = async (scope: string | null, raw: Record<string, string> = {}) => {
    const f = parseFacetQuery(raw, DESK_TAGS);
    const { sql, params } = buildFacetsQuery({ scope, facets: f }, false);
    const { rows } = await q(sql, params);
    return foldFacets(rows as never, (_d, k) => k, true, []);
  };

  it("facets: own scope only, buckets with net, desk vs personal tags, the IMX line", async () => {
    const out = await facets("Kirill");
    expect(out.total).toEqual({ count: 3, net: 60 });
    expect(out.imx).toEqual({ count: 1, net: 50 });
    expect(out.dims.years).toEqual([{ key: "2026", label: "2026", count: 2, net: 30 }, { key: "2025", label: "2025", count: 1, net: 30 }]);
    expect(out.dims.strategies.map((b) => [b.key, b.count])).toEqual(expect.arrayContaining([["MOC", 1], ["Day", 1], ["OPG", 1]]));
    expect(out.dims.types).toEqual([{ key: "long", label: "long", count: 2, net: 80 }, { key: "short", label: "short", count: 1, net: -20 }]);
    expect(out.dims.gtags.map((b) => [b.key, b.count])).toEqual([["FOMO", 1], ["IMX", 1], ["__none__", 1]]);
    expect(out.dims.ptags.map((b) => [b.key, b.count])).toEqual([["myTag", 1], ["ORB", 1], ["__none__", 1]]);
    expect(out.dims.days.map((b) => b.key)).toEqual(["1", "3", "4"]); // Mon 2025-03-03, Wed 06-10, Thu 06-11
    expect(out.dims.times.map((b) => b.key).sort()).toEqual(["13:30-15:30", "9:30-9:50", "9:50-10:10"].sort());
  });

  it("an excluded bucket drops trades from the other columns but keeps its own numbers; excludeImx keeps the IMX line", async () => {
    const out = await facets("Kirill", { xYears: "2025", excludeImx: "1" });
    expect(out.total).toEqual({ count: 1, net: -20 });
    expect(out.imx).toEqual({ count: 1, net: 50 });
    expect(out.dims.years.map((b) => [b.key, b.count])).toEqual([["2026", 1], ["2025", 1]]);
    const tagsOff = await facets("Kirill", { xGtags: "IMX,__none__" });
    expect(tagsOff.total.count).toBe(1); // only the trade with FOMO stays
    const desk = await facets(null);
    expect(desk.total.count).toBe(4);
  });

  it("the page WHERE and the /stats/aggregate tail apply the same selection", async () => {
    const f = parseFacetQuery({ excludeImx: "1", xTypes: "short" }, DESK_TAGS);
    const p = new Params();
    const { rows } = await q(`SELECT t.id FROM trades t WHERE ${buildWhere({ scope: "Kirill", facets: f }, p, { quality: false })}`, p.list);
    expect(rows.map((r) => r.id)).toEqual([ids.opg]);
    const params: unknown[] = ["Kirill"];
    const tail = facetSqlTail(f, params);
    const agg = await q(`SELECT t.id FROM trades t WHERE t.deleted_at IS NULL AND t.trader = $1${tail}`, params);
    expect(agg.rows.map((r) => r.id)).toEqual([ids.opg]);
  });
});
