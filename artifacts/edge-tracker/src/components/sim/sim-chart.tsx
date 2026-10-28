/**
 * Simulator chart — lightweight-charts with the WS Chart engine's theme, primitives (session shading, levels, VWAP)
 * and helpers. Built once per game; every new bar is pushed with `series.update()` from a BarFeed, so advancing never
 * re-renders React or rebuilds the chart. The overlay (fills, position, stop / target, reveal) is pushed into a
 * primitive. Fake time before the reveal: intraday axis shows the New York clock and «Yesterday / Today», swing shows
 * day numbers; after the reveal the axis switches to the real times.
 * Interaction (trainer): `onDragLine` lets the player drag the stop / target (and the planned stop / target while
 * flat) with a mouse or a finger — panning is paused while a line is held; `onPick` reports a click / tap (pointer
 * events, so a finger works like a mouse) as (bar index, price) («Найди вход»). Both use the lightweight-charts public
 * API only (coordinate ↔ logical index / price).
 * Timeframes: the feed holds base bars; with `dispMin` above `baseMin` the chart shows them aggregated (tf-model.ts) —
 * the last display bar forms from the base bars revealed so far. Overlay indices are base indices and are mapped to the
 * display bar that contains them. VWAP is computed on the base bars and sampled at each display bar's close.
 * Placing lines (trainer): Shift+click → `onPlace("stop")`, Alt+click → `onPlace("target")`; a touch long-press or a
 * right-click → `onMenu` (the screen shows «stop here / target here»).
 */
import * as React from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type Time,
} from "lightweight-charts";
import { chartTableIsLayout, readChartTheme, sessionVwap, tickMarkLabel, fmtEtDateTime, type Candle, type ChartTheme } from "@/components/chart-engine";
import { useThemeVersion } from "@/components/chart-engine/hooks/useThemeVersion";
import { SessionShadingPrimitive } from "@/components/chart-engine/primitives/SessionShadingPrimitive";
import { LevelsPrimitive, type LevelLine } from "@/components/chart-engine/primitives/LevelsPrimitive";
import { VwapBandsPrimitive } from "@/components/chart-engine/primitives/VwapBandsPrimitive";
import { fmtDate, fmtPrice, localeTag } from "@/lib/format";
import { cn } from "@/lib/utils";
import { simI18n } from "@/i18n/ns/simulator";
import type { Levels, SimMode } from "./api";
import { fakeClock, focusRange, hhmm, swingIndex } from "./model";
import { SimOverlayPrimitive, mapOverlay, type DragLine, type OverlayData } from "./sim-overlay";
import { aggregate, displayTime, lastBaseOf, toDisplayIdx, type Aggregated } from "./tf-model";
import { SCALE_ON, SCROLL_ON, useChartPointer } from "./sim-chart-pointer";


/** Mutable bar store of one game, shared by the game controller and the chart (no React state per bar). */
export class BarFeed {
  bars: Candle[];
  /** Real times after the reveal (same length as bars), else null. */
  realTimes: number[] | null = null;
  private listeners = new Set<(kind: "append" | "relabel") => void>();
  constructor(bars: Candle[]) { this.bars = bars; }
  push(bars: Candle[]): void { if (!bars.length) return; this.bars.push(...bars); this.emit("append"); }
  relabel(real: number[]): void { this.realTimes = real.slice(0, this.bars.length); this.emit("relabel"); }
  subscribe(fn: (kind: "append" | "relabel") => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(kind: "append" | "relabel") { for (const fn of this.listeners) fn(kind); }
}

export type ChartToggles = { vwap: boolean; levels: boolean; ma: boolean };

type Refs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  ma20: ISeriesApi<"Line"> | null;
  ma50: ISeriesApi<"Line"> | null;
  session: SessionShadingPrimitive;
  levels: LevelsPrimitive;
  vwap: VwapBandsPrimitive;
  overlay: SimOverlayPrimitive;
  theme: ChartTheme;
  volCap: number;
  /** Display bars drawn so far. */
  len: number;
  /** Current aggregation of the feed (identity when the display tf is the base). */
  agg: Aggregated;
  /** Redraw everything from the feed (timeframe switch, reveal). */
  full: () => void;
  /** Push the current overlay again (a cancelled drag). */
  resetOverlay: () => void;
};

const MA = [20, 50] as const;

function sma(bars: readonly Candle[], n: number, at: number): number | null {
  if (at + 1 < n) return null;
  let s = 0;
  for (let i = at - n + 1; i <= at; i++) s += bars[i].c;
  return s / n;
}

/** Performance probe (dev only): time to first bar and per-append cost, read from the console as window.__simPerf
 *  (window.__simChart.takeScreenshot() gives the synchronous cost of one full paint). */
type Perf = { firstBarMs: number | null; appendMs: number[]; frameMs: number[]; t0: number | null };
const perf: Perf | null = import.meta.env.DEV ? ((globalThis as { __simPerf?: Perf }).__simPerf ??= { firstBarMs: null, appendMs: [], frameMs: [], t0: null }) : null;
export function markGameRequested(): void { if (perf) { perf.t0 = performance.now(); perf.firstBarMs = null; } }

export function SimChart({
  feed, mode, startIdx, levels, overlay, toggles, className, onDragLine, dragLabel, onPick, focus, baseMin = 1, dispMin = 1, onPlace, onMenu,
}: {
  feed: BarFeed;
  mode: SimMode;
  startIdx: number;
  levels: Levels;
  overlay: OverlayData;
  toggles: ChartToggles;
  className?: string;
  /** A stop / target / planned line was dragged to `price`. */
  onDragLine?: (kind: DragLine, price: number) => void;
  /** Label of a line while it is dragged. */
  dragLabel?: (kind: DragLine, price: number) => string;
  /** Click / tap on the chart: the (display) bar under the pointer and the price at its height. */
  onPick?: (idx: number, price: number) => void;
  /** «Найди вход»: the decision window to zoom to on a narrow chart (see focusRange). */
  focus?: { from: number; to: number } | null;
  /** Minutes of a feed bar and of a display bar (display > base = aggregated, the last bar forming). */
  baseMin?: number;
  dispMin?: number;
  /** Shift+click (stop) / Alt+click (target) at `price`. */
  onPlace?: (kind: "stop" | "target", price: number) => void;
  /** Touch long-press / right-click at `price`; x, y = the point inside the chart box (CSS px) for a menu. */
  onMenu?: (price: number, x: number, y: number) => void;
}) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const refs = React.useRef<Refs | null>(null);
  const themeVersion = useThemeVersion();
  const { t } = simI18n.useT();
  const intraday = mode === "intraday";
  const live = React.useRef({ startIdx, intraday, t, toggles, levels, overlay, onDragLine, dragLabel, onPick, focus, baseMin, dispMin, onPlace, onMenu });
  live.current = { startIdx, intraday, t, toggles, levels, overlay, onDragLine, dragLabel, onPick, focus, baseMin, dispMin, onPlace, onMenu };

  // Axis / crosshair labels: fake clock until the reveal, real time after.
  const tickLabel = React.useCallback((time: Time, type: number): string => {
    if (typeof time !== "number") return "";
    const real = realTimeOf(feed, time);
    const st = live.current;
    if (real != null) return st.intraday ? tickMarkLabel(real, type) : fmtDate(real * 1000, type <= 1 ? "monthYear" : "dayMonth");
    if (!st.intraday) return st.t("chart.day", { n: signed(swingIndex(time) - st.startIdx) });
    const c = fakeClock(time);
    return type <= 2 ? (c.day < 0 ? st.t("chart.prevDay") : st.t("chart.playDay")) : hhmm(c.min);
  }, [feed]);
  const crossLabel = React.useCallback((time: Time): string => {
    if (typeof time !== "number") return "";
    const real = realTimeOf(feed, time);
    const st = live.current;
    if (real != null) return st.intraday ? fmtEtDateTime(real) : fmtDate(real * 1000, "medium");
    if (!st.intraday) return st.t("chart.day", { n: signed(swingIndex(time) - st.startIdx) });
    const c = fakeClock(time);
    return `${c.day < 0 ? st.t("chart.prevDay") : st.t("chart.playDay")} ${hhmm(c.min)}`;
  }, [feed]);

  // ── Build once per game / theme ─────────────────────────────────────────
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const theme = readChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth || 600, height: el.clientHeight || 480,
      layout: { background: { color: "transparent" }, textColor: theme.muted(), fontFamily: theme.font, fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: theme.border(theme.dark ? 0.22 : 0.35) }, horzLines: { color: theme.border(theme.dark ? 0.22 : 0.35) } },
      timeScale: {
        timeVisible: intraday, secondsVisible: false, borderColor: theme.border(), rightOffset: 14, barSpacing: intraday ? 7 : 8, minBarSpacing: 1,
        shiftVisibleRangeOnNewBar: true,
        tickMarkFormatter: (time: Time, type: number) => tickLabel(time, type),
      },
      localization: { locale: localeTag(), timeFormatter: (time: Time) => crossLabel(time), priceFormatter: (p: number) => fmtPrice(p) },
      rightPriceScale: { borderColor: theme.border(), scaleMargins: { top: 0.08, bottom: 0.2 } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.muted(0.45), labelBackgroundColor: theme.labelBg, width: 1, style: 3 },
        horzLine: { color: theme.muted(0.45), labelBackgroundColor: theme.labelBg, width: 1, style: 3 },
      },
      handleScale: SCALE_ON,
      handleScroll: SCROLL_ON,
    });
    chartTableIsLayout(el);
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.up(), downColor: theme.down(), borderUpColor: theme.up(), borderDownColor: theme.down(), wickUpColor: theme.up(0.9), wickDownColor: theme.down(0.9),
      priceLineVisible: true, priceLineStyle: 2, priceLineColor: theme.muted(0.6), lastValueVisible: true,
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    let ma20: ISeriesApi<"Line"> | null = null, ma50: ISeriesApi<"Line"> | null = null;
    if (!intraday) {
      ma20 = chart.addSeries(LineSeries, { color: theme.c3(0.9), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      ma50 = chart.addSeries(LineSeries, { color: theme.c5(0.9), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }
    const session = new SessionShadingPrimitive(theme);
    const lv = new LevelsPrimitive(theme, { zOrder: "bottom" });
    const vwap = new VwapBandsPrimitive(theme, { color: theme.c5, bands: [], title: "VWAP" });
    const overlayPrim = new SimOverlayPrimitive(theme);
    chart.panes()[0]?.attachPrimitive(session);
    for (const p of [lv, vwap, overlayPrim]) candles.attachPrimitive(p);

    const aggOf = () => aggregate(feed.bars, live.current.baseMin, live.current.dispMin);
    const full = () => {
      const r = refs.current;
      if (!r) return;
      r.agg = aggOf();
      const bars = r.agg.bars;
      const tm = (i: number) => displayTime(r.agg, i, feed.bars, feed.realTimes) as UTCTimestamp;
      const vols = bars.map((b) => b.v).filter((v) => v > 0).sort((a, b) => a - b);
      r.volCap = vols.length ? vols[Math.min(vols.length - 1, Math.floor(0.98 * (vols.length - 1)))] : 0;
      r.candles.setData(bars.map((b, i) => ({ time: tm(i), open: b.o, high: b.h, low: b.l, close: b.c })));
      r.volume.setData(bars.map((b, i) => volPoint(r, b, tm(i))));
      if (r.ma20 && r.ma50) {
        r.ma20.setData(bars.map((_, i) => maPoint(bars, i, 20, tm(i))));
        r.ma50.setData(bars.map((_, i) => maPoint(bars, i, 50, tm(i))));
      }
      r.len = bars.length;
      refreshDerived(r, feed.bars, live.current.intraday);
      r.overlay.set(displayOverlay(r, live.current.overlay, live.current.baseMin, live.current.dispMin));
      const focused = live.current.focus ? focusRange(live.current.focus, el.clientWidth) : null;
      r.chart.timeScale().setVisibleLogicalRange(focused ?? { from: Math.max(0, bars.length - (live.current.intraday ? 150 : 110)), to: bars.length + 14 });
    };
    refs.current = {
      chart, candles, volume, ma20, ma50, session, levels: lv, vwap, overlay: overlayPrim, theme, volCap: 0, len: 0,
      agg: { bars: [], map: [], first: [] }, full,
      resetOverlay: () => { const r = refs.current; if (r) r.overlay.set(displayOverlay(r, live.current.overlay, live.current.baseMin, live.current.dispMin)); },
    };
    full();
    if (perf) {
      // Click «Play» → bars received and drawn into the chart model (the paint follows in the next frame).
      if (perf.t0 != null) { perf.firstBarMs = Math.round(performance.now() - perf.t0); perf.t0 = null; }
      (globalThis as { __simChart?: IChartApi }).__simChart = chart;
    }

    const unsub = feed.subscribe((kind) => {
      const r = refs.current;
      if (!r) return;
      if (kind === "relabel") { full(); return; }
      const t0 = perf ? performance.now() : 0;
      r.agg = aggOf();
      const bars = r.agg.bars;
      // The last drawn display bar may still be forming: redraw it, then append the new ones.
      for (let i = Math.max(0, r.len - 1); i < bars.length; i++) {
        const b = bars[i];
        const time = displayTime(r.agg, i, feed.bars, feed.realTimes) as UTCTimestamp;
        r.candles.update({ time, open: b.o, high: b.h, low: b.l, close: b.c });
        r.volume.update(volPoint(r, b, time));
        if (r.ma20 && r.ma50) { r.ma20.update(maPoint(bars, i, 20, time)); r.ma50.update(maPoint(bars, i, 50, time)); }
      }
      r.len = bars.length;
      refreshDerived(r, feed.bars, live.current.intraday);
      if (perf) {
        perf.appendMs.push(Math.round((performance.now() - t0) * 100) / 100);
        const s = performance.now();
        requestAnimationFrame(() => perf.frameMs.push(Math.round((performance.now() - s) * 100) / 100));
        if (perf.appendMs.length > 500) { perf.appendMs.splice(0, 250); perf.frameMs.splice(0, 250); }
      }
    });

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(el);
    return () => {
      unsub();
      ro.disconnect();
      for (const p of [lv, vwap, overlayPrim]) candles.detachPrimitive(p);
      chart.panes()[0]?.detachPrimitive(session);
      chart.remove();
      refs.current = null;
    };
    // One chart per game (one feed per game) and theme; bars stream in through the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, intraday, themeVersion]);

  // Timeframe switch: redraw from the same feed (no rebuild; the first run is the build above).
  const shownTf = React.useRef(`${baseMin}/${dispMin}`);
  React.useEffect(() => {
    const key = `${baseMin}/${dispMin}`;
    if (shownTf.current === key) return;
    shownTf.current = key;
    refs.current?.full();
  }, [baseMin, dispMin]);

  // ── Levels / toggles / overlay ──────────────────────────────────────────
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const th = r.theme;
    const lv: LevelLine[] = [];
    if (toggles.levels) {
      if (levels.pdh != null) lv.push({ key: "pdh", price: levels.pdh, text: "PDH", color: th.c3(0.75) });
      if (levels.pdl != null) lv.push({ key: "pdl", price: levels.pdl, text: "PDL", color: th.c3(0.75) });
      if (levels.pdc != null) lv.push({ key: "pdc", price: levels.pdc, text: "PDC", color: th.muted(0.8), dash: [6, 4] });
      if (levels.pmh != null) lv.push({ key: "pmh", price: levels.pmh, text: "PMH", color: th.c1(0.75) });
      if (levels.pml != null) lv.push({ key: "pml", price: levels.pml, text: "PML", color: th.c1(0.75) });
    }
    r.levels.set(lv);
    r.vwap.setVisible(toggles.vwap && intraday);
    r.ma20?.applyOptions({ visible: toggles.ma });
    r.ma50?.applyOptions({ visible: toggles.ma });
  }, [levels, toggles, intraday, themeVersion, feed]);

  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.overlay.set(displayOverlay(r, overlay, live.current.baseMin, live.current.dispMin));
  }, [overlay, themeVersion, feed, baseMin, dispMin]);

  // ── Drag stop / target / planned lines, modified clicks, long-press menu ─
  useChartPointer(boxRef, refs, live, [feed, intraday, themeVersion]);

  return <div ref={boxRef} className={cn("relative h-full min-h-[420px] w-full", className)} />;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** After the reveal the series runs on real times, so the axis time IS real; before it there is none. */
function realTimeOf(feed: BarFeed, time: number): number | null {
  return feed.realTimes ? time : null;
}

function volPoint(r: Refs, b: Candle, time: UTCTimestamp) {
  const cap = r.volCap > 0 ? r.volCap * 1.5 : b.v;
  return { time, value: Math.min(b.v, cap), color: b.c >= b.o ? r.theme.up(0.34) : r.theme.down(0.34) };
}

function maPoint(bars: readonly Candle[], i: number, n: (typeof MA)[number], time: UTCTimestamp) {
  const v = sma(bars, n, i);
  return v == null ? { time } : { time, value: v };
}

/** Overlay in display indices (identity on the base timeframe). */
function displayOverlay(r: Refs, overlay: OverlayData, baseMin: number, dispMin: number): OverlayData {
  if (!(dispMin > baseMin)) return overlay;
  return mapOverlay(overlay, (i) => toDisplayIdx(r.agg, i));
}

/**
 * Session shading + VWAP (O(n), n ≤ ~1,100 base bars: well under a millisecond). VWAP runs on the base bars of the
 * play day and is sampled at each display bar's last base bar, so it is the same line on every timeframe.
 */
function refreshDerived(r: Refs, base: readonly Candle[], intraday: boolean): void {
  const disp = r.agg.bars;
  r.session.setBars(disp, intraday);
  if (!intraday) return;
  // The play day only: the previous session's VWAP would be joined to today's by a line across the night.
  let from = base.length;
  while (from > 0 && fakeClock(base[from - 1].t).day >= 0) from--;
  const byT = new Map(sessionVwap(base.slice(from)).map((p) => [p.t, p] as const));
  const at: ({ vwap: number; sd: number } | null)[] = new Array(base.length).fill(null);
  let last: { vwap: number; sd: number } | null = null;
  for (let i = from; i < base.length; i++) { last = byT.get(base[i].t) ?? last; at[i] = last; }
  const pts: { idx: number; vwap: number; sd: number }[] = [];
  for (let j = 0; j < disp.length; j++) {
    const p = at[lastBaseOf(r.agg, j)];
    if (p) pts.push({ idx: j, vwap: p.vwap, sd: p.sd });
  }
  r.vwap.set(pts);
}
