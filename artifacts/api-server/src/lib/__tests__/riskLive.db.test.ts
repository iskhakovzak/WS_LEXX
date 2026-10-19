/**
 * RISK-LIVE against a real Postgres: a scratch database built from the repository migrations (0221 included), then the
 * snapshot upsert / emptying, the per-trader live read, the once-per-threshold claim + outbox row, and the alert log.
 * Skips when the local server is down.
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

describe.skipIf(!available)("live positions + risk alerts (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("risklive");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
  }, 120_000);
  afterAll(async () => { await db?.drop(); });

  const T = "Денис Ф.";
  const DATE = "2026-10-19";

  it("saveLiveSnapshots upserts per account, empties the accounts a later run no longer has; loadLiveSnapshots sums per trader", async () => {
    const { saveLiveSnapshots } = await import("../livePositions");
    const { loadLiveSnapshots } = await import("../riskData");
    const t1 = new Date("2026-10-19T15:00:00Z");
    await saveLiveSnapshots([
      { account: "DEN-1", trader: T, openCount: 2, unrealized: -420, unrealizedDelta: -420, realized: 15.5, positions: [{ symbol: "AAPL", qty: 200, avg: 180.5, close: 179, unrealized: -300 }] },
      { account: "DEN-2", trader: T, openCount: 1, unrealized: 20, unrealizedDelta: 20, realized: 0, positions: [] },
      { account: "OLG002", trader: null, openCount: 1, unrealized: 100, unrealizedDelta: 100, realized: 0, positions: [] },
    ], DATE, t1);
    let live = await loadLiveSnapshots(DATE);
    expect(live.get(T)).toEqual({ date: DATE, unrealizedUsd: -400, openPositions: 3, fetchedAt: t1.toISOString() });
    expect(live.size).toBe(1); // unmapped account: no trader

    const t2 = new Date("2026-10-19T15:05:00Z");
    await saveLiveSnapshots([{ account: "DEN-1", trader: T, openCount: 1, unrealized: -50, unrealizedDelta: -50, realized: 0, positions: [] }], DATE, t2);
    live = await loadLiveSnapshots(DATE, [T]);
    expect(live.get(T)).toMatchObject({ unrealizedUsd: -50, openPositions: 1, fetchedAt: t2.toISOString() });
    const { rows } = await db.pool.query(`SELECT account, open_count, unrealized::float AS u FROM propreports_live_positions ORDER BY account`);
    expect(rows).toEqual([{ account: "DEN-1", open_count: 1, u: -50 }, { account: "DEN-2", open_count: 0, u: 0 }, { account: "OLG002", open_count: 0, u: 0 }]);
    expect((await loadLiveSnapshots("2026-10-20")).size).toBe(0);
  });

  it("claimAndQueue: one outbox row per trader / day / threshold; the handler writes the alert log once", async () => {
    const { claimAndQueue } = await import("../riskAlertQueue");
    const { logStopAlert } = await import("../riskAlerts");
    const p = {
      trader: T, date: DATE, state: "stop" as const, halted: true, used: 350, limit: 300, message: "стоп",
      todayLoss: 350, weekLoss: 350, currentDd: 0, dailyLimit: 300, weeklyLimit: 900, maxDrawdown: 2000,
      dailyPct: 116.7, weeklyPct: 38.9, drawdownPct: 0, unrealized: -200,
    };
    expect(await claimAndQueue(p)).toBe(true);
    expect(await claimAndQueue(p)).toBe(false);
    expect(await claimAndQueue({ ...p, state: "warn", halted: false })).toBe(true);
    const { rows } = await db.pool.query(`SELECT kind, payload FROM propreports_outbox ORDER BY id`);
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(["risk.alert", "risk.alert"]);
    expect(rows[0].payload).toMatchObject({ trader: T, state: "stop", unrealized: -200 });
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM risk_live_alerts`)).rows[0].n).toBe(2);

    expect(await logStopAlert(p)).toBe(true);
    expect(await logStopAlert(p)).toBe(false);
  });
});
