/**
 * US equities session math in America/New_York wall time.
 * Pre-market 04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00 ET.
 * Weekends and full-day market holidays (from /api/holidays or /api/dashboard/today) are closed. An early-close day
 * (`earlyClose` on the calendar row: day after Thanksgiving, Christmas Eve, July 3) trades 09:30–13:00, after-hours
 * until 17:00 — the server's lib/marketDays sessionFor, same rule.
 */

import { shellI18n } from "@/i18n/ns/shell";

const TZ = "America/New_York";

export type SessionPhase = "pre" | "regular" | "after" | "closed";
export type NextKey = "toOpen" | "toClose" | "toAfterEnd" | "toPremarket";

export type SessionState = {
  phase: SessionPhase;
  /** NY wall clock "HH:MM:SS". */
  nyTime: string;
  /** NY calendar date YYYY-MM-DD. */
  nyDate: string;
  /** Milliseconds until the next relevant boundary. */
  msToNext: number;
  /** What the countdown points to, as a code. */
  nextKey: NextKey;
  /** What the countdown points to, in the UI language (read when the state is computed: call at render). */
  nextLabel: string;
  /** 0..1 position within the 04:00–20:00 extended day, null when outside it / closed day. */
  dayProgress: number | null;
  /** Holiday name if today is a market holiday. */
  holiday: string | null;
  weekend: boolean;
  /** Today is an early-close day: the regular session ends at 13:00 ET (`closeTime`). */
  earlyClose: boolean;
  /** Today's regular close, NY "HH:MM" ("16:00", "13:00" on an early close). */
  closeTime: string;
};

/** A calendar row of type `holiday`: a full-day closure, or (`earlyClose`) a 13:00 half day that still trades. */
export type MarketHoliday = { date: string; name: string; earlyClose?: boolean };

export const PRE_OPEN_MIN = 4 * 60;
export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;
export const EARLY_CLOSE_MIN = 13 * 60;
export const AFTER_END_MIN = 20 * 60;
/** After-hours last 4 h past the close (20:00, or 17:00 on an early close). */
const POST_HOURS_MIN = AFTER_END_MIN - CLOSE_MIN;

/** Today's close / after-hours end in NY minutes for a day that is (not) an early close. */
export function sessionBounds(earlyClose: boolean): { closeMin: number; afterEndMin: number } {
  const closeMin = earlyClose ? EARLY_CLOSE_MIN : CLOSE_MIN;
  return { closeMin, afterEndMin: closeMin + POST_HOURS_MIN };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

type WallParts = { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number };
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallParts(date: Date): WallParts {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(date)) p[x.type] = x.value;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
    wd: WD[p.weekday] ?? 0,
  };
}

/** UTC ms of a NY wall time (DST-aware). */
function nyWallToUtc(ymd: string, minutes: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0);
  const offsetAt = (t: number) => {
    const w = wallParts(new Date(t));
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return t;
}

function ymdOf(p: WallParts) {
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, n: number) {
  const dt = new Date(`${ymd}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function isTradingDay(ymd: string, holidays: Set<string>) {
  const wd = weekdayOf(ymd);
  return wd !== 0 && wd !== 6 && !holidays.has(ymd);
}

function nextTradingDay(fromYmd: string, holidays: Set<string>) {
  let d = addDaysYmd(fromYmd, 1);
  for (let i = 0; i < 14 && !isTradingDay(d, holidays); i++) d = addDaysYmd(d, 1);
  return d;
}

const next = (nextKey: NextKey) => ({ nextKey, nextLabel: shellI18n.t(`clock.next.${nextKey}`) });

export function getSessionState(now: Date, holidays: MarketHoliday[] = []): SessionState {
  const p = wallParts(now);
  const nyDate = ymdOf(p);
  const nyTime = `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}:${String(p.s).padStart(2, "0")}`;
  const closures = holidays.filter((h) => !h.earlyClose);
  const set = new Set(closures.map((h) => h.date));
  const holiday = closures.find((h) => h.date === nyDate)?.name ?? null;
  const weekend = p.wd === 0 || p.wd === 6;
  const earlyClose = !weekend && !holiday && holidays.some((h) => h.earlyClose && h.date === nyDate);
  const { closeMin: closeToday, afterEndMin: afterEndToday } = sessionBounds(earlyClose);
  const extDay = afterEndToday - PRE_OPEN_MIN;
  const day = { holiday, weekend, earlyClose, closeTime: hhmm(closeToday) };
  const mins = p.h * 60 + p.mi + p.s / 60;
  const t = now.getTime();

  const tradingToday = isTradingDay(nyDate, set);
  const nextOpen = () => {
    const openDay = tradingToday && mins < OPEN_MIN ? nyDate : nextTradingDay(nyDate, set);
    return nyWallToUtc(openDay, OPEN_MIN) - t;
  };

  if (!tradingToday) {
    return {
      phase: "closed",
      nyTime,
      nyDate,
      msToNext: nextOpen(),
      ...next("toOpen"),
      dayProgress: null,
      ...day,
    };
  }
  const progress = mins >= PRE_OPEN_MIN && mins < afterEndToday ? (mins - PRE_OPEN_MIN) / extDay : null;
  if (mins >= PRE_OPEN_MIN && mins < OPEN_MIN) {
    return {
      phase: "pre",
      nyTime,
      nyDate,
      msToNext: nyWallToUtc(nyDate, OPEN_MIN) - t,
      ...next("toOpen"),
      dayProgress: progress,
      ...day,
    };
  }
  if (mins >= OPEN_MIN && mins < closeToday) {
    return {
      phase: "regular",
      nyTime,
      nyDate,
      msToNext: nyWallToUtc(nyDate, closeToday) - t,
      ...next("toClose"),
      dayProgress: progress,
      ...day,
    };
  }
  if (mins >= closeToday && mins < afterEndToday) {
    return {
      phase: "after",
      nyTime,
      nyDate,
      msToNext: nyWallToUtc(nyDate, afterEndToday) - t,
      ...next("toAfterEnd"),
      dayProgress: progress,
      ...day,
    };
  }
  return {
    phase: "closed",
    nyTime,
    nyDate,
    msToNext: nextOpen(),
    ...next("toOpen"),
    dayProgress: progress,
    ...day,
  };
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return days > 0 ? `${shellI18n.t("clock.daysPrefix", { count: days })} ${hms}` : hms;
}

/** Full phase names in the UI language (getters: read at render, never frozen at import). */
export const PHASE_LABEL: Readonly<Record<SessionPhase, string>> = {
  get pre() { return shellI18n.t("clock.phaseLong.pre"); },
  get regular() { return shellI18n.t("clock.phaseLong.regular"); },
  get after() { return shellI18n.t("clock.phaseLong.after"); },
  get closed() { return shellI18n.t("clock.phaseLong.closed"); },
};
