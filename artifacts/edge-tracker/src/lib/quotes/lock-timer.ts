/**
 * Lock-screen quote timer. The quote changes every N minutes (Settings → Безопасность: 1 / 5 / 15, or off). Time is
 * cut into slots aligned to the wall clock (slot = floor(epoch minutes / N)), so every open tab, a reload and the
 * stored rotation agree on which quote is current, and a change lands exactly on the boundary.
 */

export const LOCK_QUOTE_INTERVALS = [0, 1, 5, 15] as const;
export type LockQuoteInterval = (typeof LOCK_QUOTE_INTERVALS)[number];
export const DEFAULT_LOCK_QUOTE_INTERVAL: LockQuoteInterval = 5;

export function parseLockQuoteInterval(raw: string | null | undefined): LockQuoteInterval {
  if (raw == null || raw === "") return DEFAULT_LOCK_QUOTE_INTERVAL;
  const n = Number(raw);
  return (LOCK_QUOTE_INTERVALS as readonly number[]).includes(n) ? (n as LockQuoteInterval) : DEFAULT_LOCK_QUOTE_INTERVAL;
}

/** Slot number of `nowMs` for an interval of `minutes` (> 0). */
export function lockSlot(nowMs: number, minutes: number): number {
  return Math.floor(nowMs / (Math.max(1, minutes) * 60_000));
}

/** Milliseconds until the next slot begins (always ≥ 1, so a timer never spins). */
export function msToNextSlot(nowMs: number, minutes: number): number {
  const len = Math.max(1, minutes) * 60_000;
  return Math.max(1, len - (nowMs % len));
}

/**
 * Timer plan for the lock quote: null = off (no quote, no timer); else the slot key to show now and the delay before
 * the next change. The slot key carries the interval so switching 5 → 1 min draws a fresh quote instead of reusing
 * a slot number from another scale.
 */
export function lockQuotePlan(nowMs: number, minutes: LockQuoteInterval): { slot: string; nextInMs: number } | null {
  if (minutes === 0) return null;
  return { slot: `${minutes}m:${lockSlot(nowMs, minutes)}`, nextInMs: msToNextSlot(nowMs, minutes) };
}

/** Cross-fade length: slow by default, instant under prefers-reduced-motion. */
export function crossFadeMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 1600;
}
