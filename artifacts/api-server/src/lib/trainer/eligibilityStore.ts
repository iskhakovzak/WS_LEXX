/**
 * «Тренажёр» eligibility — SQL side (the rule itself: eligibility.ts). The desk-wide set of ticker-days poisoned by a
 * close-auction fill (15:50–16:00 NY), shared by every selection path and memoised for BLOCKED_TTL_MS.
 *
 * The SQL only narrows to a superset (NY wall time 15:49–16:01 of any non-deleted trade's fill); the exact decision is
 * eligibility.closeAuctionDays.
 */
import { pool } from "@workspace/db";
import { closeAuctionDays } from "./eligibility";

export const BLOCKED_TTL_MS = 10 * 60_000;
let memo: { at: number; days: Set<string> } | null = null;
let inflight: Promise<Set<string>> | null = null;

/** For tests. */
export function _resetEligibilityMemo(): void { memo = null; inflight = null; }

async function load(): Promise<Set<string>> {
  const { rows } = await pool.query<{ ticker: string; at: Date | string }>(
    `SELECT t.ticker, x.executed_at AS at
       FROM trade_executions x JOIN trades t ON t.id = x.trade_id
      WHERE t.deleted_at IS NULL AND x.executed_at IS NOT NULL
        AND (x.executed_at AT TIME ZONE 'America/New_York')::time BETWEEN time '15:49:00' AND time '16:01:00'`,
  );
  return closeAuctionDays(rows.map((r) => ({ ticker: String(r.ticker), at: r.at })));
}

/** "TICKER:YYYY-MM-DD" keys no trainer pool may use (any desk trade filled in the closing auction that day). */
export async function blockedTickerDays(): Promise<Set<string>> {
  if (memo && Date.now() - memo.at < BLOCKED_TTL_MS) return memo.days;
  if (!inflight) {
    inflight = load()
      .then((days) => { memo = { at: Date.now(), days }; return days; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
