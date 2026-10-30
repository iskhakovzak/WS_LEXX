/**
 * Live fills loop — pure cadence rules (unit-tested in lib/__tests__/propreports/live-policy.test.ts).
 *
 *   budget     the loop may spend LIVE_BUDGET_SHARE (60 %) of the vendor limit (40 req / 4 s per host, ../rate-limit.ts):
 *              6 requests / s. The rest stays for the 5-minute full sync, the outbox and curators' manual calls (they
 *              share the same per-host limiter).
 *   interval   the smallest gap the budget allows for the requests the last cycle spent, never below LIVE_FLOOR_MS
 *              and never below the owner's cap (setting sync.liveMinIntervalSec; its default 2 s = the floor). One
 *              cycle is normally ONE request (the whole group's fills for today, ≤ 50 000 rows per page), so the
 *              cadence does not depend on the number of accounts.
 *   backoff    after a failed cycle: interval × 2^failures (one more doubling for a 429 / 503), at most LIVE_MAX_BACKOFF_MS
 *   window     trading days only (lib/marketDays), New York 09:00 → one hour after the close (17:00, 14:00 on an early
 *              close) — the hours of the desk tick (scheduler.ts DESK_TICK_CRON 09:00–16:55)
 */
import { PROPREPORTS_RATE } from "../rate-limit";
import type { DaySession } from "../../tradingDate";

export const LIVE_BUDGET_SHARE = 0.6;
export const LIVE_FLOOR_MS = 2_000;
export const LIVE_MAX_BACKOFF_MS = 5 * 60_000;
/** Outside the window / switched off: look again this often. */
export const LIVE_IDLE_MS = 60_000;
export const LIVE_START_MIN = 9 * 60;
export const LIVE_AFTER_CLOSE_MIN = 60;
/** Hard cap of PropReports calls in one cycle (today's pages + the carried-position windows). */
export const LIVE_MAX_REQUESTS = 6;

/** Requests per second the live loop may spend. */
export function liveBudgetPerSec(rate: { max: number; windowMs: number } = PROPREPORTS_RATE, share = LIVE_BUDGET_SHARE): number {
  return (rate.max * share) / (rate.windowMs / 1000);
}

/** Gap before the next cycle after a cycle that spent `requests` calls (`capSec` = the owner's slowest-allowed speed cap). */
export function liveIntervalMs(requests: number, capSec: number, budgetPerSec = liveBudgetPerSec()): number {
  const byBudget = Math.ceil((Math.max(1, requests) * 1000) / budgetPerSec);
  const cap = Number.isFinite(capSec) ? capSec * 1000 : 0;
  return Math.max(LIVE_FLOOR_MS, cap, byBudget);
}

/** Gap after `failures` failed cycles in a row (0 = `baseMs`). */
export function liveBackoffMs(baseMs: number, failures: number, rateLimited = false): number {
  if (failures <= 0) return baseMs;
  const exp = Math.min(20, failures + (rateLimited ? 1 : 0));
  return Math.min(LIVE_MAX_BACKOFF_MS, baseMs * 2 ** exp);
}

/** Is `nyMin` (minutes since New York midnight) inside the live window of `session`? */
export function inLiveWindow(nyMin: number, session: Pick<DaySession, "closed" | "closeMin">): boolean {
  if (session.closed) return false;
  return nyMin >= LIVE_START_MIN && nyMin < session.closeMin + LIVE_AFTER_CLOSE_MIN;
}

/** Per-cycle request budget: callers ask before every PropReports call. */
export class RequestBudget {
  used = 0;
  constructor(readonly max: number = LIVE_MAX_REQUESTS) {}
  get left(): number { return Math.max(0, this.max - this.used); }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}
