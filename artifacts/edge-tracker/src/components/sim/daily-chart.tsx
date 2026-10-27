/**
 * The long daily chart of a trainer day (owner 2026-10-25: «дейли должен быть длинный показан»): up to 250 daily
 * candles before the play day plus today's forming candle, the previous close, the 52-week high / low and the gap
 * marker (previous close → today's price, with the %). The x axis counts trading days back («−50 д.», «сегодня») —
 * real dates only after the reveal (the server sends fake dates until then; spoiler rule). Plain SVG sized to its box
 * (ResizeObserver), volume at the bottom, cheap on phones.
 */
import * as React from "react";
import type { Candle } from "@/components/chart-engine";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";

const AXIS_BACK = [250, 200, 150, 100, 50, 20] as const;
const RIGHT = 88;
const LABEL_GAP = 24;
const BOTTOM = 18;
const TOP = 8;

/** Pure: x-axis ticks — bar index and how many trading days before the play day (0 = today), only those that exist. */
export function dailyAxisTicks(n: number, hasToday: boolean): { idx: number; back: number }[] {
  const lastPast = hasToday ? n - 2 : n - 1;
  const out: { idx: number; back: number }[] = [];
  for (const back of AXIS_BACK) {
    const idx = lastPast + 1 - back;
    if (idx >= 0) out.push({ idx, back });
  }
  if (hasToday) out.push({ idx: n - 1, back: 0 });
  return out;
}

/** Pure: label positions (top → bottom order kept) at least `gap` px apart, inside [lo, hi]. */
export function spreadLabels(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(ys.length);
  let prev = -Infinity;
  for (const o of order) { const y = Math.max(o.y, prev + gap, lo); out[o.i] = y; prev = y; }
  // Pushed past the bottom: shift the stack up.
  const over = prev - hi;
  if (over > 0) for (const o of order) out[o.i] = Math.max(lo, out[o.i] - over);
  return out;
}

function useBoxSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [s, setS] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setS({ w: el.clientWidth, h: el.clientHeight });
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

export function DailyChart({
  daily, today, levels, gapPct, revealed, className,
}: {
  daily: readonly Candle[];
  today: Candle | null;
  levels: { pdc: number | null; hi52?: number | null; lo52?: number | null };
  gapPct: number | null;
  revealed: boolean;
  className?: string;
}) {
  const { t } = simI18n.useT();
  const box = React.useRef<HTMLDivElement>(null);
  const { w, h } = useBoxSize(box);
  const bars = React.useMemo(() => (today ? [...daily, today] : [...daily]), [daily, today]);
  const pdc = levels.pdc ?? daily[daily.length - 1]?.c ?? null;
  const gapPx = pdc != null && gapPct != null ? pdc * (1 + gapPct / 100) : null;

  const body = (() => {
    if (!bars.length || w < 40 || h < 60) return null;
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); vmax = Math.max(vmax, b.v || 0); }
    for (const v of [pdc, levels.hi52, levels.lo52, gapPx]) if (v != null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const span = hi - lo || hi * 0.01 || 1;
    const plotW = Math.max(10, w - RIGHT);
    const volH = Math.min(40, (h - TOP - BOTTOM) * 0.16);
    const plotH = h - TOP - BOTTOM - volH - 4;
    const y = (p: number) => TOP + ((hi - p) / span) * plotH;
    const step = plotW / Math.max(bars.length, 20);
    const x0 = plotW - bars.length * step;
    const cx = (i: number) => x0 + i * step + step / 2;
    const bw = Math.max(1, Math.min(8, step * 0.65));
    // Narrow screens: drop ticks closer than 40 px to the previous one (today always stays).
    const ticks = dailyAxisTicks(bars.length, !!today).filter((k, i, all) => k.back === 0 || i === 0 || cx(k.idx) - cx(all[i - 1].idx) >= 40);
    type Lv = { key: "hi52" | "lo52" | "pdc"; v: number; cls: string };
    const lv: Lv[] = [];
    for (const [key, v, cls] of [["hi52", levels.hi52, "stroke-up"], ["lo52", levels.lo52, "stroke-down"], ["pdc", pdc, "stroke-muted-foreground"]] as const) {
      if (v != null && Number.isFinite(v)) lv.push({ key, v, cls });
    }
    const labelY = spreadLabels(lv.map((x) => y(x.v) - 2), LABEL_GAP, TOP + 8, TOP + plotH);
    const levelsSvg = lv.map(({ key, v, cls }, i) => (
      <g key={key} data-testid={`sim-daily-${key}`}>
        <line x1={0} x2={plotW} y1={y(v)} y2={y(v)} strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.7} className={cls} />
        <text x={plotW + 4} y={labelY[i]} className="fill-muted-foreground text-[10px]">{t(`dailyChart.${key}`)}</text>
        <text x={plotW + 4} y={labelY[i] + 11} className="fill-foreground text-[10px] tabular-nums">{fmtPrice(v)}</text>
      </g>
    ));
    const todayX = today ? cx(bars.length - 1) : plotW - step / 2;
    return (
      <svg width={w} height={h} role="img" aria-label={t("dailyChart.label")} className="block">
        {levelsSvg}
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const isToday = !!today && i === bars.length - 1;
          const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
          const vh = vmax > 0 ? ((b.v || 0) / vmax) * volH : 0;
          return (
            <g key={i} className={up ? "stroke-up fill-up" : "stroke-down fill-down"}>
              <line x1={cx(i)} x2={cx(i)} y1={y(b.h)} y2={y(b.l)} strokeWidth={1} />
              <rect x={cx(i) - bw / 2} width={bw} y={top} height={Math.max(0.8, bot - top)} fillOpacity={isToday ? 0.25 : 1} strokeWidth={isToday ? 1.5 : 0} className={isToday ? "stroke-primary" : undefined} />
              {vh > 0 && <rect x={cx(i) - bw / 2} width={bw} y={h - BOTTOM - vh} height={vh} fillOpacity={0.35} strokeWidth={0} />}
            </g>
          );
        })}
        {pdc != null && gapPx != null && (
          <g data-testid="sim-daily-gap">
            <line x1={todayX + bw} x2={todayX + bw} y1={y(pdc)} y2={y(gapPx)} strokeWidth={2} className={gapPx >= pdc ? "stroke-up" : "stroke-down"} />
            <text x={Math.max(0, todayX - 6)} y={y(gapPx) + (gapPx >= pdc ? -6 : 14)} textAnchor="end" className={cn("text-2xs font-semibold tabular-nums", gapPx >= pdc ? "fill-up" : "fill-down")}>
              {t("dailyChart.gap", { value: fmtPct(gapPct, { decimals: 1 }) })}
            </text>
          </g>
        )}
        {ticks.map((k) => (
          <text key={k.back} x={Math.min(Math.max(cx(k.idx), 16), plotW - 4)} y={h - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
            {k.back === 0 ? t("dailyChart.today") : revealed ? fmtDate(new Date(bars[k.idx].t * 1000).toISOString().slice(0, 10), "dayMonth") : t("dailyChart.ago", { count: k.back })}
          </text>
        ))}
      </svg>
    );
  })();

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-testid="sim-daily-chart">
      <p className="px-1 pb-1 text-2xs font-medium text-muted-foreground">{t("dailyChart.title", { count: daily.length })}</p>
      <div ref={box} className="relative min-h-0 flex-1">
        {daily.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("dailyChart.empty")}</p> : body}
      </div>
    </div>
  );
}
