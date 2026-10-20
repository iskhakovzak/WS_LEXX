/**
 * Day headings of the desk stream (the feed page and the game plan's «Утро деска»): moved out of components/feed so the
 * stream rows can be shared (layer rules: a feature never imports another feature).
 */
import { fmtDate } from "@/lib/format";
import { nyDate } from "@/lib/trading-date";
import { commonI18n } from "@/i18n/ns/common";
import { feedI18n } from "@/i18n/ns/feed";

const parseDay = (d: string): Date => new Date(d + "T12:00:00");

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

/** «Пятница, 17 октября» — day heading, first letter capitalised. */
export function formatDayLong(d: string): string {
  const s = fmtDate(d, "weekdayDayMonthLong");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function relativeDayLabel(d: string, today = nyDate()): string | null {
  const diff = daysBetween(d, today);
  if (diff === 0) return commonI18n.t("time.today");
  if (diff === 1) return commonI18n.t("time.yesterday");
  if (diff === -1) return commonI18n.t("time.tomorrow");
  if (diff > 1 && diff < 7) return feedI18n.t("day.daysAgo", { count: diff });
  return null;
}
