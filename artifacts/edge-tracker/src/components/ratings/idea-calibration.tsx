import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Pill, Segmented, toneOf, toneText } from "@/components/ds";
import { CHART_CURSOR, CHART_TOOLTIP, OutcomeBar, fmtR, useStoredState } from "./shared";
import { calibVerdict, calibrationOf, qualityCalibration, scoreCalibration, type EnrichedIdea } from "./idea-metrics";

type Mode = "score" | "quality";

export function IdeaCalibration({ ideas }: { ideas: EnrichedIdea[] }) {
  const [mode, setMode] = useStoredState<Mode>("ideaStats.calibMode", "score", ["score", "quality"]);
  const rows = useMemo(() => (mode === "score" ? scoreCalibration(ideas) : qualityCalibration(ideas)), [ideas, mode]);
  const calib = useMemo(() => calibrationOf(ideas), [ideas]);
  const verdict = calibVerdict(calib);
  const chartRows = rows.filter((r) => r.ideas > 0).map((r) => ({
    label: r.label,
    hit: r.hitRate != null ? Math.round(r.hitRate * 100) : null,
    avgR: r.avgR != null ? Number(r.avgR.toFixed(2)) : null,
    closed: r.closed,
  }));
  const hasOutcomes = rows.some((r) => r.closed > 0);

  return (
    <Panel
      icon={Gauge}
      title="Калибровка"
      description={mode === "score" ? "Совпадает ли скор идеи с реальным исходом сделки" : "Совпадает ли качество сетапа (A+…D) с исходом"}
      actions={
        <Segmented
          ariaLabel="Группировка калибровки"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: "score", label: "По скору" }, { value: "quality", label: "По качеству" }]}
        />
      }
      className="h-full"
    >
      <div className="flex flex-col gap-4">
        {mode === "score" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Корреляция скор ↔ R:</span>
            <span className={cn("font-semibold tabular-nums", toneText(calib.r == null ? "neutral" : toneOf(calib.r)))}>
              {calib.r == null ? "—" : `${calib.r >= 0 ? "+" : "−"}${Math.abs(calib.r).toFixed(2)}`}
            </span>
            <Pill tone={verdict.tone}>{verdict.text}</Pill>
            <span className="text-xs text-muted-foreground">n = {calib.n}</span>
          </div>
        )}

        {hasOutcomes ? (
          <div className="h-52 w-full" role="img" aria-label="Hit rate и средний R по группам">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="hit" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  cursor={CHART_CURSOR}
                  formatter={(v, name, p) => {
                    const n = v == null ? null : Number(v);
                    return name === "hit"
                      ? [n == null ? "—" : `${n}% (${(p?.payload as { closed?: number } | undefined)?.closed ?? 0} закрыто)`, "Hit rate"]
                      : [fmtR(n), "Средний R"];
                  }}
                />
                <Bar yAxisId="hit" dataKey="hit" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Line yAxisId="r" dataKey="avgR" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--chart-3))" }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="rounded-xl bg-[var(--glass-bg)] p-4 text-sm text-muted-foreground">
            Пока нет закрытых сделок из идей. Когда идеи будут конвертированы в сделки с результатом, здесь появится сравнение
            hit rate и среднего R по {mode === "score" ? "диапазонам скора" : "качеству сетапа"}.
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[hsl(var(--chart-1))]" aria-hidden="true" /> Hit rate, %</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-[hsl(var(--chart-3))]" aria-hidden="true" /> Средний R</span>
        </div>

        <table className="w-full text-sm">
          <caption className="sr-only">Калибровка по группам</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 text-left font-medium">{mode === "score" ? "Скор" : "Качество"}</th>
              <th scope="col" className="py-2 text-right font-medium">Идей</th>
              <th scope="col" className="hidden py-2 text-right font-medium sm:table-cell">В сделках</th>
              <th scope="col" className="w-1/4 py-2 pl-3 text-left font-medium">Исходы</th>
              <th scope="col" className="py-2 text-right font-medium">Hit</th>
              <th scope="col" className="py-2 text-right font-medium">Ср. R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn("border-b border-border/50 last:border-0", r.ideas === 0 && "opacity-60")}>
                <td className="py-2 font-medium text-foreground">{r.label}</td>
                <td className="py-2 text-right tabular-nums">{r.ideas}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">{r.converted}</td>
                <td className="py-2 pl-3"><OutcomeBar wins={r.wins} losses={r.losses} be={r.be} open={r.open} /></td>
                <td className="py-2 text-right tabular-nums">{r.hitRate == null ? "—" : `${Math.round(r.hitRate * 100)}%`}</td>
                <td className={cn("py-2 text-right tabular-nums", toneText(toneOf(r.avgR)))}>{fmtR(r.avgR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
