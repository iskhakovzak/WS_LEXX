import { Lock } from "lucide-react";
import { EmptyState, Panel, Pill, StatCard, StatGrid, toneOf } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { BenchmarkResponse } from "./api";
import { EquityLines } from "./charts";
import { SERIES_COLORS, fmtMetric } from "./format";
import { fmtRate, fmtUsd } from "@/lib/format";
import { TrendView } from "./trend";

/** Trader mode: own metrics against the anonymised desk median (no other trader is named or shown). */
export function SelfView({ data }: { data: BenchmarkResponse }) {
  const me = data.rows[0];
  if (!me) {
    return (
      <Panel>
        <EmptyState icon={Lock} title="Нет закрытых сделок за период" description="Ваша строка появится после первых закрытых сделок; сравнение — с анонимной медианой деска." />
      </Panel>
    );
  }
  const strengths = me.badges.filter((b) => b.kind === "strength");
  const weaknesses = me.badges.filter((b) => b.kind === "weakness");
  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        <StatCard label="Нетто" value={me.net != null ? fmtUsd(me.net, { signed: true, decimals: "auto" }) : "—"} tone={toneOf(me.net)} hint={me.gross != null ? `брутто ${fmtUsd(me.gross, { signed: true, decimals: "auto" })}` : undefined} />
        <StatCard label="Win rate" value={fmtRate(me.winRate)} hint={`${me.wins} W / ${me.losses} L`} />
        <StatCard label="Зелёные дни" value={fmtRate(me.greenShare)} hint={`${me.greenDays} из ${me.days}`} />
        <StatCard label="Лучший день / прибыль" value={me.bestDayShare != null ? fmtRate(me.bestDayShare) : "—"}
          tone={me.consistencyFlag === "breach" ? "down" : me.consistencyFlag === "warn" ? "warn" : "neutral"}
          hint={`порог ${Math.round(data.rules.consistencyWarn * 100)}–${Math.round(data.rules.consistencyBreach * 100)}%`} />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Panel title="Я и медиана деска" description={`Медиана — по трейдерам с ≥ ${data.minTrades} сделок; метрика скрыта, если таких меньше ${data.rules.medianMinTraders}`} padded={false} bodyClassName="p-2">
          <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Метрика</th>
                <th className="px-3 py-2 text-right font-medium">Я</th>
                <th className="px-3 py-2 text-right font-medium">Медиана деска</th>
                <th className="px-3 py-2 text-right font-medium">Перцентиль</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => {
                const v = me[m.key] as number | null;
                const med = data.median[m.key];
                const p = me.percentiles?.[m.key] ?? null;
                const better = v == null || med == null || m.neutral || v === med ? null : m.better === "higher" ? v > med : v < med;
                return (
                  <tr key={m.key} className="border-t border-border/50">
                    <td className="px-3 py-1.5 text-muted-foreground" title={m.hint}>{m.label}</td>
                    <td className={cn("px-3 py-1.5 text-right font-medium", better === true && "text-up", better === false && "text-down")}>{fmtMetric(m, v)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{fmtMetric(m, med)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{p == null || data.deskSize < data.rules.medianMinTraders ? "—" : Math.round(p * 100)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Сильные и слабые стороны">
            {me.badges.length === 0 ? <p className="text-sm text-muted-foreground">Пока без выраженных сигналов.</p> : (
              <div className="flex flex-col gap-2">
                {[...strengths, ...weaknesses].map((b) => (
                  <div key={b.kind + b.key} className="flex items-start gap-2">
                    <Pill tone={b.kind === "strength" ? "up" : "down"}>{b.kind === "strength" ? "▲" : "▼"} {b.label}</Pill>
                    <span className="text-xs text-muted-foreground">{b.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Кривая капитала">
            <EquityLines height={200} series={[{ name: me.trader, color: SERIES_COLORS[0], unit: me.equityUnit, points: me.equity }]} />
          </Panel>
        </div>
      </div>
      <Panel title="Мой тренд">
        <TrendView trend={data.trend} />
      </Panel>
    </div>
  );
}
