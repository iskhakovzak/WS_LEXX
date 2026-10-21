/**
 * Rules engine (lib/rulesEngine) — the recent-scan window and the batched violation upsert.
 *
 * Recent scan (a broker sync of a few days): only violations dated ≥ `from` are judged (written, or deleted / archived
 * as stale); older rows are left as the last full scan stored them. `from` = NY today − RECENT_SCAN_DAYS, pulled back
 * to the earliest day of any trade of the trader written in the last RECENT_WRITES_HOURS (a back-dated import / trade).
 * The trades loaded give exactly the full-history drafts for every day ≥ from:
 *   • every rule kind is per trade, per open day (`date`) or per close day (`closeDate`; day loss, loss per trade, hold,
 *     loss streak) — no weekly / monthly / rolling kind exists (lib/rulesEval) — so loading every trade opened OR closed
 *     on / after `from` covers each day's whole list (a swing opened long ago but closed in the window included);
 *   • max_consecutive_losses carries a streak across days: the load then starts at the last WIN opened before the
 *     earliest loaded trade (sorted by open date, so everything after that win is loaded and the streak resets on it);
 *     without such a win the whole history is loaded.
 * Drafts dated before `from` come from partial days: never written, but their keys still count as produced (a stored
 * row is never dropped because of them).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import type { ViolationDraft } from "./rulesEval";
import { closeDateSql, resultSql } from "./tradeMath";
import { addDays, nyDate } from "./tradingDate";

export const RECENT_SCAN_DAYS = 7;
export const RECENT_WRITES_HOURS = 48;
/** Rule kinds whose drafts depend on trades before the day judged (the streak lead-in). */
export const STREAK_KINDS: readonly string[] = ["max_consecutive_losses"];

/** `from` = first judged day; `loadFrom` = first open day loaded (null = whole history); trades closed ≥ from also load. */
export type ScanWindow = { from: string; loadFrom: string | null };

/** The draft's day is judged by a scan from `from` (null = full scan: every day). */
export function inScanWindow(day: string | null | undefined, from: string | null): boolean {
  return from === null || String(day ?? "").slice(0, 10) >= from;
}

/**
 * Pure: the window from the DB facts. `fromDay` = judged-from day; `lastWin` = the last open day of a win strictly before
 * the earliest open day of the trades opened or closed ≥ fromDay (and before fromDay); null = no such win.
 */
export function planScanWindow(fromDay: string, lastWin: string | null, needsStreak: boolean): ScanWindow {
  return { from: fromDay, loadFrom: needsStreak ? lastWin : fromDay };
}

/** Trades a window loads (the SQL of rulesEngine.fetchTradesForWindow, for tests). */
export function inLoadedSet(t: { date: string; closeDate: string }, w: ScanWindow): boolean {
  return w.loadFrom === null || t.date.slice(0, 10) >= w.loadFrom || t.closeDate.slice(0, 10) >= w.from;
}

export async function resolveRecentWindow(
  trader: string,
  needsStreak: boolean,
  { today = nyDate(), writesHours = RECENT_WRITES_HOURS }: { today?: string; writesHours?: number } = {},
): Promise<ScanWindow> {
  const base = addDays(today, -RECENT_SCAN_DAYS);
  const day = "LEFT(t.date, 10)";
  const close = `LEFT(${closeDateSql()}, 10)`;
  const { rows } = await pool.query<{ from_day: string; min_day: string | null; last_win: string | null }>(
    `WITH f AS (
       SELECT LEAST($2::text, (SELECT MIN(LEAST(${day}, ${close})) FROM trades t
                                WHERE t.trader = $1 AND t.deleted_at IS NULL
                                  AND (t.created_at >= NOW() - make_interval(hours => $3) OR t.synced_at >= NOW() - make_interval(hours => $3)))) AS from_day
     ), m AS (
       SELECT MIN(${day}) AS min_day FROM trades t, f
        WHERE t.trader = $1 AND t.deleted_at IS NULL AND (${day} >= f.from_day OR ${close} >= f.from_day)
     )
     SELECT f.from_day, m.min_day,
            CASE WHEN $4::boolean THEN (SELECT MAX(${day}) FROM trades t
                                        WHERE t.trader = $1 AND t.deleted_at IS NULL AND ${resultSql()} = 'win'
                                          AND ${day} < LEAST(f.from_day, m.min_day)) END AS last_win
       FROM f, m`,
    [trader, base, writesHours, needsStreak],
  );
  const r = rows[0];
  return planScanWindow(r?.from_day ?? base, r?.last_win ?? null, needsStreak);
}

const BATCH = 1000;

/**
 * Upsert the drafts of one rule in batches (unnest). An unchanged row is not rewritten (no dead tuple, no WAL); a row
 * that changed or was archived is updated and un-archived. Returns how many drafts were written (as the old per-row loop
 * counted them) and the keys that were newly inserted. A failed batch falls back to row-by-row (errors logged, skipped).
 */
export async function upsertViolationDrafts(ruleId: number, trader: string, drafts: readonly ViolationDraft[]): Promise<{ written: number; inserted: Set<string> }> {
  const inserted = new Set<string>();
  // One row per key (ON CONFLICT cannot touch a row twice in one statement); the last draft wins, as before.
  const byKey = new Map<string, ViolationDraft>();
  const times = new Map<string, number>();
  for (const d of drafts) {
    byKey.set(d.key, d);
    times.set(d.key, (times.get(d.key) ?? 0) + 1);
  }
  const list = [...byKey.values()];
  let written = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    try {
      const { rows } = await pool.query<{ dedup_key: string; inserted: boolean }>(
        `INSERT INTO rule_violations (trader, rule_id, trade_id, severity, message, details, dedup_key, day, cost_net)
         SELECT $1, $2, u.trade_id, u.severity, u.message, u.details::jsonb, u.dedup_key, u.day, u.cost_net
           FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[])
                AS u(trade_id, severity, message, details, dedup_key, day, cost_net)
         ON CONFLICT (rule_id, dedup_key) DO UPDATE
           SET trade_id = EXCLUDED.trade_id, severity = EXCLUDED.severity, message = EXCLUDED.message,
               details = EXCLUDED.details, day = EXCLUDED.day, cost_net = EXCLUDED.cost_net,
               archived_at = NULL, archived_reason = NULL
           WHERE (rule_violations.trade_id, rule_violations.severity, rule_violations.message, rule_violations.details,
                  rule_violations.day, rule_violations.cost_net)
                 IS DISTINCT FROM (EXCLUDED.trade_id, EXCLUDED.severity, EXCLUDED.message, EXCLUDED.details, EXCLUDED.day, EXCLUDED.cost_net)
              OR rule_violations.archived_at IS NOT NULL OR rule_violations.archived_reason IS NOT NULL
         RETURNING dedup_key, (xmax = 0) AS inserted`,
        [
          trader, ruleId,
          chunk.map((d) => d.tradeId ?? null),
          chunk.map((d) => d.severity),
          chunk.map((d) => d.message),
          chunk.map((d) => JSON.stringify({ ...d.details, msg: d.msg })),
          chunk.map((d) => d.key),
          chunk.map((d) => d.day),
          chunk.map((d) => d.costNet ?? null),
        ],
      );
      for (const r of rows) if (r.inserted) inserted.add(r.dedup_key);
      for (const d of chunk) written += times.get(d.key) ?? 1;
    } catch (e: any) {
      logger.warn({ error: e?.message, ruleId, rows: chunk.length }, "rule_violations batch upsert failed; row by row");
      written += await upsertOneByOne(ruleId, trader, chunk, inserted);
    }
  }
  return { written, inserted };
}

async function upsertOneByOne(ruleId: number, trader: string, chunk: readonly ViolationDraft[], inserted: Set<string>): Promise<number> {
  let n = 0;
  for (const d of chunk) {
    try {
      const { rows } = await pool.query<{ inserted: boolean }>(
        `INSERT INTO rule_violations (trader, rule_id, trade_id, severity, message, details, dedup_key, day, cost_net)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (rule_id, dedup_key) DO UPDATE
           SET trade_id = EXCLUDED.trade_id, severity = EXCLUDED.severity, message = EXCLUDED.message,
               details = EXCLUDED.details, day = EXCLUDED.day, cost_net = EXCLUDED.cost_net,
               archived_at = NULL, archived_reason = NULL
         RETURNING (xmax = 0) AS inserted`,
        [trader, ruleId, d.tradeId, d.severity, d.message, { ...d.details, msg: d.msg }, d.key, d.day, d.costNet],
      );
      n++;
      if (rows[0]?.inserted) inserted.add(d.key);
    } catch (e: any) {
      logger.warn({ error: e?.message, ruleId }, "rule_violations upsert failed");
    }
  }
  return n;
}
