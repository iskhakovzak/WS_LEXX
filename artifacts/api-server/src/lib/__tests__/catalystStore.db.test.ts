/**
 * Catalyst marks + strategy formula on a scratch database built from every migration (0276 included): the table and
 * its checks, the upsert of the two taps, the automatic link of trades to marks in SQL (variant → parent setup), the
 * formula column round trip, the day-two lines from the candle archive and the formula check. Synthetic people only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const A = "Synth Catalyst A";

describe.skipIf(!available)("catalyst marks and strategy formula (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("catalyst");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("migration 0276: the table, its checks and playbook.formula", async () => {
    const cols = await db.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'catalyst_marks' ORDER BY ordinal_position`);
    expect(cols.rows.map((r) => r.column_name)).toEqual(["trader", "day", "ticker", "direction", "strength", "kind", "source", "suggested", "created_at", "updated_at"]);
    await expect(db.pool.query(`INSERT INTO catalyst_marks (trader, day, ticker, strength) VALUES ($1, '2026-10-20', 'tmus', 'strong')`, [A])).rejects.toThrow(/check/i);
    await expect(db.pool.query(`INSERT INTO catalyst_marks (trader, day, ticker, strength) VALUES ($1, '2026-10-20', 'TMUS', 'huge')`, [A])).rejects.toThrow(/check/i);
    await expect(db.pool.query(`INSERT INTO playbook (name, formula) VALUES ('Bad', '"text"'::jsonb)`)).rejects.toThrow(/playbook_formula_check/);
  });

  it("saveMark upserts the whole state of the two taps; a cleared mark stays as unmarked", async () => {
    const { saveMark, marksOf } = await import("../catalyst/store");
    await saveMark(A, "2026-10-19", "AAPL", { direction: "bull", strength: null, kind: "earnings", source: "watchlist", suggested: true });
    const m = await saveMark(A, "2026-10-19", "AAPL", { direction: "bull", strength: "strong", kind: null, source: "plan", suggested: false });
    expect(m).toMatchObject({ direction: "bull", strength: "strong", kind: "earnings", source: "plan" }); // kind kept from the suggestion
    await saveMark(A, "2026-10-19", "MSFT", { direction: null, strength: null, kind: null, source: "plan", suggested: false });
    expect((await marksOf(A, "2026-10-19", "2026-10-19")).map((x) => [x.ticker, x.strength])).toEqual([["AAPL", "strong"], ["MSFT", null]]);
  });

  it("links trades to marks by trader / entry day / ticker and rolls a variant up to its setup", async () => {
    const { saveMark, edgeOf } = await import("../catalyst/store");
    const p = await db.pool.query(`INSERT INTO playbook (name, space) VALUES ('Opening Drive', 'office') RETURNING id`);
    const parent = Number(p.rows[0].id);
    const v = await db.pool.query(`INSERT INTO playbook (name, space, parent_id) VALUES ('OD: rubber band to VWAP', 'office', $1) RETURNING id`, [parent]);
    const child = Number(v.rows[0].id);
    const ins = (ticker: string, date: string, pnl: number, playbookId: number | null) => db.pool.query(
      `INSERT INTO trades (ticker, date, result, pnl, fees, trader, playbook_id, source) VALUES ($1, $2, $3, $4, 1, $5, $6, 'propreports')`,
      [ticker, date, pnl > 0 ? "win" : "loss", pnl, A, playbookId],
    );
    await saveMark(A, "2026-10-20", "WEAK", { direction: "bull", strength: "weak", kind: null, source: "plan", suggested: false });
    await ins("weak", "2026-10-20 09:41:00", -100, parent);
    await ins("WEAK", "2026-10-20", -50, child);
    await ins("WEAK", "2026-10-20", -30, parent);
    await ins("WEAK", "2026-10-21", 70, parent); // next day: no mark
    await ins("NONE", "2026-10-20", 40, null);
    const e = await edgeOf(A, "2026-10-20", "2026-10-21");
    expect(e.total).toBe(5);
    expect(e.buckets.map((b) => [b.key, b.n, b.net])).toEqual([["weak_bull", 3, -183], ["none", 2, 108]]);
    expect(e.bySetup).toEqual([expect.objectContaining({ setupId: parent, setupName: "Opening Drive", n: 4 })]);
    expect(e.insight).toMatchObject({ setupId: parent, strength: "weak", n: 3, net: -183 });
  });

  it("formula round trip, the day-two line from the archive and the formula check", async () => {
    const { normFormula } = await import("../strategyFormula");
    const { saveMark, dayTwoOf, formulaBreaksOf } = await import("../catalyst/store");
    const f = normFormula({ catalyst: { kind: "news", strength: "strong", direction: "bear" }, setup: "Day two below VWAP", trade: "first lower high, stop above it" });
    const s = await db.pool.query(`INSERT INTO playbook (name, setup_type, space, formula) VALUES ('Second Day Play', 'Second Day Play', 'office', $1::jsonb) RETURNING id, formula`, [JSON.stringify(f)]);
    const setupId = Number(s.rows[0].id);
    expect(normFormula(s.rows[0].formula)).toEqual(f);

    await saveMark(A, "2026-10-20", "TMUS", { direction: "bear", strength: "strong", kind: "news", source: "plan", suggested: false });
    await db.pool.query(
      `INSERT INTO candle_archive (symbol, day, tf, enc, extended, bar_count, payload, source, fetched_at, rth_open, rth_high, rth_low, rth_close, prev_close)
       VALUES ('TMUS', '2026-10-20', '5m', 1, false, 1, '\\x00'::bytea, 'yahoo', now(), 97, 98, 91, 92.5, 100)`,
    );
    const two = await dayTwoOf(A, "2026-10-21", 4);
    expect(two.yesterday).toBe("2026-10-20");
    expect(two.hints).toEqual([expect.objectContaining({ ticker: "TMUS", direction: "bear", source: "mark", movePct: -7.5, setupId, setupName: "Second Day Play" })]);

    await db.pool.query(`INSERT INTO trades (ticker, date, result, pnl, trader, playbook_id) VALUES ('NOCAT', '2026-10-21', 'loss', -20, $1, $2)`, [A, setupId]);
    await db.pool.query(`INSERT INTO trades (ticker, date, result, pnl, trader, playbook_id) VALUES ('TMUS', '2026-10-20', 'win', 90, $1, $2)`, [A, setupId]);
    const breaks = await formulaBreaksOf(A, "2026-10-14", "2026-10-21");
    expect(breaks.map((b) => [b.ticker, b.reason, b.setupName])).toEqual([["NOCAT", "unmarked", "Second Day Play"]]);
  });
});
