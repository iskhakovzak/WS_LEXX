/**
 * Plain-SVG charts of the benchmark (no chart lib): multi-series equity lines and a percentile radar.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { DayPoint } from "./api";
import { fmtDay, fmtR, fmtUsd } from "./format";

export type EquitySeries = { name: string; color: string; unit: "usd" | "r" | null; points: DayPoint[] };

/**
 * Cumulative equity of one or more traders on a shared day axis (union of their trading days). Hover shows values.
 */
export function EquityLines({ series, height = 260, className }: { series: EquitySeries[]; height?: number; className?: string }) {
  const W = 760, H = height, PL = 64, PR = 12, PT = 12, PB = 26;
  const [hover, setHover] = useState<number | null>(null);
  const model = useMemo(() => {
    const days = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))].sort();
    const idx = new Map(days.map((d, i) => [d, i]));
    const lines = series.map((s) => {
      // carry the last cum forward on days the trader did not trade
      const byDay = new Map(s.points.map((p) => [p.day, p.cum]));
      let last: number | null = null;
      const vals = days.map((d) => {
        if (byDay.has(d)) last = byDay.get(d)!;
        return last;
      });
      return { ...s, vals };
    });
    const all = lines.flatMap((l) => l.vals.filter((v): v is number => v != null));
    let min = Math.min(0, ...all), max = Math.max(0, ...all);
    if (min === max) { min -= 1; max += 1; }
    return { days, idx, lines, min, max };
  }, [series]);
  const { days, lines, min, max } = model;
  if (days.length < 2) {
    return <div className={cn("grid h-40 place-items-center text-sm text-muted-foreground", className)}>Недостаточно дней для кривой</div>;
  }
  const x = (i: number) => PL + (i / (days.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  const unit = series[0]?.unit ?? "usd";
  const fmt = (v: number) => (unit === "r" ? fmtR(v) : fmtUsd(v));
  const ticks = [min, (min + max) / 2, max];
  const xTicks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PL) / (W - PL - PR)) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };
  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Кривая капитала: ${series.map((s) => s.name).join(", ")}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeDasharray={t === 0 ? undefined : "2 4"} strokeWidth={1} />
            <text x={PL - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{fmt(t)}</text>
          </g>
        ))}
        {min < 0 && max > 0 && <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} strokeWidth={1} />}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px] tabular-nums">{fmtDay(days[i])}</text>
        ))}
        {lines.map((l) => {
          let d = "";
          l.vals.forEach((v, i) => { if (v == null) return; d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
          return <path key={l.name} d={d} fill="none" stroke={l.color} strokeWidth={1.8} strokeLinejoin="round" />;
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
            {lines.map((l) => (l.vals[hover] != null ? <circle key={l.name} cx={x(hover)} cy={y(l.vals[hover] as number)} r={3} fill={l.color} /> : null))}
          </g>
        )}
        <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="glass-panel pointer-events-none absolute right-2 top-2 rounded-lg px-2.5 py-1.5 text-xs tabular-nums">
          <div className="font-medium text-foreground">{fmtDay(days[hover])}</div>
          {lines.map((l) => (
            <div key={l.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} aria-hidden="true" />
              <span className="text-muted-foreground">{l.name}</span>
              <span className="ml-auto pl-2 text-foreground">{l.vals[hover] == null ? "—" : fmt(l.vals[hover] as number)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden="true" />{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export type RadarAxis = { key: string; label: string };
export type RadarSeries = { name: string; color: string; values: Record<string, number | null> };

/** Radar of desk percentiles (0..1 per axis, 1 = best). Missing values are drawn at the centre and marked «—». */
export function Radar({ axes, series, size = 320, className }: { axes: RadarAxis[]; series: RadarSeries[]; size?: number; className?: string }) {
  const c = size / 2, R = size / 2 - 52;
  const n = axes.length;
  if (n < 3) return <div className="text-sm text-muted-foreground">Нужно ≥ 3 метрик</div>;
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number) => [c + Math.cos(ang(i)) * R * v, c + Math.sin(ang(i)) * R * v] as const;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={cn("h-auto w-full max-w-[360px]", className)} role="img"
      aria-label={`Радар перцентилей: ${series.map((s) => s.name).join(" vs ")}`}>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <polygon key={g} points={axes.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="hsl(var(--border))" strokeDasharray={g === 0.5 ? undefined : "2 3"} />
      ))}
      {axes.map((a, i) => {
        const [x2, y2] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        return (
          <g key={a.key}>
            <line x1={c} y1={c} x2={x2} y2={y2} stroke="hsl(var(--border))" />
            <text x={lx} y={ly} textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end"} dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{a.label}</text>
          </g>
        );
      })}
      {series.map((s) => (
        <polygon key={s.name} points={axes.map((a, i) => pt(i, s.values[a.key] ?? 0).join(",")).join(" ")}
          fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" />
      ))}
      {series.map((s) => axes.map((a, i) => {
        const v = s.values[a.key];
        if (v == null) return null;
        const [px, py] = pt(i, v);
        return <circle key={`${s.name}-${a.key}`} cx={px} cy={py} r={2.6} fill={s.color}><title>{`${s.name} · ${a.label}: перцентиль ${Math.round(v * 100)}`}</title></circle>;
      }))}
    </svg>
  );
}
