/**
 * The period of /analytics: the analytics group's shared scope (hooks/use-analytics-scope — the vocabulary
 * week · month · quarter · year · all, windows ending today, and «Период…» = AnalyticsFilters period «custom» + from / to)
 * with the equally long previous window of the comparison. Re-exported by ./metrics.
 */
import { parseDayRange, presetRange, prevDayRange, type DayRange } from "@/lib/period-range";
import { ANALYTICS_PRESETS, DEFAULT_ANALYTICS_PERIOD, type AnalyticsPeriod, type AnalyticsPreset } from "@/hooks/use-analytics-scope";

/** A preset, or «custom» = «Свой период» (AnalyticsFilters from / to). */
export type Period = AnalyticsPeriod;
export type PresetPeriod = AnalyticsPreset;

export const PERIODS: readonly PresetPeriod[] = ANALYTICS_PRESETS;

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive [from, to] range for a period, plus the equal-length previous range for comparison. */
export function periodRange(period: Period, now = new Date(), custom: DayRange | null = null): { from: string; to: string; prevFrom: string; prevTo: string } | null {
  if (period === "all") return null;
  const win = period === "custom" ? custom ?? presetRange(DEFAULT_ANALYTICS_PERIOD, isoDay(now)) : presetRange(period, isoDay(now));
  if (!win) return null;
  const prev = prevDayRange(win);
  return { from: win.from, to: win.to, prevFrom: prev.from, prevTo: prev.to };
}

/** The custom range of the filters (null when not set / invalid). */
export const customRangeOf = (f: { from?: string; to?: string }): DayRange | null => parseDayRange(f.from, f.to);

/** The window of the filters: the preset's or «Свой период» (null = «Всё время»). */
export function filtersRange(f: { period: Period; from?: string; to?: string }, now = new Date()) {
  return periodRange(f.period, now, customRangeOf(f));
}
