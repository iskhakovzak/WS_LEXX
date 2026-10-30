/**
 * Live risk signals end to end on a scratch database built from every migration: a trader whose past days show a
 * 3-loss streak followed by more losses gets a loss-streak alert and the 70 / 90 % stop alerts today, each stored once
 * (a repeated scan and a restart add nothing), the curator is told once about the critical 90 % level, and after the
 * session the alerts settle with the «desk saved» estimate vs the trader's own history. Synthetic people only; no
 * Telegram (tests never send).
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
const TRADER = "Signal Trader";
const CURATOR = "Signal Curator";
const DAY = "2026-10-21"; // a Wednesday (EDT, UTC−4)
const ny = (hh: number, mm: number) => new Date(`${DAY}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
const wall = (day: string, hh: number, mm: number) => `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;

describe.skipIf(!available)("risk signals scan (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  const insertTrades = async (rows: Array<[string, string, string, string, number]>) => {
    const values: unknown[] = [];
    const tuples = rows.map(([day, opened, closed, result, pnl]) => {
      values.push(TRADER, day, result, pnl, JSON.stringify({ openedAt: opened, closedAt: closed }));
      const b = values.length - 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 0, 'SYN', 100, 10, 'propreports', $${b + 5}::jsonb)`;
    });
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker, qty, entry, source, context_snapshot) VALUES ${tuples.join(", ")}`, values);
  };

  beforeAll(async () => {
    db = await createScratchDb("risksignals");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(
      `INSERT INTO users (name, role, active, assigned_curator) VALUES ($1, 'curator', true, NULL), ($2, 'trader', true, $1)`,
      [CURATOR, TRADER],
    );
    await db.pool.query(`INSERT INTO trader_risk_limits (trader, daily_loss_limit) VALUES ($1, 130)`, [TRADER]);
    // History: every weekday a 3-loss streak (−120, 92 % of the stop), then +30 and −50 → the rest of the session −20.
    const rows: Array<[string, string, string, string, number]> = [];
    for (let d = 1; d <= 14; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      if ([3, 4, 10, 11].includes(d)) continue; // weekends
      rows.push([day, wall(day, 10, 0), wall(day, 10, 5), "loss", -40]);
      rows.push([day, wall(day, 10, 10), wall(day, 10, 15), "loss", -40]);
      rows.push([day, wall(day, 10, 20), wall(day, 10, 25), "loss", -40]);
      rows.push([day, wall(day, 11, 0), wall(day, 11, 30), "win", 30]);
      rows.push([day, wall(day, 12, 0), wall(day, 12, 30), "loss", -50]);
    }
    // Today: the same streak by 10:25.
    rows.push([DAY, wall(DAY, 10, 0), wall(DAY, 10, 5), "loss", -40]);
    rows.push([DAY, wall(DAY, 10, 10), wall(DAY, 10, 15), "loss", -40]);
    rows.push([DAY, wall(DAY, 10, 20), wall(DAY, 10, 25), "loss", -40]);
    await insertTrades(rows);
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("stores each alert once, tells the curator once about the critical level, settles vs the trader's history", async () => {
    const { runRiskSignals, resetRiskSignalState } = await import("../riskSignals/scan");
    const first = await runRiskSignals(ny(10, 27), { traders: [TRADER] });
    expect(first).toMatchObject({ traders: 1, created: 3, staffTold: 1 });
    const { rows } = await db.pool.query(`SELECT signal, level, severity, staff_notified_at FROM risk_signal_alerts WHERE trader = $1 ORDER BY signal, level`, [TRADER]);
    expect(rows.map((r) => [r.signal, r.level, r.severity])).toEqual([
      ["loss_streak", "3", "warn"], ["stop_proximity", "70", "warn"], ["stop_proximity", "90", "critical"],
    ]);
    expect(rows.filter((r) => r.staff_notified_at).map((r) => r.level)).toEqual(["90"]);
    const told = await db.pool.query(`SELECT user_name, params FROM notifications WHERE type = 'risk_signal'`);
    expect(told.rows.map((r) => r.user_name)).toEqual([CURATOR]);
    expect(told.rows[0].params).toMatchObject({ variant: "staff", trader: TRADER, signal: "stop_proximity", level: "90" });

    // The same sync again, and after a restart (the in-memory set refills from the DB): nothing new, nobody told twice.
    expect(await runRiskSignals(ny(10, 28))).toMatchObject({ created: 0, staffTold: 0 });
    resetRiskSignalState();
    expect(await runRiskSignals(ny(10, 29))).toMatchObject({ created: 0, staffTold: 0 });
    const store = await import("../riskSignals/store");
    expect(await store.insertAlert(TRADER, DAY, { signal: "loss_streak", level: "3", severity: "warn", at: ny(10, 25).getTime(), tradeId: null, stats: {} }, null)).toBeNull();

    // The rest of today: one +60 win after the streak. History after the same situation: −20 on each of 10 days.
    await insertTrades([[DAY, wall(DAY, 12, 0), wall(DAY, 12, 30), "win", 60]]);
    expect(await runRiskSignals(ny(16, 45))).toMatchObject({ settled: 3 });
    const { rows: done } = await db.pool.query(
      `SELECT signal, level, rest_net, baseline_rest, baseline_n, saved_usd FROM risk_signal_alerts WHERE trader = $1 ORDER BY signal, level`, [TRADER],
    );
    const streak = done.find((r) => r.signal === "loss_streak")!;
    expect([Number(streak.rest_net), Number(streak.baseline_rest), streak.baseline_n, Number(streak.saved_usd)]).toEqual([60, -20, 10, 80]);
    expect(done.every((r) => r.baseline_n === 10 && Number(r.saved_usd) === 80)).toBe(true);

    const { summarizeSaved } = await import("../riskSignals/saved");
    const all = await store.alertsBetween(DAY, DAY, null);
    expect(summarizeSaved(all.map((a) => ({ day: a.day, signal: a.signal, settled: a.settledAt != null, saved: a.saved, cases: a.baselineN }))))
      .toMatchObject({ alerts: 3, estimated: 3, hidden: 0, saved: 240, cases: 30 });
  });

  it("entry-time: an OPEN position (the live sync's row from the opening fill) alerts at once; its close adds nothing", async () => {
    const ENTRY = "Signal Entry Trader";
    await db.pool.query(`INSERT INTO users (name, role, active, assigned_curator) VALUES ($1, 'trader', true, $2)`, [ENTRY, CURATOR]);
    // Own normal: 20 past trades of $1 000 notional. Today's plan: AAPL only, FOMC statement at 14:00 (high impact).
    const past: unknown[] = [];
    const tuples: string[] = [];
    for (let i = 0; i < 20; i++) {
      const day = `2026-10-${String(12 + (i % 4)).padStart(2, "0")}`;
      past.push(ENTRY, day, JSON.stringify({ openedAt: wall(day, 10, i), closedAt: wall(day, 10, i + 1) }));
      const b = past.length - 3;
      tuples.push(`($${b + 1}, $${b + 2}, 'win', 10, 0, 'AAPL', 100, 10, 'propreports', $${b + 3}::jsonb)`);
    }
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker, qty, entry, source, context_snapshot) VALUES ${tuples.join(", ")}`, past);
    await db.pool.query(`INSERT INTO trader_plans (trader, date, doc) VALUES ($1, $2, $3::jsonb)`, [
      ENTRY, DAY, JSON.stringify({ inPlay: [{ ticker: "AAPL" }], macro: [{ time: "14:00", title: "FOMC statement", impact: "high" }] }),
    ]);
    await db.pool.query(
      `INSERT INTO trades (trader, date, result, pnl, fees, ticker, qty, entry, source, context_snapshot)
       VALUES ($1, $2, 'loss', -80, 0, 'AAPL', 100, 10, 'propreports', $3::jsonb)`,
      [ENTRY, DAY, JSON.stringify({ openedAt: wall(DAY, 13, 50), closedAt: wall(DAY, 14, 0) })],
    );
    // 14:02 the opening fill of an off-plan, 3× size position inside the FOMC window — still open (no exit, no P&L yet).
    const { rows: [openRow] } = await db.pool.query(
      `INSERT INTO trades (trader, date, result, pnl, fees, ticker, qty, entry, source, context_snapshot)
       VALUES ($1, $2, 'open', 0, 0, 'TSLA', 300, 10, 'propreports', $3::jsonb) RETURNING id`,
      [ENTRY, DAY, JSON.stringify({ openedAt: wall(DAY, 14, 2), closedAt: null })],
    );

    const { scanTradersNow } = await import("../riskSignals/scan");
    expect(await scanTradersNow([ENTRY], new Date(ny(14, 2).getTime() + 3_000))).toMatchObject({ traders: 1, created: 3, staffTold: 1, settled: 0 });
    const { rows } = await db.pool.query(`SELECT signal, level, trade_id, triggered_at FROM risk_signal_alerts WHERE trader = $1 ORDER BY signal, level`, [ENTRY]);
    expect(rows.map((r) => [r.signal, r.level])).toEqual([["banned_window", "14:00"], ["off_plan", "TSLA"], ["revenge", "size"]]);
    expect(rows.every((r) => Number(r.trade_id) === Number(openRow.id) && new Date(r.triggered_at).getTime() === ny(14, 2).getTime())).toBe(true);

    // 14:20 the same row closes at a loss (the live sync updates it in place): nothing new, nobody told twice.
    await db.pool.query(
      `UPDATE trades SET result = 'loss', pnl = -60, exit = 9.8, context_snapshot = context_snapshot || $2::jsonb WHERE id = $1`,
      [openRow.id, JSON.stringify({ closedAt: wall(DAY, 14, 20) })],
    );
    expect(await scanTradersNow([ENTRY], ny(14, 21))).toMatchObject({ created: 0, staffTold: 0 });
    const { rows: after } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM risk_signal_alerts WHERE trader = $1`, [ENTRY]);
    expect(after[0].n).toBe(3);
  });
});
