/**
 * Admin console «Обзор» → «Петля вчера» (Волна 2 п. 2.4) — the focal point of the tab: one row per active trader for
 * the last finished trading day (plan → trades → day closed → curator review, plus Telegram), totals at the bottom, a
 * red ✗ links to the screen that fixes it. On top, for admins (usage.read), the PILOT §3 week in one line (the
 * «Использование» card's numbers: usage-model pilotSummary). Curators get «Моя группа / Все». Data: GET
 * /api/admin/loop-yesterday (loop-yesterday-api.ts); cell rules: loop-yesterday-model.ts. Phone: one card per trader.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, Clock, Repeat, X } from "lucide-react";
import { EmptyState, ListSkeleton, Panel, Segmented, StatusDot } from "@/components/ds";
import { QueryError } from "@/components/query-error";
import { fmtCount, fmtDeskDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { personName } from "@/i18n";
import { adminI18n } from "@/i18n/ns/admin";
import { usageI18n } from "@/i18n/ns/usage";
import { useLoopYesterday, type LoopRow, type LoopScope, type LoopYesterday } from "./loop-yesterday-api";
import { useUsageOverview } from "./usage-api";
import { defaultFilter, filterTraders, pilotSummary } from "./usage-model";
import { cellOf, fixOf, pilotVerdict, profileHref, sortRows, totalsOf, waitParts, type Cell, type Column } from "./loop-yesterday-model";

type T = ReturnType<typeof adminI18n.useT>["t"];
const COLS: readonly Column[] = ["plan", "closed", "review", "telegram"];

/** PILOT §3 in one line (admins): «в норме 3 из 5 · хуже всего: …» → «Использование». */
function PilotVerdictLine({ onOpenUsage }: { onOpenUsage?: () => void }) {
  const { t } = adminI18n.useT();
  const { t: tu } = usageI18n.useT();
  const q = useUsageOverview(true);
  if (!q.data) return null;
  const rows = pilotSummary(filterTraders(q.data.funnel.traders, defaultFilter(q.data)), q.data.inactive.map((r) => r.name), q.data.inactiveLowData ?? false);
  const v = pilotVerdict(rows);
  const tone = !v.measured ? "neutral" : v.bad.length === 0 ? "up" : v.good * 2 > v.measured ? "warn" : "down";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--glass-border)] pb-3 text-sm">
      <StatusDot tone={tone}><span className="font-medium text-foreground">{t("loop.pilot.label")}</span></StatusDot>
      <span className="tabular-nums">{v.measured ? t("loop.pilot.good", { good: v.good, measured: v.measured }) : t("loop.pilot.noData")}</span>
      {v.bad.length > 0 && <span className="text-muted-foreground">· {t("loop.pilot.bad", { names: v.bad.map((k) => tu(`pilotWeek.rows.${k}`)).join(", ") })}</span>}
      {onOpenUsage && (
        <button type="button" onClick={onOpenUsage} className="ml-auto rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("loop.pilot.more")}
        </button>
      )}
    </div>
  );
}

function waitText(t: T, hours: number | null): string {
  const { d, h } = waitParts(hours);
  return d ? t("loop.waitDays", { days: d, hours: h }) : t("loop.wait", { hours: h });
}

/** One status cell: icon + text for screen readers, a link / button when a ✗ has a screen that fixes it. */
function Mark({ col, row, date, onOpenPeople, sla }: { col: Column; row: LoopRow; date: string; onOpenPeople: () => void; sla: number }) {
  const { t } = adminI18n.useT();
  const c: Cell = cellOf(col, row);
  const fix = fixOf(col, row, date);
  let body: ReactNode;
  let title: string | undefined;
  if (c === "ok") {
    body = <><Check className="h-4 w-4 text-up" aria-hidden="true" /><span className="sr-only">{t("loop.cell.ok")}</span></>;
    if (col === "review" && row.reviewedBy) title = t("loop.reviewed", { name: personName(row.reviewedBy), hours: Math.round(row.reviewHours ?? 0) });
  } else if (c === "late") {
    body = col === "plan"
      ? <span className="inline-flex items-center gap-1 text-xs text-warn"><Check className="h-4 w-4" aria-hidden="true" />{t("loop.cell.planLate")}</span>
      : <span className="inline-flex items-center gap-1 text-xs text-warn"><Check className="h-4 w-4" aria-hidden="true" />{t("loop.hours", { hours: Math.round(row.reviewHours ?? 0) })}</span>;
    title = col === "plan" ? t("loop.cell.planLateTitle") : t("loop.reviewedLate", { sla });
  } else if (c === "wait" || c === "overdue") {
    body = <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", c === "overdue" ? "text-down" : "text-warn")}><Clock className="h-3.5 w-3.5" aria-hidden="true" />{waitText(t, row.reviewHours)}</span>;
  } else if (c === "miss") {
    body = <><X className="h-4 w-4 text-down" aria-hidden="true" /><span className="sr-only">{t("loop.cell.miss")}</span></>;
  } else {
    body = <><span className="text-muted-foreground" aria-hidden="true">—</span><span className="sr-only">{t("loop.cell.na")}</span></>;
  }
  const cls = "inline-flex min-h-8 items-center rounded px-1 hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (fix && "href" in fix) return <Link href={fix.href} className={cls} title={t(col === "closed" ? "loop.fix.closed" : "loop.fix.review")}>{body}</Link>;
  if (fix) return <button type="button" onClick={onOpenPeople} className={cls} title={t("loop.fix.telegram")}>{body}</button>;
  return <span className="inline-flex min-h-8 items-center px-1" title={title}>{body}</span>;
}

function TraderName({ row }: { row: LoopRow }) {
  const { t } = adminI18n.useT();
  return (
    <div className="min-w-0">
      <Link href={profileHref(row.name)} className="block truncate font-medium hover:underline" title={t("loop.profile")}>{personName(row.name)}</Link>
      <span className="block truncate text-2xs text-muted-foreground">{row.group ?? t("loop.noGroup")}</span>
    </div>
  );
}

/** The totals row cells (numbers + one hint each). */
function totalCells(data: LoopYesterday, t: T) {
  const s = totalsOf(data.rows, data.totals);
  const of = (n: number, total: number) => t("loop.of", { n, of: total });
  return {
    plan: <>{of(s.plan.n, s.plan.of)}<span className="block text-2xs font-normal text-muted-foreground">{t("loop.beforeOpen", { n: s.plan.beforeOpen })}</span></>,
    trades: <>{fmtCount(s.trades.sum)}<span className="block text-2xs font-normal text-muted-foreground">{t("loop.traded", { n: s.trades.traded })}</span></>,
    closed: <>{of(s.closed.n, s.closed.of)}</>,
    review: <>{of(s.review.n, s.review.of)}{s.review.waiting > 0 && <span className={cn("block text-2xs font-normal", s.review.overdue ? "text-down" : "text-muted-foreground")}>{s.review.overdue ? t("loop.overdue", { n: s.review.overdue }) : t("loop.waiting", { n: s.review.waiting })}</span>}</>,
    telegram: <>{of(s.telegram.n, s.telegram.of)}</>,
  };
}

function LoopTable({ data, onOpenPeople }: { data: LoopYesterday; onOpenPeople: () => void }) {
  const { t } = adminI18n.useT();
  const rows = sortRows(data.rows);
  const total = totalCells(data, t);
  const mark = (col: Column, r: LoopRow) => <Mark col={col} row={r} date={data.date} onOpenPeople={onOpenPeople} sla={data.slaHours} />;
  const th = "px-2 py-2 text-left text-2xs font-medium uppercase tracking-wide text-muted-foreground";
  return (
    <>
      {/* ≥ md: one table, totals in the footer */}
      <table className="hidden w-full text-sm md:table" aria-label={t("loop.tableAria")}>
        <thead>
          <tr className="border-b border-[var(--glass-border)]">
            <th scope="col" className={th}>{t("loop.cols.trader")}</th>
            <th scope="col" className={th}>{t("loop.cols.plan")}</th>
            <th scope="col" className={cn(th, "text-right")}>{t("loop.cols.trades")}</th>
            <th scope="col" className={th}>{t("loop.cols.closed")}</th>
            <th scope="col" className={th}>{t("loop.cols.review")}</th>
            <th scope="col" className={th}>{t("loop.cols.telegram")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-border)]">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="max-w-[14rem] px-2 py-1.5"><TraderName row={r} /></td>
              <td className="px-2 py-1.5">{mark("plan", r)}</td>
              <td className={cn("px-2 py-1.5 text-right tabular-nums", r.trades === 0 && "text-muted-foreground")}>{fmtCount(r.trades)}</td>
              <td className="px-2 py-1.5">{mark("closed", r)}</td>
              <td className="px-2 py-1.5">{mark("review", r)}</td>
              <td className="px-2 py-1.5">{mark("telegram", r)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--glass-border)] align-top text-xs font-medium tabular-nums">
            <th scope="row" className="px-2 py-2 text-left">{t("loop.total")}</th>
            <td className="px-2 py-2">{total.plan}</td>
            <td className="px-2 py-2 text-right">{total.trades}</td>
            <td className="px-2 py-2">{total.closed}</td>
            <td className="px-2 py-2">{total.review}</td>
            <td className="px-2 py-2">{total.telegram}</td>
          </tr>
        </tfoot>
      </table>

      {/* phone: totals on top, then one card per trader */}
      <div className="md:hidden">
        <dl className="mb-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
          {(["plan", "trades", "closed", "review", "telegram"] as const).map((k) => (
            <div key={k} className="tile min-w-0 p-2">
              <dt className="truncate text-2xs text-muted-foreground">{t(`loop.cols.${k}`)}</dt>
              <dd className="font-medium">{total[k]}</dd>
            </div>
          ))}
        </dl>
        <ul className="divide-y divide-[var(--glass-border)]" aria-label={t("loop.tableAria")}>
          {rows.map((r) => (
            <li key={r.name} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <TraderName row={r} />
                <span className={cn("shrink-0 text-xs tabular-nums", r.trades === 0 && "text-muted-foreground")}>{t("loop.cols.trades")}: {fmtCount(r.trades)}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {COLS.map((c) => (
                  <div key={c} className="flex min-w-0 items-center justify-between gap-1">
                    <span className="truncate text-muted-foreground">{t(`loop.cols.${c}`)}</span>
                    {mark(c, r)}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function LoopYesterdayPanel({ showPilot, onOpenUsage, onOpenPeople }: { showPilot: boolean; onOpenUsage?: () => void; onOpenPeople: () => void }) {
  const { t } = adminI18n.useT();
  const [scope, setScope] = useState<LoopScope | null>(null);
  const q = useLoopYesterday(scope);
  const data = q.data;
  const current: LoopScope = scope ?? data?.scope ?? "all";
  return (
    <Panel
      icon={Repeat}
      title={data ? t("loop.title", { date: fmtDeskDate(data.date, "weekdayDayMonth") }) : t("loop.name")}
      description={t("loop.description")}
      actions={data?.mine ? (
        <Segmented<LoopScope>
          size="sm"
          ariaLabel={t("loop.scopeAria")}
          value={current}
          onChange={setScope}
          options={[{ value: "group", label: t("loop.scope.group") }, { value: "all", label: t("loop.scope.all") }]}
        />
      ) : undefined}
    >
      {showPilot && <PilotVerdictLine onOpenUsage={onOpenUsage} />}
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError || !data ? (
        <QueryError error={q.error} title={t("loop.loadFailed")} onRetry={() => q.refetch()} compact />
      ) : data.rows.length === 0 ? (
        <EmptyState icon={Repeat} title={data.scope === "group" ? t("loop.emptyGroup") : t("loop.empty")} className="py-8" />
      ) : (
        <LoopTable data={data} onOpenPeople={onOpenPeople} />
      )}
    </Panel>
  );
}
