/**
 * The trader's trading day: intraday equity curve (cumulative net by close time) against the daily
 * loss limit, the day's trades, and optional behaviour flags (revenge / tilt / overtrading) from /api/behavior.
 */
import * as React from "react";
import { Link } from "wouter";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { Skeleton } from "@/components/ui/skeleton";
import type { BehaviorFlags, TraderDay } from "./use-risk";
import { useBehaviorDay, useTraderDay } from "./use-risk";
import { intradayCurve } from "./risk-math";
import { AXIS, CHART_TOOLTIP_STYLE } from "./primitives";
import { fmtDate, fmtUsd } from "@/lib/format";

const ddmm = (d: string) => fmtDate(d.slice(0, 10), "dayMonthNumeric");
const clock = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export function dayLabel(day: TraderDay | undefined): string {
  if (!day?.date) return "сегодня";
  return day.isToday ? "сегодня" : `последний торговый день, ${ddmm(day.date)}`;
}

/** Cumulative net through the day vs −daily limit (and the 70% warn line). */
export function IntradayChart({ day, dailyLimit, height = 180 }: { day: TraderDay; dailyLimit: number | null | undefined; height?: number }) {
  const curve = React.useMemo(() => intradayCurve(day.trades), [day.trades]);
  if (curve.points.length < 2) return null;
  const limit = dailyLimit != null && dailyLimit > 0 ? dailyLimit : null;
  const lo = Math.min(curve.low, limit != null ? -limit * 1.08 : curve.low);
  const hi = Math.max(curve.high, 0);
  const pad = Math.max(10, (hi - lo) * 0.08);
  const color = curve.final >= 0 ? "hsl(var(--up))" : "hsl(var(--down))";
  const xs = curve.points.map((p) => p.min);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 30);
  return (
    <div style={{ height }} role="img" aria-label={`Кривая P&L за день: итог ${fmtUsd(curve.final, { signed: true, decimals: 0 })}${limit != null ? `, дневной лимит ${fmtUsd(limit, { decimals: 0 })}` : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={curve.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="min" type="number" domain={[x0, x1]} tickFormatter={clock} {...AXIS} minTickGap={28} />
          <YAxis {...AXIS} width={56} domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => fmtUsd(v, { decimals: 0, compact: 10_000 })} />
          {limit != null && <ReferenceArea y1={lo - pad} y2={-limit} fill="hsl(var(--down))" fillOpacity={0.08} ifOverflow="hidden" />}
          {limit != null && (
            <ReferenceLine y={-limit} stroke="hsl(var(--down))" strokeDasharray="4 3" label={{ value: `стоп −${fmtUsd(limit, { decimals: 0 })}`, position: "insideBottomLeft", fill: "hsl(var(--down))", fontSize: 11 }} />
          )}
          {limit != null && <ReferenceLine y={-limit * 0.7} stroke="hsl(var(--warn))" strokeDasharray="2 4" strokeOpacity={0.7} />}
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelFormatter={(l) => (curve.timed ? `${clock(Number(l))} ET` : "")}
            formatter={(v: number, _n, item) => {
              const p = item?.payload as { ticker: string | null; net: number | null } | undefined;
              return [`${fmtUsd(v, { signed: true, decimals: 0 })}${p?.ticker ? ` · ${p.ticker} ${fmtUsd(p.net, { signed: true, decimals: 0 })}` : ""}`, "За день"];
            }}
          />
          <Line type="stepAfter" dataKey="cum" stroke={color} strokeWidth={2} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The day's closed trades with a running total. */
export function DayTradesList({ day, max }: { day: TraderDay; max?: number }) {
  let cum = 0;
  const rows = day.trades.map((t) => {
    cum += t.net ?? 0;
    return { t, cum: Math.round(cum * 100) / 100 };
  });
  const shown = max != null ? rows.slice(-max) : rows;
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--field-border)]">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-[var(--glass-bg)] text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Время</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Тикер</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Кол-во</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Нетто</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">За день</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ t, cum: c }) => (
            <tr key={t.id} className="border-t border-border/50">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">{t.openLabel && t.closeLabel ? `${t.openLabel}–${t.closeLabel}` : t.closeLabel ?? "—"}</td>
              <td className="px-3 py-1.5">
                <Link href={links.trade(t.id)} className="font-medium hover:text-primary">{t.ticker}</Link>
                <span className="ml-1.5 text-xs text-muted-foreground">{(t.side ?? "").toLowerCase().startsWith("s") ? "шорт" : "лонг"}</span>
              </td>
              <td className="px-3 py-1.5 text-right">{t.qty ?? "—"}</td>
              <td className={cn("px-3 py-1.5 text-right font-medium", (t.net ?? 0) > 0 ? "text-up" : (t.net ?? 0) < 0 ? "text-down" : "")} title={t.fees ? `брутто ${fmtUsd(t.gross, { signed: true, decimals: 0 })} − комиссии ${fmtUsd(t.fees, { decimals: 0 })}` : undefined}>
                {t.net != null ? fmtUsd(t.net, { signed: true, decimals: 0 }) : "—"}
              </td>
              <td className={cn("px-3 py-1.5 text-right text-xs", c > 0 ? "text-up" : c < 0 ? "text-down" : "text-muted-foreground")}>{fmtUsd(c, { signed: true, decimals: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {max != null && rows.length > max && (
        <p className="border-t border-border/50 px-3 py-1.5 text-xs text-muted-foreground">показаны последние {max} из {rows.length}</p>
      )}
    </div>
  );
}

/** Behaviour warnings for the day — renders nothing when there is nothing to say. */
export function BehaviorNote({ flags, className }: { flags: BehaviorFlags | null | undefined; className?: string }) {
  if (!flags) return null;
  const items: string[] = [];
  if (flags.revenge > 0) items.push(`${flags.revenge} ${flags.revenge === 1 ? "сделка" : flags.revenge < 5 ? "сделки" : "сделок"} вскоре после убытка (реванш)${flags.revengeCost != null && flags.revengeCost < 0 ? `, итог ${fmtUsd(flags.revengeCost, { signed: true, decimals: 0 })}` : ""}`);
  if (flags.tilt > 0) items.push(`тильт-кластер: ${flags.tilt} сд. подряд в минус`);
  if (flags.martingale > 0) items.push(`рост размера после убытка: ${flags.martingale} сд.`);
  if (flags.overtrading && flags.norm != null) items.push(`${flags.trades} сделок при обычных ≤ ${Math.round(flags.norm)} — овертрейдинг`);
  if (!items.length) return null;
  return (
    <div role="status" className={cn("flex items-start gap-2.5 rounded-xl bg-warn/10 px-3 py-2.5 text-sm ring-1 ring-inset ring-warn/30", className)}>
      <Flame className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-warn">{flags.revenge > 0 ? "Реванш-трейдинг — сделайте паузу" : "Признаки тильта — снизьте темп"}</p>
        <ul className="mt-0.5 text-xs text-muted-foreground">
          {items.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </div>
    </div>
  );
}

export function DaySkeleton({ height = 180 }: { height?: number }) {
  return <Skeleton className="w-full rounded-xl" style={{ height }} />;
}

/**
 * The trading day block: header line (which day, net, trades, fees), behaviour note, intraday curve vs the
 * daily stop and, optionally, the trades. Renders a one-line note when there were no trades in the last 10 days.
 */
export function TraderDayBlock({ trader, dailyLimit, showTrades = false, height = 180 }: { trader: string; dailyLimit: number | null | undefined; showTrades?: boolean; height?: number }) {
  const q = useTraderDay(trader);
  const day = q.data;
  const beh = useBehaviorDay(trader, day?.date ?? null);
  if (q.isLoading) return <DaySkeleton height={height} />;
  if (q.isError) return <p className="text-xs text-muted-foreground">Сделки дня недоступны.</p>;
  if (!day?.date || day.trades.length === 0) return <p className="text-sm text-muted-foreground">За последние 10 дней закрытых сделок нет.</p>;
  const net = day.net;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{day.isToday ? "Сегодня" : `Последний торговый день · ${ddmm(day.date)}`}</span>
        <span>нетто <span className={cn("font-semibold", (net ?? 0) > 0 ? "text-up" : (net ?? 0) < 0 ? "text-down" : "text-foreground")}>{fmtUsd(net, { signed: true, decimals: 0 })}</span></span>
        <span>{day.trades.length} сд.</span>
        {day.fees > 0 && <span>комиссии {fmtUsd(day.fees, { decimals: 0 })}</span>}
        <Link href={links.journalDay(day.date, trader)} className="ml-auto text-primary hover:underline">журнал дня →</Link>
      </p>
      <BehaviorNote flags={beh.data} />
      <IntradayChart day={day} dailyLimit={dailyLimit} height={height} />
      {showTrades && <DayTradesList day={day} />}
    </div>
  );
}
