/**
 * Plain-SVG charts of the benchmark (no chart lib): multi-series equity lines and a percentile radar.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AXIS_SVG_TEXT, CHART, DRAW_MS, STROKE, TooltipCard, areaGradient } from "@/components/shared/charts";
import { chartsI18n } from "@/i18n/ns/charts";
import { PERIOD_HINT, dayHref, usePeriodNav } from "@/lib/period-links";
import type { DayPoint } from "./api";
import { fmtDate, fmtR, fmtUsd } from "@/lib/format";
import { benchmarkI18n } from "@/i18n/ns/benchmark";
import { personName } from "@/i18n";

/** `name` is the stored trader name (keys, day links); labels show it through personName(). */
export type EquitySeries = { name: string; color: string; unit: "usd" | "r" | null; points: DayPoint[] };

/**
 * Cumulative equity of one or more traders on a shared day axis (union of their trading days). Hover shows values;
 * click a day (or focus + ←/→ + Enter) opens that trader's «Разбор дня» — with several lines, of the nearest one.
 */
export function EquityLines({ series, height = 260, className }: { series: EquitySeries[]; height?: number; className?: string }) {
  // Drawn at the measured width (no viewBox scaling), so 11px text and 2px lines stay 11px / 2px at any size.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const hasDays = new Set(series.flatMap((s) => s.points.map((p) => p.day))).size >= 2;
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
    // The box exists only once there are ≥ 2 days (the early return below renders a placeholder instead).
  }, [hasDays]);
  const H = height, PL = 64, PR = 12, PT = 12, PB = 26;
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const gid = `bm${useId().replace(/:/g, "")}`;
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
  const [, navigate] = useLocation();
  const nav = usePeriodNav({
    kind: "day",
    dates: days,
    trader: series.length === 1 ? series[0].name : null,
    label: benchmarkI18n.t("charts.equityAria", { names: series.map((s) => personName(s.name)).join(", ") }),
    describe: (i) => fmtDate(days[i], "shortYY"),
  });
  if (days.length < 2) {
    return <div className={cn("grid h-40 place-items-center text-sm text-muted-foreground", className)}>{benchmarkI18n.t("charts.tooFewDays")}</div>;
  }
  const x = (i: number) => PL + (i / (days.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  const unit = series[0]?.unit ?? "usd";
  const fmt = (v: number) => (unit === "r" ? fmtR(v) : fmtUsd(v, { signed: true, decimals: "auto" }));
  const ticks = [min, (min + max) / 2, max];
  const xTicks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const pointAt = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * (H - PT - PB) + PT;
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - PL) / (W - PL - PR)) * (days.length - 1))));
    return { i, py };
  };
  const onMove = (e: React.MouseEvent<SVGRectElement>) => setHover(pointAt(e).i);
  const onClick = (e: React.MouseEvent<SVGRectElement>) => {
    const { i, py } = pointAt(e);
    // Several traders: open the line closest to the pointer.
    let best: string | null = null, bestD = Infinity;
    for (const l of lines) {
      const v = l.vals[i];
      if (v == null) continue;
      const d = Math.abs(y(v) - py);
      if (d < bestD) { bestD = d; best = l.name; }
    }
    if (best == null) return;
    navigate(dayHref(days[i], best));
  };
  const shown = hover ?? (nav.active >= 0 ? nav.active : null);
  const single = lines.length === 1 ? lines[0] : null;
  const dayDelta = (i: number) => {
    if (!single) return null;
    const v = single.vals[i];
    if (v == null) return null;
    return v - (i > 0 ? single.vals[i - 1] ?? 0 : 0);
  };
  return (
    <div ref={boxRef} {...nav.wrapperProps} className={cn("relative", nav.wrapperProps.className, className)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block" role="img" aria-label={benchmarkI18n.t("charts.equityAria", { names: series.map((s) => personName(s.name)).join(", ") })}>
        {single && areaGradient(gid, single.color)}
        {ticks.map((t, i) => (
          <g key={i}>
            {/* Faint horizontal guides only; zero gets its own emphasised rule below. */}
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={CHART.grid} strokeOpacity={0.45} strokeWidth={1} />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" {...AXIS_SVG_TEXT}>{fmt(t)}</text>
          </g>
        ))}
        {min < 0 && max > 0 && <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke={CHART.fg} strokeOpacity={0.4} strokeWidth={1} />}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} {...AXIS_SVG_TEXT}>{fmtDate(days[i], "shortYY")}</text>
        ))}
        {lines.map((l) => {
          let d = "";
          let firstX: number | null = null, lastX = 0;
          l.vals.forEach((v, i) => { if (v == null) return; if (firstX == null) firstX = x(i); lastX = x(i); d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
          const base = y(Math.max(min, Math.min(max, 0)));
          return (
            <g key={l.name}>
              {single && firstX != null && <motion.path d={`${d}L${lastX.toFixed(1)},${base.toFixed(1)}L${(firstX as number).toFixed(1)},${base.toFixed(1)}Z`} fill={`url(#${gid})`} initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: DRAW_MS / 1000, ease: "easeOut" }} />}
              <motion.path d={d} fill="none" stroke={l.color} strokeWidth={STROKE} strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: DRAW_MS / 1000, ease: "easeOut" }} />
            </g>
          );
        })}
        {shown != null && (
          <g>
            <line x1={x(shown)} x2={x(shown)} y1={PT} y2={H - PB} stroke={CHART.fg} strokeOpacity={0.35} strokeDasharray="3 3" />
            {lines.map((l) => (l.vals[shown] != null ? <circle key={l.name} cx={x(shown)} cy={y(l.vals[shown] as number)} r={4} fill={l.color} stroke={CHART.surface} strokeWidth={2} /> : null))}
          </g>
        )}
        <rect
          x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} fill="transparent" className="cursor-pointer"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}
        />
      </svg>
      {shown != null && (() => {
        const dd = dayDelta(shown);
        return (
          <TooltipCard
            className="absolute right-2 top-2"
            title={fmtDate(days[shown], "shortYY")}
            tone="pnl"
            rows={lines.map((l) => ({
              key: l.name,
              name: personName(l.name),
              color: l.color,
              raw: l.vals[shown] as number | null,
              value: l.vals[shown] == null ? "—" : fmt(l.vals[shown] as number),
            }))}
            delta={dd != null ? { raw: dd, text: fmt(dd), label: chartsI18n.t("tip.day") } : null}
            footer={<span className="font-medium text-primary">{hover != null ? benchmarkI18n.t("charts.click") : benchmarkI18n.t("charts.enter")} — {PERIOD_HINT.day.toLowerCase()} →</span>}
          />
        );
      })()}
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden="true" />{personName(s.name)}
          </span>
        ))}
      </div>
    </div>
  );
}

export type RadarAxis = { key: string; label: string };
export type RadarSeries = { name: string; color: string; values: Record<string, number | null> };

const RADAR_PAD_X = 64;

/** Radar of desk percentiles (0..1 per axis, 1 = best). Missing values are drawn at the centre and marked «—». */
export function Radar({ axes, series, size = 320, className }: { axes: RadarAxis[]; series: RadarSeries[]; size?: number; className?: string }) {
  const c = size / 2, R = size / 2 - 52;
  const n = axes.length;
  if (n < 3) return <div className="text-sm text-muted-foreground">{benchmarkI18n.t("charts.needAxes")}</div>;
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number) => [c + Math.cos(ang(i)) * R * v, c + Math.sin(ang(i)) * R * v] as const;
  return (
    // Side padding: the axis labels («Лучший день / прибыль») run outward from the circle and must not be clipped.
    <svg viewBox={`${-RADAR_PAD_X} 0 ${size + RADAR_PAD_X * 2} ${size}`} className={cn("h-auto w-full max-w-[440px] overflow-visible", className)} role="img"
      aria-label={benchmarkI18n.t("charts.radarAria", { names: series.map((s) => personName(s.name)).join(" vs ") })}>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <polygon key={g} points={axes.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke={CHART.grid} strokeOpacity={g === 1 ? 0.8 : 0.45} />
      ))}
      {axes.map((a, i) => {
        const [x2, y2] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        return (
          <g key={a.key}>
            <line x1={c} y1={c} x2={x2} y2={y2} stroke={CHART.grid} strokeOpacity={0.45} />
            <text x={lx} y={ly} textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end"} dominantBaseline="middle" fontSize={12} fill={CHART.axis}>{a.label}</text>
          </g>
        );
      })}
      {series.map((s) => (
        <polygon key={s.name} points={axes.map((a, i) => pt(i, s.values[a.key] ?? 0).join(",")).join(" ")}
          fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={STROKE} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      {series.map((s) => axes.map((a, i) => {
        const v = s.values[a.key];
        if (v == null) return null;
        const [px, py] = pt(i, v);
        return <circle key={`${s.name}-${a.key}`} cx={px} cy={py} r={2.6} fill={s.color}><title>{benchmarkI18n.t("charts.percentile", { name: personName(s.name), axis: a.label, value: Math.round(v * 100) })}</title>
</circle>;
      }))}
    </svg>
  );
}
