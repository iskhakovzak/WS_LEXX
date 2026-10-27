/**
 * Live (PropReports positions tick) pieces of /risk: the desk freshness line and the trader's open broker positions.
 * The one-line badge itself is shared (components/shared/live-badge) with the dashboard and the sidebar footer.
 */
import { cn } from "@/lib/utils";
import { fmtNum, fmtPrice, fmtUsd } from "@/lib/format";
import { riskI18n } from "@/i18n/ns/risk";
import { LiveBadge } from "@/components/shared/live-badge";
import { LiveNumber } from "@/components/ds";
import { rich, slots } from "@/i18n/rich";

const signedUsd0 = (n: number) => fmtUsd(n, { signed: true, decimals: 0 });
import type { DeskLive, LivePosition } from "./use-risk";

/** «Онлайн · обновлено 2 минуты назад · Позиции PropReports: 7 открытых · −$420 · устарело: 1». Nothing without a snapshot. */
export function DeskLiveLine({ live, className }: { live: DeskLive | null | undefined; className?: string }) {
  const { t } = riskI18n.useT();
  if (!live) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-2xs text-muted-foreground tabular-nums", className)}>
      <LiveBadge live={{ unrealizedUsd: live.unrealizedUsd, openPositions: live.openPositions, fetchedAt: live.fetchedAt, counted: live.counted > 0 }} showOpen={false} />
      {live.counted > 0 && live.openPositions > 0 && (
        <span>{t("live.desk", { open: t("live.deskOpen", { count: live.openPositions }), amount: fmtUsd(live.unrealizedUsd, { signed: true, decimals: 0 }) })}</span>
      )}
      {live.stale > 0 && <span>{t("live.staleCount", { count: live.stale })}</span>}
    </div>
  );
}

/** «открытые −$120» under a trader's P&L in the desk table (only when the snapshot is counted and something is open). */
export function LiveOpenNote({ live }: { live: { counted: boolean; openPositions: number; unrealizedUsd: number } | null | undefined }) {
  const { t } = riskI18n.useT();
  if (!live?.counted || live.openPositions <= 0) return null;
  return (
    <div className={cn("text-2xs tabular-nums", live.unrealizedUsd < 0 ? "text-down" : "text-muted-foreground")} title={t("live.hint")}>
      {rich(t("live.open", slots("amount")), { amount: <LiveNumber value={live.unrealizedUsd} format={signedUsd0} /> })}
    </div>
  );
}

/** The trader's open broker positions behind `live` (symbol · qty · avg → last · unrealized). */
export function LivePositionsList({ positions, className }: { positions: LivePosition[] | undefined; className?: string }) {
  const { t } = riskI18n.useT();
  if (!positions?.length) return null;
  return (
    <section aria-label={t("live.positionsTitle")} className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="text-xs font-medium text-muted-foreground">{t("live.positionsTitle")}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {positions.map((p) => (
          <li
            key={`${p.account}:${p.symbol}`}
            className="inline-flex items-baseline gap-1.5 rounded-lg bg-[var(--glass-bg)] px-2 py-1 text-xs tabular-nums ring-1 ring-inset ring-[var(--field-border)]"
          >
            <span className="font-semibold">{p.symbol}</span>
            <span className="text-muted-foreground">
              {fmtNum(p.qty)}{p.avg != null ? ` @ ${fmtPrice(p.avg)}` : ""}{p.close != null ? ` → ${fmtPrice(p.close)}` : ""}
            </span>
            <LiveNumber
              value={p.unrealized}
              format={signedUsd0}
              className={cn("font-medium", p.unrealized > 0 ? "text-up" : p.unrealized < 0 ? "text-down" : "")}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
