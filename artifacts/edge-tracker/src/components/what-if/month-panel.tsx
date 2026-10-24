import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Panel } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVE_DOT, CHART, GRID, STROKE, STROKE_THIN, X_AXIS, Y_AXIS, ZERO_LINE, tooltipProps, useChartMotion } from "@/components/shared/charts";
import { fmtDateCustom, fmtDeskDate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { RunResponse, SimTrade } from "./api";
import { ALL_MONTHS, type SideStats, monthView, monthsOf } from "./month-view";

/**
 * «Как бы выглядел мой месяц»: the real trades of one month (or the whole period) as a trade-by-trade equity next to
 * the scenario, removed trades marked on the fact line, and four numbers for both — net, max drawdown, worst day, red
 * days. Shown only with a scenario (the run's excluded / changed trades); the month defaults to the latest one.
 */
export function MonthPanel({ trades, run, onDay }: { trades: SimTrade[]; run: RunResponse; onDay?: (day: string) => void }) {
  const { t } = whatIfI18n.useT();
  const months = useMemo(() => monthsOf(trades), [trades]);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked && (picked === ALL_MONTHS || months.includes(picked)) ? picked : months[0] ?? ALL_MONTHS;
  const view = useMemo(() => monthView(trades, run.excluded, run.changed, month), [trades, run.excluded, run.changed, month]);
  const motion = useChartMotion();
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  const label = (m: string) => (m === ALL_MONTHS ? t("month.all") : fmtDateCustom(`${m}-01`, { month: "long", year: "numeric" }));
  const removedDots = view.points.filter((p) => p.removed).map((p) => ({ i: p.i, fact: p.fact }));
  return (
    <Panel
      title={t("month.title")}
      icon={CalendarRange}
      description={t("month.hint")}
      actions={months.length > 0 ? (
        <Select value={month} onValueChange={setPicked}>
          <SelectTrigger className="h-9 w-auto min-w-[10rem] rounded-full" aria-label={t("month.pick")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m} value={m}>{label(m)}</SelectItem>)}
            <SelectItem value={ALL_MONTHS}>{t("month.all")}</SelectItem>
          </SelectContent>
        </Select>
      ) : undefined}
    >
      {view.points.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("month.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="h-[260px]" role="img" aria-label={t("month.aria", { month: label(month) })}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                onClick={onDay ? (st: { activePayload?: { payload?: { day?: unknown } }[] } | null) => { const d = st?.activePayload?.[0]?.payload?.day; if (typeof d === "string") onDay(d); } : undefined}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="i" type="number" domain={[1, "dataMax"]} {...X_AXIS} allowDecimals={false} tickFormatter={(v: number) => String(v)} />
                <YAxis {...Y_AXIS} tickFormatter={usd} width={76} />
                <ReferenceLine {...ZERO_LINE} />
                <Tooltip
                  {...tooltipProps("line")}
                  formatter={(v: number, name: string) => [usd(v), name]}
                  labelFormatter={(_, p) => { const x = p?.[0]?.payload as { day?: string; ticker?: string } | undefined; return x?.day ? `${fmtDeskDate(x.day, "medium")} · ${x.ticker ?? ""}` : ""; }}
                />
                <Line type="linear" dataKey="fact" name={t("month.fact")} stroke={CHART.neutral} strokeDasharray="4 3" strokeWidth={STROKE_THIN} dot={false} activeDot={{ ...ACTIVE_DOT, fill: CHART.neutral }} {...motion} />
                <Line type="linear" dataKey="scenario" name={t("month.scenario")} stroke={CHART.accent} strokeWidth={STROKE} dot={false} activeDot={{ ...ACTIVE_DOT, fill: CHART.accent }} {...motion} />
                <Scatter data={removedDots} dataKey="fact" name={t("month.removedDot")} fill={CHART.down} shape="circle" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2">
            <StatsTable fact={view.fact} scenario={view.scenario} />
            <p className="text-xs text-muted-foreground">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-down align-middle" aria-hidden="true" />
              {t("month.removed", { trades: commonI18n.t("units.trades", { count: view.removed }) })}
              {view.changed > 0 && ` · ${t("month.changed", { trades: commonI18n.t("units.trades", { count: view.changed }) })}`}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function StatsTable({ fact, scenario }: { fact: SideStats; scenario: SideStats }) {
  const { t } = whatIfI18n.useT();
  const usd = (v: number | null | undefined) => (v == null ? "—" : fmtUsd(v, { signed: true, decimals: "auto" }));
  const rows: { id: string; label: string; a: string; b: string; better: boolean | null }[] = [
    { id: "net", label: t("month.net"), a: usd(fact.net), b: usd(scenario.net), better: scenario.net === fact.net ? null : scenario.net > fact.net },
    { id: "dd", label: t("month.dd"), a: usd(fact.maxDrawdown), b: usd(scenario.maxDrawdown), better: scenario.maxDrawdown === fact.maxDrawdown ? null : scenario.maxDrawdown > fact.maxDrawdown },
    {
      id: "worst", label: t("month.worst"), a: usd(fact.worstDay?.net), b: usd(scenario.worstDay?.net),
      better: fact.worstDay && scenario.worstDay && scenario.worstDay.net !== fact.worstDay.net ? scenario.worstDay.net > fact.worstDay.net : null,
    },
    { id: "red", label: t("month.red"), a: String(fact.redDays), b: String(scenario.redDays), better: scenario.redDays === fact.redDays ? null : scenario.redDays < fact.redDays },
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1 text-left font-medium" />
          <th className="py-1 text-right font-medium">{t("month.fact")}</th>
          <th className="py-1 text-right font-medium">{t("month.scenario")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border/50 tabular-nums">
            <td className="py-1.5">{r.label}</td>
            <td className="py-1.5 text-right text-muted-foreground">{r.a}</td>
            <td className={cn("py-1.5 text-right font-medium", r.better === true && "text-up", r.better === false && "text-down")}>{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
