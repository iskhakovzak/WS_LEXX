/**
 * Strategy set v4 on a scratch Postgres built from the repository migrations (0243):
 *  - the desk Print cluster: 2 traders exiting a pre-market position at the same second stay OPGtoDAY, the third trader's
 *    trade (PropReports sync path = refreshTradeStrategies, or the backfill) turns all three into Print — the peers are
 *    rewritten by the refresh of the new trade; one trader twice counts once; a different second / ticker / day does
 *    not join; 09:45:00 is out; the broker openedAt / closedAt (naive ET, trades_ny_wall) feed the cluster like fills;
 *  - a peer leaving (soft delete, ticker change, hard delete — 0243 triggers) breaks the cluster again;
 *  - is_imx apart from the strategy (a pre-market entry closed in the auction = OPGtoDAY + IMX + tag);
 *  - Overnight vs Swing by trading days with the seeded holiday_calendar (Thursday → Monday over 2026-07-03).
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

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noReload = async () => {};
const DAY = "2026-10-16";

describe.skipIf(!available)("strategy v4: Print cluster, IMX mark, Swing", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  const ids: Record<string, number> = {};

  type T = { trader: string; ticker?: string; date?: string; exitDate?: string; entry?: string; exit?: string; snap?: object };
  /** A trade with an entry / exit fill at NY wall times (or only the broker snapshot). */
  const trade = async (key: string, v: T) => {
    const date = v.date ?? DAY;
    const { rows } = await q(
      `INSERT INTO trades (ticker, date, exit_date, side, result, pnl, fees, qty, entry, trader, horizon, context_snapshot)
       VALUES ($1, $2, $3, 'Long', 'win', 10, 0, 100, 10, $4, 'intraday', $5::jsonb) RETURNING id`,
      [v.ticker ?? "NYX", date, v.exitDate ?? null, v.trader, JSON.stringify(v.snap ?? {})],
    );
    ids[key] = Number(rows[0].id);
    for (const [kind, at] of [["entry", v.entry], ["exit", v.exit]] as const) {
      if (!at) continue;
      await q(
        `INSERT INTO trade_executions (trade_id, kind, price, qty, executed_at) VALUES ($1, $2, 10, 100, ($3::text || ' America/New_York')::timestamptz)`,
        [ids[key], kind, at.includes(" ") ? at : `${date} ${at}`],
      );
    }
    return ids[key]!;
  };
  const strategy = async (key: string) => (await q(`SELECT strategy FROM trades WHERE id = $1`, [ids[key]])).rows[0].strategy;
  const strategies = async (...keys: string[]) => Promise.all(keys.map(strategy));
  const backfill = () => backfillTradeStrategies(db.pool, 1000, noReload);

  beforeAll(async () => {
    db = await createScratchDb("print4");
    holder.pool = db.pool;
    q = (sql, params) => db.pool.query(sql, params as unknown[]);
    await runMigrationFiles({ pool: db.pool, logger: silent, dir: resolveMigrationsDir() });
    // NYX, auction print at 09:33:12: Ann (twice), Bob; Dan one second later; Eve on another ticker; Fay another day.
    await trade("ann", { trader: "Ann", entry: "09:10:00", exit: "09:33:12" });
    await trade("ann2", { trader: "Ann", entry: "09:20:00", exit: "09:33:12" });
    await trade("bob", { trader: "Bob", snap: { openedAt: `${DAY}T09:05:00`, closedAt: `${DAY}T09:33:12` } }); // broker clock only
    await trade("dan", { trader: "Dan", entry: "09:15:00", exit: "09:33:13" });
    await trade("eve", { trader: "Eve", ticker: "OTHER", entry: "09:15:00", exit: "09:33:12" });
    await trade("fay", { trader: "Fay", date: "2026-10-15", entry: "09:15:00", exit: "09:33:12" });
    // 09:45:00 cluster of three: out of the window
    for (const tr of ["Ann", "Bob", "Cat"]) await trade(`late${tr}`, { trader: tr, ticker: "LATE", entry: "09:00:00", exit: "09:45:00" });
    // Nasdaq open print / pre-market round trip / regular entry
    await trade("cross", { trader: "Ann", ticker: "NDQ", entry: "09:29:59", exit: "09:30:01" });
    await trade("pm", { trader: "Ann", ticker: "META", entry: "08:00:00", exit: "09:29:59" });
    await trade("reg", { trader: "Ann", ticker: "REG", entry: "09:30:00", exit: "09:30:01" });
    // IMX apart from the strategy
    await trade("pmImx", { trader: "Ann", ticker: "IMXP", entry: "08:00:00", exit: "15:58:00" });
    await trade("regImx", { trader: "Ann", ticker: "IMXR", entry: "10:00:00", exit: "15:58:00" });
    // Thursday → Monday over the 2026-07-03 holiday; Friday → Tuesday
    await trade("hol", { trader: "Ann", ticker: "HOL", date: "2026-07-02", exitDate: "2026-07-06", entry: "2026-07-02 15:00:00", exit: "2026-07-06 10:00:00" });
    await trade("swing", { trader: "Ann", ticker: "SWG", date: "2026-10-09", exitDate: "2026-10-13", entry: "2026-10-09 15:00:00", exit: "2026-10-13 10:00:00" });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("two traders at one second are not a cluster; boundaries of the cross, the round trip and the regular entry", async () => {
    await backfill();
    expect(await strategies("ann", "ann2", "bob", "dan", "eve", "fay")).toEqual(Array(6).fill("OPGtoDAY"));
    expect(await strategies("lateAnn", "lateBob", "lateCat")).toEqual(["OPGtoDAY", "OPGtoDAY", "OPGtoDAY"]);
    expect(await strategies("cross", "pm", "reg")).toEqual(["Print", "OPG", "Day"]);
  });

  it("is_imx is apart from the strategy; the IMX tag follows it", async () => {
    const { rows } = await q(`SELECT id, strategy, is_imx, tags FROM trades WHERE id = ANY($1::int[]) ORDER BY id`, [[ids.pmImx, ids.regImx, ids.ann]]);
    expect(rows.map((r) => [r.strategy, r.is_imx, r.tags])).toEqual([["OPGtoDAY", false, null], ["OPGtoDAY", true, "IMX"], ["MOC", true, "IMX"]]);
  });

  it("Overnight vs Swing count trading days with the market calendar", async () => {
    expect(await strategies("hol", "swing")).toEqual(["Overnight", "Swing"]);
  });

  it("a third trader's trade arriving (sync path) turns the same-second exits into Print, peers included", async () => {
    const cat = await trade("cat", { trader: "Cat", entry: "09:25:00", exit: "09:33:12" });
    await refreshTradeStrategies([cat], db.pool);
    expect(await strategies("ann", "ann2", "bob", "cat")).toEqual(["Print", "Print", "Print", "Print"]);
    expect(await strategies("dan", "eve", "fay")).toEqual(["OPGtoDAY", "OPGtoDAY", "OPGtoDAY"]);
    expect((await backfill()).trades).toBe(0); // the peers' signatures stay valid
  });

  it("a soft-deleted peer breaks the cluster (stale → backfill → peers rewritten), restoring it brings it back", async () => {
    await q(`UPDATE trades SET deleted_at = now() WHERE id = $1`, [ids.cat]);
    await backfill();
    expect(await strategies("ann", "bob")).toEqual(["OPGtoDAY", "OPGtoDAY"]);
    await q(`UPDATE trades SET deleted_at = NULL WHERE id = $1`, [ids.cat]);
    await backfill();
    expect(await strategies("ann", "bob", "cat")).toEqual(["Print", "Print", "Print"]);
  });

  it("a peer moved to another ticker marks the old ticker-day stale (0243 trigger)", async () => {
    await q(`UPDATE trades SET ticker = 'MOVED' WHERE id = $1`, [ids.bob]);
    expect((await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids.ann])).rows[0].strategy_sig).toBeNull();
    expect((await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids.eve])).rows[0].strategy_sig).not.toBeNull();
    await backfill();
    expect(await strategies("ann", "cat", "bob")).toEqual(["OPGtoDAY", "OPGtoDAY", "OPGtoDAY"]);
    await q(`UPDATE trades SET ticker = 'NYX' WHERE id = $1`, [ids.bob]);
    await backfill();
    expect(await strategies("ann", "cat", "bob")).toEqual(["Print", "Print", "Print"]);
  });

  it("a hard-deleted peer marks the ticker-day stale (0243 trigger)", async () => {
    await q(`DELETE FROM trades WHERE id = $1`, [ids.cat]);
    expect((await q(`SELECT strategy_sig FROM trades WHERE id = $1`, [ids.bob])).rows[0].strategy_sig).toBeNull();
    await backfill();
    expect(await strategies("ann", "ann2", "bob")).toEqual(["OPGtoDAY", "OPGtoDAY", "OPGtoDAY"]);
  });

  it("trades_ny_wall: naive wall clocks as is, zoned strings converted, garbage NULL", async () => {
    const { rows } = await q(`SELECT trades_ny_wall('2026-10-16T09:27:41')::text AS a, trades_ny_wall('2026-10-16 09:27')::text AS b,
      trades_ny_wall('2026-10-16T13:27:41Z')::text AS c, trades_ny_wall('nope') AS d, trades_ny_wall('') AS e`);
    expect(rows[0]).toEqual({ a: "2026-10-16 09:27:41", b: "2026-10-16 09:27:00", c: "2026-10-16 09:27:41", d: null, e: null });
  });
});
