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

// ── The one period vocabulary (design audit wave 3) ─────────────────────────
// Every period selector of the app speaks these words: Сегодня · Неделя · Месяц · Квартал · Год · Всё · Период….
// The presets are windows that END TODAY (rolling): «Неделя» = the last 7 days, «Месяц» = 30, «Квартал» = 90,
// «Год» = 365, so a comparison «к прошлому периоду» is the equally long window right before (prevDayRange) and a
// window never shrinks to one day on the 1st of a month. Calendar-anchored reports (/office: a year, its quarters and
// months) keep their own meaning and say so on screen.

export const PERIOD_PRESETS = ["today", "week", "month", "quarter", "year", "all"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type PeriodValue = PeriodPreset | "custom";

/** Days in each preset window, today included («Всё» has no window). */
export const PRESET_DAYS: Record<Exclude<PeriodPreset, "all">, number> = { today: 1, week: 7, month: 30, quarter: 90, year: 365 };

/** Legacy values of the old period sets (7d / 30d / 90d / ytd, day counts, calendar words) → the vocabulary. */
const LEGACY: Record<string, PeriodValue> = {
  "1": "today", "1d": "today", day: "today",
  "7": "week", "7d": "week", "5": "week", "14": "week", w: "week",
  "30": "month", "30d": "month", m: "month",
  "60": "quarter", "90": "quarter", "90d": "quarter", "120": "quarter", "180": "quarter", q: "quarter",
  "365": "year", "250": "year", ytd: "year", "1y": "year", y: "year",
  "0": "all", alltime: "all",
};

/** A stored / linked value read as the vocabulary (unknown → `fallback`). */
export function normalizePeriod(v: unknown, fallback: PeriodValue): PeriodValue {
  if (typeof v !== "string" || !v) return fallback;
  if ((PERIOD_PRESETS as readonly string[]).includes(v) || v === "custom") return v as PeriodValue;
  return LEGACY[v.toLowerCase()] ?? fallback;
}

/** The window of a preset ending `today` (null = «Всё»). */
export function presetRange(p: PeriodPreset, today: string): DayRange | null {
  if (p === "all") return null;
  return { from: shiftYmd(today, -(PRESET_DAYS[p] - 1)), to: today };
}

/** The window of a period value: a preset's, the custom range, or null («Всё», or «custom» without a valid range). */
export function periodWindow(p: PeriodValue, today: string, custom: DayRange | null): DayRange | null {
  if (p === "custom") return custom;
  return presetRange(p, today);
}

/** Days a period covers (null = «Всё»): the API's `days=N` for endpoints that take a count. */
export function periodDays(p: PeriodValue, custom: DayRange | null): number | null {
  if (p === "all") return null;
  if (p === "custom") return custom ? rangeDays(custom) : null;
  return PRESET_DAYS[p];
}
