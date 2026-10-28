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
  it("stores one plan note per author, day and ticker and one season row per trader and period", async () => {
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
      // 0290 season reports: one row per trader and period, linked to the Playbook note (a deleted entry unlinks)
      const { rows: [pb] } = await q(`INSERT INTO playbook (name, notes, trader, source_type) VALUES ('Season 2026-Q4', 'conclusions', 't', 'season_report') RETURNING id`);
      const { rows: [sr] } = await q(`INSERT INTO season_reports (trader, from_day, to_day, playbook_id) VALUES ('t', '2026-10-12', '2027-01-11', $1) RETURNING id`, [pb.id]);
      await expect(q(`INSERT INTO season_reports (trader, from_day, to_day) VALUES ('t', '2026-10-12', '2027-01-11')`)).rejects.toThrow(/season_reports_trader_from_day_to_day_key/);
      await expect(q(`INSERT INTO season_reports (trader, from_day, to_day) VALUES ('t', '2026-10-12', '2026-10-01')`)).rejects.toThrow(/season_reports_check/);
      await q(`DELETE FROM playbook WHERE id = $1`, [pb.id]);
      expect((await q(`SELECT playbook_id FROM season_reports WHERE id = $1`, [sr.id])).rows[0].playbook_id).toBeNull();
      // idempotent: a second run applies nothing
      expect((await runMigrationFiles({ pool: db.pool, logger: silent })).applied).toEqual([]);
    } finally {
      await db.drop();
    }
  }, 120_000);
});
