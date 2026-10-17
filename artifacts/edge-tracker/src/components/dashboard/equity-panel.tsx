import { useMemo } from "react";
import { Link } from "wouter";
import { ChevronRight, LineChart as LineChartIcon, RefreshCw } from "lucide-react";
import { EmptyState, Panel, Segmented, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EquityChart, fromDashboardDays } from "@/components/equity-chart";
import { KPI_FORMULAS } from "@/lib/trade-math";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct, fmtR, plural, shortDate } from "./fmt";
import type { DashboardEquity, EquityMetric, EquityPeriod } from "./use-dashboard";

/** Server windows of the curve; the engine's own zoom / navigator work inside the loaded one. */
const PERIOD_OPTIONS: { value: EquityPeriod; label: string; title: string }[] = [
  { value: "week", label: "1Н", title: "Эта неделя" },
  { value: "30d", label: "1М", title: "30 дней" },
  { value: "90d", label: "3М", title: "90 дней" },
  { value: "ytd", label: "YTD", title: "С начала года" },
  { value: "all", label: "Всё", title: "Всё время" },
];

const EMPTY_TITLE: Record<EquityPeriod, string> = {
  week: "На этой неделе закрытых сделок нет",
  "30d": "За 30 дней закрытых сделок нет",
  "90d": "За 90 дней закрытых сделок нет",
  ytd: "С начала года закрытых сделок нет",
  all: "Закрытых сделок пока нет",
};
const LONGER: Partial<Record<EquityPeriod, EquityPeriod>> = { week: "30d", "30d": "90d", "90d": "ytd", ytd: "all" };

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

/** Dashboard equity: total, the interactive curve (click a day → «Разбор дня»), four numbers. */
export function EquityPanel({
  data,
  isLoading,
  isError,
  onRetry,
  period,
  onPeriodChange,
  metric,
  onMetricChange,
  fill,
}: {
  data: DashboardEquity | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  period: EquityPeriod;
  onPeriodChange: (p: EquityPeriod) => void;
  metric: EquityMetric;
  onMetricChange: (m: EquityMetric) => void;
  fill?: boolean;
}) {
  const hasPnl = !!data?.hasPnl;
  // R only exists when trades have stops; without it the toggle is hidden entirely.
  const hasR = (data?.days ?? []).some((d) => d.r !== 0);
  const effMetric: EquityMetric = metric === "r" && hasR ? "r" : hasPnl ? "pnl" : hasR ? "r" : "pnl";
  const fmt = effMetric === "pnl" ? fmtMoney : (v: number | null) => fmtR(v);

  const days = useMemo(() => fromDashboardDays(data?.days ?? [], effMetric === "pnl" ? "net" : "r"), [data, effMetric]);

  const t = data?.totals;
  const total = effMetric === "pnl" ? (t?.pnl ?? 0) : (t?.r ?? 0);
  const best = effMetric === "pnl" ? (t?.bestNet?.pnl ?? null) : (t?.bestR?.r ?? null);
  const worst = effMetric === "pnl" ? (t?.worstNet?.pnl ?? null) : (t?.worstR?.r ?? null);
  const dd = effMetric === "pnl" && t?.maxDrawdownNet != null ? t.maxDrawdownNet : (t?.maxDrawdownR ?? 0);
  const longer = LONGER[period];

  return (
    <Panel
      title={effMetric === "pnl" ? "Кривая капитала · нетто" : "Кривая капитала · R"}
      icon={LineChartIcon}
      fill={fill}
      actions={
        hasR && hasPnl ? (
          <Segmented<EquityMetric>
            ariaLabel="Единица"
            size="sm"
            value={effMetric}
            onChange={onMetricChange}
            options={[
              { value: "pnl", label: "$" },
              { value: "r", label: "R" },
            ]}
          />
        ) : undefined
      }
      footer={
        <>
          <span>{data ? `${shortDate(data.from)} — ${shortDate(data.to)} · по дате закрытия, Нью-Йорк` : " "}</span>
          <Link href="/analytics" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Вся аналитика
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      }
    >
      {isLoading && !data ? (
        <div className="flex flex-1 flex-col gap-3" role="status" aria-label="Загрузка">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="min-h-[240px] w-full flex-1 rounded-xl" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg" />
            ))}
          </div>
        </div>
      ) : isError && !data ? (
        <EmptyState
          compact
          title="Не удалось загрузить кривую"
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Повторить
            </Button>
          }
        />
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          {t && days.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={cn("text-2xl font-semibold tabular-nums tracking-tight", toneText(toneOf(total)))}
                title={effMetric === "pnl" ? KPI_FORMULAS.netPnl : undefined}
              >
                {fmt(total)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t.trades} {plural(t.trades, ["сделка", "сделки", "сделок"])} · {t.tradingDays}{" "}
                {plural(t.tradingDays, ["торговый день", "торговых дня", "торговых дней"])}
                {effMetric === "pnl" && t.fees ? ` · комиссии ${fmtMoney(-Math.abs(t.fees))}` : ""}
              </span>
            </div>
          )}
          <EquityChart<EquityPeriod>
            days={days}
            unit={effMetric === "pnl" ? "net" : "r"}
            height="fill"
            storageKey="dashboard.equity"
            period={{ value: period, options: PERIOD_OPTIONS, onChange: onPeriodChange }}
            defaults={{ mode: "line", panes: { pnl: true, dd: false, nav: true, marks: true } }}
            showSummary={false}
            empty={
              <div className="flex flex-1 flex-col gap-3">
                <PeriodSwitch period={period} onChange={onPeriodChange} />
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    compact
                    icon={LineChartIcon}
                    title={EMPTY_TITLE[period]}
                    description="Кривая строится по закрытым сделкам."
                    action={
                      longer ? (
                        <Button variant="outline" size="sm" onClick={() => onPeriodChange(longer)}>
                          Показать {PERIOD_OPTIONS.find((o) => o.value === longer)?.title.toLowerCase()}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              </div>
            }
          />
          {t && days.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Stat label="Win rate" title={KPI_FORMULAS.winRate}>
                {fmtPct(t.winRate)} <span className="text-xs font-normal text-muted-foreground">{t.wins}W / {t.losses}L</span>
              </Stat>
              <Stat label="Лучший день" title={(effMetric === "pnl" ? t.bestNet?.date : t.bestR?.date) ?? undefined}>
                <span className={toneText(toneOf(best))}>{fmt(best)}</span>
              </Stat>
              <Stat label="Худший день" title={(effMetric === "pnl" ? t.worstNet?.date : t.worstR?.date) ?? undefined}>
                <span className={toneText(toneOf(worst))}>{fmt(worst)}</span>
              </Stat>
              <Stat label="Макс. просадка" title={KPI_FORMULAS.maxDrawdown}>
                <span className={toneText(toneOf(dd))}>{fmt(dd)}</span>
              </Stat>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function PeriodSwitch({ period, onChange }: { period: EquityPeriod; onChange: (p: EquityPeriod) => void }) {
  return <Segmented<EquityPeriod> ariaLabel="Период" size="sm" value={period} onChange={onChange} options={PERIOD_OPTIONS} className="self-start" />;
}
