/**
 * Live leak guard end to end on a scratch database built from every migration: a Джун whose re-entries after a loss
 * cost money gets a firm pause at the scan after a new loss, the curator is told when it is not confirmed, and the
 * finished pause settles as complied with the trader's own expected cost as «saved». Synthetic people only; no
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
const TRADER = "Guard Junior";
const CURATOR = "Guard Curator";
const DAY = "2026-10-21"; // a Wednesday (EDT, UTC−4)
/** NY wall time of DAY → Date. */
const ny = (hh: number, mm: number) => new Date(`${DAY}T${String(hh + 4).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
const wall = (day: string, hh: number, mm: number) => `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;

describe.skipIf(!available)("leak guard scan (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("leakguard");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(
      `INSERT INTO users (name, role, active, assigned_curator) VALUES ($1, 'curator', true, NULL), ($2, 'trader', true, $1)`,
      [CURATOR, TRADER],
    );
    const rows: Array<[string, string, string, string, number]> = [];
    for (let d = 1; d <= 14; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      if ([3, 4, 10, 11].includes(d)) continue; // weekends
      rows.push([day, wall(day, 9, 45), wall(day, 9, 50), "win", 35]);
      rows.push([day, wall(day, 10, 0), wall(day, 10, 5), "loss", -40]);
      rows.push([day, wall(day, 10, 8), wall(day, 10, 12), "loss", -60 - d]); // re-entry 3 min after the loss
      rows.push([day, wall(day, 13, 0), wall(day, 13, 10), "win", 25 + (d % 3)]);
      rows.push([day, wall(day, 14, 0), wall(day, 14, 10), "win", 20 + (d % 4)]);
    }
    rows.push([DAY, wall(DAY, 10, 30), wall(DAY, 10, 35), "loss", -55]); // today's loss, exit 10:35 NY
    const values: unknown[] = [];
    const tuples = rows.map(([day, opened, closed, result, pnl]) => {
      values.push(TRADER, day, result, pnl, JSON.stringify({ openedAt: opened, closedAt: closed }));
      const b = values.length - 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 0, 'SYN', 100, 10, 'propreports', $${b + 5}::jsonb)`;
    });
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker, qty, entry, source, context_snapshot) VALUES ${tuples.join(", ")}`, values);
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("detects the loss, asks a Джун to confirm the pause, escalates without it, then settles as complied", async () => {
    const { runLeakGuardScan } = await import("../leakGuard/scan");
    const first = await runLeakGuardScan(ny(10, 37));
    expect(first).toMatchObject({ created: 1, told: 1 });
    const { rows: [ev] } = await db.pool.query(`SELECT * FROM leak_guard_events WHERE trader = $1`, [TRADER]);
    expect(ev).toMatchObject({ pattern: "after_loss", level: "firm", late: false, silent_reason: null });
    expect(new Date(ev.pause_until).toISOString()).toBe(new Date(ny(10, 45)).toISOString());
    expect(Number(ev.cost_per_trade)).toBeGreaterThan(50);
    const told = await db.pool.query(`SELECT user_name, params FROM notifications WHERE type = 'leak_guard' ORDER BY id`);
    expect(told.rows.map((r) => r.user_name)).toEqual([TRADER]);
    expect(told.rows[0].params).toMatchObject({ variant: "trader", patternCode: "after_loss", levelCode: "firm", minutes: 10 });

    const store = await import("../leakGuard/store");
    expect((await store.listEvents(null, DAY, DAY)).map((e) => e.pattern)).toEqual(["after_loss"]);
    expect(await store.activeEvents(TRADER, DAY)).toEqual([]); // the DB clock is past this synthetic day's pause

    // the same sync seen again: nothing new
    expect(await runLeakGuardScan(ny(10, 38))).toMatchObject({ created: 0, told: 0, escalated: 0 });
    // no confirmation within ackMinutes (3): the curator is told, once
    expect(await runLeakGuardScan(ny(10, 41))).toMatchObject({ escalated: 1 });
    expect(await runLeakGuardScan(ny(10, 42))).toMatchObject({ escalated: 0 });
    const cur = await db.pool.query(`SELECT params FROM notifications WHERE type = 'leak_guard' AND user_name = $1`, [CURATOR]);
    expect(cur.rows).toHaveLength(1);
    expect(cur.rows[0].params).toMatchObject({ variant: "ignored", trader: TRADER, reasonCode: "noAck" });

    // the pause is over without a new entry: complied, saved = the trader's expected cost of one loss
    expect(await runLeakGuardScan(ny(10, 46))).toMatchObject({ settled: 1 });
    const { rows: [done] } = await db.pool.query(`SELECT outcome, saved_usd, lost_usd, cost_per_trigger FROM leak_guard_events WHERE trader = $1`, [TRADER]);
    expect(done.outcome).toBe("complied");
    expect(Number(done.saved_usd)).toBe(Number(done.cost_per_trigger));
    expect(Number(done.lost_usd)).toBe(0);
  });
});
