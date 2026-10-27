/**
 * Nightly AI review batches — the pure decisions (no DB, no network; tested on their own):
 *   nightTargets   which reviews are due tonight: the day (Mon–Fri, once the desk's day closes), the week (Fridays,
 *                  Monday's date), the month (the 1st, the previous month's first day)
 *   dayClosed      «the day closes»: after the post-close sync (16:15 NY) every trader who traded has closed the EOD,
 *                  or it is aiBatch.time (default 21:00) — whichever comes first
 *   estimateUnits  budget units a request is expected to cost (recent average when known, else a size heuristic)
 *   pickWithinCap  the requests that fit the nightly desk cap, in priority order: day reviews (traders whose day review
 *                  is still missing) first, then juniors, then week before month, more trades first
 *   nextPollDelay  polling backoff: 5, 10, then every 15 minutes
 */
import { unitWeight, type AssistantModel, type RouteSettings } from "../models";
import type { BatchKind } from "./store";

const MIN = 60_000;
/** The close + the first post-close sync (same as the evening Telegram cards). */
export const AFTER_CLOSE_MIN = 16 * 60 + 15;

export type Clock = { today: string; nowMin: number; weekday: number /* 0 = Sunday */ };

const NY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** New York date, minute of the day and weekday of an instant. */
export function nyClock(d: Date): Clock {
  const p = Object.fromEntries(NY_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, nowMin: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: WEEKDAYS.indexOf(String(p.weekday)) };
}

const shift = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The first day of the month before `ymd`'s month. */
export function previousMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

/** The first day of the period that covers `date`: Monday of its week / the 1st of its month. */
export function periodStart(kind: "week" | "month", date: string): string {
  if (kind === "month") return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T12:00:00Z`);
  return shift(date, -((d.getUTCDay() + 6) % 7));
}

export type Scopes = { day: boolean; week: boolean; month: boolean };
export type Target = { kind: BatchKind; period: string; from: string; to: string };

/** The reviews tonight may carry (before the «day closed» check): day and week on weekdays, month on the 1st. */
export function nightTargets(c: Clock, scopes: Scopes): Target[] {
  const out: Target[] = [];
  const weekday = c.weekday >= 1 && c.weekday <= 5;
  if (weekday && c.nowMin >= AFTER_CLOSE_MIN) {
    if (scopes.day) out.push({ kind: "day", period: c.today, from: c.today, to: c.today });
    if (scopes.week && c.weekday === 5) { const mon = shift(c.today, -4); out.push({ kind: "week", period: mon, from: mon, to: c.today }); }
  }
  if (scopes.month && c.today.endsWith("-01")) {
    const start = previousMonthStart(c.today);
    out.push({ kind: "month", period: start, from: start, to: shift(c.today, -1) });
  }
  return out;
}

/**
 * Has the desk's day closed? After 16:15 NY on a weekday: everyone who traded closed the EOD (and someone traded), or
 * the cutoff (aiBatch.time) has passed. A month-only night (the 1st on a weekend) waits for the cutoff.
 */
export function dayClosed(c: Clock, cutoffMin: number, traded: number, closed: number): boolean {
  if (c.nowMin >= cutoffMin) return true;
  const weekday = c.weekday >= 1 && c.weekday <= 5;
  return weekday && c.nowMin >= AFTER_CLOSE_MIN && traded > 0 && closed >= traded;
}

/** Output tokens of one review incl. thinking (structured JSON ~1.5K + reasoning) and the advisor's share. */
const EST_OUTPUT = 2_500;
const EST_ADVISOR_EXTRA = 1_200;
/** Characters per token for the JSON-heavy prompt (conservative: more tokens than a plain text estimate). */
const CHARS_PER_TOKEN = 3.2;

/**
 * Units one request is expected to cost: input + output at the executor's weight, plus the advisor (it reads the same
 * transcript and writes advice) at the advisor's weight. A recent average of the same kind and models wins when known.
 */
export function estimateUnits(
  a: { promptChars: number; model: AssistantModel; advisor: AssistantModel | null; recentAverage: number | null },
  s: Pick<RouteSettings, "defaultModel" | "multiplier">,
): number {
  if (a.recentAverage != null && a.recentAverage > 0) return Math.ceil(a.recentAverage * 1.1);
  const input = Math.ceil(a.promptChars / CHARS_PER_TOKEN);
  let units = (input + EST_OUTPUT) * unitWeight(a.model, s);
  if (a.advisor) units += (input + EST_ADVISOR_EXTRA) * unitWeight(a.advisor, s);
  return Math.ceil(units);
}

export type Candidate = { kind: BatchKind; trader: string; junior: boolean; trades: number; estUnits: number };

const KIND_ORDER: Record<BatchKind, number> = { day: 0, week: 1, month: 2 };

/** Priority order: day reviews first (the day review is still missing), then juniors, then week / month, more trades first. */
export function byPriority(a: Candidate, b: Candidate): number {
  const dayA = a.kind === "day" ? 0 : 1;
  const dayB = b.kind === "day" ? 0 : 1;
  return dayA - dayB || Number(b.junior) - Number(a.junior) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.trades - a.trades || a.trader.localeCompare(b.trader);
}

/** The candidates that fit `capLeft` units in priority order (a request that does not fit is skipped; smaller ones may still fit). */
export function pickWithinCap<C extends Candidate>(candidates: readonly C[], capLeft: number): { picked: C[]; skipped: C[] } {
  const picked: C[] = [];
  const skipped: C[] = [];
  let left = Math.max(0, capLeft);
  for (const c of [...candidates].sort(byPriority)) {
    if (c.estUnits <= left) { picked.push(c); left -= c.estUnits; } else skipped.push(c);
  }
  return { picked, skipped };
}

/** Polling backoff after `polls` polls: 5, 10, then every 15 minutes (a batch may take up to 24 h). */
export function nextPollDelay(polls: number): number {
  return (polls <= 0 ? 5 : polls === 1 ? 10 : 15) * MIN;
}

/** A batch older than this is given up on (the API expires batches at 24 h; one more hour for the last poll). */
export const GIVE_UP_MS = 25 * 60 * MIN;

/** Notices go out from the morning send time until this NY minute (results that land at night wait for the morning). */
export const NOTIFY_UNTIL_MIN = 20 * 60;

export function inNotifyWindow(c: Clock, morningMin: number): boolean {
  return c.nowMin >= morningMin && c.nowMin < NOTIFY_UNTIL_MIN;
}
