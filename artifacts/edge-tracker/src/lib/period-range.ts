/**
 * «Свой период» — a custom from–to window of a period selector (components/shared/period/PeriodPicker), shared by
 * /stats, /analytics, /behavior, /what-if, /benchmark and /office. Days are YYYY-MM-DD keys (trading days in NY), both
 * ends inclusive. Pure: no React, no clock except the `today` argument.
 */

export type DayRange = { from: string; to: string };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day «YYYY-MM-DD» (2026-02-30 is not). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const dayNo = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const ymdOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** `ymd` shifted by `days` (negative = back). */
export function shiftYmd(ymd: string, days: number): string {
  return ymdOf(dayNo(ymd) + days);
}

/** Why a draft range cannot be applied: a missing / malformed end, or from after to; null when it is fine. */
export function rangeError(r: { from?: string | null; to?: string | null }): "missing" | "order" | null {
  if (!isYmd(r.from) || !isYmd(r.to)) return "missing";
  return r.from > r.to ? "order" : null;
}

/** The stored / linked range when it is valid (from ≤ to, real days), else null. */
export function parseDayRange(from: unknown, to: unknown): DayRange | null {
  return isYmd(from) && isYmd(to) && from <= to ? { from, to } : null;
}

/** Calendar days in the range, both ends included. */
export function rangeDays(r: DayRange): number {
  return dayNo(r.to) - dayNo(r.from) + 1;
}

/** The equally long window right before the range (the «к прошлому периоду» comparison). */
export function prevDayRange(r: DayRange): DayRange {
  const n = rangeDays(r);
  return { from: shiftYmd(r.from, -n), to: shiftYmd(r.from, -1) };
}

/**
 * The draft a picker opens with (prefill): the stored custom range, else the window of the current preset (its
 * missing end = today), else the last 30 days.
 */
export function draftRange(custom: DayRange | null, preset: { from?: string | null; to?: string | null } | null, today: string): DayRange {
  if (custom) return custom;
  const to = isYmd(preset?.to) ? preset!.to! : today;
  const from = isYmd(preset?.from) ? preset!.from! : shiftYmd(to, -29);
  return from <= to ? { from, to } : { from: to, to };
}
