import * as React from "react";
import { cn } from "@/lib/utils";
import { Pill, toneOf, toneText, type Tone } from "@/components/ds";
import { fmtSigned } from "./lib";

/** Tiny inline SVG sparkline; colour follows the first→last direction. */
export function Sparkline({
  values,
  className,
  height = 28,
  ariaLabel,
  baseline,
}: {
  values: number[] | undefined;
  className?: string;
  height?: number;
  ariaLabel?: string;
  /** Optional dashed reference line (e.g. previous close). */
  baseline?: number | null;
}) {
  const id = React.useId();
  const pts = (values ?? []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) {
    return <div className={cn("w-full", className)} style={{ height }} aria-hidden="true" />;
  }
  const W = 100;
  const H = height;
  const all = baseline != null && Number.isFinite(baseline) ? [...pts, baseline] : pts;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${d} L${W},${H} L0,${H} Z`;
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", up ? "text-up" : "text-down", className)}
      style={{ height }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} stroke="none" />
      {baseline != null && Number.isFinite(baseline) && (
        <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="hsl(var(--border))" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Signed % change pill (colour + sign, never colour alone). */
export function ChangePill({ value, digits = 2, className, suffix = "%" }: { value: number | null | undefined; digits?: number; className?: string; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) return <Pill className={className}>—</Pill>;
  return <Pill tone={toneOf(value)} className={className}>{fmtSigned(value, digits, suffix)}</Pill>;
}

/** Label + signed value, compact, for inline metrics (RS, gap…). */
export function Metric({
  label,
  value,
  tone,
  title,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1 text-xs tabular-nums", className)} title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", tone ? toneText(tone) : "text-foreground")}>{value}</span>
    </span>
  );
}

/** Horizontal meter: position of `value` inside [low, high] (e.g. price within day/52w range). */
export function RangeMeter({ low, high, value, className, label }: { low: number | null | undefined; high: number | null | undefined; value: number | null | undefined; className?: string; label: string }) {
  if (low == null || high == null || value == null || !(high > low)) return null;
  const pct = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div className={cn("relative h-1.5 w-full rounded-full bg-[var(--glass-bg)]", className)} role="meter" aria-label={label} aria-valuemin={low} aria-valuemax={high} aria-valuenow={value}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary/40" style={{ width: `${pct}%` }} />
      <div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-primary" style={{ left: `calc(${pct}% - 2px)` }} />
    </div>
  );
}
