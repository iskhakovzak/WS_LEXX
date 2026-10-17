import { useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { LineChart as LineIcon } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { EquityChart, buildDayCandles, soleTrader, type EquityTradeInput } from "@/components/equity-chart";
import { fmtCompact, fmtValue, type EquityPoint, type Metric } from "./metrics";

export const CHART_TOOLTIP = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
} as const;
export const CHART_CURSOR = { fill: "hsl(var(--muted-foreground) / 0.08)" };
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (m: string) => `${MONTHS[Number(m.substring(5, 7)) - 1] ?? m} ${m.substring(2, 4)}`;

type View = "equity" | "monthly";

export function EquityPanel({
  equity, monthly, metric, trades, trader,
}: {
  equity: EquityPoint[];
  monthly: { month: string; value: number; count: number }[];
  metric: Metric;
  /** Trades of the period: when given, the curve is drawn on the equity engine (hover — day details, click — «Разбор дня»). */
  trades?: EquityTradeInput[];
  /** Trader for the day-report link (null / "all" — derived from the trades). */
  trader?: string | null;
}) {
  const [view, setView] = useState<View>("equity");
  const reduce = useReducedMotion();
  const unit = metric === "r" ? "R" : "$";
  const last = equity.at(-1)?.equity ?? null;
  const eqUnit = metric === "r" ? "r" : metric === "usd" ? "gross" : "net";
  const days = useMemo(() => (trades ? buildDayCandles(trades, eqUnit) : []), [trades, eqUnit]);

  return (
    <Panel
      title={view === "equity" ? "Кривая результата" : "Результат по месяцам"}
      description={
        view === "equity"
          ? trades
            ? `Накопленный ${unit} по дням, неделям или месяцам · клик по дню — разбор дня`
            : `Накопленный ${unit} по закрытым сделкам и просадка от пика`
          : `Сумма ${unit} за каждый месяц периода`
      }
      actions={
        <Segmented<View>
          size="sm"
          ariaLabel="Вид графика"
          value={view}
          onChange={setView}
          options={[{ value: "equity", label: "Кривая" }, { value: "monthly", label: "По месяцам" }]}
        />
      }
    >
      {view === "equity" && trades ? (
        <EquityChart
          days={days}
          unit={eqUnit}
          trader={trader && trader !== "all" ? trader : soleTrader(trades)}
          storageKey="stats.equity"
          height={400}
        />
      ) : view === "equity" ? (
        equity.length >= 2 ? (
          <>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={`text-lg font-semibold tabular-nums ${last != null && last < 0 ? "text-down" : "text-up"}`}>
                {fmtValue(last, metric)}
              </span>
              <span className="text-xs text-muted-foreground">за {equity.length} сделок с {unit}</span>
            </div>
            <div className="h-[240px]" role="img" aria-label={`Кривая результата: итог ${fmtValue(last, metric)}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equity} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="statsEq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="idx" {...AXIS} minTickGap={48} />
                  <YAxis {...AXIS} width={60} tickFormatter={(v: number) => fmtCompact(v, metric) || "0"} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground) / 0.5)" />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    cursor={{ stroke: "hsl(var(--border))" }}
                    labelFormatter={(_l, payload) => (payload?.[0]?.payload as EquityPoint | undefined)?.label ?? ""}
                    formatter={(v: number, name: string) => [fmtValue(v, metric), name === "equity" ? "Накоплено" : "Просадка"]}
                  />
                  <Area
                    type="monotone" dataKey="drawdown" stroke="hsl(var(--down))" strokeWidth={1}
                    fill="hsl(var(--down) / 0.18)" dot={false} isAnimationActive={!reduce}
                  />
                  <Area
                    type="monotone" dataKey="equity" stroke="hsl(var(--chart-1))" strokeWidth={2}
                    fill="url(#statsEq)" dot={false} isAnimationActive={!reduce}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-chart-1" aria-hidden="true" />Накоплено</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-down/40" aria-hidden="true" />Просадка</span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={LineIcon}
            title="Мало данных для кривой"
            description={`Нужно минимум 2 закрытые сделки с заполненным ${metric === "r" ? "R-multiple" : "P&L"}.`}
          />
        )
      ) : monthly.length > 0 ? (
        <div className="h-[268px]" role="img" aria-label="Результат по месяцам">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" {...AXIS} tickFormatter={monthLabel} />
              <YAxis {...AXIS} width={60} tickFormatter={(v: number) => fmtCompact(v, metric) || "0"} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground) / 0.5)" />
              <Tooltip
                contentStyle={CHART_TOOLTIP}
                cursor={CHART_CURSOR}
                labelFormatter={(l: string) => monthLabel(l)}
                formatter={(v: number, _n, item) => [`${fmtValue(v, metric)} · ${(item?.payload as { count: number }).count} сд.`, "Результат"]}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={!reduce}>
                {monthly.map((m) => <Cell key={m.month} fill={m.value >= 0 ? "hsl(var(--up))" : "hsl(var(--down))"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState icon={LineIcon} title="Нет данных по месяцам" description={metric === "r" ? "Укажите стоп в закрытых сделках — R посчитается сам." : "В закрытых сделках нет P&L — он приходит с синхронизацией брокера."} />
      )}
    </Panel>
  );
}
