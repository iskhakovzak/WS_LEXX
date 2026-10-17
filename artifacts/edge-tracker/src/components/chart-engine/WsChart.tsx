/**
 * WS Chart — trade analysis / replay / training chart on lightweight-charts 5 (panes + primitives).
 * Drop-in replacement for components/replay/ReplayChart: same `trade` / `target` / `height` / `className` props.
 *
 * Panes: 0 price (candles + all overlays), 1 volume (coloured by direction, RVOL-aware), 2 «Позиция» (MTM P&L in $).
 * The chart instance is built once per (bars, timeframe, theme); everything else (cursor, overlays, drawings)
 * is pushed into the existing instance through refs, so replay stepping never rebuilds the chart.
 */
import * as React from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, BaselineSeries, CrosshairMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type Time, type MouseEventParams, type CandlestickData, type WhitespaceData,
  type HistogramData, type BaselineData, type AutoscaleInfo,
} from "lightweight-charts";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Bar, ChartMode, Drawing, DrawingPoint, DrawingType, Execution, Timeframe, TradeLike, TrainingResult } from "./types";
import { TIMEFRAMES, TF_SECONDS } from "./types";
import { aggregate, availableTimeframes, barSeconds } from "./lib/aggregate";
import { barIndexForTime, etDayKey, findBarIndex, fmtEtDateTime, fmtEtDay, fmtEtTime, logicalToTime, tickMarkLabel } from "./lib/time";
import { fmtPrice, fmtVol } from "./lib/format";
import { buildGeometry, type Geometry } from "./lib/geometry";
import { isOpening, positionAt, positionSeries } from "./lib/position";
import { computeExitScore } from "./lib/training";
import { DRAWING_POINTS, loadDrawings, makeDrawing, saveDrawings } from "./lib/drawings";
import { readChartTheme, type ChartTheme } from "./theme";
import { useChartData } from "./hooks/useChartData";
import { useThemeVersion } from "./hooks/useThemeVersion";
import { SessionShadingPrimitive } from "./primitives/SessionShadingPrimitive";
import { FillsPrimitive } from "./primitives/FillsPrimitive";
import { PositionZonePrimitive } from "./primitives/PositionZonePrimitive";
import { StopTargetPrimitive } from "./primitives/StopTargetPrimitive";
import { ExcursionPrimitive } from "./primitives/ExcursionPrimitive";
import { LevelsPrimitive, type LevelLine } from "./primitives/LevelsPrimitive";
import { VwapBandsPrimitive } from "./primitives/VwapBandsPrimitive";
import { VolumeProfilePrimitive } from "./primitives/VolumeProfilePrimitive";
import { EventMarkersPrimitive } from "./primitives/EventMarkersPrimitive";
import { DrawingsPrimitive } from "./primitives/DrawingsPrimitive";
import { ChartLegend, type LegendInfo } from "./ui/ChartLegend";
import { REPLAY_SPEEDS, ReplayControls, type ReplayEvent, type ReplayMark, type ReplaySpeed, type ReplayStart } from "./ui/ReplayControls";
import { ChartToolbar, DEFAULT_OVERLAYS, DEFAULT_PANES, type Overlays, type PaneToggles } from "./ui/ChartToolbar";
import { TrainingPanel } from "./ui/TrainingPanel";

export type WsChartProps = {
  trade: TradeLike;
  /** Fills; when omitted they are fetched from GET /api/trades/:id/executions. */
  executions?: Execution[];
  /** Target price (e.g. from the linked trade idea). */
  target?: number | null;
  initialTimeframe?: Timeframe;
  /** Initial mode; the toolbar can switch it. */
  mode?: ChartMode;
  onTrainingResult?: (result: TrainingResult) => void;
  height?: number;
  className?: string;
  /** Trading days of context loaded before the entry day (default 2). */
  contextDays?: number;
  /**
   * Replay starts this many bars before the entry. When omitted the viewer's own start choice is used
   * (5 / 15 / 30 min before the entry or the session open; remembered in localStorage, default 15 min).
   */
  startBarsBefore?: number;
};

type ChartRefs = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram"> | null;
  pnl: ISeriesApi<"Baseline"> | null;
  prims: {
    session: SessionShadingPrimitive; sessionVol: SessionShadingPrimitive; fills: FillsPrimitive; zone: PositionZonePrimitive; stopTarget: StopTargetPrimitive;
    excursion: ExcursionPrimitive; levels: LevelsPrimitive; vwap: VwapBandsPrimitive; avwap: VwapBandsPrimitive; profile: VolumeProfilePrimitive;
    events: EventMarkersPrimitive; drawings: DrawingsPrimitive;
  };
  full: CandlestickData<UTCTimestamp>[];
  ws: WhitespaceData<UTCTimestamp>[];
  volFull: HistogramData<UTCTimestamp>[];
  volWs: WhitespaceData<UTCTimestamp>[];
  pnlFull: BaselineData<UTCTimestamp>[];
  /** Last applied reveal limit (−1 = everything). */
  revealed: number;
  theme: ChartTheme;
};

const OVERLAYS_KEY = "ws-chart:overlays:v2";
const REPLAY_KEY = "ws-chart:replay:v1";
type ReplayPrefs = { speed: ReplaySpeed; start: ReplayStart; pauseOnFills: boolean };
const DEFAULT_REPLAY: ReplayPrefs = { speed: 2, start: "15", pauseOnFills: true };
function loadReplayPrefs(): ReplayPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(REPLAY_KEY) ?? "null") as Partial<ReplayPrefs> | null;
    if (!p || typeof p !== "object") return DEFAULT_REPLAY;
    return {
      speed: (REPLAY_SPEEDS as readonly number[]).includes(Number(p.speed)) ? (Number(p.speed) as ReplaySpeed) : DEFAULT_REPLAY.speed,
      start: p.start === "5" || p.start === "15" || p.start === "30" || p.start === "open" ? p.start : DEFAULT_REPLAY.start,
      pauseOnFills: typeof p.pauseOnFills === "boolean" ? p.pauseOnFills : DEFAULT_REPLAY.pauseOnFills,
    };
  } catch { return DEFAULT_REPLAY; }
}
const PANES_KEY = "ws-chart:panes:v1";
function loadStored<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return defaults;
    const out = { ...defaults } as Record<string, unknown>;
    for (const k of Object.keys(defaults)) if (typeof (p as Record<string, unknown>)[k] === "boolean") out[k] = (p as Record<string, unknown>)[k];
    return out as T;
  } catch { return defaults; }
}
function saveStored(key: string, value: object): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
/** Pane heights: price ≈ 70 %, volume ≈ 12 %, P&L ≈ 18 % (stretch factors are relative). */
const STRETCH = { price: 70, volume: 12, pnl: 18 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function WsChart({ trade, executions, target, initialTimeframe = "1m", mode: modeProp = "analysis", onTrainingResult, height = 520, className, contextDays = 2, startBarsBefore }: WsChartProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const refs = React.useRef<ChartRefs | null>(null);
  const themeVersion = useThemeVersion();
  const data = useChartData(trade, { executions, contextDays });

  // ── Timeframe & bars ─────────────────────────────────────────────────────
  const timeframes = React.useMemo(() => availableTimeframes(data.baseSec, TIMEFRAMES), [data.baseSec]);
  const [tfState, setTf] = React.useState<Timeframe>(initialTimeframe);
  const tf: Timeframe = timeframes.includes(tfState) ? tfState : timeframes[0] ?? "D";
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
    trade, executions: data.executions, prevClose: data.prevClose, dateKey: data.dateKey, target, events: data.events, intraday,
  }), [bars, barSec, data.bars, data.baseSec, data.executions, data.prevClose, data.dateKey, data.events, trade, target, intraday, tf]);

  // ── Mode / replay ────────────────────────────────────────────────────────
  const [mode, setMode] = React.useState<ChartMode>(modeProp);
  React.useEffect(() => { setMode(modeProp); }, [modeProp, trade.id]);
  const replayActive = mode !== "analysis";
  const [cursorTime, setCursorTime] = React.useState<number | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [prefs, setPrefs] = React.useState<ReplayPrefs>(loadReplayPrefs);
  const updatePrefs = React.useCallback((patch: Partial<ReplayPrefs>) => setPrefs((p) => { const n = { ...p, ...patch }; saveStored(REPLAY_KEY, n); return n; }), []);
  const speed = prefs.speed;
  const setSpeed = React.useCallback((v: ReplaySpeed) => updatePrefs({ speed: v }), [updatePrefs]);
  // An explicit `startBarsBefore` prop wins until the viewer picks a start point themselves.
  const [startChosen, setStartChosen] = React.useState(startBarsBefore == null);
  const [trainingResult, setTrainingResult] = React.useState<TrainingResult | null>(null);
  const training = mode === "training";

  // Start of the replay: N minutes before the entry or the regular-session open of the entry day.
  const entryIdx = geo.entryIdx;
  const openIdx = React.useMemo(() => {
    if (entryIdx == null || !bars.length || !intraday) return null;
    if (geo.dayRange && geo.dayRange.from <= entryIdx) return geo.dayRange.from;
    const day = etDayKey(bars[entryIdx].t);
    let i = entryIdx;
    while (i > 0 && etDayKey(bars[i - 1].t) === day) i--;
    return i;
  }, [entryIdx, bars, intraday, geo.dayRange]);
  const startIdx = React.useMemo(() => {
    if (entryIdx == null || !bars.length) return 0;
    if (!startChosen && startBarsBefore != null) return Math.max(0, entryIdx - startBarsBefore);
    if (prefs.start === "open") return openIdx ?? Math.max(0, entryIdx - 30);
    const anchor = geo.entryTime ?? bars[entryIdx].t;
    const i = findBarIndex(bars, anchor - Number(prefs.start) * 60);
    return clamp(i < 0 ? 0 : i, 0, entryIdx);
  }, [entryIdx, bars, startChosen, startBarsBefore, prefs.start, openIdx, geo.entryTime]);

  const cursorIdx = replayActive && cursorTime != null && bars.length ? clamp(barIndexForTime(bars, cursorTime, barSec), startIdx, last) : null;
  const revealAll = !replayActive || (training && trainingResult != null);
  const hideExits = training && trainingResult == null;
  // Training: the scrubber may only seek back to bars already watched (the future stays hidden).
  const [frontier, setFrontier] = React.useState(0);
  React.useEffect(() => { if (cursorIdx != null) setFrontier((f) => Math.max(f, cursorIdx)); }, [cursorIdx]);
  const seekLimit = hideExits ? Math.max(frontier, cursorIdx ?? 0) : last;

  // Replay (re)starts at the chosen start whenever the mode, the trade or the start point changes.
  const sessionKey = `${trade.id}:${mode}:${startIdx}`;
  const initialisedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!replayActive) { initialisedFor.current = null; setPlaying(false); setTrainingResult(null); return; }
    if (initialisedFor.current === sessionKey || !bars.length) return;
    initialisedFor.current = sessionKey;
    setPlaying(false); setTrainingResult(null);
    setFrontier(startIdx);
    setCursorTime(bars[startIdx].t);
  }, [sessionKey, replayActive, bars, startIdx]);

  const goTo = React.useCallback((idx: number) => {
    if (!bars.length) return;
    setCursorTime(bars[clamp(idx, startIdx, last)].t);
  }, [bars, startIdx, last]);
  const step = React.useCallback((delta: number) => { if (cursorIdx != null) goTo(cursorIdx + delta); }, [cursorIdx, goTo]);
  const seek = React.useCallback((idx: number) => { setPlaying(false); goTo(Math.min(idx, seekLimit)); }, [goTo, seekLimit]);

  // Fills the viewer may see in this mode (training: opening fills only until the answer is given).
  const visibleFills = React.useMemo(() => (hideExits ? geo.fills.filter((f) => isOpening(f.kind)) : geo.fills), [geo.fills, hideExits]);
  const playRef = React.useRef({ fillIdx: [] as number[], pauseOnFills: prefs.pauseOnFills });
  playRef.current = { fillIdx: visibleFills.map((f) => f.idx), pauseOnFills: prefs.pauseOnFills };

  React.useEffect(() => {
    if (!playing || cursorIdx == null) return;
    const perTick = speed >= 10 ? Math.ceil(speed / 5) : 1;
    const ms = speed >= 10 ? 100 : Math.round(500 / speed);
    const id = window.setInterval(() => {
      setCursorTime((t) => {
        if (t == null || !bars.length) return t;
        const cur = barIndexForTime(bars, t, barSec);
        let next = Math.min(last, cur + perTick);
        // «Пауза на исполнениях»: stop exactly on the next visible fill.
        if (playRef.current.pauseOnFills) {
          const hit = playRef.current.fillIdx.find((i) => i > cur && i <= next);
          if (hit != null) { next = hit; setPlaying(false); }
        }
        if (next >= last) setPlaying(false);
        return bars[next].t;
      });
    }, ms);
    return () => window.clearInterval(id);
    // cursorIdx intentionally not a dependency: the interval reads the latest cursor from state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, bars, barSec, last]);

  const togglePlay = React.useCallback(() => {
    if (cursorIdx == null) return;
    if (playing) { setPlaying(false); return; }
    if (cursorIdx >= last) {
      if (hideExits) return;
      goTo(startIdx);
    }
    setPlaying(true);
  }, [cursorIdx, playing, last, hideExits, goTo, startIdx]);

  const nextFill = cursorIdx != null ? visibleFills.find((f) => f.idx > cursorIdx) ?? null : null;
  // Without a next fill: analysis/replay jump to the end; training never fast-forwards (the future stays hidden).
  const jumpNextFill = React.useCallback(() => { setPlaying(false); if (nextFill) goTo(nextFill.idx); else if (!training) goTo(last); }, [nextFill, goTo, last, training]);
  const jumpEntry = React.useCallback(() => { setPlaying(false); if (geo.entryIdx != null) goTo(geo.entryIdx); }, [geo.entryIdx, goTo]);
  const jumpExit = React.useCallback(() => { setPlaying(false); if (geo.exitIdx != null && !hideExits) goTo(geo.exitIdx); }, [geo.exitIdx, goTo, hideExits]);
  const chooseStart = React.useCallback((v: ReplayStart) => { setStartChosen(true); updatePrefs({ start: v }); }, [updatePrefs]);

  // ── Training ─────────────────────────────────────────────────────────────
  const exitHere = React.useCallback(() => {
    if (cursorIdx == null || !bars.length || geo.entryIdx == null || cursorIdx < geo.entryIdx || trainingResult != null) return;
    setPlaying(false);
    const bar = bars[cursorIdx];
    const dir = geo.side === "short" ? -1 : 1;
    const qty = geo.qty;
    const avgEntry = geo.avgEntry;
    const userPnl = qty != null && avgEntry != null ? dir * (bar.c - avgEntry) * qty : null;
    const actualPnl = geo.grossUsd ?? (qty != null && avgEntry != null && geo.avgExit != null ? dir * (geo.avgExit - avgEntry) * qty : null);
    const result: TrainingResult = {
      tradeId: trade.id, side: geo.side, qty,
      userExitPrice: bar.c, userExitTime: bar.t,
      actualExitPrice: geo.avgExit, actualExitTime: geo.exitTime,
      avgEntry,
      userPnlUsd: userPnl, actualPnlUsd: actualPnl,
      diffUsd: userPnl != null && actualPnl != null ? userPnl - actualPnl : null,
      diffSeconds: geo.exitTime != null ? bar.t + barSec - geo.exitTime : null,
      score: computeExitScore(bars.map((b) => b.c), geo.entryIdx, cursorIdx, geo.exitIdx, geo.side, bar.c),
    };
    setTrainingResult(result);
    onTrainingResult?.(result);
  }, [cursorIdx, bars, geo, trade.id, barSec, onTrainingResult, trainingResult]);
  const restartTraining = React.useCallback(() => {
    setTrainingResult(null); setPlaying(false); setFrontier(startIdx);
    if (bars.length) setCursorTime(bars[startIdx].t);
  }, [bars, startIdx]);

  // P&L pane data: in training (before the answer) only the opening fills count, so the pane cannot leak the exit.
  const pnlPoints = React.useMemo(
    () => (hideExits ? positionSeries(bars, visibleFills, geo.side, trade.qty ?? null) : geo.position),
    [hideExits, bars, visibleFills, geo.side, geo.position, trade.qty],
  );

  // ── Overlays / drawings ──────────────────────────────────────────────────
  const [overlays, setOverlays] = React.useState<Overlays>(() => loadStored(OVERLAYS_KEY, DEFAULT_OVERLAYS));
  const setOverlay = React.useCallback((k: keyof Overlays, v: boolean) => setOverlays((o) => { const n = { ...o, [k]: v }; saveStored(OVERLAYS_KEY, n); return n; }), []);
  const [panes, setPanes] = React.useState<PaneToggles>(() => loadStored(PANES_KEY, DEFAULT_PANES));
  const setPane = React.useCallback((k: keyof PaneToggles, v: boolean) => setPanes((o) => { const n = { ...o, [k]: v }; saveStored(PANES_KEY, n); return n; }), []);
  const [drawings, setDrawings] = React.useState<Drawing[]>(() => loadDrawings(trade.id));
  const drawingsLoadedFor = React.useRef(trade.id);
  React.useEffect(() => {
    if (drawingsLoadedFor.current === trade.id) return;
    drawingsLoadedFor.current = trade.id;
    setDrawings(loadDrawings(trade.id));
  }, [trade.id]);
  const updateDrawings = React.useCallback((fn: (d: Drawing[]) => Drawing[]) => setDrawings((d) => { const n = fn(d); saveDrawings(trade.id, n); return n; }), [trade.id]);
  const [tool, setTool] = React.useState<DrawingType | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const pendingRef = React.useRef<DrawingPoint[]>([]);
  const [pendingCount, setPendingCount] = React.useState(0);

  const [hover, setHover] = React.useState<number | null>(null);

  // Latest values for chart callbacks (which are bound once per chart build).
  const live = React.useRef({ mode, tool, bars, barSec, cursorIdx, revealAll, replayActive, startIdx });
  live.current = { mode, tool, bars, barSec, cursorIdx, revealAll, replayActive, startIdx };

  // ── Chart build ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const el = containerRef.current, wrap = wrapRef.current;
    if (!el || !wrap || !bars.length) return;
    const theme = readChartTheme();
    const chart = createChart(el, {
      width: el.clientWidth || 320, height: el.clientHeight || height,
      layout: {
        background: { color: "transparent" }, textColor: theme.muted(), fontFamily: theme.font, fontSize: 11, attributionLogo: false,
        panes: { separatorColor: theme.border(0.9), separatorHoverColor: theme.primary(0.25), enableResize: true },
      },
      grid: { vertLines: { color: theme.border(theme.dark ? 0.35 : 0.5) }, horzLines: { color: theme.border(theme.dark ? 0.35 : 0.5) } },
      timeScale: {
        timeVisible: intraday, secondsVisible: false, borderColor: theme.border(), rightOffset: 6, barSpacing: 7, minBarSpacing: 0.5,
        tickMarkFormatter: (time: Time, type: number) => (typeof time === "number" ? tickMarkLabel(time, type) : ""),
      },
      localization: { locale: "ru-RU", timeFormatter: (time: Time) => (typeof time === "number" ? fmtEtDateTime(time) : String(time)), priceFormatter: (p: number) => fmtPrice(p) },
      rightPriceScale: { borderColor: theme.border(), scaleMargins: { top: 0.08, bottom: 0.06 } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.muted(0.5), labelBackgroundColor: theme.labelBg, width: 1 },
        horzLine: { color: theme.muted(0.5), labelBackgroundColor: theme.labelBg, width: 1 },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    const full = bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c }));
    const ws = bars.map((b) => ({ time: b.t as UTCTimestamp }));
    const volFull = bars.map((b, i) => {
      const rv = geo.rvol[i];
      const a = rv != null && rv >= 2 ? 0.9 : rv != null && rv >= 1.3 ? 0.65 : 0.4;
      return { time: b.t as UTCTimestamp, value: Number.isFinite(b.v) ? b.v : 0, color: b.c >= b.o ? theme.up(a) : theme.down(a) };
    });
    const volWs = ws;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.up(), downColor: theme.down(), borderUpColor: theme.up(), borderDownColor: theme.down(), wickUpColor: theme.up(0.85), wickDownColor: theme.down(0.85),
      priceLineVisible: false, lastValueVisible: true,
      // Replay: keep the price scale fitted to the FULL bars in view so revealing bars does not jump the scale.
      // Training: default autoscale over revealed bars only (the future stays unknown).
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
        const s = live.current;
        if (s.mode !== "replay" || s.revealAll) return original();
        const r = chart.timeScale().getVisibleLogicalRange();
        if (!r) return original();
        const from = Math.max(0, Math.floor(r.from)), to = Math.min(bars.length - 1, Math.ceil(r.to));
        let lo = Infinity, hi = -Infinity;
        for (let i = from; i <= to; i++) { if (bars[i].l < lo) lo = bars[i].l; if (bars[i].h > hi) hi = bars[i].h; }
        return Number.isFinite(lo) ? { priceRange: { minValue: lo, maxValue: hi } } : original();
      },
    }, 0);
    // Volume / P&L panes are created by the pane effect below (they can be collapsed by the user).
    chart.panes()[0]?.setStretchFactor(STRETCH.price);

    const prims: ChartRefs["prims"] = {
      session: new SessionShadingPrimitive(theme), sessionVol: new SessionShadingPrimitive(theme),
      fills: new FillsPrimitive(theme), zone: new PositionZonePrimitive(theme, { zOrder: "bottom" }), stopTarget: new StopTargetPrimitive(theme),
      excursion: new ExcursionPrimitive(theme), levels: new LevelsPrimitive(theme, { zOrder: "bottom" }),
      vwap: new VwapBandsPrimitive(theme, { color: theme.c5, bands: [1, 2], title: "VWAP" }),
      avwap: new VwapBandsPrimitive(theme, { color: theme.primary, bands: [], title: "AVWAP", dash: [5, 3] }),
      profile: new VolumeProfilePrimitive(theme), events: new EventMarkersPrimitive(theme), drawings: new DrawingsPrimitive(theme, { zOrder: "top" }),
    };
    chart.panes()[0]?.attachPrimitive(prims.session);
    chart.panes()[0]?.attachPrimitive(prims.events);
    for (const p of [prims.levels, prims.zone, prims.profile, prims.vwap, prims.avwap, prims.stopTarget, prims.excursion, prims.fills, prims.drawings]) candles.attachPrimitive(p);
    prims.session.setBars(bars, intraday);
    prims.sessionVol.setBars(bars, intraday);
    prims.drawings.setScale(bars, barSec);

    const pnlFull: BaselineData<UTCTimestamp>[] = pnlPoints.map((p) => ({ time: p.t as UTCTimestamp, value: Math.round(p.total * 100) / 100 }));
    refs.current = { chart, candles, volume: null, pnl: null, prims, full, ws, volFull, volWs, pnlFull, revealed: -2, theme };

    // Initial reveal + viewport.
    const s = live.current;
    const limit = s.revealAll ? null : s.cursorIdx;
    applyReveal(refs.current, limit);
    if (s.replayActive && limit != null) {
      chart.timeScale().setVisibleLogicalRange({ from: limit - 70, to: limit + 30 });
    } else if (geo.entryIdx != null) {
      const a = geo.entryIdx, b = geo.exitIdx ?? geo.entryIdx;
      const pad = Math.max(25, Math.round((b - a) * 0.6));
      chart.timeScale().setVisibleLogicalRange({ from: a - pad, to: b + pad });
    } else {
      chart.timeScale().fitContent();
    }

    // Crosshair → legend (rAF-throttled) + drawing preview.
    let raf = 0;
    let lastHover: number | null = null;
    let hasPreview = false;
    const onMove = (param: MouseEventParams) => {
      const st = live.current;
      let idx: number | null = null;
      if (param.logical != null) {
        const i = Math.round(Number(param.logical));
        if (i >= 0 && i < bars.length && (st.revealAll || (st.cursorIdx != null && i <= st.cursorIdx))) idx = i;
      }
      if (idx !== lastHover) {
        lastHover = idx;
        if (!raf) raf = window.requestAnimationFrame(() => { raf = 0; setHover(lastHover); });
      }
      if (st.tool && pendingRef.current.length && param.point && param.paneIndex === 0 && param.logical != null) {
        const price = candles.coordinateToPrice(param.point.y);
        if (price != null) {
          const time = logicalToTime(bars, Number(param.logical), barSec);
          prims.drawings.setPreview(makeDrawing(st.tool, [...pendingRef.current, { time, price: Number(price) }], theme.c1(1)));
          hasPreview = true;
        }
      } else if (hasPreview) { prims.drawings.setPreview(null); hasPreview = false; }
    };
    const onClick = (param: MouseEventParams) => {
      const st = live.current;
      if (!param.point || param.paneIndex !== 0 || param.logical == null) return;
      if (!st.tool) {
        const id = typeof param.hoveredObjectId === "string" && param.hoveredObjectId.startsWith("drawing:") ? param.hoveredObjectId.slice(8) : null;
        setSelected(id);
        return;
      }
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null) return;
      const time = logicalToTime(bars, Number(param.logical), barSec);
      const pts = [...pendingRef.current, { time, price: Number(price) }];
      if (pts.length >= DRAWING_POINTS[st.tool]) {
        const d = makeDrawing(st.tool, pts, theme.c1(1));
        pendingRef.current = [];
        setPendingCount(0);
        prims.drawings.setPreview(null);
        hasPreview = false;
        updateDrawings((list) => [...list, d]);
        setSelected(d.id);
        setTool(null);
      } else {
        pendingRef.current = pts;
        setPendingCount(pts.length);
      }
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      for (const p of [prims.levels, prims.zone, prims.profile, prims.vwap, prims.avwap, prims.stopTarget, prims.excursion, prims.fills, prims.drawings]) candles.detachPrimitive(p);
      chart.remove();
      refs.current = null;
      setHover(null);
    };
    // Rebuild only when the bar set, timeframe or theme changes; `geo` is pushed through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, barSec, intraday, themeVersion]);

  // ── Volume / P&L panes (collapsible) ─────────────────────────────────────
  // Panes are rebuilt from scratch on a toggle so their order (price, volume, P&L) and indices stay deterministic.
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const th = r.theme;
    if (r.volume) { r.volume.getPane().detachPrimitive(r.prims.sessionVol); r.chart.removeSeries(r.volume); r.volume = null; }
    if (r.pnl) { r.chart.removeSeries(r.pnl); r.pnl = null; }
    let next = 1;
    if (panes.volume) {
      r.volume = r.chart.addSeries(HistogramSeries, {
        priceFormat: { type: "custom", formatter: (v: number) => fmtVol(v), minMove: 1 },
        priceLineVisible: false, lastValueVisible: false,
      }, next);
      r.volume.getPane().setStretchFactor(STRETCH.volume);
      r.volume.getPane().attachPrimitive(r.prims.sessionVol);
      next++;
    }
    if (panes.pnl && pnlPoints.length > 0) {
      r.pnl = r.chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: th.up(1), topFillColor1: th.up(0.35), topFillColor2: th.up(0.03),
        bottomLineColor: th.down(1), bottomFillColor1: th.down(0.03), bottomFillColor2: th.down(0.35),
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        priceFormat: { type: "custom", formatter: (p: number) => `${p < 0 ? "−" : ""}$${Math.abs(p).toFixed(0)}`, minMove: 0.01 },
        title: "P&L $",
      }, next);
      r.pnl.getPane().setStretchFactor(STRETCH.pnl);
    }
    r.chart.panes()[0]?.setStretchFactor(STRETCH.price);
    r.pnlFull = pnlPoints.map((p) => ({ time: p.t as UTCTimestamp, value: Math.round(p.total * 100) / 100 }));
    r.revealed = -2; // force a full data push once; replay steps are handled incrementally by the reveal effect below
    const s = live.current;
    applyReveal(r, s.revealAll ? null : s.cursorIdx);
  }, [panes.volume, panes.pnl, pnlPoints, bars]);

  // ── Push geometry + overlay visibility ───────────────────────────────────
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const { prims } = r;
    const th = r.theme;
    prims.fills.setFills(geo.fills, geo.side);
    const multiple = geo.fills.filter((f) => isOpening(f.kind)).length > 1;
    prims.zone.set(geo.entryIdx != null && geo.avgEntry != null ? {
      // Training (before the answer): no exit index / price / outcome colour — the zone must not leak the result.
      fromIdx: geo.entryIdx, toIdx: hideExits ? null : geo.exitIdx, avgEntry: geo.avgEntry, avgExit: hideExits ? null : geo.avgExit,
      positive: hideExits ? null : geo.grossUsd != null ? geo.grossUsd >= 0 : trade.pnl != null ? trade.pnl >= 0 : null, side: geo.side, multipleEntries: multiple,
    } : null);
    prims.zone.setVisible(overlays.zone);
    prims.stopTarget.set({ stop: geo.stop, target: geo.target, avgEntry: geo.avgEntry, side: geo.side });
    prims.stopTarget.setVisible(overlays.stopTarget);
    prims.excursion.set(geo.excursion && geo.avgEntry != null ? { result: geo.excursion, avgEntry: geo.avgEntry, mfeIdx: geo.mfeIdx, maeIdx: geo.maeIdx } : null);
    prims.excursion.setVisible(overlays.excursion && !hideExits);
    const lv: LevelLine[] = [];
    const L = geo.levels;
    if (overlays.levels) {
      if (L.pdh != null) lv.push({ key: "pdh", price: L.pdh, text: "PDH", color: th.c3(0.8) });
      if (L.pdl != null) lv.push({ key: "pdl", price: L.pdl, text: "PDL", color: th.c3(0.8) });
      if (L.pdc != null) lv.push({ key: "pdc", price: L.pdc, text: "PDC", color: th.muted(0.9), dash: [6, 4] });
      if (L.pmh != null) lv.push({ key: "pmh", price: L.pmh, text: "PMH", color: th.c1(0.85) });
      if (L.pml != null) lv.push({ key: "pml", price: L.pml, text: "PML", color: th.c1(0.85) });
    }
    if (overlays.orb && geo.dayRange) {
      if (L.orb5) { lv.push({ key: "orb5h", price: L.orb5.h, text: "ORB5 H", color: th.c2(0.8), fromIdx: geo.dayRange.from }); lv.push({ key: "orb5l", price: L.orb5.l, text: "ORB5 L", color: th.c2(0.8), fromIdx: geo.dayRange.from }); }
      if (L.orb15) { lv.push({ key: "orb15h", price: L.orb15.h, text: "ORB15 H", color: th.c5(0.8), dash: [4, 3], fromIdx: geo.dayRange.from }); lv.push({ key: "orb15l", price: L.orb15.l, text: "ORB15 L", color: th.c5(0.8), dash: [4, 3], fromIdx: geo.dayRange.from }); }
    }
    prims.levels.set(lv);
    prims.vwap.set(geo.vwap); prims.vwap.setVisible(overlays.vwap);
    prims.avwap.set(geo.avwap); prims.avwap.setVisible(overlays.avwap);
    prims.profile.set(geo.profile); prims.profile.setVisible(overlays.profile);
    prims.events.set(geo.events); prims.events.setVisible(overlays.events);
    prims.session.setEnabled(overlays.session); prims.sessionVol.setEnabled(overlays.session);
  }, [geo, overlays, hideExits, trade.pnl]);

  // ── Reveal (replay cursor) ───────────────────────────────────────────────
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const limit = revealAll ? null : cursorIdx;
    applyReveal(r, limit);
    r.prims.fills.setLimit(limit);
    r.prims.fills.setHidden(hideExits ? geo.fills.filter((f) => !isOpening(f.kind)).map((f) => f.id) : []);
    r.prims.zone.setCursor(limit, limit != null ? bars[limit]?.c ?? null : null);
    r.prims.vwap.setLimit(limit);
    r.prims.avwap.setLimit(limit);
    if (limit != null) {
      const ts = r.chart.timeScale();
      const vr = ts.getVisibleLogicalRange();
      if (vr && (limit > vr.to - 3 || limit < vr.from)) {
        const span = Math.max(20, vr.to - vr.from);
        ts.setVisibleLogicalRange({ from: limit - span * 0.7, to: limit + span * 0.3 });
      }
    }
  }, [cursorIdx, revealAll, hideExits, geo.fills, bars]);

  // ── Drawings → primitive ─────────────────────────────────────────────────
  React.useEffect(() => { refs.current?.prims.drawings.setDrawings(drawings); }, [drawings, bars]);
  React.useEffect(() => { refs.current?.prims.drawings.setSelected(selected); }, [selected, bars]);
  React.useEffect(() => {
    if (!tool) { pendingRef.current = []; setPendingCount(0); refs.current?.prims.drawings.setPreview(null); }
  }, [tool]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    // Let buttons / inputs inside the toolbar keep their own keyboard behaviour (Space/Enter activate them).
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") { if (k === "Escape") { setTool(null); setSelected(null); } return; }
    if (k === "Escape") { e.preventDefault(); setTool(null); setSelected(null); return; }
    if ((k === "Delete" || k === "Backspace") && selected) { e.preventDefault(); updateDrawings((d) => d.filter((x) => x.id !== selected)); setSelected(null); return; }
    if (!replayActive || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = k.length === 1 ? k.toLowerCase() : k;
    if (key === " ") { e.preventDefault(); togglePlay(); }
    else if (key === "ArrowRight") { e.preventDefault(); setPlaying(false); step(e.shiftKey ? 10 : 1); }
    else if (key === "ArrowLeft") { e.preventDefault(); setPlaying(false); step(e.shiftKey ? -10 : -1); }
    else if (key === "e" || key === "у") { e.preventDefault(); jumpEntry(); }
    else if (key === "x" || key === "ч") { e.preventDefault(); jumpExit(); }
    else if (key === "n" || key === "т") { e.preventDefault(); jumpNextFill(); }
    else if (key === "p" || key === "з") { e.preventDefault(); updatePrefs({ pauseOnFills: !prefs.pauseOnFills }); }
    else if (key === "+" || key === "=") { e.preventDefault(); const i = REPLAY_SPEEDS.indexOf(speed); setSpeed(REPLAY_SPEEDS[Math.min(REPLAY_SPEEDS.length - 1, i + 1)]); }
    else if (key === "-" || key === "_") { e.preventDefault(); const i = REPLAY_SPEEDS.indexOf(speed); setSpeed(REPLAY_SPEEDS[Math.max(0, i - 1)]); }
    else if (key === "Enter" && training) { e.preventDefault(); exitHere(); }
    else if (key === "Home") { e.preventDefault(); setPlaying(false); goTo(startIdx); }
  };

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

  // ── Legend ───────────────────────────────────────────────────────────────
  const legend: LegendInfo | null = React.useMemo(() => {
    if (!bars.length) return null;
    const idx = hover ?? (cursorIdx != null && !revealAll ? cursorIdx : (geo.exitIdx ?? last));
    const bar = bars[idx];
    if (!bar) return null;
    const pos = positionAt(visibleFills, idx, geo.side, bar.c, trade.qty ?? null);
    const v = geo.vwap.length ? bsearch(geo.vwap, idx) : null;
    const av = geo.avwap.length ? bsearch(geo.avwap, idx) : null;
    const entryT = geo.entryTime;
    const sinceEntry = entryT != null && geo.entryIdx != null && idx >= geo.entryIdx ? Math.max(0, (idx === geo.entryIdx ? bar.t + Math.min(barSec, 60) : bar.t + barSec) - entryT) : null;
    return { bar, idx, hovered: hover != null, position: pos, sinceEntry, vwap: v, avwap: av?.vwap ?? null, rvol: geo.rvol[idx] ?? null, risk: geo.risk, side: geo.side, prevClose: geo.levels.pdc ?? data.prevClose };
  }, [bars, hover, cursorIdx, revealAll, geo, last, barSec, visibleFills, trade.qty, data.prevClose]);

  // ── Replay dock data ─────────────────────────────────────────────────────
  const marks: ReplayMark[] = React.useMemo(() => visibleFills.map((f) => ({ idx: f.idx, kind: f.kind, label: f.label })), [visibleFills]);
  const livePosition = React.useMemo(() => {
    if (cursorIdx == null || !bars[cursorIdx]) return null;
    return positionAt(visibleFills, cursorIdx, geo.side, bars[cursorIdx].c, trade.qty ?? null);
  }, [cursorIdx, bars, visibleFills, geo.side, trade.qty]);
  const event: ReplayEvent | null = React.useMemo(() => {
    if (cursorIdx == null) return null;
    let f: (typeof visibleFills)[number] | null = null;
    for (const x of visibleFills) { if (x.idx <= cursorIdx) f = x; else break; }
    return f ? { kind: f.kind, label: f.label, current: f.idx === cursorIdx } : null;
  }, [cursorIdx, visibleFills]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (data.loading) {
    return (
      <div className={cn("flex w-full min-w-0 flex-col gap-2", className)} aria-busy="true">
        <Skeleton className="h-9 w-full max-w-[34rem] rounded-full" />
        <Skeleton className="rounded-2xl" style={{ height }} />
        <span className="sr-only" role="status">Загружаем график…</span>
      </div>
    );
  }
  if (data.error || !bars.length) {
    const err = data.error;
    const text = err?.reason === "weekend" ? `${data.dateKey} — выходной, биржа закрыта`
      : err?.reason === "future" ? `${data.dateKey} ещё не наступило`
      : err?.status === 404 ? `Нет свечей ${trade.ticker} за ${data.fromKey}…${data.toKey}`
      : err ? `Не удалось загрузить свечи: ${err.message}`
      : useDaily && data.daily.loading ? "Загружаем дневные бары…"
      : `Нет свечей за ${data.dateKey}`;
    return (
      <div className={cn("flex items-center gap-2 rounded-2xl bg-[var(--glass-bg)] px-4 py-6 text-sm text-muted-foreground", className)} role="status">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--chart-3))]" aria-hidden="true" /> {text}
      </div>
    );
  }

  const inPosition = cursorIdx != null && geo.entryIdx != null && cursorIdx >= geo.entryIdx;
  // Scrubber window: the trade plus some context after it — not the whole loaded day (which would squeeze the
  // marks into a corner). In training it ignores the real exit, so its length cannot hint at the answer.
  const viewEnd = Math.min(last, Math.max(
    (geo.entryIdx ?? startIdx) + Math.max(12, Math.round(3600 / barSec)), // ~1 h after the entry
    !hideExits && geo.exitIdx != null ? geo.exitIdx + Math.max(3, Math.round(900 / barSec)) : 0, // ~15 min after the exit
  ));
  const fmtBarTime = (t: number) => (intraday ? `${fmtEtTime(t)} ET` : fmtEtDay(t));
  const hint = tool ? `${pendingCount ? "Вторая точка" : "Первая точка"}: кликните на графике · Esc — отмена` : selected ? "Delete — удалить выбранный рисунок" : null;

  return (
    <div
      ref={wrapRef}
      className={cn("ws-chart flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden outline-none", className)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="График сделки: пробел — играть/пауза, стрелки — шаг по барам, N — следующее исполнение, E — вход, X — выход, Esc — отмена инструмента"
    >
      <ChartToolbar
        timeframe={tf} timeframes={timeframes} onTimeframe={(t) => { setTf(t); }}
        mode={mode} onMode={setMode}
        overlays={overlays} onOverlay={setOverlay}
        panes={panes} onPane={setPane} hasPosition={geo.position.length > 0}
        tool={tool} onTool={setTool} drawingsCount={drawings.length}
        onClearDrawings={() => { updateDrawings(() => []); setSelected(null); }}
        onScreenshot={screenshot} fetching={data.fetching || (useDaily && data.daily.loading)}
        hasEvents={geo.events.length > 0} hasStopOrTarget={geo.stop != null || geo.target != null}
      />
      <div className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow-sm)]" style={{ height }}>
        {/* The chart is sized explicitly from this box by the ResizeObserver (autoSize off), so it can never exceed the container. */}
        <div ref={containerRef} className={cn("absolute inset-0 isolate overflow-hidden tabular-nums", tool && "cursor-crosshair")} />
        <ChartLegend info={legend} ticker={trade.ticker} />
        {hint && <div className="pointer-events-none absolute bottom-8 left-2 z-raised rounded-full bg-background/80 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">{hint}</div>}
        {geo.excursion?.approximate && overlays.excursion && !hideExits && (
          <div className="pointer-events-none absolute bottom-8 right-2 z-raised rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur" title="Внутри бара входа/выхода неизвестно, что было до/после филла: его экстремумы исключены">MFE/MAE ≈ приблизительно</div>
        )}
      </div>
      {/* Replay dock and training live UNDER the chart, so the chart never moves when they appear or change. */}
      {replayActive && cursorIdx != null && (
        <ReplayControls
          playing={playing} speed={speed} cursor={cursorIdx} start={startIdx} last={last} viewEnd={viewEnd} frontier={seekLimit} training={training}
          marks={marks} timeLabel={fmtBarTime(bars[cursorIdx].t)} startLabel={fmtBarTime(bars[startIdx].t)}
          hasEntry={geo.entryIdx != null} hasExit={geo.exitIdx != null && !hideExits} nextFillLabel={nextFill?.label ?? null}
          startPreset={prefs.start} canStartAtOpen={openIdx != null} pauseOnFills={prefs.pauseOnFills}
          position={livePosition} side={geo.side} event={event}
          onToggle={togglePlay} onStep={(d) => { setPlaying(false); step(d); }} onSpeed={setSpeed} onSeek={seek}
          onNextFill={jumpNextFill} onEntry={jumpEntry} onExit={jumpExit} onRestart={() => { setPlaying(false); goTo(startIdx); }}
          onStartPreset={chooseStart} onPauseOnFills={(v) => updatePrefs({ pauseOnFills: v })}
        />
      )}
      {training && cursorIdx != null && (
        <TrainingPanel result={trainingResult} canExit={inPosition && trainingResult == null} inPosition={inPosition} onExitHere={exitHere} onRestart={restartTraining} />
      )}
    </div>
  );
}

/** Push candles / volume / P&L data for a reveal limit (null = everything). Steps of +1 bar use `update` instead of `setData`. */
function applyReveal(r: ChartRefs, limit: number | null): void {
  const n = r.full.length;
  const target = limit == null ? n - 1 : Math.max(-1, Math.min(n - 1, limit));
  if (r.revealed === target) return;
  const prev = r.revealed;
  if (prev >= -1 && target === prev + 1) {
    r.candles.update(r.full[target], true);
    r.volume?.update(r.volFull[target], true);
    if (r.pnl) {
      const t = r.full[target].time;
      const p = r.pnlFull.find((x) => x.time === t);
      if (p) r.pnl.update(p);
    }
  } else {
    r.candles.setData(target >= n - 1 ? r.full : [...r.full.slice(0, target + 1), ...r.ws.slice(target + 1)]);
    r.volume?.setData(target >= n - 1 ? r.volFull : [...r.volFull.slice(0, target + 1), ...r.volWs.slice(target + 1)]);
    if (r.pnl) {
      const limitT = target >= 0 ? Number(r.full[target].time) : -Infinity;
      r.pnl.setData(target >= n - 1 ? r.pnlFull : r.pnlFull.filter((p) => Number(p.time) <= limitT));
    }
  }
  r.revealed = target;
}

/** Last point with idx <= i, or null (points sorted by idx). */
function bsearch<T extends { idx: number }>(pts: readonly T[], i: number): T | null {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m].idx <= i) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 && pts[ans].idx === i ? pts[ans] : ans >= 0 ? pts[ans] : null;
}
