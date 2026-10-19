/**
 * Dates, months, weekdays, relative time and NY clock: they follow the UI language and live in i18n/format.ts
 * (one implementation, shared with the i18n runtime). Re-exported so feature code imports every formatter from
 * "@/lib/format".
 */
import { fmtDate, fmtTimeNY, toDate, type DateInput } from "@/i18n/format";

export {
  fmtDate,
  fmtDateCustom,
  fmtDayMonth,
  fmtDateRange,
  fmtMonth,
  fmtWeekday,
  fmtRelative,
  fmtTimeNY,
  localeTag,
  toDate,
  type DateInput,
  type DateStyle,
} from "@/i18n/format";

/** The desk clock: the app trades US equities, so every timestamp a person reads is New York time. */
export const DESK_TZ = "America/New_York";
/** Suffix after a desk time so a reader in Tashkent never mistakes it for local time. Same in every language. */
const DESK_SUFFIX = "NY";

/**
 * Desk (New York) wall-clock time with the «NY» suffix: "17:30 NY". `seconds` → "17:30:05 NY", `suffix: false`
 * → "17:30" (for a column whose header already says NY). Invalid / empty → "—".
 */
export function fmtDeskTime(d: DateInput | null | undefined, opts?: { seconds?: boolean; suffix?: boolean }): string {
  const date = toDate(d);
  if (!date) return "—";
  const t = fmtTimeNY(date, { seconds: opts?.seconds });
  return opts?.suffix === false ? t : `${t} ${DESK_SUFFIX}`;
}

/**
 * Desk (New York) date and time in the UI language with the «NY» suffix. The date is the New York calendar date
 * (02:00 UTC on Oct 17 is «16 окт., 22:00 NY»).
 *   style "dateTime" (default)  → «16 окт., 22:00 NY» / «Oct 16, 22:00 NY» / «16-okt, 22:00 NY»
 *   style "shortDateTime"       → «16.10.2026, 22:00 NY»
 *   style "numericDateTime"     → «16.10, 22:00 NY»
 * `suffix: false` drops «NY». Invalid / empty → "—".
 */
export function fmtDeskDateTime(
  d: DateInput | null | undefined,
  opts?: { style?: "dateTime" | "shortDateTime" | "numericDateTime"; suffix?: boolean },
): string {
  const date = toDate(d);
  if (!date) return "—";
  const s = fmtDate(date, opts?.style ?? "dateTime", { timeZone: DESK_TZ });
  return opts?.suffix === false ? s : `${s} ${DESK_SUFFIX}`;
}

/**
 * Desk (New York) calendar date in the UI language, no time: «16 окт.» for 02:00 UTC on Oct 17. A date-only string
 * ("2026-10-16") already is a desk date and is printed as is (no zone shift).
 */
export function fmtDeskDate(
  d: DateInput | null | undefined,
  style: "dayMonth" | "dayMonthLong" | "medium" | "short" | "weekdayDayMonth" = "dayMonth",
): string {
  const date = toDate(d);
  if (!date) return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return fmtDate(date, style);
  return fmtDate(date, style, { timeZone: DESK_TZ });
}

/**
 * A waiting time in hours as whole days + hours, rounded once (71.6 h → 3 d 0 h, never «2 d 24 h»). Shared by the review
 * queue, the EOD sheet and the curator cabinet so every «ждёт N» reads the same. Negative / non-finite → 0.
 */
export function splitHours(hours: number): { d: number; h: number } {
  const total = Number.isFinite(hours) && hours > 0 ? Math.round(hours) : 0;
  return { d: Math.floor(total / 24), h: total % 24 };
}
