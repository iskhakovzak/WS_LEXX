/**
 * `due()` helpers for tick steps (pure). The tick (the API's job scheduler, lib/propreports/scheduler) fires every few
 * minutes in desk hours (pre-market → post-market in New York) and hourly otherwise; a step asks for its own cadence.
 */

/** 13:00–21:59 UTC, Monday–Friday — the window in which the heartbeat runs every 5 minutes. */
export function isDeskHours(now: Date): boolean {
  const d = now.getUTCDay();
  const h = now.getUTCHours();
  return d >= 1 && d <= 5 && h >= 13 && h <= 21;
}

/** Slack so a 5-minute heartbeat that fires a few seconds early still counts as "5 minutes later". */
const SLACK_MS = 30_000;

/** Due when it never ran or at least `minutes` passed since the last run. */
export function everyMinutes(minutes: number): (now: Date, last: Date | null) => boolean {
  return (now, last) => !last || now.getTime() - last.getTime() >= minutes * 60_000 - SLACK_MS;
}

/** `deskMinutes` cadence in desk hours, `offMinutes` otherwise. */
export function deskCadence(deskMinutes: number, offMinutes: number): (now: Date, last: Date | null) => boolean {
  const desk = everyMinutes(deskMinutes);
  const off = everyMinutes(offMinutes);
  return (now, last) => (isDeskHours(now) ? desk(now, last) : off(now, last));
}

/** Always due (a step that decides inside run() whether there is work, e.g. the history backfill). */
export const always = (): boolean => true;

/** Milliseconds left before the tick deadline (never negative). */
export function remainingMs(deadline: number, now = Date.now()): number {
  return Math.max(0, deadline - now);
}
