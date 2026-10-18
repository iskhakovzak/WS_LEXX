/**
 * Admin console → «Использование» (capability usage.read, admins only): what members actually use during the pilot.
 * Focal point: the daily-loop funnel per trader (UsageFunnel.tsx); next to it, who has not come for 3+ trading days;
 * below, who comes (DAU by role / WAU) and the top screens and loop steps. Data: GET /api/admin/usage. Internal: no
 * third-party analytics, only route patterns and loop steps are stored; never used for rewards or rankings.
 */
import { useState } from "react";
import { Activity } from "lucide-react";
import { EmptyState, Panel, Segmented, StatusDot } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { fmtCount, fmtDate, fmtWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usageI18n } from "@/i18n/ns/usage";
import { useUsageOverview, type ActivityPoint, type UsageCount, type UsageOverview, type UsageRole } from "./usage-api";
import { actionDictKey, barScale } from "./usage-model";
import { FunnelPanel, InactivePanel } from "./UsageFunnel";

type Period = "d7" | "d30";
const ROLE_BAR: Record<UsageRole, string> = { trader: "bg-chart-1", curator: "bg-chart-5", admin: "bg-chart-3" };
const ROLE_ORDER: readonly UsageRole[] = ["admin", "curator", "trader"]; // stacked top → bottom

function StatusLine({ data, onOpenSettings }: { data: UsageOverview; onOpenSettings?: () => void }) {
  const { t } = usageI18n.useT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={data.enabled ? "up" : "warn"} />
        {data.enabled ? t("status.on", { days: data.retentionDays }) : t("status.off")}
      </span>
      <span>{data.trackedSince ? t("status.since", { date: fmtDate(data.trackedSince, "dayMonthLong") }) : t("status.none")}</span>
      {onOpenSettings && (
        <button type="button" onClick={onOpenSettings} className="rounded underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("status.settings")}
        </button>
      )}
    </div>
  );
}

function ActivityPanel({ points }: { points: ActivityPoint[] }) {
  const { t } = usageI18n.useT();
  const max = barScale(points.map((p) => p.dau));
  const last = points[points.length - 1];
  return (
    <Panel title={t("activity.title")} description={t("activity.description")} fill>
      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div><p className="text-2xs uppercase text-muted-foreground">{t("activity.dauToday")}</p><p className="text-2xl font-semibold tabular-nums">{fmtCount(last?.dau ?? 0)}</p></div>
        <div><p className="text-2xs uppercase text-muted-foreground">{t("activity.wau")}</p><p className="text-2xl font-semibold tabular-nums">{fmtCount(last?.wau ?? 0)}</p></div>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(["trader", "curator", "admin"] as const).map((r) => (
            <li key={r} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-sm", ROLE_BAR[r])} aria-hidden="true" />{t(`activity.roles.${r}`)}</li>
          ))}
        </ul>
      </div>
      <div role="img" aria-label={t("activity.aria")} className="flex h-28 items-end gap-[3px]">
        {points.map((p) => {
          const label = t("activity.bar", {
            day: `${fmtWeekday(p.day, "short")} ${fmtDate(p.day, "dayMonthNumeric")}`, dau: p.dau, wau: p.wau,
            trader: p.byRole.trader, curator: p.byRole.curator, admin: p.byRole.admin,
          });
          return (
            <div key={p.day} title={label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              {p.dau === 0 && <span className="h-px w-full bg-[var(--glass-border)]" />}
              {ROLE_ORDER.map((r) => p.byRole[r] > 0 && (
                <span key={r} className={cn("w-full first:rounded-t-[3px]", ROLE_BAR[r])} style={{ height: `${(p.byRole[r] / max) * 100}%` }} />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-muted-foreground tabular-nums">
        <span>{points[0] ? fmtDate(points[0].day, "dayMonthNumeric") : ""}</span>
        <span>{last ? fmtDate(last.day, "dayMonthNumeric") : ""}</span>
      </div>
    </Panel>
  );
}

function CountTable({ rows, head, label, sub }: {
  rows: UsageCount[];
  head: [string, string, string, string];
  label: (key: string) => string;
  sub?: (key: string) => string | null;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="pb-1 font-medium">{head[0]}</th>
          {head.slice(1).map((h) => <th key={h} scope="col" className="pb-1 text-right font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--glass-border)]">
        {rows.map((r) => {
          const s = sub?.(r.key) ?? null;
          return (
            <tr key={r.key}>
              <td className="min-w-0 py-1.5 pr-2">
                <span className="block text-foreground [overflow-wrap:anywhere]">{label(r.key)}</span>
                {s && <span className="block font-mono text-2xs text-muted-foreground [overflow-wrap:anywhere]">{s}</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmtCount(r.users)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtCount(r.traders)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtCount(r.count)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TopPanels({ data, screenLabel }: { data: UsageOverview; screenLabel?: (key: string) => string | null }) {
  const { t } = usageI18n.useT();
  const [period, setPeriod] = useState<Period>("d7");
  const screens = data.screens[period];
  const actions = data.actions[period];
  const toggle = (
    <Segmented<Period> ariaLabel={t("screens.periodAria")} size="sm" value={period} onChange={setPeriod}
      options={(["d7", "d30"] as const).map((v) => ({ value: v, label: t(`screens.period.${v}`) }))} />
  );
  return (
    <div className="grid min-w-0 items-start gap-[var(--grid-gap)] lg:grid-cols-2">
      <Panel title={t("screens.title")} description={t("screens.description")} actions={toggle}>
        {screens.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("screens.empty")}</p> : (
          <CountTable
            rows={screens}
            head={[t("screens.col.screen"), t("screens.col.users"), t("screens.col.traders"), t("screens.col.count")]}
            label={(k) => screenLabel?.(k) ?? k}
            sub={(k) => (screenLabel?.(k) ? k : null)}
          />
        )}
      </Panel>
      <Panel title={t("actions.title")} description={`${t("actions.description")} · ${t(`screens.period.${period}`)}`}>
        {actions.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("actions.empty")}</p> : (
          <CountTable
            rows={actions}
            head={[t("actions.col.action"), t("actions.col.users"), t("actions.col.traders"), t("actions.col.count")]}
            label={(k) => usageI18n.tryT(`actions.keys.${actionDictKey(k)}`) ?? k}
          />
        )}
      </Panel>
    </div>
  );
}

export function UsagePanel({ enabled, screenLabel, onOpenSettings }: {
  enabled: boolean;
  /** Route pattern → section name (the page passes the shell's route titles); null = show the pattern. */
  screenLabel?: (key: string) => string | null;
  onOpenSettings?: () => void;
}) {
  const { t } = usageI18n.useT();
  const q = useUsageOverview(enabled);
  if (!enabled) return null;
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true">
        <Skeleton className="h-96 rounded-2xl" />
        <div className="grid gap-[var(--grid-gap)] lg:grid-cols-2"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
      </div>
    );
  }
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} message={t("loadFailed")} />;
  const data = q.data;
  if (!data) return <EmptyState icon={Activity} title={t("loadFailed")} />;
  return (
    <div className="flex flex-col gap-[var(--grid-gap)] pb-2">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <StatusLine data={data} onOpenSettings={onOpenSettings} />
      </div>
      <FunnelPanel data={data} onOpenSettings={onOpenSettings} />
      <div className="grid min-w-0 items-stretch gap-[var(--grid-gap)] lg:grid-cols-2">
        <InactivePanel rows={data.inactive} />
        <ActivityPanel points={data.activity} />
      </div>
      <TopPanels data={data} screenLabel={screenLabel} />
    </div>
  );
}
