import { useId, useMemo, useState } from "react";
import { LineChart as LineIcon } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { EquityChart, buildDayCandles, soleTrader, type EquityTradeInput } from "@/components/equity-chart";
import {
  ACTIVE_DOT, BAR_RADIUS, GRID, GlassTooltip, MARGIN, STROKE, STROKE_THIN, X_AXIS, Y_AXIS, ZERO_LINE,
  barGradients, pnlColor, pnlPaint, tint, tooltipProps, useBarFocus, useChartMotion, useGlow,
} from "@/components/shared/charts";
import { fmtMetricCompact, fmtValue, type EquityPoint, type Metric } from "./metrics";
import { fmtMonth } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { statsI18n } from "@/i18n/ns/stats";

/** "2026-10" → «окт 26» / «Oct 26». */
const monthLabel = (m: string) => {
  const i = Number(m.substring(5, 7)) - 1;
  return i >= 0 && i < 12 ? `${fmtMonth(i, "short").replace(".", "")} ${m.substring(2, 4)}` : m;
};

type View = "equity" | "monthly";

export function EquityPanel({
  equity, monthly, metric, trades, trader, daily = false,
}: {
  equity: EquityPoint[];
  /** The points are end-of-day closes (staff view, GET /api/stats/aggregate), not single trades. */
  daily?: boolean;
  monthly: { month: string; value: number; count: number }[];
  metric: Metric;
  /** Trades of the period: when given, the curve is drawn on the equity engine (hover — day details, click — «Разбор дня»). */
  trades?: EquityTradeInput[];
  /** Trader for the day-report link (null / "all" — derived from the trades). */
  trader?: string | null;
}) {
  const { t } = statsI18n.useT();
  const [view, setView] = useState<View>("equity");
  const motion = useChartMotion();
  const gid = useId().replace(/:/g, "");
  const paint = useMemo(() => pnlPaint(`statsEq${gid}`, equity.map((p) => p.equity)), [equity, gid]);
  const glow = useGlow(`statsEq${gid}`);
  const focus = useBarFocus();
  const rows = useMemo(() => equity.map((p, i) => ({ ...p, step: i ? p.equity - equity[i - 1].equity : p.equity })), [equity]);
  const unit = metric === "r" ? "R" : "$";
  const last = equity.at(-1)?.equity ?? null;
  const eqUnit = metric === "r" ? "r" : metric === "usd" ? "gross" : "net";
  const days = useMemo(() => (trades ? buildDayCandles(trades, eqUnit) : []), [trades, eqUnit]);

  return (
    <Panel
      title={view === "equity" ? t("equity.curve") : t("equity.monthly")}
      description={
        view === "equity"
          ? trades
            ? t("equity.hintDays", { unit })
            : daily ? t("equity.hintDaily", { unit }) : t("equity.hintCurve", { unit })
          : t("equity.hintMonthly", { unit })
      }
      actions={
        <Segmented<View>
          size="sm"
          ariaLabel={t("equity.viewAria")}
          value={view}
          onChange={setView}
          options={[{ value: "equity", label: t("equity.viewCurve") }, { value: "monthly", label: t("equity.viewMonthly") }]}
        />
      }
    >
      {view === "equity" && trades ? (
        <EquityChart
          days={days}
          unit={eqUnit}
          trader={trader && trader !== "all" ? trader : soleTrader(trades)}
          storageKey="stats.equity"
          height={440}
        />
      ) : view === "equity" ? (
        equity.length >= 2 ? (
          <>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={`text-lg font-semibold tabular-nums ${last != null && last < 0 ? "text-down" : "text-up"}`}>
                {fmtValue(last, metric)}
              </span>
              <span className="text-xs text-muted-foreground">{daily ? t("equity.overDays", { count: equity.length, unit }) : t("equity.overTrades", { count: equity.length, unit })}</span>
            </div>
            <div className="h-[240px]" role="img" aria-label={t("equity.aria", { value: fmtValue(last, metric) })}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={MARGIN}>
                  {paint.defs}
                  {glow.defs}
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="idx" {...X_AXIS} minTickGap={48} />
                  <YAxis {...Y_AXIS} tickFormatter={(v: number) => fmtMetricCompact(v, metric) || "0"} />
                  <ReferenceLine {...ZERO_LINE} />
                  <Tooltip
                    {...tooltipProps("line")}
                    content={<GlassTooltip tone="pnl" delta={(r) => r.step as number} deltaFormat={(v) => fmtValue(v, metric)} deltaLabel={daily ? t("equity.deltaDay") : t("equity.deltaTrade")} />}
                    labelFormatter={(_l, payload) => (payload?.[0]?.payload as EquityPoint | undefined)?.label ?? ""}
                    formatter={(v: number, name: string) => [fmtValue(v, metric), name === "equity" ? t("equity.accumulated") : t("equity.drawdown")]}
                  />
                  <Area
                    {...motion} type="monotone" dataKey="drawdown" stroke={tint("down", 0.7)} strokeWidth={STROKE_THIN}
                    fill={tint("down", 0.12)} dot={false} activeDot={false}
                  />
                  <Area
                    {...motion} type="monotone" dataKey="equity" stroke={paint.stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"
                    filter={glow.filter} fill={paint.fill} dot={false} activeDot={{ ...ACTIVE_DOT, fill: pnlColor(last) }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-up" aria-hidden="true" />{t("equity.accumulated")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-down/25" aria-hidden="true" />{t("equity.drawdown")}</span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={LineIcon}
            title={t("equity.few")}
            description={t("equity.fewHint", { unit: metric === "r" ? "R-multiple" : "P&L" })}
          />
        )
      ) : monthly.length > 0 ? (
        <div className="h-[268px]" role="img" aria-label={t("equity.monthlyAria")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={MARGIN} {...focus.chartProps}>
              {barGradients(`statsMo${gid}`)}
              <CartesianGrid {...GRID} />
              <XAxis dataKey="month" {...X_AXIS} tickFormatter={monthLabel} />
              <YAxis {...Y_AXIS} tickFormatter={(v: number) => fmtMetricCompact(v, metric) || "0"} />
              <ReferenceLine {...ZERO_LINE} />
              <Tooltip
                {...tooltipProps("bar")}
                content={<GlassTooltip tone="pnl" footer={(r) => commonI18n.t("units.trades", { count: (r as { count: number }).count })} />}
                labelFormatter={(l: string) => monthLabel(l)}
                formatter={(v: number) => [fmtValue(v, metric), t("equity.result")]}
              />
              <Bar dataKey="value" radius={BAR_RADIUS} maxBarSize={36} {...motion}>
                {monthly.map((m, i) => <Cell key={m.month} fill={`url(#statsMo${gid}-${m.value >= 0 ? "up" : "down"})`} fillOpacity={focus.opacity(i)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState icon={LineIcon} title={t("equity.noMonthly")} description={metric === "r" ? t("equity.noMonthlyR") : t("equity.noMonthlyUsd")} />

      )}
    </Panel>
  );
}
