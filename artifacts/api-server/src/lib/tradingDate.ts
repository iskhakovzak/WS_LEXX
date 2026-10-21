// The desk trades US equities: "today" is always the America/New_York calendar date,
// never the server's local or UTC date (they disagree for several hours every night).

const NY_TZ = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: NY_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** YYYY-MM-DD in New York for the given instant (default: now). */
export function nyDate(d: Date = new Date()): string {
  return dateFmt.format(d);
}

/** Minutes since New York midnight (e.g. 9:30 → 570). */
export function nyMinutes(d: Date = new Date()): number {
  const [h, m] = timeFmt.format(d).split(":").map(Number);
  return h * 60 + m;
}

/** NYSE session bounds, New York minutes: premarket 04:00, open 09:30, close 16:00 (13:00 early), post until 20:00 (17:00). */
export const PREMARKET_MIN = 4 * 60;
export const OPEN_MIN = 9 * 60 + 30;
export const REGULAR_CLOSE_MIN = 16 * 60;
export const EARLY_CLOSE_MIN = 13 * 60;
/** Extended hours run 4 h past the close (20:00 on a regular day, 17:00 on an early close). */
export const POST_HOURS_MIN = 4 * 60;

/**
 * One trading day's session (wave 1, 1.12): `closed` = weekend / full-day holiday; `earlyClose` = NYSE half day
 * (holiday_calendar «Early close 1pm ET»: day after Thanksgiving, Christmas Eve, July 3). lib/marketDays sessionFor
 * reads it for a date; everything that needs «is the market open / when does it close» takes it from there.
 */
export type DaySession = {
  date: string;
  closed: boolean;
  earlyClose: boolean;
  openMin: number;
  closeMin: number;
  postEndMin: number;
};

/** The session of `date` from its two calendar facts (pure). */
export function daySession(date: string, facts: { closed?: boolean; earlyClose?: boolean } = {}): DaySession {
  const closed = isWeekend(date) || !!facts.closed;
  const earlyClose = !closed && !!facts.earlyClose;
  const closeMin = earlyClose ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN;
  return { date, closed, earlyClose, openMin: OPEN_MIN, closeMin, postEndMin: closeMin + POST_HOURS_MIN };
}

export type NySessionPhase = "premarket" | "regular" | "postmarket" | "closed";

/** The phase at NY minutes `m` of a day closing at `closeMin` (16:00 by default, 13:00 on an early close). */
export function phaseAt(m: number, closeMin: number = REGULAR_CLOSE_MIN): NySessionPhase {
  if (m >= PREMARKET_MIN && m < OPEN_MIN) return "premarket";
  if (m >= OPEN_MIN && m < closeMin) return "regular";
  if (m >= closeMin && m < closeMin + POST_HOURS_MIN) return "postmarket";
  return "closed";
}

/**
 * "premarket" (04:00–09:30), "regular" (09:30–16:00), "postmarket" (16:00–20:00) or "closed", by New York time.
 * With a `session` (lib/marketDays sessionFor): a closed day is "closed", an early close ends the regular session at
 * 13:00 and the post-market at 17:00.
 */
export function nySession(d: Date = new Date(), session?: Pick<DaySession, "closed" | "closeMin"> | null): NySessionPhase {
  if (session?.closed) return "closed";
  return phaseAt(nyMinutes(d), session?.closeMin ?? REGULAR_CLOSE_MIN);
}

/** Shift a YYYY-MM-DD date by whole days (calendar arithmetic, timezone-free). */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Weekend check for a YYYY-MM-DD date (holidays live in the market_holidays table, see routes/holidays.ts). */
export function isWeekend(date: string): boolean {
  const [y, mo, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}
