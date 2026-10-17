/**
 * «Партнёрам» — desk-level executive summary of the week (staff only, print / PDF friendly):
 * desk net, active traders, fees and efficiency, the 3–5 main conclusions, top / problem traders and
 * one table «трейдер | нетто | тренд | риск-статус | заметка».
 * Data: GET /api/weekly-review/overview (+ /api/benchmark for trends, /api/risk/desk as a fallback).
 */
import * as React from "react";
import { Award, Briefcase, ListChecks, TrendingDown, Users } from "lucide-react";
import {
  BentoGrid, DataTable, EmptyState, ErrorState, Panel, PanelSkeleton, Pill, SortableTh, Sparkline, StatCard, StatGrid, StatGridSkeleton, TableSkeleton, Tile, toneOf, useTableSort, type Tone,
} from "@/components/ds";
import { cn } from "@/lib/utils";
import { buildDeskConclusions, type DeskRow } from "@/lib/weeklyInsights";
import { STATUS_LABEL, fmtPct, fmtUsd, fmtX, useWeeklyOverview, weekLabel, type OverviewRow, type RiskStatus } from "./api";
import { ReviewStatusPill } from "./collab";
import { VERDICT_LABEL, VERDICT_TONE } from "./insight-panels";
import { useRiskDeskNow, useWeekBenchmark, type BenchTrend } from "./insights-api";

const RISK_META: Record<RiskStatus, { label: string; tone: Tone }> = {
  ok: { label: "в лимитах", tone: "up" },
  warn: { label: "на грани", tone: "warn" },
  breach: { label: "нарушение", tone: "down" },
  none: { label: "лимиты не заданы", tone: "neutral" },
};

type Row = OverviewRow & { trend: BenchTrend | null; riskStatus: RiskStatus | null; riskNow: boolean; note: string | null };

const RISK_ORDER: Record<RiskStatus, number> = { breach: 0, warn: 1, ok: 2, none: 3 };
const VERDICT_ORDER: Record<BenchTrend["verdict"], number | null> = { worse: 0, flat: 1, better: 2, nodata: null };
const PARTNER_ACCESSORS = {
  trader: (r: Row) => r.trader,
  net: (r: Row) => r.netPnl,
  trend: (r: Row) => (r.trend ? VERDICT_ORDER[r.trend.verdict] : null),
  risk: (r: Row) => (r.riskStatus ? RISK_ORDER[r.riskStatus] : null),
};

export function PartnersView({ week, onOpen }: { week: string; onOpen: (trader: string) => void }) {
  const q = useWeeklyOverview(week);
  const ov = q.data;
  const bench = useWeekBenchmark(ov?.week ?? null, !!ov);
  const needRiskFallback = !!ov && ov.traders.length > 0 && ov.traders.every((t) => t.risk == null);
  const riskNow = useRiskDeskNow(needRiskFallback && !!ov?.week.isCurrent);

  const rows = React.useMemo<Row[]>(() => {
    if (!ov) return [];
    const trendBy = new Map((bench.data?.trend ?? []).map((t) => [t.trader, t]));
    const badgeBy = new Map((bench.data?.rows ?? []).map((r) => [r.trader, r.badges?.find((b) => b.kind === "weakness")?.label ?? null]));
    return ov.traders
      .map((t) => {
        const fromNow = t.risk == null ? riskNow.data?.get(t.trader) ?? null : null;
        return {
          ...t,
          trend: trendBy.get(t.trader) ?? null,
          riskStatus: t.risk?.status ?? fromNow,
          riskNow: t.risk == null && fromNow != null,
          note: t.curatorComment ?? badgeBy.get(t.trader) ?? null,
        };
      })
      .sort((a, b) => (b.netPnl ?? -Infinity) - (a.netPnl ?? -Infinity) || b.trades - a.trades);
  }, [ov, bench.data, riskNow.data]);

  if (q.isError) return <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} inset /></Panel>;
  if (!ov) {
    return (
      <div className="flex flex-col gap-[var(--grid-gap)]" aria-busy="true">
        <StatGridSkeleton count={4} />
        <div className="grid gap-[var(--grid-gap)] lg:grid-cols-12">
          <PanelSkeleton height={180} className="lg:col-span-7" />
          <PanelSkeleton height={180} className="lg:col-span-5" />
        </div>
        <Panel><TableSkeleton rows={6} cols={5} /></Panel>
      </div>
    );
  }

  const s = ov.summary;
  const active = rows.filter((r) => r.trades > 0);
  const idle = rows.filter((r) => r.trades === 0);
  const green = active.filter((r) => (r.netPnl ?? 0) > 0).length;
  const fees = s.fees ?? rows.reduce((a, r) => a + r.fees, 0);
  const gross = s.grossPnl ?? null;
  const feeShare = gross != null && gross > 0 ? fees / gross : null;
  const perTrade = s.netPnl != null && s.trades > 0 ? s.netPnl / s.trades : null;
  const deskPf = s.posNet != null && s.negNet != null && s.negNet < 0 ? s.posNet / Math.abs(s.negNet) : null;

  const deskRows: DeskRow[] = rows.map((r) => ({
    trader: r.trader, trades: r.trades, netPnl: r.netPnl, fees: r.fees, grossPnl: r.grossPnl ?? null,
    riskStatus: r.riskStatus, verdict: r.trend?.verdict ?? null, weakness: r.note && !r.curatorComment ? r.note : null,
  }));
  const conclusions = buildDeskConclusions(
    { traders: s.traders, active: s.active, netPnl: s.netPnl, fees, grossPnl: gross, reviewed: s.reviewed, submitted: s.submitted },
    deskRows,
  );
  const ranked = active.filter((r) => r.netPnl != null);
  const top = ranked[0] && (ranked[0].netPnl ?? 0) > 0 ? ranked[0] : null;
  const problem =
    active.find((r) => r.riskStatus === "breach") ??
    (ranked.length && (ranked[ranked.length - 1].netPnl ?? 0) < 0 ? ranked[ranked.length - 1] : null);

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]" data-partners-report>
      <p data-print-title className="hidden text-lg font-semibold">Деск · отчёт недели {weekLabel(ov.week.key)}</p>
      <StatGrid cols={4}>
        <StatCard label="Нетто деска" term="net" value={fmtUsd(s.netPnl, { signed: true })} tone={toneOf(s.netPnl)} hint={`${s.trades} сделок за неделю`} />
        <StatCard label="Активные трейдеры" value={`${s.active} из ${s.traders}`} hint={s.active ? `в плюсе ${green} из ${s.active}` : "никто не торговал"} />
        <StatCard
          label="Комиссии"
          term="fees"
          value={fmtUsd(fees)}
          tone={feeShare != null && feeShare > 0.4 ? "down" : "neutral"}
          hint={feeShare != null ? `${fmtPct(feeShare)} брутто` : gross != null ? "брутто ≤ 0 — доля не считается" : "доля брутто — после обновления API"}
        />
        <StatCard
          label="Нетто на сделку"
          value={fmtUsd(perTrade, { signed: true })}
          tone={toneOf(perTrade)}
          hint={deskPf != null ? `PF деска ${fmtX(deskPf)}` : "PF деска: —"}
        />
      </StatGrid>

      <BentoGrid>
        <Panel title="Главное за неделю" icon={ListChecks} fill className="min-w-0 lg:col-span-7">
          <ul className="flex flex-col gap-2">
            {conclusions.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Лидер и зона внимания" icon={Award} fill className="min-w-0 lg:col-span-5">
          {!top && !problem ? (
            <EmptyState compact icon={Users} title="Нет торговавших трейдеров" description="За неделю закрытых сделок на деске нет." />
          ) : (
            <div className="flex flex-col gap-2">
              {top && <TraderTile row={top} kind="top" onOpen={onOpen} />}
              {problem && problem !== top && <TraderTile row={problem} kind="problem" onOpen={onOpen} />}
            </div>
          )}
        </Panel>
      </BentoGrid>

      <Panel
        title="Трейдеры"
        description={`${weekLabel(ov.week.key)} · нетто после комиссий · тренд — 9 недель`}
        icon={Briefcase}
        padded={false}
        className="min-w-0"
      >
        {active.length === 0 ? (
          <EmptyState compact icon={Users} title="За неделю никто не торговал" className="px-[var(--panel-p)]" />
        ) : (
          <PartnersTable rows={active} onOpen={onOpen} />
        )}
        {idle.length > 0 && (
          <p className="border-t border-[var(--glass-border)] px-[var(--panel-p)] py-2.5 text-xs text-muted-foreground">
            Без сделок: {idle.map((r) => r.trader).join(", ")}
          </p>
        )}
      </Panel>
    </div>
  );
}

/** Sorted by net desc like the original list; headers re-sort for printing/reading. */
function PartnersTable({ rows, onOpen }: { rows: Row[]; onOpen: (trader: string) => void }) {
  const { rows: sorted, thProps } = useTableSort(rows, PARTNER_ACCESSORS, "net");
  return (
    <DataTable ariaLabel="Трейдеры за неделю">
      <table>
        <thead>
          <tr>
            <SortableTh {...thProps("trader")}>Трейдер</SortableTh>
            <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
            <SortableTh {...thProps("trend")}>Тренд</SortableTh>
            <SortableTh {...thProps("risk")}>Риск-статус</SortableTh>
            <th>Заметка</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.trader}>
              <td>
                <button type="button" onClick={() => onOpen(r.trader)} className="text-left font-medium text-foreground hover:text-primary hover:underline">{r.trader}</button>
                <div className="text-xs text-muted-foreground">{r.trades} сд. · WR {fmtPct(r.winRate)} · <span title={STATUS_LABEL[r.status]}>{STATUS_LABEL[r.status].toLowerCase()}</span></div>
              </td>
              <td className={cn("text-right font-semibold", (r.netPnl ?? 0) > 0 ? "text-up" : (r.netPnl ?? 0) < 0 ? "text-down" : "text-foreground")}>{fmtUsd(r.netPnl, { signed: true })}</td>
              <td>
                {r.trend ? (
                  <div className="flex items-center gap-2">
                    <Sparkline data={r.trend.weeks.map((w) => w.net)} width={88} height={24} baseline={0} ariaLabel={`Нетто по неделям: ${r.trader}`} />
                    <Pill tone={VERDICT_TONE[r.trend.verdict]}>{VERDICT_LABEL[r.trend.verdict]}</Pill>
                  </div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </td>
              <td>
                {r.riskStatus ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Pill tone={RISK_META[r.riskStatus].tone} dot>{RISK_META[r.riskStatus].label}</Pill>
                    {r.riskNow && <span className="text-xs text-muted-foreground">сейчас</span>}
                    {r.risk?.events[0] && <span className="max-w-[16rem] whitespace-normal text-xs text-muted-foreground">{r.risk.events.map((e) => e.label).join(", ")}</span>}
                  </span>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </td>
              <td className="max-w-[22rem]">
                {r.note ? <span className="whitespace-pre-line break-words text-sm text-foreground">{r.note}</span> : <span className="text-xs text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}

function TraderTile({ row, kind, onOpen }: { row: Row; kind: "top" | "problem"; onOpen: (t: string) => void }) {
  const why =
    kind === "top"
      ? [row.trend?.verdict === "better" ? "растёт 4 недели" : null, row.riskStatus === "ok" ? "в лимитах" : null, row.winRate != null ? `WR ${fmtPct(row.winRate)}` : null]
      : [row.riskStatus === "breach" ? `нарушение лимитов${row.risk?.events[0] ? `: ${row.risk.events[0].label}` : ""}` : null, row.trend?.verdict === "worse" ? "хуже своих 4 недель" : null, row.violations ? `${row.violations} наруш. правил` : null];
  return (
    <Tile onClick={() => onOpen(row.trader)} className="flex items-center gap-3">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", kind === "top" ? "bg-up/15 text-up" : "bg-down/15 text-down")} aria-hidden="true">
        {kind === "top" ? <Award className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{kind === "top" ? "Лидер недели" : "Зона внимания"}</p>
        <p className="truncate text-sm font-semibold text-foreground">{row.trader}</p>
        <p className="truncate text-xs text-muted-foreground">{why.filter(Boolean).join(" · ") || `${row.trades} сделок`}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("text-base font-semibold tabular-nums", (row.netPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{fmtUsd(row.netPnl, { signed: true })}</span>
        <ReviewStatusPill status={row.status} />
      </div>
    </Tile>
  );
}
