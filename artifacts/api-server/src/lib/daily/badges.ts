/**
 * Discipline badges — the shared inputs and the «reviewed on time» rule. The 8 badges are tiers of the achievement lines
 * now (lib/quests/achievements.ts: BADGE_TIER maps each badge to its line and tier; the rules live there):
 *
 *   streak_1/2/3  contract_streak bronze / silver / gold (kept-contract days in a row: 5 / 10 / 20)
 *   reviews       review_streak silver (10 traded days in a row reviewed on time)
 *   focus         focus_beaten bronze (the focus mistake absent 5 judged days in a row)
 *   clean_month   clean_month bronze (a finished month, the daily stop known and never reached)
 *   sim_first     own_replays bronze (the first own-day replay in the simulator)
 *   sim_beat      beat_yourself bronze (3 own replays better than the real trade)
 */
import { addDays, isWeekend } from "../tradingDate";
import type { BadgeId } from "./types";

export const BADGE_IDS: readonly BadgeId[] = ["streak_1", "streak_2", "streak_3", "reviews", "focus", "clean_month", "sim_first", "sim_beat"];

/** Inputs, all sorted or sortable by date. */
/**
 * `reviewedOn` = the NY day it was closed (one-tap «Разобрал» or the journal form); `fullOn` = the NY day of the FULL
 * EOD review (journal form with ≥ 1 trade review or mistake verdict, eod_days.full_review_at) — rewards count only that
 * (roadmap R3: reviews_total, review_streak, full_loop). Absent = unknown (treated as not full).
 */
export type ReviewDay = { date: string; reviewedOn: string | null; fullOn?: string | null };

/** The same day judged by its full review only (the one-tap close is «seen», not reviewed). */
export const asFullReview = (r: ReviewDay): ReviewDay => ({ date: r.date, reviewedOn: r.fullOn ?? null });
export type FocusDay = { date: string; status: string; disputed: boolean };
export type StopDay = { date: string; trough: number; limit: number | null };
export type OwnGame = { finishedOn: string; verdict: string | null };

function nextWeekday(d: string): string {
  let x = addDays(d, 1);
  for (let i = 0; i < 7 && isWeekend(x); i++) x = addDays(x, 1);
  return x;
}

/** Reviewed on time = on the day itself or by the next trading day (the dashboard shows yesterday's card until the close). */
export function reviewedOnTime(r: ReviewDay): boolean {
  return r.reviewedOn != null && r.reviewedOn <= nextWeekday(r.date);
}
