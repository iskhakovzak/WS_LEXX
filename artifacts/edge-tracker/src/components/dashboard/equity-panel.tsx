import { useId, useMemo } from "react";
import { Link } from "wouter";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, LineChart as LineChartIcon, RefreshCw } from "lucide-react";
import { EmptyState, Panel, Segmented, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KPI_FORMULAS } from "@/lib/trade-math";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct, fmtR, plural, shortDate } from "./fmt";
import type { DashboardEquity, EquityMetric, EquityPeriod } from "./use-dashboard";

const PERIOD_OPTIONS: { value: EquityPeriod; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "30d", label: "Месяц" },
];

type Row = { date: string; label: string; day: number; cum: number; trades: number; wins: number; losses: number; fees: number | null; gross: number | null };

function ChartTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: Row }[]; metric: EquityMetric }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const f = metric === "pnl" ? fmtMoney : (v: number) => fmtR(v);
  return (
    <div className="glass-thick min-w-[170px] rounded-xl px-3 py-2 text-xs">
      <div className="mb-1 font-medium">{shortDate(r.date)}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{metric === "pnl" ? "За день · нетто" : "За день"}</span>
        <span className={cn("font-medium tabular-nums", toneText(toneOf(r.day)))}>{f(r.day)}</span>
      </div>
      {metric === "pnl" && r.gross != null && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Брутто / комиссии</span>
          <span className="tabular-nums">
            {fmtMoney(r.gross)} / {fmtMoney(-Math.abs(r.fees ?? 0))}
          </span>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Накоплено</span>
        <span className="font-medium tabular-nums">{f(r.cum)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Сделки</span>
        <span className="tabular-nums">
          {r.trades} · {r.wins}W / {r.losses}L
        </span>
      </div>
    </div>
  );
}

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

/** Compact week / month equity: total, curve with daily bars, four numbers. The full range lives in Analytics. */
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
  const gradId = useId().replace(/:/g, "");
  const hasPnl = !!data?.hasPnl;
  // R only exists when trades have stops; without it the toggle is hidden entirely.
  const hasR = (data?.days ?? []).some((d) => d.r !== 0);
  const effMetric: EquityMetric = metric === "r" && hasR ? "r" : hasPnl ? "pnl" : hasR ? "r" : "pnl";
  const fmt = effMetric === "pnl" ? fmtMoney : (v: number | null) => fmtR(v);

  const rows: Row[] = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        date: d.date,
        label: shortDate(d.date),
        day: effMetric === "pnl" ? (d.pnl ?? 0) : d.r,
        cum: effMetric === "pnl" ? d.cumPnl : d.cumR,
        trades: d.trades,
        wins: d.wins,
        losses: d.losses,
        fees: d.fees,
        gross: d.pnlGross,
      })),
    [data, effMetric],
  );

  const t = data?.totals;
  const total = effMetric === "pnl" ? (t?.pnl ?? 0) : (t?.r ?? 0);
  const best = effMetric === "pnl" ? (t?.bestNet?.pnl ?? null) : (t?.bestR?.r ?? null);
  const worst = effMetric === "pnl" ? (t?.worstNet?.pnl ?? null) : (t?.worstR?.r ?? null);
  const dd = effMetric === "pnl" && t?.maxDrawdownNet != null ? t.maxDrawdownNet : (t?.maxDrawdownR ?? 0);

  return (
    <Panel
      title={effMetric === "pnl" ? "Кривая капитала · нетто" : "Кривая капитала · R"}
      icon={LineChartIcon}
      fill={fill}
      actions={
        <>
          {hasR && hasPnl && (
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
          )}
          <Segmented<EquityPeriod> ariaLabel="Период" size="sm" value={period} onChange={onPeriodChange} options={PERIOD_OPTIONS} />
        </>
      }
      footer={
        <>
          <span>{data ? `${shortDate(data.from)} — ${shortDate(data.to)} · по дате закрытия, Нью-Йорк` : " "}</span>
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
          <Skeleton className="min-h-[180px] w-full flex-1 rounded-xl" />
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
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            compact
            icon={LineChartIcon}
            title={period === "week" ? "На этой неделе закрытых сделок нет" : "За месяц закрытых сделок нет"}
            description="Кривая строится по закрытым сделкам."
            action={
              period === "week" ? (
                <Button variant="outline" size="sm" onClick={() => onPeriodChange("30d")}>
                  Показать месяц
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn("text-2xl font-semibold tabular-nums tracking-tight", toneText(toneOf(total)))}
              title={effMetric === "pnl" ? KPI_FORMULAS.netPnl : undefined}
            >
              {fmt(total)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t!.trades} {plural(t!.trades, ["сделка", "сделки", "сделок"])} · {t!.tradingDays}{" "}
              {plural(t!.tradingDays, ["торговый день", "торговых дня", "торговых дней"])}
              {effMetric === "pnl" && t!.fees ? ` · комиссии ${fmtMoney(-Math.abs(t!.fees))}` : ""}
            </span>
          </div>
          <div className="min-h-[180px] w-full flex-1" role="img" aria-label={`Кривая капитала: итог ${fmt(total)} за ${t!.tradingDays} торговых дней`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`eq-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis
                  width={52}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (effMetric === "pnl" ? `$${Math.round(v)}` : `${v}R`)}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} content={<ChartTooltip metric={effMetric} />} />
                <Bar dataKey="day" barSize={rows.length > 12 ? 8 : 18} radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.date} fill={r.day >= 0 ? "hsl(var(--up) / 0.55)" : "hsl(var(--down) / 0.6)"} />
                  ))}
                </Bar>
                <Area
                  type="monotone"
                  dataKey="cum"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill={`url(#eq-${gradId})`}
                  dot={rows.length <= 12 ? { r: 3, fill: "hsl(var(--chart-1))", strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Stat label="Win rate" title={KPI_FORMULAS.winRate}>
              {fmtPct(t!.winRate)} <span className="text-xs font-normal text-muted-foreground">{t!.wins}W / {t!.losses}L</span>
            </Stat>
            <Stat label="Лучший день" title={(effMetric === "pnl" ? t!.bestNet?.date : t!.bestR?.date) ?? undefined}>
              <span className={toneText(toneOf(best))}>{fmt(best)}</span>
            </Stat>
            <Stat label="Худший день" title={(effMetric === "pnl" ? t!.worstNet?.date : t!.worstR?.date) ?? undefined}>
              <span className={toneText(toneOf(worst))}>{fmt(worst)}</span>
            </Stat>
            <Stat label="Макс. просадка" title={KPI_FORMULAS.maxDrawdown}>
              <span className={toneText(toneOf(dd))}>{fmt(dd)}</span>
            </Stat>
          </div>
        </div>
      )}
    </Panel>
  );
}
