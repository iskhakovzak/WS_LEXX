/**
 * Admin console → «Обзор»: «Награды» — open requests and rewards handed out, with links to the curator queue and the
 * catalog (OWNER-20: requests used to be visible only inside /curator, and only when non-empty). Always rendered for an
 * admin with the catalog (an empty state says where requests will appear); nothing for a role without it or an older API.
 * Mounted by components/admin/OverviewPanel.tsx (ADMIN-ACCESS): `<RewardsAdminBlock onOpenCatalog={() => onGo("settings")} />`.
 */
import { Link } from "wouter";
import { ArrowRight, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListSkeleton, Panel, Pill, StatRow } from "@/components/ds";
import { fmtCount, fmtDayMonth } from "@/lib/format";
import { personName } from "@/i18n";
import { gamificationI18n } from "@/i18n/ns/gamification";
import type { RewardGrant } from "@/lib/gamification/types";
import { useRewardCatalog, type RewardStats } from "./api";
import { STAFF_QUEUE_HREF } from "./reward-queue";

/** Presentational: the numbers, the latest handed-out rewards, the links. */
export function RewardsAdminView({ stats, recent, onOpenCatalog }: { stats: RewardStats; recent: readonly RewardGrant[]; onOpenCatalog?: () => void }) {
  const { t } = gamificationI18n.useT();
  return (
    <Panel
      title={t("admin.title")}
      icon={Gift}
      description={t("admin.description")}
      actions={stats.requested > 0 ? <Pill tone="warn">{t("editor.requests", { count: stats.requested })}</Pill> : undefined}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <StatRow label={t("admin.requested")} value={fmtCount(stats.requested)} tone={stats.requested > 0 ? "warn" : "neutral"} />
          <StatRow label={t("admin.grantedMonth")} value={fmtCount(stats.grantedMonth)} />
          <StatRow label={t("admin.granted")} value={fmtCount(stats.granted)} />
          <StatRow label={t("admin.activeItems")} value={`${fmtCount(stats.activeItems)} / ${fmtCount(stats.items)}`} />
        </div>
        {stats.requested === 0 && <p className="text-xs text-muted-foreground">{t("admin.noRequests")}</p>}
        {stats.activeItems === 0 && <p className="text-xs text-muted-foreground">{t("admin.noItems")}</p>}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="micro-label">{t("admin.recent")}</span>
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {recent.map((g) => (
                <li key={g.id} className="truncate">
                  {t("admin.recentLine", { name: personName(g.trader), title: g.title ?? `#${g.itemId}`, date: fmtDayMonth(g.at) })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {stats.requested > 0 && (
            <Button asChild size="sm">
              <Link href={STAFF_QUEUE_HREF}>{t("admin.openQueue")} <ArrowRight aria-hidden="true" /></Link>
            </Button>
          )}
          {onOpenCatalog && (
            <Button type="button" size="sm" variant="ghost" onClick={onOpenCatalog}>
              {t("admin.openCatalog")} <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** The block for the admin overview: loads the catalog numbers (settings.manage); nothing without them. */
export function RewardsAdminBlock({ onOpenCatalog, enabled = true }: { onOpenCatalog?: () => void; enabled?: boolean }) {
  const { t } = gamificationI18n.useT();
  const q = useRewardCatalog(enabled);
  if (!enabled) return null;
  if (q.isLoading) return <Panel title={t("admin.title")} icon={Gift}><ListSkeleton rows={3} /></Panel>;
  const stats = q.data?.stats;
  if (!stats) return null; // no rights, an error, or an older API without the numbers
  return <RewardsAdminView stats={stats} recent={q.data?.recent ?? []} onOpenCatalog={onOpenCatalog} />;
}
