/**
 * WS Chart — trade analysis / replay chart on lightweight-charts 5 (panes + primitives). The training game lives in the
 * «Тренажёр» (components/sim); this chart shows what really happened.
 *
 * Layouts:
 *  - "inline" (default): toolbar, a chart of `height` px, the replay dock and (in replay) the side panels stacked under
 *    it — for sheets and cards. The mouse wheel scrolls the page; Ctrl/⌘ + wheel (or a pinch) zooms.
 *  - "workspace": fills its parent (give the parent a height): toolbar on top, the chart + a right column with the
 *    position / fills / summary, the dock under the chart. Hotkeys work page-wide; the wheel zooms.
 *
 * Opening a trade shows its whole day (premarket and after-hours shaded). Key levels, the stop / R ladder and the VWAP
 * value share one label rail on the right edge (LevelsPrimitive) so labels never overlap; the legend owns the top-left.
 * The chart instance is built once per (bars, timeframe, theme); cursor, overlays, drawings and the live P&L are pushed
 * into it through refs, so replay stepping never rebuilds the chart; the crosshair re-renders only the legend.
 *
 * Money: `trade.redacted` (another trader's trade, $ nulled by the API) ⇒ per-share moves and R only, never $.
 */
import * as React from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, BaselineSeries,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams, type CandlestickData, type WhitespaceData,
  type HistogramData, type BaselineData, type AutoscaleInfo, type Time,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import type { Bar, ChartMode, Execution, ReplayExtraCtx, Timeframe, TradeLike, TradeStructureDto } from "./types";
import { TIMEFRAMES, TF_LABEL, TF_SECONDS } from "./types";
import { aggregate, availableTimeframes, barSeconds, baseBarLabel } from "./lib/aggregate";
import { etDayKey, fmtEtDateTime, fmtEtDay, fmtEtTime } from "./lib/time";
import { fmtR, fmtUsd } from "@/lib/format";
import { buildGeometry, type Geometry } from "./lib/geometry";
import { isOpening, positionAt, replayMark } from "./lib/position";
import { replayKeyAction, stepSpeed } from "./lib/replay-clock";
import { buildTradeSummary, fmtPerShare } from "./lib/trade-summary";
import { capVolumes, daySpanOf, defaultViewRange, followCursor, isViewMode, type ViewMode } from "./lib/view";
import { baseChartOptions, candleColors, priceFormatFor, refPrice, topMargin, wheelNeedsModifier } from "./lib/chart-options";
import { chartI18n } from "@/i18n/ns/chart";
import { readChartTheme, type ChartTheme } from "./theme";
import { useChartData } from "./hooks/useChartData";
import { ChartLoading, ChartNotice } from "./ui/ChartStates";
import { useThemeVersion } from "./hooks/useThemeVersion";
import { useStructureLayer } from "./hooks/useStructureLayer";
import { useReplay } from "./hooks/useReplay";
import { useDrawings } from "./hooks/useDrawings";
import { useDrawingTools } from "./hooks/useDrawingTools";
import { SessionShadingPrimitive } from "./primitives/SessionShadingPrimitive";
import { FillsPrimitive } from "./primitives/FillsPrimitive";
import { PositionZonePrimitive } from "./primitives/PositionZonePrimitive";
import { StopTargetPrimitive, stopTargetRail } from "./primitives/StopTargetPrimitive";
import { ExcursionPrimitive } from "./primitives/ExcursionPrimitive";
import { LevelsPrimitive, type LevelLine } from "./primitives/LevelsPrimitive";
import { VwapBandsPrimitive } from "./primitives/VwapBandsPrimitive";
import { VolumeProfilePrimitive } from "./primitives/VolumeProfilePrimitive";
import { EventMarkersPrimitive } from "./primitives/EventMarkersPrimitive";
import { DrawingsPrimitive } from "./primitives/DrawingsPrimitive";
import { ChartLegend, type LegendInfo } from "./ui/ChartLegend";
import { ReplayDock, type ReplayMark } from "./ui/ReplayControls";
import { ChartToolbar, DEFAULT_OVERLAYS, DEFAULT_PANES, type HotkeyRow, type Overlays, type PaneToggles } from "./ui/ChartToolbar";
import { FillLog, PositionCard, SummaryCard } from "./ui/TradePanels";
import { FillsKey } from "./ui/FillsKey";
import { DrawingBar } from "./ui/DrawingBar";
import { DrawingNotes } from "./ui/DrawingNotes";
import { robustPriceRange } from "./lib/autoscale";
import { planRail, type PlanLevel } from "./lib/plan-levels";

export type WsChartProps = {
  trade: TradeLike;
  /** Fills; when omitted they are fetched from GET /api/trades/:id/executions. */
  executions?: Execution[];
  /** Recognised structure that came with `executions`. */
  structure?: TradeStructureDto | null;
  /** Target price (e.g. from the linked trade idea). */
  target?: number | null;
  initialTimeframe?: Timeframe;
  /** Initial mode (the toolbar switches it; `onModeChange` reports the switch). */
  mode?: ChartMode;
  onModeChange?: (m: ChartMode) => void;
  onTimeframeChange?: (tf: Timeframe) => void;
  /** Inline layout only: chart height in px. */
  height?: number;
  className?: string;
  /** Trading days of context loaded before the entry day (default 2; dropped when it would cost resolution). */
  contextDays?: number;
  /** Replay starts this many bars before the entry until the viewer picks a start preset. */
  startBarsBefore?: number;
  layout?: "inline" | "workspace";
  /** Hotkeys without focusing the chart first (default: on in the workspace layout). */
  globalHotkeys?: boolean;
  /** Show the analysis / replay switch in the toolbar (default true). */
  showModes?: boolean;
  /** Extra content at the bottom of the side column. */
  asideExtra?: React.ReactNode;
  /** The morning plan's levels of this ticker-day (Волна 2 п. 2.12, hooks/usePlanOverlay) — dotted «План» lines. */
  planLevels?: readonly PlanLevel[] | null;
  /** Replay only: extra content in the side column built from the cursor (/chart-lab «угадай» drill, decision readout). */
  replayExtra?: (ctx: ReplayExtraCtx) => React.ReactNode;
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram"> | null;
  pnl: ISeriesApi<"Baseline"> | null;
  prims: {
    session: SessionShadingPrimitive; fills: FillsPrimitive; zone: PositionZonePrimitive; stopTarget: StopTargetPrimitive;
    excursion: ExcursionPrimitive; levels: LevelsPrimitive; vwap: VwapBandsPrimitive; avwap: VwapBandsPrimitive; profile: VolumeProfilePrimitive;
    events: EventMarkersPrimitive; drawings: DrawingsPrimitive;
  };
  full: CandlestickData<UTCTimestamp>[];
  ws: WhitespaceData<UTCTimestamp>[];
  volFull: HistogramData<UTCTimestamp>[];
  pnlFull: BaselineData<UTCTimestamp>[];
  pnlByTime: Map<number, BaselineData<UTCTimestamp>>;
  /** Last applied reveal limit (−1 = nothing, −2 = force a full push). */
  revealed: number;
  theme: ChartTheme;
  /** Pane height (px) for the top margin that keeps candles clear of the legend. */
  height: number;
  volumeOn: boolean;
};

const OVERLAYS_KEY = "ws-chart:overlays:v3";
const PANES_KEY = "ws-chart:panes:v2";
/** Default zoom of a trade: the whole day (owner: «график должен полностью показываться за тот день»). */
const VIEW_KEY = "ws-chart:view:v1";
/** Legend height (two text lines) the top price margin keeps free. */
const LEGEND_PX = 40;

function loadBools<T extends object>(key: string, defaults: T): T {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return defaults;
    const out = { ...defaults } as Record<string, unknown>;
    for (const k of Object.keys(defaults)) if (typeof p[k] === "boolean") out[k] = p[k];
    return out as T;
  } catch { return defaults; }
}
function save(key: string, value: object): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const STRETCH = { price: 76, pnl: 24 } as const;
const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

function applyMargins(r: ChartRefs): void {
  r.candles.priceScale().applyOptions({ scaleMargins: { top: topMargin(r.height, LEGEND_PX), bottom: r.volumeOn ? 0.2 : 0.06 } });
}

export function WsChart({
  trade, executions, structure, target, initialTimeframe = "1m", mode: modeProp = "analysis", onModeChange, onTimeframeChange,
  height = 520, className, contextDays = 2, startBarsBefore, layout = "inline", globalHotkeys, showModes = true, asideExtra, planLevels, replayExtra,
}: WsChartProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const refs = React.useRef<ChartRefs | null>(null);
  const themeVersion = useThemeVersion();
  const data = useChartData(trade, { executions, structure, contextDays });
  const redacted = !!trade.redacted;
  const { t: tc } = chartI18n.useT();

  // ── Timeframe & bars ─────────────────────────────────────────────────────
  const timeframes = React.useMemo(() => availableTimeframes(data.baseSec, TIMEFRAMES), [data.baseSec]);
  const [tfState, setTfState] = React.useState<Timeframe>(initialTimeframe);
  const tf: Timeframe = timeframes.includes(tfState) ? tfState : timeframes[0] ?? "D";
  const setTf = React.useCallback((t: Timeframe) => { setTfState(t); onTimeframeChange?.(t); }, [onTimeframeChange]);
  const useDaily = tf === "D";
  const requestDaily = data.daily.request;
  React.useEffect(() => { if (useDaily) requestDaily(); }, [useDaily, requestDaily]);
  const intraday = !useDaily && data.baseSec < 86400;
  const barSec = useDaily ? 86400 : barSeconds(tf, data.baseSec);
  const bars: Bar[] = React.useMemo(() => {
    if (useDaily && data.daily.bars.length) return data.daily.bars.map((b) => ({ ...b, n: 1 }));
    return aggregate(data.bars, data.baseSec, tf);
  }, [data.bars, data.baseSec, data.daily.bars, tf, useDaily]);
  const last = Math.max(0, bars.length - 1);

  const geo: Geometry = React.useMemo(() => buildGeometry({
    bars, barSec, baseBars: tf === "1m" || data.baseSec >= TF_SECONDS[tf] ? bars : data.bars, baseSec: data.baseSec,
    trade, executions: data.executions, prevClose: data.prevClose, dateKey: data.dateKey, target, events: data.events, intraday, structure: data.structure,
  }), [bars, barSec, data.bars, data.baseSec, data.executions, data.prevClose, data.dateKey, data.events, data.structure, trade, target, intraday, tf]);
  const hasTrade = geo.entryIdx != null;
  /** Volume of each bar ÷ the average of the 20 bars before it (the legend's «×1.4»). */
  const volRatio = React.useMemo(() => {
    const out: (number | null)[] = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i >= 20) { const avg = sum / 20; out[i] = avg > 0 && bars[i].v > 0 ? bars[i].v / avg : null; sum -= bars[i - 20].v || 0; }
      sum += bars[i].v || 0;
    }
    return out;
  }, [bars]);

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [mode, setModeState] = React.useState<ChartMode>(modeProp);
  React.useEffect(() => { setModeState(modeProp); }, [modeProp, trade.id]);
  const setMode = React.useCallback((m: ChartMode) => { setModeState(m); onModeChange?.(m); }, [onModeChange]);
  const replayActive = mode === "replay";

  // ── Replay ───────────────────────────────────────────────────────────────
  const replay = useReplay({
    active: replayActive, sessionId: trade.id, bars, barSec, intraday, dayKey: data.dateKey,
    entryIdx: geo.entryIdx, entryTime: geo.entryTime, exitIdx: geo.exitIdx, fills: geo.fills, startBarsBefore,
  });
  const cursorIdx = replay.cursorIdx;
  const revealAll = !replayActive;
  const structureLayer = useStructureLayer(geo, false, revealAll ? null : cursorIdx);

  // ── Overlays / drawings ──────────────────────────────────────────────────
  const [overlays, setOverlays] = React.useState<Overlays>(() => loadBools(OVERLAYS_KEY, DEFAULT_OVERLAYS));
  const setOverlay = React.useCallback((k: keyof Overlays, v: boolean) => setOverlays((o) => { const n = { ...o, [k]: v }; save(OVERLAYS_KEY, n); return n; }), []);
  const [panes, setPanes] = React.useState<PaneToggles>(() => loadBools(PANES_KEY, DEFAULT_PANES));
  const setPane = React.useCallback((k: keyof PaneToggles, v: boolean) => setPanes((o) => { const n = { ...o, [k]: v }; save(PANES_KEY, n); return n; }), []);
  const ov = overlays;
  const showPnlPane = panes.pnl && geo.position.length > 0;

  const drawingStore = useDrawings(trade.ticker, data.dateKey, Boolean(trade.ticker && data.dateKey));
  const tools = useDrawingTools(drawingStore, { bars, barSec }, { tradeId: trade.id > 0 ? trade.id : null });
  // Hovered bar lives outside React state: the crosshair updates only the legend, not the whole chart + panels.
  const [hoverStore] = React.useState(createHoverStore);
  const live = React.useRef({ bars, cursorIdx, revealAll, replayActive });
  live.current = { bars, cursorIdx, revealAll, replayActive };

  // ── View ─────────────────────────────────────────────────────────────────
  const [viewMode, setViewModeState] = React.useState<ViewMode>(() => {
    try { const v = localStorage.getItem(VIEW_KEY); return isViewMode(v) ? v : "day"; } catch { return "day"; }
  });
  const setViewMode = React.useCallback((v: ViewMode) => {
    setViewModeState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
  }, []);
  // Every bar of the trade's day(s): premarket → after-hours of the entry day … the exit day (context days excluded).
  const daySpan = React.useMemo(
    () => (intraday && bars.length ? daySpanOf(bars.map((b) => etDayKey(b.t)), data.dateKey, data.toKey || data.dateKey) : null),
    [intraday, bars, data.dateKey, data.toKey],
  );
  /** «День / Сделка» only makes sense for a trade on intraday bars outside replay (replay follows its cursor). */
  const showViewSwitch = hasTrade && daySpan != null && !replayActive;
  const fitView = React.useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const s = live.current;
    const ts = r.chart.timeScale();
    if (s.replayActive && s.cursorIdx != null) ts.setVisibleLogicalRange({ from: s.cursorIdx - 70, to: s.cursorIdx + 30 });
    else {
      const range = defaultViewRange({ count: s.bars.length, entryIdx: geo.entryIdx, exitIdx: geo.exitIdx, dayRange: geo.dayRange, daySpan, mode: hasTrade ? viewMode : "day" });
      if (range) ts.setVisibleLogicalRange(range); else ts.fitContent();
    }
    r.chart.priceScale("right").applyOptions({ autoScale: true });
  }, [geo.entryIdx, geo.exitIdx, geo.dayRange, daySpan, viewMode, hasTrade]);
  const fitRef = React.useRef(fitView);
  fitRef.current = fitView;
  // Switching «День / Сделка» re-frames at once (the chart itself is not rebuilt).
  const viewInit = React.useRef(true);
  React.useEffect(() => {
    if (viewInit.current) { viewInit.current = false; return; }
    fitRef.current();
  }, [viewMode]);

  // ── Chart build ──────────────────────────────────────────────────────────
  const bindTools = tools.bind;
  /** Bumped after every (re)build so the push effects below run against the new chart instance. */
  const [chartGen, setChartGen] = React.useState(0);
  const showChart = !data.loading && !data.error && bars.length > 0;
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || !bars.length) return;
    const theme = readChartTheme();
    const h = el.clientHeight || height;
    const chart = createChart(el, { ...baseChartOptions(theme, { width: el.clientWidth || 320, height: h, intraday, rightOffset: 8 }) });

    const full = bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c }));
    const ws = bars.map((b) => ({ time: b.t as UTCTimestamp }));
    const capped = capVolumes(bars.map((b) => b.v)).values;
    const volFull = bars.map((b, i) => {
      const rv = geo.rvol[i];
      const a = rv != null && rv >= 2 ? 0.62 : 0.34;
      return { time: b.t as UTCTimestamp, value: capped[i], color: b.c >= b.o ? theme.up(a) : theme.down(a) };
    });

    const candles = chart.addSeries(CandlestickSeries, {
      ...candleColors(theme), priceLineVisible: false, lastValueVisible: true, priceFormat: priceFormatFor(refPrice(bars.map((b) => b.c))),
      // The price scale fits the bars in view without bad prints (lib/autoscale). In replay it covers ALL bars in view
      // (revealed or not), so revealing bars does not jump the scale.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
        const r = chart.timeScale().getVisibleLogicalRange();
        if (!r) return original();
        const range = robustPriceRange(bars, r.from, r.to);
        if (!range) return original();
        if (!live.current.replayActive) {
          // Analysis: keep the library's own range when it is already tight (nothing was cut).
          const o = original();
          if (o?.priceRange && o.priceRange.minValue >= range.min && o.priceRange.maxValue <= range.max) return o;
        }
        return { priceRange: { minValue: range.min, maxValue: range.max } };
      },
    }, 0);
    chart.panes()[0]?.setStretchFactor(STRETCH.price);

    const prims: ChartRefs["prims"] = {
      session: new SessionShadingPrimitive(theme),
      fills: new FillsPrimitive(theme), zone: new PositionZonePrimitive(theme, { zOrder: "bottom" }), stopTarget: new StopTargetPrimitive(theme),
      excursion: new ExcursionPrimitive(theme), levels: new LevelsPrimitive(theme, { zOrder: "bottom" }),
      // VWAP is labelled on the levels rail (its value at the right edge), not at the end of the line.
      vwap: new VwapBandsPrimitive(theme, { color: theme.c5, bands: [], title: "" }),
      avwap: new VwapBandsPrimitive(theme, { color: theme.primary, bands: [], title: "AVWAP", dash: [5, 3] }),
      profile: new VolumeProfilePrimitive(theme), events: new EventMarkersPrimitive(theme), drawings: new DrawingsPrimitive(theme, { zOrder: "top" }),
    };
    const seriesPrims = [prims.levels, prims.zone, prims.profile, prims.vwap, prims.avwap, prims.stopTarget, prims.excursion, prims.fills, prims.drawings];
    chart.panes()[0]?.attachPrimitive(prims.session);
    chart.panes()[0]?.attachPrimitive(prims.events);
    structureLayer.attach(candles, theme);
    for (const p of seriesPrims) candles.attachPrimitive(p);
    prims.session.setBars(bars, intraday);

    const r: ChartRefs = { chart, candles, volume: null, pnl: null, prims, full, ws, volFull, pnlFull: [], pnlByTime: new Map(), revealed: -2, theme, height: h, volumeOn: false };
    refs.current = r;
    applyMargins(r);
    const s = live.current;
    applyReveal(r, s.revealAll ? null : s.cursorIdx);
    fitRef.current();

    // Crosshair → legend (rAF-throttled: at most one legend render per frame).
    let raf = 0;
    let lastHover: number | null = null;
    const onMove = (param: MouseEventParams<Time>) => {
      const st = live.current;
      let idx: number | null = null;
      if (param.logical != null && param.point) {
        const i = Math.round(Number(param.logical));
        if (i >= 0 && i < bars.length && (st.revealAll || (st.cursorIdx != null && i <= st.cursorIdx))) idx = i;
      }
      if (idx !== lastHover) {
        lastHover = idx;
        if (!raf) raf = window.requestAnimationFrame(() => { raf = 0; hoverStore.set(lastHover); });
      }
    };
    chart.subscribeCrosshairMove(onMove);
    const unbindTools = bindTools(chart, candles, prims.drawings, el);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, hh = el.clientHeight;
      if (w > 0 && hh > 0) { chart.applyOptions({ width: w, height: hh }); r.height = hh; applyMargins(r); }
    });
    ro.observe(el);
    setChartGen((g) => g + 1);

    return () => {
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      unbindTools();
      structureLayer.detach(candles);
      for (const p of seriesPrims) candles.detachPrimitive(p);
      chart.remove();
      refs.current = null;
      hoverStore.set(null);
    };
    // Rebuild only when the bar set, timeframe or theme changes, or the container appears (the fills may finish loading
    // after the candles: the skeleton is shown until then); everything else is pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, barSec, intraday, themeVersion, showChart]);

  // ── Volume overlay / P&L pane ────────────────────────────────────────────
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const th = r.theme;
    if (r.volume) { r.chart.removeSeries(r.volume); r.volume = null; }
    if (r.pnl) { r.chart.removeSeries(r.pnl); r.pnl = null; }
    if (panes.volume) {
      r.volume = r.chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 0);
      r.chart.priceScale("vol", 0).applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    }
    r.volumeOn = panes.volume;
    applyMargins(r);
    if (showPnlPane) {
      r.pnl = r.chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: th.up(1), topFillColor1: th.up(0.3), topFillColor2: th.up(0.03),
        bottomLineColor: th.down(1), bottomFillColor1: th.down(0.03), bottomFillColor2: th.down(0.3),
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        priceFormat: { type: "custom", formatter: (p: number) => fmtUsd(p, { decimals: 0 }), minMove: 0.01 },
        title: "P&L",
      }, 1);
      r.pnl.getPane().setStretchFactor(STRETCH.pnl);
    }
    r.chart.panes()[0]?.setStretchFactor(STRETCH.price);
    r.pnlFull = geo.position.map((p) => ({ time: p.t as UTCTimestamp, value: Math.round(p.total * 100) / 100 }));
    r.pnlByTime = new Map(r.pnlFull.map((p) => [Number(p.time), p]));
    r.revealed = -2;
    const s = live.current;
    applyReveal(r, s.revealAll ? null : s.cursorIdx);
  }, [panes.volume, showPnlPane, geo.position, bars, chartGen]);

  // ── Push geometry + overlay visibility ───────────────────────────────────
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const { prims } = r;
    const th = r.theme;
    prims.fills.setFills(geo.fills, geo.side);
    const multiple = geo.fills.filter((f) => isOpening(f.kind)).length > 1;
    prims.zone.set(geo.entryIdx != null && geo.avgEntry != null ? {
      fromIdx: geo.entryIdx, toIdx: geo.exitIdx, avgEntry: geo.avgEntry, avgExit: geo.avgExit,
      positive: geo.grossUsd != null ? geo.grossUsd >= 0 : null, side: geo.side, multipleEntries: multiple,
    } : null);
    prims.zone.setVisible(ov.zone);
    const st = { stop: geo.stop, target: geo.target, avgEntry: geo.avgEntry, side: geo.side };
    prims.stopTarget.set(st);
    prims.stopTarget.setVisible(ov.stopTarget);
    prims.excursion.set(geo.excursion && geo.avgEntry != null ? { result: geo.excursion, avgEntry: geo.avgEntry, mfeIdx: geo.mfeIdx, maeIdx: geo.maeIdx } : null);
    prims.excursion.setVisible(ov.excursion);
    // One label rail: key levels, ORB, the stop / target / R ladder and (dynamic) the VWAP value.
    const lv: LevelLine[] = [];
    const L = geo.levels;
    if (ov.levels) {
      if (L.pdh != null) lv.push({ key: "pdh", price: L.pdh, text: "PDH", color: th.c3(0.8) });
      if (L.pdl != null) lv.push({ key: "pdl", price: L.pdl, text: "PDL", color: th.c3(0.8) });
      if (L.pdc != null) lv.push({ key: "pdc", price: L.pdc, text: "PDC", color: th.muted(0.85), dash: [6, 4] });
      if (L.pmh != null) lv.push({ key: "pmh", price: L.pmh, text: "PMH", color: th.c1(0.8) });
      if (L.pml != null) lv.push({ key: "pml", price: L.pml, text: "PML", color: th.c1(0.8) });
    }
    if (ov.orb && geo.dayRange) {
      if (L.orb5) { lv.push({ key: "orb5h", price: L.orb5.h, text: "ORB5 H", color: th.c2(0.8), fromIdx: geo.dayRange.from }); lv.push({ key: "orb5l", price: L.orb5.l, text: "ORB5 L", color: th.c2(0.8), fromIdx: geo.dayRange.from }); }
      if (L.orb15) { lv.push({ key: "orb15h", price: L.orb15.h, text: "ORB15 H", color: th.c5(0.8), dash: [4, 3], fromIdx: geo.dayRange.from }); lv.push({ key: "orb15l", price: L.orb15.l, text: "ORB15 L", color: th.c5(0.8), dash: [4, 3], fromIdx: geo.dayRange.from }); }
    }
    if (ov.stopTarget) lv.push(...stopTargetRail(st, th));
    if (ov.levels) lv.push(...planRail(planLevels, th, chartI18n.t("canvas.planShort")));
    prims.levels.set(lv);
    prims.levels.setDynamic(ov.vwap ? (rc) => {
      const v = prims.vwap.edgeValue(rc.range);
      return v == null ? [] : [{ key: "vwap", price: v, text: "VWAP", color: th.c5(0.9), noLine: true }];
    } : null);
    prims.vwap.setOptions({ bands: ov.vwapBands ? [1, 2] : [] });
    prims.vwap.set(geo.vwap); prims.vwap.setVisible(ov.vwap);
    prims.avwap.set(geo.avwap); prims.avwap.setVisible(ov.avwap);
    prims.profile.set(geo.profile); prims.profile.setVisible(ov.profile);
    prims.events.set(geo.events); prims.events.setVisible(ov.events);
    prims.session.setEnabled(ov.session);
  }, [geo, ov, chartGen, planLevels]);

  // ── Reveal (replay cursor) + the live P&L of the open position ──────────
  const liveMark = cursorIdx != null ? replayMark(bars, geo.fills, cursorIdx) : null;
  const livePosition = React.useMemo(() => {
    if (cursorIdx == null || liveMark == null) return null;
    return positionAt(geo.fills, cursorIdx, geo.side, liveMark, trade.qty ?? null);
  }, [cursorIdx, liveMark, geo.fills, geo.side, trade.qty]);
  const liveText = React.useMemo(() => {
    if (!replayActive || cursorIdx == null || !livePosition || livePosition.avg == null || liveMark == null) return null;
    const perShare = (geo.side === "short" ? -1 : 1) * (liveMark - livePosition.avg);
    const r = geo.risk ? perShare / geo.risk : null;
    const parts = [r != null ? fmtR(r) : fmtPerShare(perShare)];
    if (!redacted && livePosition.total != null) parts.push(fmtUsd(livePosition.total, { signed: true, decimals: "auto" }));
    return parts.join(" · ");
  }, [replayActive, cursorIdx, livePosition, liveMark, geo.side, geo.risk, redacted]);
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const limit = revealAll ? null : cursorIdx;
    applyReveal(r, limit);
    r.prims.fills.setLimit(limit);
    r.prims.zone.setCursor(limit, limit != null ? bars[limit]?.c ?? null : null);
    r.prims.zone.setLive(liveText);
    r.prims.vwap.setLimit(limit);
    r.prims.avwap.setLimit(limit);
    if (limit != null) {
      const ts = r.chart.timeScale();
      const next = followCursor(ts.getVisibleLogicalRange(), limit);
      if (next) ts.setVisibleLogicalRange(next);
    }
  }, [cursorIdx, revealAll, bars, liveText, chartGen]);

  // ── Fullscreen / wheel ───────────────────────────────────────────────────
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === rootRef.current && rootRef.current != null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = React.useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);
  const isWorkspace = layout === "workspace" || fullscreen;
  // Embedded (inline) charts leave the wheel to the page: Ctrl/⌘ + wheel or a pinch zooms.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || isWorkspace) return;
    return wheelNeedsModifier(el);
  }, [isWorkspace, showChart]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const cycleTf = React.useCallback(() => {
    if (timeframes.length < 2) return;
    setTf(timeframes[(timeframes.indexOf(tf) + 1) % timeframes.length]);
  }, [timeframes, tf, setTf]);
  const handleKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const code = e.code;
    if (k === "Escape") { if (tools.tool || tools.selected) { e.preventDefault(); tools.setTool(null); tools.setSelected(null); } return; }
    if ((k === "Delete" || k === "Backspace") && tools.selected) { e.preventDefault(); tools.remove(tools.selected); return; }
    if (code === "KeyF") { e.preventDefault(); if (e.shiftKey) toggleFullscreen(); else fitView(); return; }
    if (code === "KeyT") { e.preventDefault(); cycleTf(); return; }
    if (!replayActive && showViewSwitch && (code === "KeyD" || code === "KeyZ")) { e.preventDefault(); setViewMode(code === "KeyD" ? "day" : "trade"); return; }
    if (!replayActive) return;
    const a = replayKeyAction(k, code, e.shiftKey);
    if (!a) return;
    e.preventDefault();
    switch (a.kind) {
      case "toggle": replay.togglePlay(); break;
      case "step": replay.step(a.delta); break;
      case "speed": replay.updatePrefs({ speed: a.speed }); break;
      case "speedStep": replay.updatePrefs({ speed: stepSpeed(replay.prefs.speed, a.dir) }); break;
      case "open": replay.toOpen(); break;
      case "entry": replay.toEntry(); break;
      case "exit": replay.toExit(); break;
      case "nextFill": replay.toNextFill(); break;
      case "prevFill": replay.toPrevFill(); break;
      case "pauseOnFills": replay.updatePrefs({ pauseOnFills: !replay.prefs.pauseOnFills }); break;
    }
  };
  const keyRef = React.useRef(handleKey);
  keyRef.current = handleKey;
  const global = globalHotkeys ?? layout === "workspace";
  React.useEffect(() => {
    if (!global) return;
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      // Inside an open popover / dialog the keys belong to it.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[role='dialog'],[role='menu'],[role='listbox']")) return;
      keyRef.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [global]);

  // ── Screenshot ───────────────────────────────────────────────────────────
  const screenshot = React.useCallback(() => {
    const r = refs.current;
    if (!r) return;
    try {
      const canvas = r.chart.takeScreenshot(true, false);
      const name = `WS-${trade.ticker}-${data.dateKey}-${tf}.png`;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = name; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, "image/png");
    } catch { /* canvas tainted or unsupported — ignore */ }
  }, [trade.ticker, data.dateKey, tf]);

  // ── Derived panel data ───────────────────────────────────────────────────
  const sinceEntryAt = React.useCallback((idx: number) => {
    const bar = bars[idx];
    const entryT = geo.entryTime;
    if (!bar || entryT == null || geo.entryIdx == null || idx < geo.entryIdx) return null;
    return Math.max(0, (idx === geo.entryIdx ? bar.t + Math.min(barSec, 60) : bar.t + barSec) - entryT);
  }, [bars, geo.entryTime, geo.entryIdx, barSec]);

  const legendAt = React.useCallback((hover: number | null): LegendInfo | null => {
    if (!bars.length) return null;
    const idx = hover ?? (cursorIdx != null && !revealAll ? cursorIdx : (geo.exitIdx ?? last));
    const bar = bars[idx];
    if (!bar) return null;
    const pos = positionAt(geo.fills, idx, geo.side, bar.c, trade.qty ?? null);
    const v = ov.vwap && geo.vwap.length ? bsearch(geo.vwap, idx) : null;
    const av = ov.avwap && geo.avwap.length ? bsearch(geo.avwap, idx) : null;
    return {
      bar, idx, hovered: hover != null, position: pos, sinceEntry: sinceEntryAt(idx), vwap: v, avwap: av?.vwap ?? null, rvol: geo.rvol[idx] ?? null,
      prevBarClose: idx > 0 ? bars[idx - 1].c : null, volRatio: volRatio[idx] ?? null,
      risk: geo.risk, side: geo.side, prevClose: geo.levels.pdc ?? data.prevClose, redacted,
    };
  }, [bars, cursorIdx, revealAll, geo, last, trade.qty, ov.vwap, ov.avwap, sinceEntryAt, data.prevClose, redacted, volRatio]);

  const marks: ReplayMark[] = React.useMemo(() => geo.fills.map((f) => ({ idx: f.idx, kind: f.kind, label: f.label })), [geo.fills]);
  const summary = React.useMemo(() => (hasTrade ? buildTradeSummary({
    side: geo.side, avgEntry: geo.avgEntry, avgExit: geo.exitIdx != null ? geo.avgExit : null, risk: geo.risk, excursion: geo.excursion,
    entryTime: geo.entryTime, exitTime: geo.exitTime, pnlUsd: redacted ? null : (trade.pnl ?? geo.grossUsd),
  }) : null), [hasTrade, geo, redacted, trade.pnl]);

  const hotkeys: HotkeyRow[] = React.useMemo(() => {
    const rows: HotkeyRow[] = [];
    if (replayActive) {
      rows.push(
        [[tc("hotkeys.keySpace")], tc("hotkeys.playPause")], [["→"], tc("hotkeys.stepForward")], [["←"], tc("hotkeys.stepBack")],
        [["1–6"], tc("hotkeys.speedKeys")], [["+", "−"], tc("hotkeys.speed")], [["Home"], tc("hotkeys.toOpen")],
        [["E"], tc("hotkeys.toEntry")], [["X"], tc("hotkeys.toExit")], [["N"], tc("hotkeys.nextFill")], [["B"], tc("hotkeys.prevFill")], [["P"], tc("hotkeys.pauseOnFills")],
      );
    }
    if (showViewSwitch) rows.push([["D"], tc("hotkeys.day")], [["Z"], tc("hotkeys.trade")]);
    rows.push([["T"], tc("hotkeys.cycleTf")], [["F"], tc("hotkeys.fit")], [["Shift", "F"], tc("hotkeys.fullscreen")]);
    rows.push(isWorkspace ? [[tc("hotkeys.keyWheel")], tc("hotkeys.zoom")] : [["Ctrl", tc("hotkeys.keyWheel")], tc("hotkeys.zoom")]);
    rows.push([["Esc"], tc("hotkeys.cancelDrawing")], [["Delete"], tc("hotkeys.deleteDrawing")]);
    return rows;
  }, [replayActive, showViewSwitch, isWorkspace, tc]);

  // ── Render ───────────────────────────────────────────────────────────────
  const chartBoxCls = cn(
    "@container relative w-full min-w-0 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow-sm)]",
    isWorkspace && "h-[58svh] min-h-[280px] shrink-0 lg:h-auto lg:min-h-[320px] lg:flex-1 lg:shrink",
  );

  if (data.loading) return <ChartLoading workspace={isWorkspace} height={height} label={tc("engine.loading")} className={className} />;
  if (data.error || !bars.length) {
    const err = data.error;
    const reason = err?.field<string>("reason");
    const text = reason === "weekend" ? tc("engine.weekend", { date: data.dateKey })
      : reason === "future" ? tc("engine.future", { date: data.dateKey })
      : err?.status === 404 ? tc("engine.noCandlesRange", { ticker: trade.ticker, from: data.fromKey, to: data.toKey })
      : err ? tc("engine.loadFailed", { message: err.message })
      : useDaily && data.daily.loading ? tc("engine.loadingDaily")
      : tc("engine.noCandles", { date: data.dateKey });
    const canRetry = !!err && !reason && err.status !== 404 && err.status !== 422 && err.status !== 400;
    return <ChartNotice text={text} onRetry={canRetry ? data.retry : undefined} retrying={data.fetching} className={className} />;
  }

  // A multi-day trade (overnight / swing) spans several days: the replay labels carry the day too.
  const fmtBarTime = (t: number) => (intraday ? (data.multiDay ? fmtEtDateTime(t) : `${fmtEtTime(t)} ET`) : fmtEtDay(t));
  const drawHint = tools.tool ? (tools.pendingCount ? tc("engine.secondPoint") : tc("engine.firstPoint")) : null;
  const selectedDrawing = tools.selected ? drawingStore.drawings.find((d) => d.id === tools.selected) ?? null : null;
  const replayDone = replayActive && cursorIdx != null && geo.exitIdx != null && cursorIdx >= geo.exitIdx;

  const jumpView = (i: number) => refs.current?.chart.timeScale().setVisibleLogicalRange({ from: i - 50, to: i + 30 });
  const aside: React.ReactNode[] = [];
  if (!replayActive) {
    if (isWorkspace && summary) aside.push(<SummaryCard key="sum" s={summary} redacted={redacted} />, <FillLog key="log" fills={geo.fills} cursor={null} redacted={redacted} onJump={jumpView} />);
  } else if (cursorIdx != null) {
    if (replayDone && summary) aside.push(<SummaryCard key="sum" s={summary} redacted={redacted} onJumpBest={geo.mfeIdx != null ? () => replay.seek(geo.mfeIdx as number) : undefined} />);
    else if (hasTrade) aside.push(<PositionCard key="pos" position={livePosition} side={geo.side} mark={liveMark} risk={geo.risk} redacted={redacted} sinceEntry={sinceEntryAt(cursorIdx)} entered={geo.entryIdx != null && cursorIdx >= geo.entryIdx} />);
    if (hasTrade) aside.push(<FillLog key="log" fills={geo.fills} cursor={cursorIdx} redacted={redacted} onJump={(i) => replay.seek(i)} />);
  }
  if (replayActive && cursorIdx != null && replayExtra) aside.push(<React.Fragment key="rx">{replayExtra({ cursorIdx, bars, fills: geo.fills, side: geo.side, qty: trade.qty ?? null, entryIdx: geo.entryIdx, exitIdx: geo.exitIdx, redacted, seek: replay.seek, pause: () => replay.setPlaying(false) })}</React.Fragment>);
  if (drawingStore.drawings.some((d) => d.label)) aside.push(<DrawingNotes key="notes" drawings={drawingStore.drawings} tradeId={trade.id > 0 ? trade.id : null} selected={tools.selected} onSelect={tools.setSelected} />);
  if (asideExtra) aside.push(<React.Fragment key="extra">{asideExtra}</React.Fragment>);
  const showAside = aside.length > 0;

  return (
    <div
      ref={rootRef}
      className={cn("ws-chart flex w-full min-w-0 max-w-full flex-col gap-2 outline-none", isWorkspace && "h-full min-h-0", fullscreen && "bg-background p-3", className)}
      tabIndex={-1}
      onKeyDown={global ? undefined : (e) => { if (!isTyping(e.target)) keyRef.current(e.nativeEvent); }}
      aria-label={tc("engine.aria")}
    >
      <ChartToolbar
        timeframe={tf} timeframes={timeframes} allTimeframes={TIMEFRAMES} baseSec={data.baseSec} onTimeframe={setTf}
        mode={mode} onMode={setMode} showModes={showModes}
        overlays={overlays} onOverlay={setOverlay} panes={panes} onPane={setPane} hasPosition={geo.position.length > 0}
        hasEvents={geo.events.length > 0} hasStopOrTarget={geo.stop != null || geo.target != null}
        tool={tools.tool} onTool={tools.setTool} drawingsCount={drawingStore.drawings.length} onClearDrawings={tools.clearAll}
        onScreenshot={screenshot} onFit={fitView} onFullscreen={toggleFullscreen} fullscreen={fullscreen}
        view={showViewSwitch ? viewMode : undefined} onView={setViewMode}
        fetching={data.fetching || (useDaily && data.daily.loading)} hotkeys={hotkeys}
      />
      <div className={cn("flex min-w-0 flex-col gap-2", isWorkspace && "min-h-0 flex-1 lg:flex-row")}>
        <div className={cn("flex min-w-0 flex-col gap-1.5", isWorkspace && "min-h-0 lg:flex-1")}>
          <div className={chartBoxCls} style={isWorkspace ? undefined : { height }}>
            <div ref={containerRef} className={cn("absolute inset-0 isolate overflow-hidden tabular-nums", tools.tool && "cursor-crosshair")} />
            <LiveLegend store={hoverStore} build={legendAt} ticker={trade.ticker} tfLabel={TF_LABEL[tf]} />
            <DrawingBar
              hint={drawHint} selectedRole={selectedDrawing ? selectedDrawing.role ?? "accent" : null} local={drawingStore.source === "local"}
              onRole={(role) => { if (selectedDrawing) tools.setDrawingRole(selectedDrawing.id, role); }} onDelete={() => tools.remove(tools.selected)}
              note={selectedDrawing?.label ?? null} onNote={selectedDrawing ? (v) => tools.setDrawingLabel(selectedDrawing.id, v) : undefined}
            />
            {data.baseSec > 60 && intraday && (
              // Honest bar size: an old day may only exist in 5-minute / hourly bars.
              <span className="absolute bottom-8 right-[4.5rem] z-raised cursor-help rounded-full bg-background/90 px-2 py-0.5 text-xs text-[hsl(var(--chart-3))]" title={tc("bars.coarseTitle")}>
                {tc("bars.coarse", { tf: baseBarLabel(data.baseSec) })}
              </span>
            )}
          </div>
          <FillsKey fills={geo.fills} structure={geo.structure} layer={structureLayer} />
          {replayActive && cursorIdx != null && (
            <ReplayDock
              playing={replay.playing} speed={replay.prefs.speed} cursor={cursorIdx} start={replay.floorIdx} end={replay.dockEnd}
              marks={marks} timeLabel={fmtBarTime(bars[cursorIdx].t)} startLabel={fmtBarTime(bars[replay.floorIdx].t)} endLabel={fmtBarTime(bars[replay.dockEnd]?.t ?? bars[last].t)}
              startPreset={replay.prefs.start} onStartPreset={replay.chooseStart} hasEntry={hasTrade} intraday={intraday}
              hasExit={geo.exitIdx != null} nextFillLabel={replay.nextFill?.label ?? null} pauseOnFills={replay.prefs.pauseOnFills} onPauseOnFills={(v) => replay.updatePrefs({ pauseOnFills: v })}
              atEnd={replay.atEnd}
              onToggle={replay.togglePlay} onStep={replay.step} onSpeed={(v) => replay.updatePrefs({ speed: v })} onSeek={replay.seek}
              onNextFill={replay.toNextFill} onPrevFill={replay.toPrevFill} prevFillLabel={replay.prevFill?.label ?? null} onEntry={replay.toEntry} onExit={replay.toExit} onOpen={replay.toOpen} onRestart={replay.restart}
            />
          )}
        </div>
        {showAside && (
          <aside
            className={cn("flex min-w-0 flex-col gap-2", isWorkspace ? "lg:min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:pr-0.5" : "sm:grid sm:grid-cols-2 sm:items-start")}
            aria-label={tc("engine.asideTrade")}
          >
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Push candles / volume / P&L for a reveal limit (null = everything). Small forward steps use `update` instead of `setData`. */
function applyReveal(r: ChartRefs, limit: number | null): void {
  const n = r.full.length;
  const target = limit == null ? n - 1 : Math.max(-1, Math.min(n - 1, limit));
  if (r.revealed === target) return;
  const prev = r.revealed;
  if (prev >= -1 && target > prev && target - prev <= 24) {
    for (let i = prev + 1; i <= target; i++) {
      r.candles.update(r.full[i], true);
      r.volume?.update(r.volFull[i], true);
      const p = r.pnl ? r.pnlByTime.get(Number(r.full[i].time)) : undefined;
      if (p) r.pnl!.update(p, true);
    }
  } else {
    r.candles.setData(target >= n - 1 ? r.full : [...r.full.slice(0, target + 1), ...r.ws.slice(target + 1)]);
    r.volume?.setData(target >= n - 1 ? r.volFull : [...r.volFull.slice(0, target + 1), ...r.ws.slice(target + 1)]);
    if (r.pnl) {
      const limitT = target >= 0 ? Number(r.full[target].time) : -Infinity;
      r.pnl.setData(target >= n - 1 ? r.pnlFull : r.pnlFull.filter((p) => Number(p.time) <= limitT));
    }
  }
  r.revealed = target;
}

/** Hovered bar index as a tiny external store (see `hoverStore` in WsChart). */
function createHoverStore() {
  let value: number | null = null;
  const subs = new Set<() => void>();
  return {
    get: (): number | null => value,
    set: (v: number | null): void => { if (v === value) return; value = v; for (const f of subs) f(); },
    subscribe: (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}
type HoverStore = ReturnType<typeof createHoverStore>;

/** The legend is the only thing that follows the mouse: it alone re-renders on hover. */
function LiveLegend({ store, build, ticker, tfLabel }: { store: HoverStore; build: (hover: number | null) => LegendInfo | null; ticker: string; tfLabel: string }) {
  const hover = React.useSyncExternalStore(store.subscribe, store.get);
  const info = React.useMemo(() => build(hover), [build, hover]);
  return <ChartLegend info={info} ticker={ticker} tfLabel={tfLabel} />;
}

/** Last point with idx <= i, or null (points sorted by idx). */
function bsearch<T extends { idx: number }>(pts: readonly T[], i: number): T | null {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m].idx <= i) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? pts[ans] : null;
}
