import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineIcon } from "lucide-react";
import { EmptyState, ErrorState, Pill, Segmented } from "@/components/ds";
import { humanizeApiError } from "@/lib/api/errors";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodHint, usePeriodNav } from "@/lib/period-links";
import { useRiskHistory } from "./use-risk";
import { useStoredState } from "./primitives";
import {
  ACTIVE_DOT, BAR_RADIUS, CHART, GRID, GlassTooltip, REF_LINE, STROKE, STROKE_THIN, X_AXIS, Y_AXIS, ZERO_LINE,
  pnlPaint, tint, tooltipProps, useChartMotion,
} from "@/components/shared/charts";
import { fmtDate, fmtR, fmtUsd } from "@/lib/format";
import { riskI18n } from "@/i18n/ns/risk";
import { commonI18n } from "@/i18n/ns/common";

const PERIODS = ["20", "60", "120", "250"] as const;
type Period = (typeof PERIODS)[number];

const shortDate = (d: string) => fmtDate(d.slice(0, 10), "dayMonthNumeric");

/** Equity, daily P&L and drawdown-from-peak for one trader. Falls back to R when trades have no $ P&L. */
export function HistoryCharts({ trader, compact = false }: { trader: string; compact?: boolean }) {
  const gid = "eq" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const motion = useChartMotion();
  const [period, setPeriod] = useStoredState<Period>("risk.history.period", "60", PERIODS);
  const q = useRiskHistory(trader, Number(period));
  const h = q.data;
  const { t } = riskI18n.useT();
  const c = commonI18n.t;
  const usd = h?.unit === "usd";
  const fmt = (v: number) => (usd ? fmtUsd(v, { signed: true, decimals: 0, compact: 10_000 }) : fmtR(v));

  const data = React.useMemo(
    () =>
      (h?.points ?? []).map((p) => ({
        date: p.date,
        equity: usd ? p.cum : p.cumR,
        day: usd ? p.pnl : p.r,
        dd: usd ? p.drawdown : p.drawdownR,
      })),
    [h, usd],
  );
  const paint = React.useMemo(() => pnlPaint(gid, data.map((d) => d.equity)), [data, gid]);
  const ddLimit = usd && h?.limits?.maxDrawdown ? -h.limits.maxDrawdown : null;
  // Every point / bar is a trading day: click (or focus + ←/→ + Enter) opens its «Разбор дня».
  const nav = usePeriodNav({
    kind: "day",
    dates: data.map((d) => d.date),
    trader,
    label: t("history.navLabel"),
    describe: (i) => t("history.describe", { date: shortDate(data[i].date), day: data[i].day == null ? "—" : fmt(data[i].day), equity: fmt(data[i].equity) }),
  });
  const dayLabel = (l: unknown) => <>{typeof l === "string" ? fmtDate(l.slice(0, 10), "short") : String(l)}<PeriodHint kind="day" /></>;
  const chartH = compact ? 150 : 200;
  const smallH = compact ? 100 : 120;
  // Heights as variables, so the container queries below can re-size the charts without JS.
  const heights = { "--eq-h": `${chartH}px`, "--sm-h": `${smallH}px` } as React.CSSProperties;

  return (
    <div className="@container flex flex-col gap-4" style={heights}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel={t("history.periodAria")}
            size="sm"
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: c("time.daysShort", { count: Number(p) }) }))}
          />
          {h && !usd && <Pill tone="warn">{t("history.inR")}</Pill>}
        </div>
        {h && (
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="up">{t("history.green", { count: h.stats.greenDays })}</Pill>
            <Pill tone="down">{t("history.red", { count: h.stats.redDays })}</Pill>
            {h.stats.redDayStreak >= 2 && <Pill tone="down" dot>{t("history.redStreak", { count: h.stats.redDayStreak })}</Pill>}
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="rounded-xl" style={{ height: chartH }} />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : q.isError ? (
        <ErrorState compact inset error={q.error} message={t("history.loadFailed", { error: humanizeApiError(q.error) })} onRetry={() => q.refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={LineIcon} title={t("history.emptyTitle")} description={t("history.emptyDesc")} className="py-8" />
      ) : (
        <div {...nav.wrapperProps} className={`flex flex-col gap-4 ${nav.wrapperProps.className}`}>
          {/* Narrow: equity, then day result + drawdown in two columns. ≥ 56rem: equity big on the left, the two small
              charts stacked on the right. ≥ 72rem: three equal columns. */}
          <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @6xl:grid-cols-3">
            <div className="@lg:col-span-2 @4xl:col-span-1 @4xl:row-span-2 @6xl:row-span-1">
              <div className="flex min-h-5 items-baseline justify-between gap-2">
                <span className="micro-label">{t("history.equity")}</span>
                <span className="text-sm font-semibold tabular-nums">{fmt(data[data.length - 1].equity)}</span>
              </div>
              <div className="mt-1 h-[var(--eq-h)] @4xl:h-[calc(var(--sm-h)*2_+_2.5rem)] @6xl:h-[var(--eq-h)]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} {...nav.chartProps}>
                    {paint.defs}
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="date" tickFormatter={shortDate} {...X_AXIS} minTickGap={24} />
                    <YAxis {...Y_AXIS} width={56} tickFormatter={(v: number) => (usd ? fmtUsd(v, { decimals: 0, compact: 10_000 }) : `${v}R`)} />
                    <Tooltip
                      {...tooltipProps("line")}
                      content={<GlassTooltip tone="pnl" delta={(r) => r.day as number | null} deltaFormat={fmt} deltaLabel={t("history.dayTip")} />}
                      labelFormatter={dayLabel}
                      formatter={(v: number) => [fmt(v), t("history.equityTip")]}
                    />
                    <ReferenceLine {...ZERO_LINE} />
                    <Area type="monotone" dataKey="equity" stroke={paint.stroke} strokeWidth={STROKE} fill={paint.fill} activeDot={{ ...ACTIVE_DOT, fill: CHART.fg }} {...motion} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="flex min-h-5 items-baseline"><span className="micro-label">{t("history.dayResult")}</span></div>
              <div className="mt-1 h-[var(--sm-h)] @6xl:h-[var(--eq-h)]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} {...nav.chartProps}>
                    <XAxis dataKey="date" hide />
                    <YAxis {...Y_AXIS} width={56} tickFormatter={(v: number) => (usd ? fmtUsd(v, { decimals: 0, compact: 10_000 }) : `${v}R`)} />
                    <Tooltip {...tooltipProps("bar")} content={<GlassTooltip tone="pnl" />} labelFormatter={dayLabel} formatter={(v: number) => [v == null ? t("history.noUsd") : fmt(v), t("history.dayTip")]} />
                    <ReferenceLine {...ZERO_LINE} />
                    <Bar dataKey="day" radius={BAR_RADIUS} {...motion}>
                      {data.map((d, i) => (
                        <Cell
                          key={d.date}
                          fill={(d.day ?? 0) >= 0 ? CHART.up : CHART.down}
                          fillOpacity={nav.active < 0 || nav.active === i ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="flex min-h-5 items-baseline justify-between gap-2">
                <span className="micro-label">{t("history.ddTitle")}</span>
                {ddLimit != null && <span className="text-2xs text-muted-foreground">{t("history.ddLimit", { amount: fmtUsd(-ddLimit, { decimals: 0 }) })}</span>}
              </div>
              <div className="mt-1 h-[var(--sm-h)] @6xl:h-[var(--eq-h)]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} {...nav.chartProps}>
                    <XAxis dataKey="date" hide />
                    <YAxis {...Y_AXIS} width={56} domain={[ddLimit != null ? Math.min(ddLimit * 1.1, 0) : "auto", 0]} tickFormatter={(v: number) => (usd ? fmtUsd(v, { decimals: 0, compact: 10_000 }) : `${v}R`)} />
                    <Tooltip {...tooltipProps("line")} content={<GlassTooltip tone="pnl" />} labelFormatter={dayLabel} formatter={(v: number) => [fmt(v), c("trading.drawdown")]} />
                    {ddLimit != null && <ReferenceLine y={ddLimit} {...REF_LINE} stroke={CHART.down} />}
                    <Area type="stepAfter" dataKey="dd" stroke={tint("down", 0.85)} fill={tint("down", 0.14)} strokeWidth={STROKE_THIN} activeDot={{ ...ACTIVE_DOT, fill: CHART.down }} {...motion} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {nav.caption}

          {h && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm @md:grid-cols-4 @4xl:max-w-4xl">
              <div><dt className="text-xs text-muted-foreground">{t("history.best")}</dt><dd className="font-medium tabular-nums text-up">{h.stats.bestDay != null ? fmt(h.stats.bestDay) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("history.worst")}</dt><dd className="font-medium tabular-nums text-down">{h.stats.worstDay != null ? fmt(h.stats.worstDay) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{c("trading.maxDrawdown")}</dt><dd className="font-medium tabular-nums">{fmt(h.stats.maxDrawdown)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("history.worstStreak")}</dt><dd className="font-medium tabular-nums">{c("time.daysShort", { count: h.stats.worstRedStreak })}</dd></div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
