/**
 * Migrations 0277+ (session flow, the season calendar, expected moves, timings, opening window, idea tiers, checklists):
 * the repository migrations on a scratch database — the new guard patterns are accepted, unknown codes refused.
 */
import { describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../runner";
import { createScratchDb, pgAvailable } from "./scratchDb";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("migrations 0277+ — session flow", () => {
  it("accepts the rule patterns of the leak guard and refuses unknown ones", async () => {
    const db = await createScratchDb("flow");
    try {
      await runMigrationFiles({ pool: db.pool, logger: silent });
      const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
      const ins = (pattern: string) => q(
        `INSERT INTO leak_guard_events (trader, day, pattern, source_key, level, triggered_at) VALUES ('t', '2026-10-27', $1, 'AAA:long', 'soft', now())`, [pattern],
      );
      for (const p of ["reentry", "green_to_red", "open_window", "idea_limit"]) await ins(p);
      await expect(ins("bogus")).rejects.toThrow(/leak_guard_events_pattern_check/);
      // 0278 expected moves: one snapshot per ticker and report, a known source only
      await q(`INSERT INTO expected_moves (ticker, report_date, source, em_pct, prior_close) VALUES ('NVDA', '2026-11-19', 'implied', 7.25, 140.1)`);
      await expect(q(`INSERT INTO expected_moves (ticker, report_date, source, em_pct) VALUES ('NVDA', '2026-11-20', 'guess', 5)`)).rejects.toThrow(/expected_moves_source_check/);
      // idempotent: a second run applies nothing
      expect((await runMigrationFiles({ pool: db.pool, logger: silent })).applied).toEqual([]);
    } finally {
      await db.drop();
    }
  }, 120_000);
});
