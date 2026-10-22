/**
 * The period of /analytics: the presets and «Свой период» (AnalyticsFilters period «custom» + from / to,
 * lib/period-range) with the equally long previous window of the comparison. Re-exported by ./metrics.
 */
import { parseDayRange, prevDayRange, type DayRange } from "@/lib/period-range";
import { analyticsI18n } from "@/i18n/ns/analytics";

/** A preset, or «custom» = «Свой период» (AnalyticsFilters from / to). */
export type Period = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";
export type PresetPeriod = Exclude<Period, "custom">;

export const PERIODS: PresetPeriod[] = ["7d", "30d", "90d", "ytd", "all"];
/** Period options for a Segmented — call in render (labels follow the UI language). */
export function periodOptions(): { value: PresetPeriod; label: string }[] {
  return PERIODS.map((value) => ({ value, label: analyticsI18n.t(`period.${value}`) }));
}

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive [from, to] range for a period, plus the equal-length previous range for comparison. */
export function periodRange(period: Period, now = new Date(), custom: DayRange | null = null): { from: string; to: string; prevFrom: string; prevTo: string } | null {
  if (period === "all") return null;
  if (period === "custom") {
    if (!custom) return periodRange("90d", now);
    const prev = prevDayRange(custom);
    return { from: custom.from, to: custom.to, prevFrom: prev.from, prevTo: prev.to };
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  if (period === "ytd") start = new Date(end.getFullYear(), 0, 1);
  else start = new Date(end.getTime() - ((period === "7d" ? 7 : period === "30d" ? 30 : 90) - 1) * 86400000);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { from: isoDay(start), to: isoDay(end), prevFrom: isoDay(prevStart), prevTo: isoDay(prevEnd) };
}

/** The custom range of the filters (null when not set / invalid). */
export const customRangeOf = (f: { from?: string; to?: string }): DayRange | null => parseDayRange(f.from, f.to);

/** The window of the filters: the preset's or «Свой период» (null = «Всё время»). */
export function filtersRange(f: { period: Period; from?: string; to?: string }, now = new Date()) {
  return periodRange(f.period, now, customRangeOf(f));
}
