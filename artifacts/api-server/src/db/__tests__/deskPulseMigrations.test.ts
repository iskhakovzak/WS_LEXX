/**
 * Migrations 0289+ (easy money of the day, the season report): the repository migrations on a scratch database — the
 * plan notes and the report rows accept what the code writes and refuse what it never should.
 */
import { describe, expect, it, vi } from "vitest";
import { runMigrationFiles } from "../runner";
import { createScratchDb, pgAvailable } from "./scratchDb";

const available = await pgAvailable();
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe.skipIf(!available)("migrations 0289+ — desk pulse", () => {
  it("stores one plan note per author, day and ticker", async () => {
    const db = await createScratchDb("pulse");
    try {
      await runMigrationFiles({ pool: db.pool, logger: silent });
      const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
      // 0289 easy money notes: the author's own plan annotation
      await q(`INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ('senior', '2026-10-27', 'NVDA', 'gap and go, entry at the 9:45 flag')`);
      await expect(q(`INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ('senior', '2026-10-27', 'NVDA', 'twice')`)).rejects.toThrow(/easy_money_notes_pkey/);
      await expect(q(`INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ('senior', '27.10.2026', 'AMD', 'x')`)).rejects.toThrow(/easy_money_notes_day_check/);
      await expect(q(`INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ('senior', '2026-10-27', 'amd', 'x')`)).rejects.toThrow(/easy_money_notes_ticker_check/);
      await expect(q(`INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ('senior', '2026-10-27', 'AMD', '')`)).rejects.toThrow(/easy_money_notes_note_check/);
      // idempotent: a second run applies nothing
      expect((await runMigrationFiles({ pool: db.pool, logger: silent })).applied).toEqual([]);
    } finally {
      await db.drop();
    }
  }, 120_000);
});
