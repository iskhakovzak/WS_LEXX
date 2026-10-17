import { TrendingUp } from "lucide-react";
import { DataTable, Delta, EmptyState, Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TrendResult, TrendSlice } from "./api";
import { fmtDay, fmtNum, fmtPct, fmtR, fmtUsd } from "./format";

const VERDICT = {
  better: { tone: "up", label: "Лучше" },
  worse: { tone: "down", label: "Хуже" },
  flat: { tone: "neutral", label: "Без изменений" },
  nodata: { tone: "neutral", label: "Мало данных" },
} as const;

type Col = { key: keyof TrendSlice; label: string; fmt: (v: number | null) => string; delta?: { scale: number; suffix: string; invert?: boolean; precision?: number } };

const COLS: Col[] = [
  { key: "trades", label: "Сделки", fmt: (v) => (v == null ? "—" : String(v)) },
  { key: "net", label: "Нетто", fmt: (v) => fmtUsd(v), delta: { scale: 1, suffix: "", precision: 0 } },
  { key: "winRate", label: "Win rate", fmt: (v) => fmtPct(v), delta: { scale: 100, suffix: " п.п.", precision: 0 } },
  { key: "profitFactor", label: "PF", fmt: (v) => fmtNum(v), delta: { scale: 1, suffix: "", precision: 2 } },
  { key: "expectancy", label: "Ожидание", fmt: (v) => fmtUsd(v), delta: { scale: 1, suffix: "", precision: 2 } },
  { key: "greenShare", label: "Зел. дни", fmt: (v) => fmtPct(v), delta: { scale: 100, suffix: " п.п.", precision: 0 } },
  { key: "maxDd", label: "Макс. DD", fmt: (v) => (v == null ? "—" : fmtUsd(v, false)), delta: { scale: 1, suffix: "", invert: true, precision: 0 } },
  { key: "feeShare", label: "Комиссии", fmt: (v) => fmtPct(v), delta: { scale: 100, suffix: " п.п.", invert: true, precision: 0 } },
  { key: "totalR", label: "Σ R", fmt: (v) => fmtR(v), delta: { scale: 1, suffix: "R", precision: 2 } },
];

/** Weekly bars of the 8-week window (net $, else R). */
function WeekBars({ weeks }: { weeks: TrendResult["weeks"] }) {
  const vals = weeks.map((w) => w.net ?? w.r ?? 0);
  const max = Math.max(1e-9, ...vals.map(Math.abs));
  const W = 8 * weeks.length + 2 * (weeks.length - 1), H = 28;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Недели: ${weeks.map((w) => `${fmtDay(w.week)} ${w.net != null ? fmtUsd(w.net) : fmtR(w.r)}`).join("; ")}`}>
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="hsl(var(--border))" />
      {weeks.map((w, i) => {
        const v = vals[i];
        const h = (Math.abs(v) / max) * (H / 2 - 1);
        return (
          <rect key={w.week} x={i * 10} width={8} y={v >= 0 ? H / 2 - h : H / 2} height={Math.max(h, w.trades ? 1 : 0)} rx={1}
            fill={i < weeks.length - 4 ? "hsl(var(--muted-foreground) / 0.45)" : v >= 0 ? "hsl(var(--up))" : "hsl(var(--down))"}>
            <title>{`${fmtDay(w.week)}: ${w.net != null ? fmtUsd(w.net) : fmtR(w.r)} · ${w.trades} сд.`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function TrendView({ trend }: { trend: TrendResult[] }) {
  if (!trend.length) return <EmptyState icon={TrendingUp} title="Нет сделок за последние 8 недель" description="Сравнение «последние 4 недели vs предыдущие 4» появится, когда будут закрытые сделки." />;
  const t0 = trend[0];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Последние 4 недели ({fmtDay(t0.cur.from)}–{fmtDay(t0.cur.to)}) против предыдущих 4 ({fmtDay(t0.prev.from)}–{fmtDay(t0.prev.to)}). Серые столбики — прошлый отрезок.
      </p>
      <DataTable stickyFirstCol ariaLabel="Тренд трейдеров">
        <table>
          <thead>
            <tr>
              <th scope="col">Трейдер</th>
              <th scope="col">Вердикт</th>
              <th scope="col">8 недель</th>
              {COLS.map((c) => <th key={c.key} scope="col" className="text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.trader}>
                <td className="font-medium text-foreground">{t.trader}</td>
                <td><Pill tone={VERDICT[t.verdict].tone} dot>{VERDICT[t.verdict].label}</Pill></td>
                <td><WeekBars weeks={t.weeks} /></td>
                {COLS.map((c) => {
                  const cur = t.curM[c.key] as number | null;
                  const prev = t.prevM[c.key] as number | null;
                  const d = c.delta && cur != null && prev != null ? (cur - prev) * c.delta.scale : null;
                  return (
                    <td key={c.key} className="text-right">
                      <div className={cn(cur == null && "text-muted-foreground")}>{c.fmt(cur)}</div>
                      <div className="flex items-center justify-end gap-1 text-2xs text-muted-foreground">
                        <span>было {c.fmt(prev)}</span>
                        {c.delta && d != null && Math.abs(d) > 1e-9 && (
                          <Delta value={d} suffix={c.delta.suffix} precision={c.delta.precision ?? 1} invert={c.delta.invert} bare showIcon={false} />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
      <p className="text-2xs text-muted-foreground">Вердикт: сумма сдвигов по ожиданию, win rate, PF, доле зелёных дней и просадке (≥ 2 в одну сторону).</p>
    </div>
  );
}
