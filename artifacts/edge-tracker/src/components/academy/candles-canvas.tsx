/**
 * A static candle chart of ready bars (the academy quiz's anonymised day): candles, the session VWAP and an optional
 * entry marker, in the chart engine's theme (readChartTheme, sessionVwap). No requests, no ticker, no date — the time
 * ticks are New York wall clock only. Redraws on resize and theme switches.
 */
import * as React from "react";
import { etParts, readChartTheme, sessionVwap, type Candle } from "@/components/chart-engine";

function useThemeTick(): number {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setN((v) => v + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return n;
}

const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

function draw(canvas: HTMLCanvasElement, bars: readonly Candle[], entryAt: number | null, side: "long" | "short" | null, width: number, height: number) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || bars.length < 2) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const th = readChartTheme();
  const padT = 10, padB = 20, padX = 6;
  const slot = (width - padX * 2) / bars.length;
  const x = (i: number) => padX + slot * (i + 0.5);
  const vw = new Map(sessionVwap([...bars]).map((p) => [p.t, p.vwap]));
  const vwap = bars.map((b) => vw.get(b.t) ?? null);
  const lo = Math.min(...bars.map((b) => b.l), ...vwap.filter((v): v is number => v != null));
  const hi = Math.max(...bars.map((b) => b.h), ...vwap.filter((v): v is number => v != null));
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo || 1)) * (height - padT - padB);
  const body = Math.max(1, Math.min(10, slot * 0.64));
  bars.forEach((c, i) => {
    const color = c.c >= c.o ? th.up : th.down;
    const cx = Math.round(x(i)) + 0.5;
    ctx.strokeStyle = color(0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y(c.h));
    ctx.lineTo(cx, y(c.l));
    ctx.stroke();
    const top = y(Math.max(c.o, c.c));
    ctx.fillStyle = color(0.85);
    ctx.fillRect(x(i) - body / 2, top, body, Math.max(1, y(Math.min(c.o, c.c)) - top));
  });
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = th.c5(0.95);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  vwap.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    if (pen) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
    pen = true;
  });
  ctx.stroke();
  ctx.restore();
  if (entryAt != null) {
    let idx = -1;
    bars.forEach((b, i) => { if (b.t <= entryAt) idx = i; });
    if (idx >= 0) {
      const b = bars[idx];
      const dir = side === "short" ? -1 : 1;
      const ey = y(side === "short" ? b.h : b.l) + dir * 4;
      ctx.beginPath();
      ctx.moveTo(x(idx), ey);
      ctx.lineTo(x(idx) - 6, ey + dir * 10);
      ctx.lineTo(x(idx) + 6, ey + dir * 10);
      ctx.closePath();
      ctx.fillStyle = th.primary(1);
      ctx.fill();
    }
  }
  ctx.fillStyle = th.muted(1);
  ctx.font = `12px ${th.font}`;
  ctx.textAlign = "center";
  bars.forEach((b, i) => {
    const m = etParts(b.t).mod;
    if (m % 60 === 0 && i > 0 && i < bars.length - 1) ctx.fillText(clock(m), x(i) - slot / 2, height - 5);
  });
}

export function CandlesCanvas({ bars, entryAt = null, side = null, label, className }: {
  bars: readonly Candle[]; entryAt?: number | null; side?: "long" | "short" | null; label: string; className?: string;
}) {
  const wrap = React.useRef<HTMLDivElement | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const themeTick = useThemeTick();
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(160, Math.floor(el.clientWidth)), h: Math.max(160, Math.floor(el.clientHeight)) });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    if (canvas.current && size) draw(canvas.current, bars, entryAt, side, size.w, size.h);
  }, [bars, entryAt, side, size, themeTick]);
  return (
    <div ref={wrap} className={className ?? "relative h-[240px] w-full sm:h-[280px]"}>
      <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}
