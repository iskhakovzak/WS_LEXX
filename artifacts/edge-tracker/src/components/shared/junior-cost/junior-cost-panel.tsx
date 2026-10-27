/**
 * «Путь к безубытку» — one junior's cost curve (cumulative net after fees), the breakeven day and the deepest point
 * marked, the price split (fees / gross / seat), days to breakeven, the projection with its interval and the anonymous
 * desk median. Used in the profile («Характеристика») and the curator cabinet (tab «Академия»). Hidden when the viewer
 * may not read that book (403) or the person has no path yet (`hideEmpty`).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, Route } from "lucide-react";
import { Panel, Pill, StatCard, StatGrid, toneOf } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVE_DOT, CHART, GRID, GlassTooltip, REF_LINE, STROKE, X_AXIS, Y_AXIS, ZERO_LINE, pnlPaint, tooltipProps, useChartMotion } from "@/components/shared/charts";
import { fmtDate } from "@/lib/format";
import { juniorCostI18n } from "@/i18n/ns/juniorCost";
import { traderJuniorCostQuery, STOP_DAYS, type TraderJuniorCost } from "./api";
import { STATUS_TONE, calendarDays, projectionLines, statusLabel, tradingDays, usd } from "./model";

function CostCurve({ data }: { data: TraderJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  const motion = useChartMotion();
  const gid = "jc" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const curve = data.path.curve;
  const paint = pnlPaint(gid, curve.map((p) => p.cum));
  const last = curve[curve.length - 1]!;
  const be = data.path.breakeven;
  const tr = data.path.trough;
  return (
    <div
      className="h-56 sm:h-64"
      role="img"
      aria-label={t("panel.chartAria", { from: fmtDate(curve[0]!.day, "medium"), to: fmtDate(last.day, "medium"), net: usd(last.cum, true) })}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={curve} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
          {paint.defs}
          <CartesianGrid {...GRID} />
          <XAxis dataKey="day" tickFormatter={(d: string) => fmtDate(d, "dayMonth")} {...X_AXIS} minTickGap={32} />
          <YAxis {...Y_AXIS} tickFormatter={(v: number) => usd(v)} />
          <Tooltip
            {...tooltipProps("line")}
            content={<GlassTooltip tone="pnl" delta={(r) => r.net as number} deltaFormat={(v) => usd(v, true)} deltaLabel={t("panel.dayNet")} />}
            labelFormatter={(d: string) => fmtDate(d, "medium")}
            formatter={(v: number) => [usd(v, true), t("panel.cum")]}
          />
          <ReferenceLine {...ZERO_LINE} />
          {be && <ReferenceLine x={be.day} {...REF_LINE} label={{ value: t("panel.breakevenMark"), position: "insideTopLeft", fill: CHART.axis, fontSize: 11 }} />}
          {tr && <ReferenceDot x={tr.day} y={tr.cum} r={4} fill={CHART.down} stroke={CHART.surface} strokeWidth={2} label={{ value: t("panel.troughMark"), position: "bottom", fill: CHART.axis, fontSize: 11 }} />}
          <Area type="monotone" dataKey="cum" stroke={paint.stroke} strokeWidth={STROKE} fill={paint.fill} activeDot={{ ...ACTIVE_DOT, fill: CHART.fg }} {...motion} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Kpis({ data }: { data: TraderJuniorCost }) {
  const { t } = juniorCostI18n.useT();
  const p = data.path;
  const c = p.cost;
  const reached = p.status === "reached";
  const costHint = c.seat > 0
    ? t("kpi.costHintSeat", { fees: usd(c.fees), gross: usd(c.gross, true), seat: usd(c.seat) })
    : t("kpi.costHint", { fees: usd(c.fees), gross: usd(c.gross, true) });
  const desk = data.desk;
  return (
    <StatGrid min="10rem">
      <StatCard label={reached ? t("kpi.cost") : t("kpi.costSoFar")} value={usd(c.total)} tone={c.total > 0 ? "down" : "neutral"} hint={costHint} />
      {p.breakeven ? (
        <StatCard
          label={t("kpi.days")}
          value={tradingDays(p.breakeven.tradingDays)}
          hint={t("kpi.daysHint", { calendar: calendarDays(p.breakeven.calendarDays), active: p.breakeven.activeDays })}
        />
      ) : (
        <StatCard label={t("kpi.onTheWay")} value={tradingDays(p.tenureTradingDays)} hint={p.start ? t("kpi.onTheWayHint", { date: fmtDate(p.start, "medium") }) : undefined} />
      )}
      <StatCard label={t("kpi.now")} value={usd(p.current, true)} tone={toneOf(p.current)} hint={t("kpi.nowHint")} />
      {desk && (
        <StatCard
          label={t("kpi.desk")}
          value={t("kpi.deskValue", { cost: usd(desk.medianCost), days: desk.medianDays != null ? tradingDays(desk.medianDays) : "—" })}
          hint={t("kpi.deskHint", { count: desk.reached })}
        />
      )}
    </StatGrid>
  );
}

function JuniorCostBody({ data }: { data: TraderJuniorCost }) {
  const p = data.path;
  const { t } = juniorCostI18n.useT();
  const notes = [
    ...projectionLines(p),
    ...(p.relapsed ? [t("note.relapsed", { current: usd(p.current, true) })] : []),
    ...(p.status === "stopped" ? [t("note.stopped", { days: STOP_DAYS })] : []),
    ...(p.truncated ? [t("note.truncated")] : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <Kpis data={data} />
      {p.curve.length >= 2 && <CostCurve data={data} />}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `trader` null = the viewer. */
export function JuniorCostPanel({ trader, hideEmpty = false, className }: { trader: string | null; hideEmpty?: boolean; className?: string }) {
  const { t } = juniorCostI18n.useT();
  const q = useQuery(traderJuniorCostQuery(trader));
  if (q.isError || (hideEmpty && !q.data?.path.curve.length)) return null;
  const d = q.data;
  const description = d
    ? t("panel.description", { seat: d.settings.seatUsdMonth > 0 ? t("panel.descriptionSeat") : "", days: tradingDays(d.settings.stableDays) })
    : undefined;
  return (
    <Panel
      title={t("panel.title")}
      icon={Route}
      description={description}
      className={className}
      actions={d && <Pill tone={STATUS_TONE[d.path.status]}>{statusLabel(d.path)}</Pill>}
    >
      {d ? <JuniorCostBody data={d} /> : <Skeleton className="h-64 w-full" />}
    </Panel>
  );
}
