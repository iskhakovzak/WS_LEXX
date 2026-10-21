/**
 * «Онлайн · обновлено 3 минуты назад · открытые −$120» — the PropReports open-positions snapshot behind today's P&L
 * (positions tick, every 5 min during the session; GET /api/risk/me | /risk/desk `live`). Shared by the risk desk, the
 * dashboard risk cell and the sidebar «Сегодня» footer. Quiet by design: one small line, a dot (green = counted,
 * grey = stale and not counted), no button. Renders nothing without a snapshot of today.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { riskI18n } from "@/i18n/ns/risk";

/** The fields of RiskLive (components/risk/use-risk) this line needs. */
export type LiveInfo = { unrealizedUsd: number; openPositions: number; fetchedAt: string; counted: boolean };

/** Pure: whole minutes since `fetchedAt` (null when unparsable). */
export function liveAgeMin(fetchedAt: string, now: number = Date.now()): number | null {
  const at = Date.parse(fetchedAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60_000)) : null;
}

/** Pure: «только что» / «3 минуты назад» / «2 часа назад» in the UI language. */
export function liveAgoText(ageMin: number): string {
  const t = commonI18n.t;
  if (ageMin < 1) return t("time.justNow");
  if (ageMin < 60) return t("time.minutesAgo", { count: ageMin });
  return t("time.hoursAgo", { count: Math.floor(ageMin / 60) });
}

/** Re-render every 30 s so the age keeps counting between refetches. */
function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function LiveBadge({ live, showOpen = true, className }: {
  live: LiveInfo | null | undefined;
  /** Append «открытые −$120» when positions are open and counted. */
  showOpen?: boolean;
  className?: string;
}) {
  const { t } = riskI18n.useT();
  commonI18n.useT();
  const now = useMinuteClock();
  if (!live) return null;
  const age = liveAgeMin(live.fetchedAt, now);
  if (age == null) return null;
  const stale = !live.counted;
  const open = showOpen && !stale && live.openPositions > 0
    ? t("live.open", { amount: fmtUsd(live.unrealizedUsd, { signed: true, decimals: 0 }) })
    : null;
  const updated = commonI18n.t("ds.updatedAgo", { ago: liveAgoText(age) });
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-2xs tabular-nums", stale ? "text-muted-foreground" : "text-foreground/80", className)}
      title={stale ? t("live.staleHint") : t("live.hint")}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stale ? "bg-muted-foreground/50" : "bg-up")} />
      <span className="truncate">
        {[stale ? t("live.stale") : t("live.on"), updated, open].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}
