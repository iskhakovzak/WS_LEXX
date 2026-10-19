/**
 * Migration 0215 (ROMAN-03 / ROMAN-15): the 2025 market calendar is seeded like 2026 / 2027, and 2026-07-03 (July 4
 * on a Saturday) is a full NYSE closure, not an early close. Runs the repository migrations on a scratch database.
 */
import { describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../runner";
import { createScratchDb, pgAvailable } from "./scratchDb";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("migration 0215 — market calendar 2025", () => {
  it("seeds 2025 (holidays, FOMC decisions, CPI, NFP …) and closes 2026-07-03", async () => {
    const db = await createScratchDb("cal2025");
    try {
      await runMigrationFiles({ pool: db.pool, logger: silent });
      const q = async (sql: string) => (await db.pool.query(sql)).rows;
      const byType = Object.fromEntries((await q(`SELECT type, count(*)::int AS n FROM holiday_calendar WHERE date LIKE '2025-%' GROUP BY type`)).map((r) => [r.type, r.n]));
      expect(byType).toEqual({ holiday: 14, fomc: 16, cpi: 11, ppi: 10, nfp: 11, opex: 8, quad_witching: 4, month_end: 12 });
      // 8 FOMC decision days in 2025, every row on a weekday
      expect((await q(`SELECT count(*)::int AS n FROM holiday_calendar WHERE date LIKE '2025-%' AND type = 'fomc' AND name LIKE '%(Decision Day)'`))[0].n).toBe(8);
      expect((await q(`SELECT count(*)::int AS n FROM holiday_calendar WHERE date LIKE '2025-%' AND extract(isodow FROM date::date) > 5`))[0].n).toBe(0);
      // full closures use the «Market closed» text every market-days reader matches (lib/marketDays ILIKE 'market closed%')
      const closed = (await q(`SELECT date FROM holiday_calendar WHERE date LIKE '2025-%' AND type = 'holiday' AND description ILIKE 'market closed%' ORDER BY date`)).map((r) => r.date);
      expect(closed).toEqual(["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"]);
      expect(await q(`SELECT type, description FROM holiday_calendar WHERE date = '2026-07-03' AND type = 'holiday'`)).toEqual([{ type: "holiday", description: "Market closed" }]);
      // idempotent: a second run applies nothing
      expect((await runMigrationFiles({ pool: db.pool, logger: silent })).applied).toEqual([]);
    } finally {
      await db.drop();
    }
  }, 120_000);
});
