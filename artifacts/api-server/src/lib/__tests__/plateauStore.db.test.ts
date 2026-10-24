/**
 * Plateau store + job run (roadmap R6) on a scratch database built from every migration (0248 included). Synthetic
 * traders only: a flat one (μ $0, σ $120) and a strong one (μ $90).
 *
 *   - the run catches up the missing monthly run of the previous month, then the monthly run of the day;
 *   - the 2nd consecutive monthly plateau escalates once and writes one system intervention (plateau_review);
 *   - «Застряли» lists the flat trader with an open escalation, never the strong one; a re-run does not escalate again;
 *   - «Назначить разбор 1:1» creates one 1:1 with the diagnosis agenda and exactly one intervention row, and closes
 *     the escalation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { pg } from "@workspace/db";
import { createScratchDb, pgAvailable } from "../../db/__tests__/scratchDb";
import { runMigrationFiles } from "../../db/runner";
import { randNormal, rngFor } from "../stats";
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
const FLAT = "Synth Flat";
const STRONG = "Synth Strong";
const CURATOR = "Synth Curator";

describe.skipIf(!available)("plateau store (scratch database)", () => {
  let db: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    db = await createScratchDb("plateau");
    holder.pool = db.pool;
    await runMigrationFiles({ pool: db.pool, logger: silent });
    await db.pool.query(`INSERT INTO users (name, role, active) VALUES ($1, 'trader', true), ($2, 'trader', true), ($3, 'curator', true)`, [FLAT, STRONG, CURATOR]);
    const rng = rngFor(42, "plateau-db");
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const day of weekdays(300, "2025-06-02")) {
      for (const [trader, mu] of [[FLAT, 0], [STRONG, 90]] as const) {
        values.push(trader, `${day}T10:00:00`, mu + 120 * randNormal(rng));
        const b = values.length - 3;
        tuples.push(`($${b + 1}, $${b + 2}, 'win', $${b + 3}, 0, 'SYN')`);
      }
    }
    await db.pool.query(`INSERT INTO trades (trader, date, result, pnl, fees, ticker) VALUES ${tuples.join(", ")}`, values);
  }, 180_000);
  afterAll(async () => { await db?.drop(); });

  const count = async (sql: string, p: unknown[] = []) => Number((await db.pool.query(sql, p)).rows[0].n);

  it("catches up the previous monthly run, escalates the 2nd monthly plateau once, logs one system row", async () => {
    const { runPlateau } = await import("../plateauStore");
    const out = await runPlateau({ asOf: "2026-07-01" });
    expect(out.catchUp).toEqual(["2026-06-01"]);
    expect(out.kind).toBe("monthly");
    expect(out.escalations).toBe(1);
    const snaps = (await db.pool.query(`SELECT trader, to_char(as_of, 'YYYY-MM-DD') AS d, run_kind, plateau, escalated, severity FROM trader_progress_snapshots ORDER BY d, trader`)).rows;
    expect(snaps).toEqual([
      { trader: FLAT, d: "2026-06-01", run_kind: "monthly", plateau: true, escalated: false, severity: "stuck" },
      { trader: STRONG, d: "2026-06-01", run_kind: "monthly", plateau: false, escalated: false, severity: null },
      { trader: FLAT, d: "2026-07-01", run_kind: "monthly", plateau: true, escalated: true, severity: "stuck" },
      { trader: STRONG, d: "2026-07-01", run_kind: "monthly", plateau: false, escalated: false, severity: null },
    ]);
    expect(await count(`SELECT count(*) AS n FROM curator_interventions WHERE kind = 'plateau_review' AND author = 'system' AND trigger = 'plateau'`)).toBe(1);
    // the same day again: replaced, no second escalation row
    await runPlateau({ asOf: "2026-07-01" });
    expect(await count(`SELECT count(*) AS n FROM curator_interventions WHERE kind = 'plateau_review'`)).toBe(1);
    // a Tuesday is not a run day (unless run by hand → a weekly refresh, never an escalation)
    expect((await runPlateau({ asOf: "2026-07-07" })).skipped).toBe("not a run day");
    expect((await runPlateau({ asOf: "2026-07-07", manual: true })).kind).toBe("weekly");
    expect(await count(`SELECT count(*) AS n FROM trader_progress_snapshots WHERE escalated`)).toBe(1);
  });

  it("«Застряли» lists the flat trader (escalation open), the curator priority sees it, never the strong trader", async () => {
    const { stuckList, plateauSignals } = await import("../plateauStore");
    const list = await stuckList([FLAT, STRONG], "2026-07-08");
    expect(list.map((x) => x.trader)).toEqual([FLAT]);
    expect(list[0]).toMatchObject({ escalated: true, escalationOpen: true, reviewedOn: null, severity: "stuck", pace: 37.5 });
    expect(list[0].hi80!).toBeLessThan(37.5);
    expect((await plateauSignals([FLAT, STRONG], "2026-07-08")).get(FLAT)).toEqual({ plateau: true, severity: "stuck", escalationOpen: true, adminEscalated: false });
  });

  it("«Назначить разбор 1:1»: one meeting with the agenda + exactly one intervention row; the escalation closes", async () => {
    const { scheduleReview, stuckList } = await import("../plateauStore");
    const out = await scheduleReview(FLAT, CURATOR, "en", "2026-07-08");
    expect(out).toMatchObject({ meetingId: expect.any(Number), interventionId: expect.any(Number) });
    const m = (await db.pool.query(`SELECT student, mentor, agenda FROM academy_one_on_ones WHERE id = $1`, [out!.meetingId])).rows[0];
    expect(m).toMatchObject({ student: FLAT, mentor: CURATOR });
    expect(m.agenda).toContain("Templated 1:1 review");
    expect(m.agenda).toContain("37.50");
    expect(await count(`SELECT count(*) AS n FROM curator_interventions WHERE kind = 'plateau_review' AND author = $1 AND source_table = 'academy_one_on_ones'`, [CURATOR])).toBe(1);
    const [after] = await stuckList([FLAT], "2026-07-09");
    expect(after).toMatchObject({ escalationOpen: false, reviewedOn: "2026-07-08" });
    expect(await scheduleReview(STRONG, CURATOR, "en", "2026-07-08")).toBeNull();
  });
});
