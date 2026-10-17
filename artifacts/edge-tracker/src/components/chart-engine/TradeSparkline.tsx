/**
 * <TradeSparkline/> — a tiny canvas price path of a trade with entry/exit dots, for trade lists.
 * Lazy: data is fetched only once the element is near the viewport (IntersectionObserver), results are
 * cached in memory per trade, so scrolling a list back and forth does not refetch.
 * Reads only: GET /api/trades/:id, GET /api/candles/:ticker/range, GET /api/trades/:id/executions.
 */
import * as React from "react";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Candle, Execution, SparkData, TradeLike } from "./types";
import { buildSparkData } from "./lib/sparkline";
import { isoToEpoch } from "./lib/time";
import { isOpening, sideOf, toNum } from "./lib/position";
import { readChartTheme } from "./theme";
import { tradeWindow } from "./hooks/useChartData";

export type TradeSparklineProps = {
  /** Fetch everything by trade id (GET /api/trades/:id). */
  tradeId?: number;
  /** Or pass the trade (saves one request). */
  trade?: TradeLike;
  /** Or pass ready data (no requests at all). */
  data?: SparkData | null;
  width?: number;
  height?: number;
  /** Colour by P&L sign (default) or always neutral. */
  tone?: "pnl" | "neutral";
  className?: string;
  title?: string;
};

const cache = new Map<string, Promise<SparkData | null>>();
const MAX_CACHE = 400;

/** Drop the in-memory cache (e.g. after a trade is edited). */
export function invalidateSparkline(tradeId?: number): void {
  if (tradeId == null) cache.clear();
  else cache.delete(`id:${tradeId}`);
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

async function loadForTrade(trade: TradeLike): Promise<SparkData | null> {
  const { fromKey, toKey, dateKey } = tradeWindow(trade, 0);
  const [range, ex] = await Promise.all([
    getJson<{ candles: Candle[] }>(`${BASE}/api/candles/${encodeURIComponent(trade.ticker)}/range?from=${fromKey}&to=${toKey}&interval=5m&extended=1`),
    trade.id > 0 ? getJson<{ executions: Execution[] }>(`${BASE}/api/trades/${trade.id}/executions`) : Promise.resolve(null),
  ]);
  const bars = (range?.candles ?? []).filter((c) => Number.isFinite(c.c));
  if (!bars.length) return null;
  const execs = ex?.executions ?? [];
  const opening = execs.filter((e) => isOpening(e.kind) && e.executedAt);
  const closing = execs.filter((e) => !isOpening(e.kind) && e.executedAt);
  // Executions win; otherwise the caller's known fill times (e.g. a playbook example of another trader's trade).
  const entryTime = opening.length ? isoToEpoch(opening[0].executedAt) : trade.entryTime ? isoToEpoch(trade.entryTime) : null;
  const exitTime = closing.length ? isoToEpoch(closing[closing.length - 1].executedAt) : trade.exitTime ? isoToEpoch(trade.exitTime) : null;
  const side = sideOf(trade);
  void dateKey;
  return buildSparkData({
    bars, side,
    entryTime: Number.isFinite(entryTime as number) ? entryTime : null,
    exitTime: Number.isFinite(exitTime as number) ? exitTime : null,
    entryPrice: toNum(trade.entry) ?? (opening.length ? toNum(opening[0].price) : null),
    exitPrice: toNum(trade.exit) ?? (closing.length ? toNum(closing[closing.length - 1].price) : null),
    points: 120, padBars: 24,
  });
}

function loadCached(key: string, loader: () => Promise<SparkData | null>): Promise<SparkData | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= MAX_CACHE) { const first = cache.keys().next().value; if (first !== undefined) cache.delete(first); }
  const p = loader().catch(() => null);
  cache.set(key, p);
  return p;
}

function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T | null>(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

export function TradeSparkline({ tradeId, trade, data: dataProp, width = 120, height = 36, tone = "pnl", className, title }: TradeSparklineProps) {
  const [ref, near] = useNearViewport<HTMLCanvasElement>();
  const [data, setData] = React.useState<SparkData | null | undefined>(dataProp);
  const key = dataProp !== undefined ? null : trade ? `id:${trade.id}` : tradeId != null ? `id:${tradeId}` : null;

  React.useEffect(() => {
    if (dataProp !== undefined) { setData(dataProp); return; }
    if (!near || !key) return;
    let alive = true;
    const loader = trade
      ? () => loadForTrade(trade)
      : async () => { const t = await getJson<TradeLike>(`${BASE}/api/trades/${tradeId}`); return t ? loadForTrade(t) : null; };
    loadCached(key, loader).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [near, key, dataProp, trade, tradeId]);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!data || data.closes.length < 2) return;
    const th = readChartTheme();
    const pnlSign = data.entryPrice != null && data.exitPrice != null ? (data.side === "short" ? data.entryPrice - data.exitPrice : data.exitPrice - data.entryPrice) : null;
    const color = tone === "neutral" || pnlSign == null ? th.muted : pnlSign >= 0 ? th.up : th.down;
    const pad = 3;
    const span = data.max - data.min || 1;
    const n = data.closes.length;
    const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
    const y = (p: number) => pad + (1 - (p - data.min) / span) * (height - pad * 2);
    // Faint context, bold in-trade segment.
    const a = data.entryIdx ?? 0, b = data.exitIdx ?? n - 1;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const stroke = (from: number, to: number, c: string, w: number) => {
      if (to <= from) return;
      ctx.beginPath();
      ctx.moveTo(x(from), y(data.closes[from]));
      for (let i = from + 1; i <= to; i++) ctx.lineTo(x(i), y(data.closes[i]));
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke();
    };
    stroke(0, a, th.muted(0.45), 1);
    stroke(b, n - 1, th.muted(0.45), 1);
    if (b > a) {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, color(0.28)); g.addColorStop(1, color(0.02));
      ctx.beginPath();
      ctx.moveTo(x(a), height - pad);
      for (let i = a; i <= b; i++) ctx.lineTo(x(i), y(data.closes[i]));
      ctx.lineTo(x(b), height - pad); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
    }
    stroke(a, b, color(1), 1.5);
    const dot = (i: number | null, price: number | null, fill: string) => {
      if (i == null) return;
      const py = price != null && Number.isFinite(price) ? y(price) : y(data.closes[i]);
      ctx.beginPath(); ctx.arc(x(i), py, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = th.bg(1); ctx.lineWidth = 1; ctx.stroke();
    };
    dot(data.entryIdx, data.entryPrice, th.primary(1));
    dot(data.exitIdx, data.exitPrice, color(1));
  }, [data, width, height, tone, ref]);

  const label = title ?? (data ? `Спарклайн: ${data.closes.length} точек${data.entryPrice != null ? `, вход ${data.entryPrice}` : ""}${data.exitPrice != null ? `, выход ${data.exitPrice}` : ""}` : "Спарклайн сделки");
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      title={title}
      className={cn("block shrink-0", data === null && "opacity-30", className)}
      style={{ width, height }}
    />
  );
}
