/**
 * «Разрезы» on the period pages (scratch Postgres from the migrations): the loaders of /behavior (+ /setups-auto),
 * /what-if, /edge/matrix|costs (/analytics) and the id filter of /analytics/psychology and /office-stats apply the same
 * selection as /trades: «Исключить IMX» and an excluded ticker drop exactly those trades; no selection changes nothing.
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
const { backfillTradeStrategies } = await import("../../lib/tradeStrategyStore");
const { loadBehaviorRows } = await import("../behavior");
const { querySimTrades } = await import("../../lib/whatIfLoader");
const { buildCostsQuery, parseCostsQuery } = await import("../edge");
const { facetCacheKey, facetPassingIds, facetsOfQuery } = await import("../../lib/tradeFacetsFilter");

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("«Разрезы» on the period pages", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  const ids: Record<string, number> = {};

  const trade = async (key: string, v: { ticker: string; date: string; pnl: number; fills: [string, string][] }) => {
    const { rows } = await q(
      `INSERT INTO trades (ticker, date, side, result, pnl, fees, qty, entry, trader, horizon)
       VALUES ($1, $2, 'Long', $3, $4, 0, 100, 10, 'Kirill', 'intraday') RETURNING id`,
      [v.ticker, v.date, v.pnl > 0 ? "win" : "loss", v.pnl],
    );
    ids[key] = Number(rows[0].id);
    for (const [kind, ts] of v.fills) {
      await q(`INSERT INTO trade_executions (trade_id, kind, price, qty, executed_at) VALUES ($1, $2, 10, 100, ($3::text || ' America/New_York')::timestamptz)`, [ids[key], kind, ts]);
    }
  };

  beforeAll(async () => {
    db = await createScratchDb("pagefacets");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    await trade("imx", { ticker: "AAPL", date: "2026-06-10", pnl: 50, fills: [["entry", "2026-06-10 15:52:00"], ["exit", "2026-06-10 15:59:58"]] });
    await trade("aapl", { ticker: "AAPL", date: "2026-06-11", pnl: -20, fills: [["entry", "2026-06-11 10:00:00"], ["exit", "2026-06-11 11:00:00"]] });
    await trade("nvda", { ticker: "NVDA", date: "2026-06-12", pnl: 30, fills: [["entry", "2026-06-12 10:00:00"], ["exit", "2026-06-12 10:30:00"]] });
    await backfillTradeStrategies();
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  const all = () => [ids.imx, ids.aapl, ids.nvda].sort();
  const sel = (raw: Record<string, string>) => facetsOfQuery(raw);

  it("parses the x* params like /trades (and rejects oversized ones)", () => {
    expect(sel({})).toBeUndefined();
    expect(facetCacheKey(sel({}))).toBe("");
    expect(facetCacheKey(sel({ xTickers: "nvda,AAPL", excludeImx: "1" }))).toBe(facetCacheKey(sel({ excludeImx: "1", xTickers: "AAPL,nvda" })));
    expect(() => sel({ xYears: "x".repeat(5000) })).toThrow();
  });

  it("/behavior + /setups-auto rows", async () => {
    expect((await loadBehaviorRows("Kirill")).map((r) => Number(r.id)).sort()).toEqual(all());
    expect((await loadBehaviorRows("Kirill", undefined, undefined, undefined, undefined, sel({ excludeImx: "1" }))).map((r) => Number(r.id)).sort()).toEqual([ids.aapl, ids.nvda].sort());
    expect((await loadBehaviorRows("Kirill", "2026-06-01", "2026-06-30", undefined, undefined, sel({ xTickers: "AAPL" }))).map((r) => Number(r.id))).toEqual([ids.nvda]);
  });

  it("/what-if engine trades", async () => {
    expect((await querySimTrades("Kirill")).map((t) => t.id).sort()).toEqual(all());
    expect((await querySimTrades("Kirill", undefined, undefined, sel({ xTickers: "NVDA", excludeImx: "1" }))).map((t) => t.id)).toEqual([ids.aapl]);
  });

  it("/edge (analytics matrix, desk, costs) WHERE", async () => {
    const parsed = parseCostsQuery({ group: "trader", trader: "Kirill", xTickers: "AAPL" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { sql, params } = buildCostsQuery(parsed.q, "Kirill");
    const { rows } = await q(sql, params);
    expect(rows.reduce((s, r) => s + Number(r.trades), 0)).toBe(1);
  });

  it("the id filter of /analytics/psychology and /office-stats", async () => {
    expect([...(await facetPassingIds(undefined, all()))].sort()).toEqual(all());
    expect([...(await facetPassingIds(sel({ excludeImx: "1" }), all()))].sort()).toEqual([ids.aapl, ids.nvda].sort());
  });
});
