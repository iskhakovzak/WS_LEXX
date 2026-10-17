import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type UTCTimestamp,
  type SeriesMarker,
  type SeriesMarkerBar,
  type SeriesMarkerBarPosition,
  type Time,
  type MouseEventParams,
  type CandlestickData,
  type WhitespaceData,
  type LineData,
  type HistogramData,
} from "lightweight-charts";
import { AlertTriangle, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Trade } from "@workspace/api-client-react";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Segmented, Pill, toneOf, toneText, Kbd } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { qualityKeys } from "@/lib/query-keys";
import { formatR } from "@/lib/trade-result";
import { addDays } from "@/lib/trading-date";
import { fmtMoney } from "@/components/trades/trade-utils";
import {
  type Candle, type Execution, type ExecutionKind, type ExecutionsResponse, type Resolved, type SessionLevels,
  ET_TIME_FMT, ET_DAY_FMT, ET_SESSION_LABEL, timeToDate, fmtEtDateTime, fmtEtTimeSec, fmtDuration, sessionOfEt, etInfo, isPreMarket, isAfterHours, toNum, ageDaysOf,
  computeSessionVwap, computeDayLevels, resolveExecutions, placeSimple, inferBarSeconds, readChartTheme, useThemeVersion, fmtPrice, fmtVol,
} from "@/components/trade-chart-parts/chart-utils";

type Interval = "1m" | "5m" | "15m" | "60m" | "1d";
const INTERVAL_LABEL: Record<Interval, string> = { "1m": "1м", "5m": "5м", "15m": "15м", "60m": "1ч", "1d": "1Д" };
const SPEEDS = [1, 2, 5, 10] as const;
type Speed = (typeof SPEEDS)[number];
type Zoom = "trade" | "day";
/** Bars of context shown on each side of the trade in «Сделка» zoom. */
const ZOOM_PAD_BARS = 15;
/** The replay starts this many bars before the first fill so the setup is visible. */
const START_BEFORE_BARS = 3;

const KIND_LABEL: Record<ExecutionKind, string> = { entry: "Вход", add: "Добор", trim: "Часть", exit: "Выход", stop: "Стоп" };

type RangeResponse = { ticker: string; from: string; to: string; interval: string; candles: Candle[]; prevClose: number | null };
type DayResponse = { ticker: string; date: string; interval: string; candles: Candle[]; prevClose: number | null; sessionLevels?: SessionLevels | null };

/** `at` is the exact fill instant (epoch s) when the execution carries a time; `t` is the containing bar. */
type Fill = { kind: ExecutionKind; price: number; qty: number | null; idx: number; t: number; at: number | null; label: string };

function fillLabel(kind: ExecutionKind, price: number, qty: number | null, at: number | null): string {
  return `${KIND_LABEL[kind]} ${fmtPrice(price)}${qty ? ` ×${qty}` : ""}${at != null ? ` · ${fmtEtTimeSec(at)}` : ""}`;
}

type PositionAt = { qty: number | null; avg: number | null; realised: number; unrealPerShare: number | null; unrealUsd: number | null; unrealR: number | null; fillsSoFar: number };

function styleFor(kind: ExecutionKind, isShort: boolean, th: ReturnType<typeof readChartTheme>): { color: string; shape: SeriesMarker<Time>["shape"]; position: SeriesMarkerBarPosition } {
  const opening = { shape: (isShort ? "arrowDown" : "arrowUp") as SeriesMarker<Time>["shape"], position: (isShort ? "aboveBar" : "belowBar") as SeriesMarkerBarPosition };
  const closing = { shape: (isShort ? "arrowUp" : "arrowDown") as SeriesMarker<Time>["shape"], position: (isShort ? "belowBar" : "aboveBar") as SeriesMarkerBarPosition };
  switch (kind) {
    case "entry": return { color: th.primary(), ...opening };
    case "add": return { color: th.c1(0.75), ...opening };
    case "trim": return { color: th.c3(), ...closing };
    case "exit": return { color: th.c5(), ...closing };
    default: return { color: th.down(), shape: "square", position: "inBar" };
  }
}

/** Position state after applying every fill with idx ≤ cursor. */
function positionAt(fills: Fill[], cursor: number, isShort: boolean, mark: number, risk: number | null, tradeQty: number | null): PositionAt {
  const dir = isShort ? -1 : 1;
  const anyNoQty = fills.some((f) => f.qty == null);
  let posQty = 0, posCost = 0, realised = 0, n = 0;
  for (const f of fills) {
    if (f.idx > cursor) break;
    n++;
    const u = anyNoQty ? 1 : (f.qty as number);
    if (f.kind === "entry" || f.kind === "add") { posCost += f.price * u; posQty += u; }
    else {
      const q = Math.min(u, posQty);
      if (q > 0) { const a = posCost / posQty; realised += dir * (f.price - a) * q; posCost -= a * q; posQty -= q; }
    }
  }
  const scale = anyNoQty ? (tradeQty != null && tradeQty > 0 ? tradeQty : null) : 1;
  const avg = posQty > 0 ? posCost / posQty : null;
  const unrealPerShare = avg != null ? dir * (mark - avg) : null;
  return {
    qty: posQty > 0 ? (anyNoQty ? (scale != null ? scale * posQty : null) : posQty) : 0,
    avg,
    realised: scale != null ? realised * scale : 0,
    unrealPerShare,
    unrealUsd: unrealPerShare != null && scale != null ? unrealPerShare * posQty * scale : null,
    unrealR: unrealPerShare != null && risk ? unrealPerShare / risk : null,
    fillsSoFar: n,
  };
}

type Props = {
  trade: Trade;
  target?: number | null;
  height?: number;
  className?: string;
};

export function ReplayChart({ trade, target, height = 380, className }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<{ candles: ISeriesApi<"Candlestick">; vwap: ISeriesApi<"Line"> | null; vol: ISeriesApi<"Histogram">; markers: ISeriesMarkersPluginApi<Time> } | null>(null);
  const themeVersion = useThemeVersion();

  const ticker = trade.ticker;
  const dateKey = (trade.date || "").slice(0, 10);
  const isShort = (trade.side || "").toLowerCase().includes("short");
  const multiDay = (trade.horizon === "overnight" || trade.horizon === "swing");
  const exitKey = trade.exitDate ? trade.exitDate.slice(0, 10) : null;
  const toKey = multiDay ? (exitKey && exitKey > dateKey ? exitKey : (trade.result === "open" ? "" : addDays(dateKey, trade.horizon === "swing" ? 5 : 1))) : dateKey;
  const spanDays = toKey ? (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${dateKey}T00:00:00Z`)) / 86400000 : 0;

  const age = ageDaysOf(dateKey);
  const allowed = React.useMemo<Interval[]>(() => {
    const out: Interval[] = [];
    if (spanDays <= 14) {
      if (age <= 7) out.push("1m");
      if (age <= 60) out.push("5m", "15m");
      if (age <= 730) out.push("60m");
    }
    out.push("1d");
    return out;
  }, [age, spanDays]);
  const autoInterval: Interval = allowed[0];
  const [interval, setInterval_] = React.useState<Interval>(autoInterval);
  React.useEffect(() => { setInterval_(autoInterval); }, [autoInterval, trade.id]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const barsQuery = useQuery<DayResponse | RangeResponse>({
    queryKey: qualityKeys.replay(trade.id, ticker, dateKey, toKey || "open", interval),
    queryFn: async () => {
      const url = multiDay || interval === "1d"
        ? `${BASE}/api/candles/${encodeURIComponent(ticker)}/range?from=${dateKey}&to=${toKey || dateKey}&interval=${interval}&extended=1`
        : `${BASE}/api/candles/${encodeURIComponent(ticker)}?date=${dateKey}&interval=${interval}&extended=1&levels=1`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const body: { error?: string; reason?: string } = await resp.json().catch(() => ({}));
        const err = new Error(body.error || `HTTP ${resp.status}`) as Error & { status?: number; reason?: string };
        err.status = resp.status; err.reason = body.reason;
        throw err;
      }
      return resp.json();
    },
    enabled: Boolean(ticker && dateKey),
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => (err as Error & { status?: number }).status !== 422 && (err as Error & { status?: number }).status !== 400 && (err as Error & { status?: number }).status !== 404 && count < 1,
  });
  const execsQuery = useQuery<ExecutionsResponse>({
    queryKey: ["trade-executions", trade.id],
    queryFn: async () => {
      const resp = await fetch(`${BASE}/api/trades/${trade.id}/executions`);
      if (!resp.ok) throw new Error("failed to load executions");
      return resp.json();
    },
    staleTime: 30 * 1000,
  });

  const bars = React.useMemo(() => {
    const raw = barsQuery.data?.candles ?? [];
    const upper = toKey || "9999-12-31";
    return raw.filter((c) => { const d = etInfo(c.t).dayKey; return d >= dateKey && d <= upper; });
  }, [barsQuery.data, dateKey, toKey]);
  const executions: Execution[] = React.useMemo(() => execsQuery.data?.executions ?? [], [execsQuery.data]);

  const geometry = React.useMemo(() => {
    const entry = toNum(trade.entry), exit = toNum(trade.exit), stop = toNum(trade.stop), tgt = toNum(target);
    const fills: Fill[] = [];
    const barSeconds = bars.length ? inferBarSeconds(bars) : 60;
    if (bars.length) {
      const resolved: Resolved[] = resolveExecutions(bars, executions);
      if (resolved.length) {
        for (const r of resolved) {
          const qty = r.exec.qty != null ? Number(r.exec.qty) : null;
          fills.push({ kind: r.exec.kind, price: r.price, qty, idx: r.idx, t: r.candle.t, at: r.at, label: fillLabel(r.exec.kind, r.price, qty, r.at) });
        }
      } else {
        const p = placeSimple(bars, dateKey, entry, exit);
        if (p.entryIdx != null && entry != null) fills.push({ kind: "entry", price: entry, qty: trade.qty ?? null, idx: p.entryIdx, t: bars[p.entryIdx].t, at: null, label: `Вход ${fmtPrice(entry)}` });
        if (p.exitIdx != null && exit != null) fills.push({ kind: "exit", price: exit, qty: trade.qty ?? null, idx: p.exitIdx, t: bars[p.exitIdx].t, at: null, label: `Выход ${fmtPrice(exit)}` });
      }
      fills.sort((a, b) => a.idx - b.idx || (a.at ?? 0) - (b.at ?? 0));
    }
    const openings = fills.filter((f) => f.kind === "entry" || f.kind === "add");
    const closings = fills.filter((f) => f.kind === "exit" || f.kind === "trim" || f.kind === "stop");
    const avgEntry = openings.length ? openings.reduce((s, f) => s + f.price * (f.qty ?? 1), 0) / openings.reduce((s, f) => s + (f.qty ?? 1), 0) : entry;
    const risk = avgEntry != null && stop != null && Math.abs(avgEntry - stop) > 1e-9 ? Math.abs(avgEntry - stop) : null;
    const local = computeDayLevels(bars, dateKey);
    const srv = (barsQuery.data as DayResponse | undefined)?.sessionLevels;
    const levels = { pmHigh: srv?.pmHigh ?? local.pmHigh, pmLow: srv?.pmLow ?? local.pmLow, open: srv?.open ?? local.open, prevClose: barsQuery.data?.prevClose ?? null };
    const vwap = interval === "1d" ? [] : computeSessionVwap(bars);
    const entryIdx = openings.length ? openings[0].idx : fills.length ? fills[0].idx : null;
    // The position closes on the LAST closing fill (not merely the last fill — a stop logged after the exit still closes it there).
    const exitIdx = closings.length ? closings[closings.length - 1].idx : null;
    const entryAt = openings.length && openings.every((f) => f.at != null) ? Math.min(...openings.map((f) => f.at as number)) : null;
    const exitAt = closings.length && closings.every((f) => f.at != null) ? Math.max(...closings.map((f) => f.at as number)) : null;
    const holdSeconds = entryAt != null && exitAt != null && exitAt >= entryAt ? exitAt - entryAt : entryIdx != null && exitIdx != null ? bars[exitIdx].t + barSeconds - bars[entryIdx].t : null;
    return { entry, exit, stop, tgt, fills, avgEntry, risk, levels, vwap, entryIdx, exitIdx, entryAt, exitAt, holdSeconds, barSeconds };
  }, [bars, executions, trade.entry, trade.exit, trade.stop, trade.qty, target, dateKey, interval, barsQuery.data]);

  // ── Replay state ─────────────────────────────────────────────────────────
  const last = Math.max(0, bars.length - 1);
  const [cursor, setCursor] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<Speed>(2);
  const [hover, setHover] = React.useState<{ bar: Candle; idx: number } | null>(null);
  const [zoom, setZoom] = React.useState<Zoom>("trade");
  const cursorRef = React.useRef(0);
  cursorRef.current = cursor;

  // Start a few bars before the entry so the context is visible.
  React.useEffect(() => {
    setPlaying(false);
    setCursor(geometry.entryIdx != null ? Math.max(0, geometry.entryIdx - START_BEFORE_BARS) : 0);
  }, [geometry.entryIdx, bars.length, trade.id, interval]);

  // Visible window: the trade with some context on each side, or the whole loaded range.
  const window_ = React.useMemo(() => {
    if (zoom === "day" || geometry.entryIdx == null || !bars.length) return { from: 0, to: last };
    const from = Math.max(0, geometry.entryIdx - ZOOM_PAD_BARS);
    const to = Math.min(last, (geometry.exitIdx ?? geometry.entryIdx) + ZOOM_PAD_BARS);
    return { from, to };
  }, [zoom, geometry.entryIdx, geometry.exitIdx, bars.length, last]);

  React.useEffect(() => {
    if (!playing) return;
    const perTick = speed >= 5 ? Math.ceil(speed / 2) : 1;
    const ms = speed >= 5 ? 180 : Math.round(500 / speed);
    const id = window.setInterval(() => {
      setCursor((c) => {
        const next = Math.min(last, c + perTick);
        if (next >= last) setPlaying(false);
        return next;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [playing, speed, last]);

  const jumpToFill = React.useCallback((dir: 1 | -1) => {
    const c = cursorRef.current;
    const f = dir > 0 ? geometry.fills.find((x) => x.idx > c) : [...geometry.fills].reverse().find((x) => x.idx < c);
    if (f) setCursor(f.idx);
    else setCursor(dir > 0 ? last : 0);
  }, [geometry.fills, last]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " ) { e.preventDefault(); setPlaying((p) => !p); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); setCursor((c) => Math.min(last, c + (e.shiftKey ? 10 : 1))); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); setCursor((c) => Math.max(0, c - (e.shiftKey ? 10 : 1))); }
    else if (e.key === "Home") { e.preventDefault(); setPlaying(false); setCursor(0); }
    else if (e.key === "End") { e.preventDefault(); setPlaying(false); setCursor(last); }
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); setPlaying(false); jumpToFill(1); }
    else if (e.key === "p" || e.key === "P") { e.preventDefault(); setPlaying(false); jumpToFill(-1); }
  };

  // ── Chart build (once per data set / theme) ──────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current || !bars.length) return;
    const th = readChartTheme();
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "transparent" }, textColor: th.muted(), fontFamily: th.font, fontSize: 11 },
      grid: { vertLines: { color: th.border(th.dark ? 0.45 : 0.6) }, horzLines: { color: th.border(th.dark ? 0.45 : 0.6) } },
      timeScale: {
        timeVisible: interval !== "1d",
        secondsVisible: false,
        borderColor: th.border(),
        tickMarkFormatter: (time: Time, tickMarkType: number) => {
          const d = timeToDate(time);
          if (!d) return "";
          return tickMarkType >= 3 ? ET_TIME_FMT.format(d) : ET_DAY_FMT.format(d);
        },
      },
      localization: { locale: "ru-RU", timeFormatter: (time: Time) => { const d = timeToDate(time); return d ? fmtEtDateTime(d) : String(time); }, priceFormatter: (p: number) => fmtPrice(p) },
      rightPriceScale: { borderColor: th.border() },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: th.muted(0.5), labelBackgroundColor: th.dark ? "rgba(40,42,46,1)" : "rgba(60,62,66,1)" },
        horzLine: { color: th.muted(0.5), labelBackgroundColor: th.dark ? "rgba(40,42,46,1)" : "rgba(60,62,66,1)" },
      },
      autoSize: true,
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    // Session shading over the full range (known in advance — it is the calendar, not price).
    if (interval !== "1d") {
      const bg = bars.map((c) => {
        const info = etInfo(c.t);
        const color = isPreMarket(info) ? th.c1(0.07) : isAfterHours(info) ? th.c3(0.07) : null;
        return color ? { time: c.t as UTCTimestamp, value: 1, color } : null;
      }).filter((x): x is { time: UTCTimestamp; value: number; color: string } => x !== null);
      if (bg.length) {
        const s = chart.addSeries(HistogramSeries, { priceScaleId: "session-bg", priceLineVisible: false, lastValueVisible: false, base: 0 });
        chart.priceScale("session-bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        s.setData(bg);
      }
    }

    // Holding period: a translucent band under the bars from the entry bar to the exit bar (through the end when open).
    if (geometry.entryIdx != null) {
      const holdTo = geometry.exitIdx ?? bars.length - 1;
      const hold = bars.slice(geometry.entryIdx, holdTo + 1).map((c) => ({ time: c.t as UTCTimestamp, value: 1, color: th.primary(0.09) }));
      if (hold.length) {
        const s = chart.addSeries(HistogramSeries, { priceScaleId: "hold-bg", priceLineVisible: false, lastValueVisible: false, base: 0 });
        chart.priceScale("hold-bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        s.setData(hold);
      }
    }

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

    // Fixed vertical range over the visible window (trade ± context, or the whole day): the picture stays stable
    // while bars are revealed one by one, and nothing after the cursor leaks through autoscale.
    let lo = Infinity, hi = -Infinity;
    for (let i = window_.from; i <= window_.to && i < bars.length; i++) { lo = Math.min(lo, bars[i].l); hi = Math.max(hi, bars[i].h); }
    for (const p of [geometry.avgEntry, geometry.exit]) if (p != null && Number.isFinite(p)) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    if (geometry.stop != null && Number.isFinite(hi - lo) && Math.abs(geometry.stop - (hi + lo) / 2) <= 1.5 * Math.max(hi - lo, 0.01)) { lo = Math.min(lo, geometry.stop); hi = Math.max(hi, geometry.stop); }
    const pad = Number.isFinite(hi - lo) ? Math.max((hi - lo) * 0.08, 0.01) : 0;
    const fixedRange = Number.isFinite(lo) && Number.isFinite(hi) ? { minValue: lo - pad, maxValue: hi + pad } : null;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: th.up(), downColor: th.down(), borderUpColor: th.up(), borderDownColor: th.down(), wickUpColor: th.up(0.8), wickDownColor: th.down(0.8), priceLineVisible: false,
      autoscaleInfoProvider: fixedRange ? () => ({ priceRange: fixedRange }) : undefined,
    });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    candles.setData(bars.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    chart.timeScale().setVisibleLogicalRange({ from: window_.from - 0.5, to: window_.to + 0.5 });

    let vwap: ISeriesApi<"Line"> | null = null;
    if (geometry.vwap.length) {
      vwap = chart.addSeries(LineSeries, { color: th.c5(0.9), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: "VWAP" });
    }

    const line = (price: number | null | undefined, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) => {
      if (price == null || !Number.isFinite(price) || price <= 0) return;
      candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title });
    };
    line(geometry.levels.prevClose, th.c3(0.9), "Пред. закр.", LineStyle.Dashed);
    line(geometry.levels.pmHigh, th.muted(0.8), "PMH", LineStyle.Dotted);
    line(geometry.levels.pmLow, th.muted(0.8), "PML", LineStyle.Dotted);
    line(geometry.stop, th.down(0.9), geometry.risk ? "Стоп −1R" : "Стоп", LineStyle.Dashed);
    if (geometry.avgEntry != null) line(geometry.avgEntry, th.primary(0.9), geometry.fills.filter((f) => f.kind !== "exit" && f.kind !== "trim" && f.kind !== "stop").length > 1 ? "Ср. вход" : "Вход", LineStyle.Solid);
    if (geometry.exit != null) line(geometry.exit, th.c5(0.9), `Выход${geometry.avgEntry != null ? ` ${isShort ? geometry.avgEntry - geometry.exit >= 0 ? "+" : "−" : geometry.exit - geometry.avgEntry >= 0 ? "+" : "−"}${Math.abs(geometry.exit - geometry.avgEntry).toFixed(2)}` : ""}`, LineStyle.Solid);
    if (geometry.tgt != null) line(geometry.tgt, th.up(0.95), "Цель", LineStyle.Solid);
    if (geometry.risk && geometry.avgEntry != null) {
      for (const k of [1, 2]) line(isShort ? geometry.avgEntry - k * geometry.risk : geometry.avgEntry + k * geometry.risk, th.up(0.5), `+${k}R`, LineStyle.SparseDotted);
    }

    const markers = createSeriesMarkers(candles, []);
    seriesRef.current = { candles, vwap, vol, markers };

    const byTime = new Map<number, number>(bars.map((c, i) => [c.t, i]));
    const onMove = (param: MouseEventParams) => {
      if (!param.time) { setHover(null); return; }
      const idx = byTime.get(Number(param.time));
      if (idx == null || idx > cursorRef.current) { setHover(null); return; }
      setHover({ bar: bars[idx], idx });
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setHover(null);
    };
  }, [bars, geometry, interval, isShort, themeVersion, window_]);

  // ── Progressive reveal: everything after the cursor becomes whitespace ───
  React.useEffect(() => {
    const s = seriesRef.current;
    if (!s || !bars.length) return;
    const th = readChartTheme();
    const c = Math.min(cursor, last);
    const candleData: (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = bars.map((b, i) => i <= c
      ? { time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c }
      : { time: b.t as UTCTimestamp });
    s.candles.setData(candleData);
    const volData: (HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = bars.map((b, i) => i <= c
      ? { time: b.t as UTCTimestamp, value: Number.isFinite(b.v) ? b.v : 0, color: b.c >= b.o ? th.up(0.3) : th.down(0.3) }
      : { time: b.t as UTCTimestamp });
    s.vol.setData(volData);
    if (s.vwap) {
      const limit = bars[c].t;
      const vd: LineData<UTCTimestamp>[] = geometry.vwap.filter((p) => Number(p.time) <= limit).map((p) => ({ time: p.time, value: p.value }));
      s.vwap.setData(vd);
    }
    const ms: SeriesMarkerBar<Time>[] = geometry.fills.filter((f) => f.idx <= c).map((f) => {
      const st = styleFor(f.kind, isShort, th);
      return { time: f.t as UTCTimestamp, position: st.position, shape: st.shape, color: st.color, text: f.label };
    });
    s.markers.setMarkers(ms);
  }, [cursor, bars, geometry, isShort, last, themeVersion]);

  // ── Readout ──────────────────────────────────────────────────────────────
  const shown = hover ?? (bars.length ? { bar: bars[Math.min(cursor, last)], idx: Math.min(cursor, last) } : null);
  const pos = React.useMemo(() => shown ? positionAt(geometry.fills, shown.idx, isShort, shown.bar.c, geometry.risk, trade.qty ?? null) : null, [shown, geometry.fills, geometry.risk, isShort, trade.qty]);
  const nextFill = geometry.fills.find((f) => f.idx > cursor);
  const fillsAtCursor = geometry.fills.filter((f) => f.idx === (shown?.idx ?? -1));
  // Where the shown bar sits relative to the trade: bars before the entry, time in position, or after the exit.
  const relation = React.useMemo(() => {
    if (!shown || geometry.entryIdx == null) return null;
    const { idx, bar } = shown;
    if (idx < geometry.entryIdx) {
      const n = geometry.entryIdx - idx;
      return { phase: "before" as const, text: `${n} ${n === 1 ? "бар" : n < 5 ? "бара" : "баров"} до входа` };
    }
    const exitIdx = geometry.exitIdx;
    if (exitIdx != null && idx > exitIdx) return { phase: "after" as const, text: "после выхода" };
    const barEnd = bar.t + geometry.barSeconds;
    const start = geometry.entryAt ?? bars[geometry.entryIdx].t;
    const end = exitIdx != null && idx === exitIdx && geometry.exitAt != null ? geometry.exitAt : barEnd;
    const elapsed = Math.max(0, end - start);
    return { phase: "in" as const, text: `в позиции ${fmtDuration(elapsed)}${geometry.holdSeconds != null && idx === exitIdx ? "" : geometry.holdSeconds != null ? ` из ${fmtDuration(geometry.holdSeconds)}` : ""}` };
  }, [shown, geometry, bars]);
  const shownSession = shown ? sessionOfEt(shown.bar.t) : null;

  if (barsQuery.isLoading) return <Skeleton className={cn("rounded-2xl", className)} style={{ height }} />;
  if (barsQuery.error || !bars.length) {
    const err = barsQuery.error as (Error & { reason?: string; status?: number }) | null;
    const text = err?.reason === "weekend" ? `${dateKey} — выходной, биржа закрыта`
      : err?.reason === "future" ? `${dateKey} ещё не наступило`
      : err?.status === 404 && (multiDay || interval === "1d") && err.message?.startsWith("Cannot") ? "Эндпоинт /candles/:ticker/range ещё не подключён на сервере."
      : err ? `Не удалось загрузить свечи: ${err.message}` : `Нет свечей за ${dateKey}`;
    return (
      <div className={cn("flex items-center gap-2 rounded-2xl bg-[var(--glass-bg)] px-4 py-6 text-sm text-muted-foreground", className)}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--chart-3))]" aria-hidden="true" /> {text}
      </div>
    );
  }

  const barTime = shown ? fmtEtDateTime(new Date(shown.bar.t * 1000)) : "";
  const progress = last ? cursor / last : 0;

  return (
    <div className={cn("space-y-2 outline-none", className)} tabIndex={0} onKeyDown={onKey} aria-label="Реплей сделки: пробел — плей/пауза, стрелки — шаг по барам, N/P — следующее/предыдущее исполнение">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="В начало (Home)" onClick={() => { setPlaying(false); setCursor(0); }}><ChevronFirst className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Предыдущее исполнение (P)" onClick={() => { setPlaying(false); jumpToFill(-1); }}><SkipBack className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Бар назад (←)" onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)); }}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant={playing ? "secondary" : "default"} size="icon" className="h-8 w-8" aria-label={playing ? "Пауза (пробел)" : "Плей (пробел)"} onClick={() => setPlaying((p) => !p)} disabled={cursor >= last && !playing}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Бар вперёд (→)" onClick={() => { setPlaying(false); setCursor((c) => Math.min(last, c + 1)); }}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Следующее исполнение (N)" title={nextFill ? `→ ${nextFill.label}` : "Исполнений впереди нет"} onClick={() => { setPlaying(false); jumpToFill(1); }}><SkipForward className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="В конец (End)" onClick={() => { setPlaying(false); setCursor(last); }}><ChevronLast className="h-4 w-4" /></Button>
        </div>
        <Segmented size="sm" ariaLabel="Скорость" value={String(speed)} onChange={(v) => setSpeed(Number(v) as Speed)} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
        <Segmented size="sm" ariaLabel="Таймфрейм" value={interval} onChange={(v) => setInterval_(v as Interval)} options={allowed.map((k) => ({ value: k, label: INTERVAL_LABEL[k] }))} />
        {geometry.entryIdx != null && (
          <Segmented size="sm" ariaLabel="Масштаб" value={zoom} onChange={(v) => setZoom(v as Zoom)} options={[{ value: "trade", label: "Сделка" }, { value: "day", label: multiDay ? "Всё" : "День" }]} />
        )}
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground" title={`Бар ${Math.min(cursor, last) + 1} из ${bars.length} загруженных`}>
          {bars.length ? `${ET_TIME_FMT.format(new Date(bars[Math.min(cursor, last)].t * 1000))} ET` : ""}
          {relation && !hover ? ` · ${relation.text}` : ""}
          {barsQuery.isFetching && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" aria-hidden="true" />}
        </span>
      </div>

      {/* Scrubber */}
      <div className="relative">
        <input
          type="range" min={0} max={last} value={Math.min(cursor, last)} aria-label="Позиция реплея"
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--glass-bg)] accent-[hsl(var(--primary))]"
          style={{ backgroundImage: `linear-gradient(to right, hsl(var(--primary)) ${progress * 100}%, transparent ${progress * 100}%)` }}
        />
        {geometry.fills.map((f, i) => (
          <span
            key={i}
            className={cn("pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full", f.kind === "entry" || f.kind === "add" ? "bg-primary" : f.kind === "stop" ? "bg-down" : "bg-[hsl(var(--chart-5))]")}
            style={{ left: `${last ? (f.idx / last) * 100 : 0}%` }}
            title={f.label}
          />
        ))}
      </div>

      {/* Chart */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-[var(--glass-bg)]" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0 isolate" />
        {shown && (
          <div className="pointer-events-none absolute left-2 top-2 z-raised flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-background/80 px-2.5 py-1.5 text-2xs tabular-nums backdrop-blur">
            <span className="font-medium text-foreground">{barTime}</span>
            <span>O <b>{fmtPrice(shown.bar.o)}</b></span>
            <span>H <b>{fmtPrice(shown.bar.h)}</b></span>
            <span>L <b>{fmtPrice(shown.bar.l)}</b></span>
            <span>C <b className={toneText(toneOf(shown.bar.c - shown.bar.o))}>{fmtPrice(shown.bar.c)}</b></span>
            <span>V <b>{fmtVol(shown.bar.v)}</b></span>
            {shownSession && shownSession !== "regular" && <span className="text-muted-foreground">{ET_SESSION_LABEL[shownSession]}</span>}
            {hover && <span className="text-muted-foreground">(под курсором)</span>}
          </div>
        )}
      </div>

      {/* Position readout at the cursor */}
      {pos && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-[var(--glass-bg)] px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">На этом баре:</span>
          {pos.avg != null ? (
            <>
              {relation?.phase === "in" && <span className="text-muted-foreground">{relation.text}</span>}
              <span>поз. <b className="tabular-nums">{pos.qty != null ? `${pos.qty.toLocaleString("en-US")} шт.` : "откр."}</b></span>
              <span>ср. вход <b className="tabular-nums">{fmtPrice(pos.avg)}</b></span>
              <span>нереализ. <b className={cn("tabular-nums", toneText(toneOf(pos.unrealPerShare)))}>{pos.unrealUsd != null ? fmtMoney(pos.unrealUsd) : `${(pos.unrealPerShare ?? 0) >= 0 ? "+" : "−"}$${Math.abs(pos.unrealPerShare ?? 0).toFixed(2)}/акц.`}{pos.unrealR != null ? ` · ${formatR(pos.unrealR)}` : ""}</b></span>
            </>
          ) : pos.fillsSoFar === 0 ? (
            <span className="text-muted-foreground">{relation?.phase === "before" ? relation.text : "до входа"}{nextFill ? ` · следующий: ${nextFill.label}` : ""}</span>
          ) : (
            <span>позиция закрыта{geometry.holdSeconds != null ? ` · держали ${fmtDuration(geometry.holdSeconds)}` : ""} · реализовано <b className={cn("tabular-nums", toneText(toneOf(pos.realised)))}>{fmtMoney(pos.realised)}</b></span>
          )}
          {fillsAtCursor.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              {fillsAtCursor.map((f, i) => <Pill key={i} tone={f.kind === "entry" || f.kind === "add" ? "accent" : f.kind === "stop" ? "down" : "purple"} className="px-1.5 text-2xs">{f.label}</Pill>)}
            </span>
          )}
          <span className="ml-auto hidden items-center gap-1 text-2xs text-muted-foreground lg:inline-flex">
            <Kbd>Space</Kbd> плей · <Kbd>←</Kbd><Kbd>→</Kbd> бар · <Kbd>N</Kbd>/<Kbd>P</Kbd> исполнение
          </span>
        </div>
      )}
    </div>
  );
}
