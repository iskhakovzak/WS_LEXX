/**
 * Daily mini chart: up to 60 daily candles before the play day (from the game context) plus today's candle built from
 * the intraday bars seen so far (forming, outlined), with the previous day's high / low as dashed lines — the same
 * PDH / PDL the intraday chart draws (connectedness). Plain SVG: no chart instance, cheap on phones.
 */
import * as React from "react";
import type { Candle } from "@/components/chart-engine";
import { cn } from "@/lib/utils";

const STEP = 7;
const BODY = 4.5;
const H = 100;
const PAD = 6;

export function DailyMini({
  daily, today, levels, className, label,
}: {
  daily: readonly Candle[];
  today: Candle | null;
  levels?: { pdh: number | null; pdl: number | null } | null;
  className?: string;
  /** Accessible name. */
  label: string;
}) {
  const bars = React.useMemo(() => (today ? [...daily, today] : [...daily]), [daily, today]);
  if (!bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  for (const v of [levels?.pdh, levels?.pdl]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi - lo || 1;
  const y = (p: number) => PAD + ((hi - p) / span) * (H - 2 * PAD);
  const W = Math.max(bars.length * STEP, STEP * 20);
  const x0 = W - bars.length * STEP;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("block h-full w-full", className)}>
      {[levels?.pdh, levels?.pdl].map((v, i) => v != null && (
        <line key={i} x1={0} x2={W} y1={y(v)} y2={y(v)} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" className="stroke-muted-foreground/60" />
      ))}
      {bars.map((b, i) => {
        const cx = x0 + i * STEP + STEP / 2;
        const up = b.c >= b.o;
        const isToday = !!today && i === bars.length - 1;
        const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
        return (
          <g key={i} className={up ? "stroke-up fill-up" : "stroke-down fill-down"}>
            <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <rect
              x={cx - BODY / 2} width={BODY} y={top} height={Math.max(0.8, bot - top)}
              strokeWidth={isToday ? 1.5 : 0} vectorEffect="non-scaling-stroke"
              fillOpacity={isToday ? 0.25 : 1}
              className={isToday ? "stroke-primary" : undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}
