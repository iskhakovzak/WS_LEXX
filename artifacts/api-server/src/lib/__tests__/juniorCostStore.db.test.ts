/**
 * «Цена джуна до безубытка» loaders (lib/juniorCost/store) on a scratch database built from every migration: every
 * optional source query runs (no warning), the academy start and cohort mentor are picked up, a deactivated junior counts
 * as stopped, a trader whose history starts with the desk's data is truncated. Synthetic members and trades only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";
import { logger } from "../logger";
import { weekdays } from "./fixtures/edgeSynth";

const holder: { pool: pg.Pool | null } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  const pool = new Proxy({}, { get: (_t, k) => { const p = holder.pool as unknown as Record<string | symbol, unknown>; const v = p[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v; } });
  return { ...real, pool };
});
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("junior cost store (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("juniorcost");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(
      `INSERT INTO users (name, role, active) VALUES ('Synth Mentor', 'curator', true), ('Synth A', 'trader', true),
         ('Synth B', 'trader', false), ('Synth Old', 'trader', true)`,
    );
    const values: unknown[] = [];
    const tuples: string[] = [];
    const add = (trader: string, day: string, pnl: number, fees: number) => {
      values.push(trader, day, pnl >= 0 ? "win" : "loss", pnl, fees);
      const b = values.length - 5;
      tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, 'SYN')`);
    };
    weekdays(10, "2025-01-02").forEach((d) => add("Synth Old", d, 30, 2));
    // A: five days −100 net (pnl −95, fees 5), then 40 days +40 → ≥ 0 from the 18th own day on, confirmed 20 days later.
    weekdays(45, "2025-03-03").forEach((d, i) => add("Synth A", d, i < 5 ? -95 : 45, 5));
    weekdays(6, "2025-03-03").forEach((d) => add("Synth B", d, -45, 5));
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker) VALUES ${tuples.join(", ")}`, values);
    const { rows } = await db.pool.query(`INSERT INTO academy_cohorts (name, mentor, starts_on) VALUES ('Synth Cohort', 'Synth Mentor', '2025-02-24') RETURNING id`);
    await db.pool.query(`INSERT INTO academy_enrollments (cohort_id, user_name, joined_on) VALUES ($1, 'Synth A', '2025-02-24'), ($1, 'Synth B', '2025-02-24')`, [rows[0].id]);
    await db.pool.query(`INSERT INTO academy_one_on_ones (student, mentor, met_at) VALUES ('Synth A', 'Synth Mentor', '2025-03-05T15:00:00Z'), ('Synth A', 'Synth Mentor', '2025-03-20T15:00:00Z')`);
    await db.pool.query(`INSERT INTO journal_days (trader, day, followed_plan) VALUES ('Synth A', '2025-03-04', true), ('Synth A', '2025-03-05', false)`);
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  it("loads every source and builds the paths", async () => {
    const { deskJuniorCost, traderJuniorCost } = await import("../juniorCost/store");
    const d = await deskJuniorCost();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    expect(d.counts).toEqual({ juniors: 3, countable: 2, truncated: 1 });
    const a = d.juniors.find((j) => j.name === "Synth A")!;
    expect(a).toMatchObject({ status: "reached", start: "2025-02-24", startSource: "academy", keys: { cohort: "Synth Cohort", month: "2025-02", curator: "Synth Mentor" } });
    expect(a.cost.trading).toBe(500);
    expect(a.cost.trading).toBeCloseTo(a.cost.fees - a.cost.gross, 6);
    expect(a.breakeven?.activeDays).toBe(5 + Math.ceil(500 / 40));
    expect(a.exposure).toMatchObject({ planAnswers: 2, planShare: 0.5 });
    expect(a.exposure!.oneOnOnePerMonth).toBeGreaterThan(0);
    expect(d.juniors.find((j) => j.name === "Synth B")?.status).toBe("stopped");
    expect(d.juniors.find((j) => j.name === "Synth Old")?.truncated).toBe(true);
    expect(d.cohorts.cohort.desk).toMatchObject({ juniors: 2, reached: 1, stopped: 1 });

    const own = await traderJuniorCost("Synth A");
    expect(own.breakeven).toEqual(a.breakeven);
    expect(own.curve).toHaveLength(45);
  });
});
