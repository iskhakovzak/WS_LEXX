/**
 * Timestamps for remote + office students: desk (New York) time with the «NY» mark, one shared format
 * (lib/format fmtDeskDateTime: «18 окт., 16:10 NY»); the viewer's own clock is in the tooltip when it differs.
 */
import { fmtDateCustom, fmtDeskDateTime, fmtTimeNY } from "@/lib/format";
import { academyI18n } from "@/i18n/ns/academy";

/** The viewer's local date + time («19.10.26, 01:10»), for the tooltip. */
export function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? fmtDateCustom(d, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";
}

/** Desk time «18 окт., 16:10 NY»; null when there is no valid date. */
export function formatNy(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? fmtDeskDateTime(d) : null;
}

/** True when the viewer's wall clock differs from New York at that moment. */
function differsFromNy(d: Date): boolean {
  return fmtTimeNY(d) !== fmtDateCustom(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function DualTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const { t } = academyI18n.useT();
  const ny = formatNy(iso);
  const d = iso ? new Date(iso) : null;
  const local = d && ny && differsFromNy(d) ? formatLocal(iso) : null;
  return (
    <time dateTime={iso ?? undefined} className={className ?? "tabular-nums"} title={local ? t("time.yourTime", { local }) : t("time.sameTz")}>
      {ny ?? "—"}
    </time>
  );
}

/** Whole days since `iso` (0 = today); null when there is no date. */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}

/** «сегодня» / «вчера» / «5 дн. назад» in the UI language (day granularity). Call at render time. */
export function relativeDays(iso: string | null | undefined, now = Date.now()): string {
  const t = academyI18n.t;
  const days = daysSince(iso, now);
  if (days == null) return t("time.noActivity");
  if (days === 0) return t("time.today");
  if (days === 1) return t("time.yesterday");
  return t("time.daysAgo", { count: days });
}
