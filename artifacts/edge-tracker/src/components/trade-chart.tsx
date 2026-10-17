import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
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
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
  type MouseEventParams,
} from "lightweight-charts";
import {
  Loader2, AlertTriangle, CalendarX, Clock, CandlestickChart, Maximize2, ChevronsUpDown, RotateCw,
  type LucideIcon,
} from "lucide-react";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Segmented, FilterChip, Pill, toneOf, toneText, type Tone } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { formatR } from "@/lib/trade-result";
import {
  type Candle, type CandlesResponse, type Execution, type ExecutionKind, type ExecutionsResponse, type Resolved, type ChartPrefs,
  ET_TIME_FMT, ET_DAY_FMT, timeToDate, fmtEtDateTime, fmtEtDateTimeSec, fmtEtTimeSec, fmtDuration, sessionOfEt, ET_SESSION_LABEL, etInfo, isPreMarket, isAfterHours, toNum, ageDaysOf,
  computeSessionVwap, computeDayLevels, resolveExecutions, placeSimple, computeExcursion,
  readChartTheme, useThemeVersion, loadPrefs, savePrefs, fmtPrice, fmtVol,
} from "@/components/trade-chart-parts/chart-utils";

type TradeChartProps = {
  tradeId?: number | null;
  ticker: string;
  date: string;
  side?: string | null;
  entry?: number | string | null;
  exit?: number | string | null;
  stop?: number | string | null;
  /** Optional profit target — drawn as «Цель» line. */
  target?: number | string | null;
  /** Optional logged R-multiple; used when R can't be derived from prices. */
  rMultiple?: number | string | null;
  /** Optional base chart height in px (default 360). */
  height?: number;
  className?: string;
};

type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";

const TIMEFRAMES: { key: Interval; label: string; maxAgeDays: number }[] = [
  { key: "1m", label: "1м", maxAgeDays: 7 },
  { key: "5m", label: "5м", maxAgeDays: 60 },
  { key: "15m", label: "15м", maxAgeDays: 60 },
  { key: "30m", label: "30м", maxAgeDays: 60 },
  { key: "60m", label: "1ч", maxAgeDays: 730 },
  { key: "1d", label: "1Д", maxAgeDays: Infinity },
];
const INTERVAL_LABEL: Record<string, string> = { "1m": "1м", "5m": "5м", "15m": "15м", "30m": "30м", "60m": "1ч", "1d": "1Д" };

const KIND_LABEL: Record<ExecutionKind, string> = {
  entry: "Вход",
  add: "Добор",
  trim: "Часть",
  exit: "Выход",
  stop: "Стоп",
};

type Shape = "arrowUp" | "arrowDown" | "square" | "circle";
type BarPos = "aboveBar" | "belowBar" | "inBar";

type ExecStyle = { color: string; shape: Shape; position: BarPos };

function styleFor(kind: ExecutionKind, isShort: boolean, th: ReturnType<typeof readChartTheme>): ExecStyle {
  const opening = { shape: (isShort ? "arrowDown" : "arrowUp") as Shape, position: (isShort ? "aboveBar" : "belowBar") as BarPos };
  const closing = { shape: (isShort ? "arrowUp" : "arrowDown") as Shape, position: (isShort ? "belowBar" : "aboveBar") as BarPos };
  switch (kind) {
    case "entry": return { color: th.primary(), ...opening };
    case "add": return { color: th.c1(0.75), ...opening };
    case "trim": return { color: th.c3(), ...closing };
    case "exit": return { color: th.c5(), ...closing };
    case "stop": return { color: th.down(), shape: "square", position: "inBar" };
  }
}

const KIND_DOT: Record<ExecutionKind, string> = {
  entry: "bg-primary",
  add: "bg-[hsl(var(--chart-1)/0.75)]",
  trim: "bg-[hsl(var(--chart-3))]",
  exit: "bg-[hsl(var(--chart-5))]",
  stop: "bg-down",
};

type TooltipState = { x: number; y: number; rows: Resolved[] } | null;

function avgPrice(rows: Execution[]): number | null {
  if (!rows.length) return null;
  let pq = 0, q = 0, allQty = true;
  for (const r of rows) {
    const p = Number(r.price);
    const n = r.qty != null ? Number(r.qty) : NaN;
    if (Number.isFinite(n) && Number.isFinite(p)) { pq += p * n; q += n; } else allQty = false;
  }
  if (allQty && q > 0) return pq / q;
  const ps = rows.map((r) => Number(r.price)).filter(Number.isFinite);
  return ps.length ? ps.reduce((s, p) => s + p, 0) / ps.length : null;
}

function errorInfo(err: Error & { reason?: string; status?: number }, date: string): { icon: LucideIcon; text: string; retry: boolean } {
  if (err.message === "non_trading_day" && err.reason === "weekend") return { icon: CalendarX, text: `${date} — выходной, биржа закрыта`, retry: false };
  if (err.message === "non_trading_day" && err.reason === "future") return { icon: Clock, text: `${date} ещё не наступило — данных пока нет`, retry: false };
  if (err.message === "no candles available") return { icon: AlertTriangle, text: `Нет свечей за ${date}: праздник, новый листинг или сбой Yahoo`, retry: true };
  if (err.message === "invalid date (expected calendar YYYY-MM-DD)" || err.message === "invalid ticker") return { icon: AlertTriangle, text: `Некорректные данные сделки: ${err.message}`, retry: false };
  return { icon: AlertTriangle, text: `Не удалось загрузить свечи: ${err.message}`, retry: true };
}

function MiniStat({ label, value, tone = "neutral", hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--glass-bg)] px-3 py-2">
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm font-semibold tabular-nums", toneText(tone))}>{value}</div>
      {hint && <div className="truncate text-2xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function TradeChart({ tradeId, ticker, date, side, entry, exit, stop, target, rMultiple, height = 360, className }: TradeChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const resolvedByTimeRef = useRef(new Map<number, Resolved[]>());
  const candleByTimeRef = useRef(new Map<number, Candle>());
  const themeVersion = useThemeVersion();

  const dateKey = (date || "").slice(0, 10);
  const trAge = ageDaysOf(dateKey);
  const autoInterval: Interval = trAge <= 7 ? "1m" : trAge <= 60 ? "5m" : trAge <= 730 ? "60m" : "1d";

  const [interval, setIntervalState] = useState<Interval>(autoInterval);
  const [prefs, setPrefs] = useState<ChartPrefs>(() => loadPrefs());
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => { setIntervalState(autoInterval); }, [autoInterval]);

  const updatePrefs = useCallback((patch: Partial<ChartPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  // Yahoo age limits per interval also cap how many context days we can request.
  const maxDaysBack = useMemo(() => {
    const cap = interval === "1m" ? 7 : interval === "5m" || interval === "15m" || interval === "30m" ? 60 : interval === "60m" ? 730 : 3650;
    return Math.max(0, Math.floor(cap - trAge - 1));
  }, [interval, trAge]);
  const effectiveDaysBack = Math.min(prefs.daysBack, maxDaysBack);

  const executionsQuery = useQuery<ExecutionsResponse>({
    queryKey: ["trade-executions", tradeId],
    queryFn: async () => {
      const resp = await fetch(`${BASE}/api/trades/${tradeId}/executions`);
      if (!resp.ok) throw new Error("failed to load executions");
      return resp.json();
    },
    enabled: Boolean(tradeId),
    staleTime: 30 * 1000,
  });
  const allExecutions = useMemo(() => executionsQuery.data?.executions ?? [], [executionsQuery.data]);
  // A 09:28 entry or a 16:04 exit lives outside regular hours: without extended bars the fill would be pinned to
  // the nearest regular bar (wrong time, wrong candle), so extended hours switch on whenever a fill needs them.
  const needExtended = useMemo(() => allExecutions.some((e) => { const s = e.executedAt ? sessionOfEt(e.executedAt) : null; return s === "premarket" || s === "postmarket"; }), [allExecutions]);
  const extended = prefs.extended || needExtended;

  const candlesQuery = useQuery<CandlesResponse>({
    queryKey: ["trade-candles", ticker, dateKey, extended, interval, effectiveDaysBack],
    queryFn: async () => {
      const url = `${BASE}/api/candles/${encodeURIComponent(ticker)}?date=${encodeURIComponent(dateKey)}&interval=${interval}${extended ? "&extended=1" : ""}${effectiveDaysBack > 0 ? `&daysBack=${effectiveDaysBack}` : ""}&levels=1`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const body: { error?: string; reason?: string } = await resp.json().catch(() => ({}));
        const err = new Error(body.error || `HTTP ${resp.status}`) as Error & { reason?: string; status?: number };
        err.reason = body.reason;
        err.status = resp.status;
        throw err;
      }
      return resp.json();
    },
    enabled: Boolean(ticker && dateKey),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: (count, err) => {
      const e = err as Error & { status?: number };
      if (e.status === 422 || e.status === 400) return false;
      return count < 1;
    },
  });

  const data = candlesQuery.data;
  // Defensive: Yahoo may append the live bar of *today* to historical data — keep trade-day and earlier bars only.
  const candles = useMemo(() => (data?.candles ?? []).filter((c) => etInfo(c.t).dayKey <= dateKey), [data, dateKey]);
  const isLoading = candlesQuery.isLoading;
  const isFetching = candlesQuery.isFetching;
  const error = candlesQuery.error;
  const isShort = (side || "").toLowerCase().includes("short");

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const addCount = useMemo(() => allExecutions.filter((e) => e.kind === "add").length, [allExecutions]);

  // ── Trade geometry: placement, averages, R, excursion ────────────────────
  const trade = useMemo(() => {
    const entryNum = toNum(entry);
    const exitNum = toNum(exit);
    const stopNum = toNum(stop);
    const targetNum = toNum(target);
    const resolved = resolveExecutions(candles, allExecutions);
    const openings = allExecutions.filter((e) => e.kind === "entry" || e.kind === "add");
    const closings = allExecutions.filter((e) => e.kind === "exit" || e.kind === "trim" || e.kind === "stop");
    const avgEntry = avgPrice(openings);
    const avgExit = avgPrice(closings);
    const effEntry = avgEntry ?? entryNum;
    const effExit = avgExit ?? exitNum;

    let entryIdx: number | null = null;
    let exitIdx: number | null = null;
    let entryAt: number | null = null;
    let exitAt: number | null = null;
    if (resolved.length) {
      const opens = resolved.filter((r) => r.exec.kind === "entry" || r.exec.kind === "add");
      const closes = resolved.filter((r) => r.exec.kind === "exit" || r.exec.kind === "trim" || r.exec.kind === "stop");
      entryIdx = opens.length ? Math.min(...opens.map((r) => r.idx)) : null;
      exitIdx = closes.length ? Math.max(...closes.map((r) => r.idx)) : null;
      const openAts = opens.map((r) => r.at).filter((x): x is number => x != null);
      const closeAts = closes.map((r) => r.at).filter((x): x is number => x != null);
      entryAt = openAts.length === opens.length && openAts.length ? Math.min(...openAts) : null;
      exitAt = closeAts.length === closes.length && closeAts.length ? Math.max(...closeAts) : null;
    } else {
      const p = placeSimple(candles, dateKey, entryNum, exitNum);
      entryIdx = p.entryIdx;
      exitIdx = p.exitIdx;
    }

    const risk = effEntry != null && stopNum != null && stopNum > 0 && Math.abs(effEntry - stopNum) > 1e-9 ? Math.abs(effEntry - stopNum) : null;
    const move = effEntry != null && effExit != null ? (isShort ? effEntry - effExit : effExit - effEntry) : null;
    const loggedR = toNum(rMultiple);
    const realizedR = risk != null && move != null ? move / risk : loggedR;
    // Fill instants cut the entry/exit bars down to the known path (open → fills → close), so the low that
    // printed before the entry fill no longer counts as MAE.
    const excursion = entryIdx != null && effEntry != null && candles.length
      ? computeExcursion(candles, entryIdx, exitIdx, effEntry, effExit, isShort, dateKey, { entryAt, exitAt })
      : null;
    const holdSeconds = entryAt != null && exitAt != null && exitAt >= entryAt ? exitAt - entryAt : null;
    const timed = entryAt != null && (exitIdx == null || exitAt != null);

    return { entryNum, exitNum, stopNum, targetNum, resolved, avgEntry, avgExit, effEntry, effExit, entryIdx, exitIdx, entryAt, exitAt, holdSeconds, timed, risk, move, realizedR, excursion, openings: openings.length, closings: closings.length };
  }, [candles, allExecutions, entry, exit, stop, target, rMultiple, isShort, dateKey]);

  const levels = useMemo(() => {
    const local = computeDayLevels(candles, dateKey);
    const srv = data?.sessionLevels;
    return {
      open: srv?.open ?? local.open,
      high: srv?.high ?? local.high,
      low: srv?.low ?? local.low,
      pmHigh: srv?.pmHigh ?? local.pmHigh,
      pmLow: srv?.pmLow ?? local.pmLow,
      prevClose: data?.prevClose ?? null,
    };
  }, [candles, dateKey, data]);

  // ── Chart build ──────────────────────────────────────────────────────────
  const chartHeight = prefs.tall ? Math.round(height * 1.5) : height;

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;
    const th = readChartTheme();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: th.muted(),
        fontFamily: th.font,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: th.border(th.dark ? 0.45 : 0.6) },
        horzLines: { color: th.border(th.dark ? 0.45 : 0.6) },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: th.border(),
        tickMarkFormatter: (time: Time, tickMarkType: number) => {
          const d = timeToDate(time);
          if (!d) return "";
          return tickMarkType >= 3 ? ET_TIME_FMT.format(d) : ET_DAY_FMT.format(d);
        },
      },
      localization: {
        locale: "ru-RU",
        timeFormatter: (time: Time) => {
          const d = timeToDate(time);
          return d ? fmtEtDateTime(d) : String(time);
        },
        priceFormatter: (p: number) => fmtPrice(p),
      },
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

    // Session shading (pre/after hours)
    const bg = candles
      .map((c) => {
        const info = etInfo(c.t);
        const color = isPreMarket(info) ? th.c1(0.07) : isAfterHours(info) ? th.c3(0.07) : null;
        return color ? { time: c.t as UTCTimestamp, value: 1, color } : null;
      })
      .filter((x): x is { time: UTCTimestamp; value: number; color: string } => x !== null);
    if (bg.length) {
      const s = chart.addSeries(HistogramSeries, { priceScaleId: "session-bg", priceLineVisible: false, lastValueVisible: false, base: 0 });
      chart.priceScale("session-bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      s.setData(bg);
    }

    // Volume
    if (prefs.volume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      vol.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, value: Number.isFinite(c.v) ? c.v : 0, color: c.c >= c.o ? th.up(0.3) : th.down(0.3) })));
    }

    const series = chart.addSeries(CandlestickSeries, {
      upColor: th.up(),
      downColor: th.down(),
      borderUpColor: th.up(),
      borderDownColor: th.down(),
      wickUpColor: th.up(0.8),
      wickDownColor: th.down(0.8),
      priceLineVisible: false,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: prefs.volume ? 0.22 : 0.08 } });
    series.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    candleByTimeRef.current = new Map(candles.map((c) => [c.t, c]));

    if (prefs.vwap) {
      const vwap = computeSessionVwap(candles);
      if (vwap.length) {
        const v = chart.addSeries(LineSeries, {
          color: th.c5(0.9),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: "VWAP",
        });
        v.setData(vwap);
      }
    }

    const line = (price: number | null | undefined, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) => {
      if (price == null || !Number.isFinite(price) || price <= 0) return;
      series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title });
    };

    if (prefs.levels) {
      line(levels.open, th.c1(0.85), "Откр.", LineStyle.Dashed);
      line(levels.prevClose, th.c3(0.9), "Пред. закр.", LineStyle.Dashed);
      line(levels.pmHigh, th.muted(0.8), "PMH", LineStyle.Dotted);
      line(levels.pmLow, th.muted(0.8), "PML", LineStyle.Dotted);
    }

    // Stop is always shown (risk anchor); R ladder + entry/target are optional.
    line(trade.stopNum, th.down(0.9), trade.risk ? "Стоп −1R" : "Стоп", LineStyle.Dashed);
    if (prefs.rLevels && trade.effEntry != null) {
      line(trade.effEntry, th.primary(0.9), trade.avgEntry != null && trade.openings > 1 ? "Ср. вход" : "Вход", LineStyle.Solid);
      if (trade.risk) {
        for (const k of [1, 2, 3]) {
          const p = isShort ? trade.effEntry - k * trade.risk : trade.effEntry + k * trade.risk;
          line(p, th.up(0.55), `+${k}R`, LineStyle.SparseDotted);
        }
      }
    }
    if (trade.targetNum != null) line(trade.targetNum, th.up(0.95), "Цель", LineStyle.Solid);

    // Markers
    const markers: SeriesMarker<Time>[] = [];
    const byTime = new Map<number, Resolved[]>();
    if (trade.resolved.length) {
      const visible = trade.resolved.filter((r) => prefs.adds || r.exec.kind !== "add");
      const totals: Record<ExecutionKind, number> = { entry: 0, add: 0, trim: 0, exit: 0, stop: 0 };
      const counters: Record<ExecutionKind, number> = { entry: 0, add: 0, trim: 0, exit: 0, stop: 0 };
      for (const r of visible) totals[r.exec.kind]++;
      for (const r of visible) {
        const st = styleFor(r.exec.kind, isShort, th);
        counters[r.exec.kind]++;
        const n = totals[r.exec.kind] > 1 ? ` ${counters[r.exec.kind]}` : "";
        const q = r.exec.qty ? ` ×${Number(r.exec.qty)}` : "";
        markers.push({ time: r.candle.t as UTCTimestamp, position: st.position, color: st.color, shape: st.shape, text: `${KIND_LABEL[r.exec.kind]}${n} ${fmtPrice(r.price)}${q}` });
        const list = byTime.get(r.candle.t) ?? [];
        list.push(r);
        byTime.set(r.candle.t, list);
      }
    } else {
      if (trade.entryIdx != null && trade.entryNum != null) {
        const st = styleFor("entry", isShort, th);
        markers.push({ time: candles[trade.entryIdx].t as UTCTimestamp, position: st.position, color: st.color, shape: st.shape, text: `Вход ${fmtPrice(trade.entryNum)}` });
      }
      if (trade.exitIdx != null && trade.exitNum != null) {
        const st = styleFor("exit", isShort, th);
        const r = trade.realizedR != null && trade.risk ? ` ${formatR(trade.realizedR)}` : "";
        markers.push({ time: candles[trade.exitIdx].t as UTCTimestamp, position: st.position, color: st.color, shape: st.shape, text: `Выход ${fmtPrice(trade.exitNum)}${r}` });
      }
    }
    resolvedByTimeRef.current = byTime;
    if (markers.length) {
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      createSeriesMarkers(series, markers);
    }

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setTooltip(null);
        setHover(null);
        return;
      }
      const t = Number(param.time);
      setHover(candleByTimeRef.current.get(t) ?? null);
      const rows = resolvedByTimeRef.current.get(t);
      setTooltip(rows && rows.length ? { x: param.point.x, y: param.point.y, rows } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      setTooltip(null);
      setHover(null);
    };
  }, [candles, trade, levels, isShort, prefs.vwap, prefs.levels, prefs.rLevels, prefs.volume, prefs.adds, themeVersion]);

  // ── Derived display ──────────────────────────────────────────────────────
  const legendCandle = hover ?? candles[candles.length - 1] ?? null;
  const legendPrev = useMemo(() => {
    if (!legendCandle) return null;
    const i = candles.findIndex((c) => c.t === legendCandle.t);
    return i > 0 ? candles[i - 1].c : legendCandle.o;
  }, [legendCandle, candles]);
  const legendChg = legendCandle && legendPrev ? ((legendCandle.c - legendPrev) / legendPrev) * 100 : null;

  const r = trade.risk;
  const exc = trade.excursion;
  const inR = (v: number | null | undefined, sign: 1 | -1 = 1) => (v == null ? null : r ? formatR((sign * v) / r) : `${sign > 0 ? "+" : "−"}$${fmtPrice(Math.abs(v))}`);
  const gapPct = levels.open != null && levels.prevClose ? ((levels.open - levels.prevClose) / levels.prevClose) * 100 : null;
  const leftOnTable = exc?.afterExit != null && r ? exc.afterExit / r : null;

  const stats: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }[] = [];
  if (trade.effEntry != null) stats.push({ label: trade.openings > 1 ? `Ср. вход · ${trade.openings}` : "Вход", value: fmtPrice(trade.effEntry), hint: isShort ? "Шорт" : "Лонг" });
  if (trade.effExit != null) stats.push({ label: trade.closings > 1 ? `Ср. выход · ${trade.closings}` : "Выход", value: fmtPrice(trade.effExit), hint: trade.move != null && trade.effEntry ? `${trade.move >= 0 ? "+" : "−"}${Math.abs((trade.move / trade.effEntry) * 100).toFixed(2)}%` : undefined });
  if (r != null && trade.effEntry) stats.push({ label: "Риск на акцию", value: `$${fmtPrice(r)}`, hint: `${((r / trade.effEntry) * 100).toFixed(2)}% · стоп ${fmtPrice(trade.stopNum)}` });
  if (trade.realizedR != null) {
    const logged = toNum(rMultiple);
    const hint = !r ? "из журнала" : logged != null && Math.abs(logged - trade.realizedR) >= 0.1 ? `в журнале ${formatR(logged)}` : "по ценам сделки";
    stats.push({ label: "Результат", value: formatR(trade.realizedR), tone: toneOf(trade.realizedR), hint });
  }
  if (trade.entryAt != null) {
    const entrySession = sessionOfEt(trade.entryAt);
    const exitSession = trade.exitAt != null ? sessionOfEt(trade.exitAt) : null;
    const sessionNote = exitSession && exitSession !== entrySession
      ? `${entrySession ? ET_SESSION_LABEL[entrySession] : ""} → ${ET_SESSION_LABEL[exitSession]}`
      : entrySession ? ET_SESSION_LABEL[entrySession] : undefined;
    stats.push({
      label: "Удержание",
      value: trade.holdSeconds != null ? fmtDuration(trade.holdSeconds) : "открыта",
      hint: `${fmtEtTimeSec(trade.entryAt)}${trade.exitAt != null ? ` → ${fmtEtTimeSec(trade.exitAt)}` : ""} ET${sessionNote ? ` · ${sessionNote}` : ""}`,
    });
  }
  if (exc) {
    const pathHint = trade.timed ? "по пути вход → выход, бары входа/выхода частично" : "по полным свечам";
    stats.push({ label: "MFE · макс. в плюс", value: inR(exc.mfe, 1), tone: exc.mfe > 0 ? "up" : "neutral", hint: pathHint });
    stats.push({ label: "MAE · макс. против", value: inR(exc.mae, -1), tone: exc.mae > 0 ? "down" : "neutral", hint: pathHint });
    if (exc.afterExit != null) {
      stats.push({
        label: "После выхода",
        value: inR(exc.afterExit, 1),
        tone: exc.afterExit > 0 ? "warn" : "neutral",
        hint: leftOnTable != null && leftOnTable >= 1 ? "Ранний выход?" : "до конца дня",
      });
    }
  }
  if (gapPct != null) stats.push({ label: "Гэп на открытии", value: `${gapPct >= 0 ? "+" : "−"}${Math.abs(gapPct).toFixed(2)}%`, tone: toneOf(gapPct), hint: `пред. закр. ${fmtPrice(levels.prevClose)}` });
  if (levels.pmHigh != null && levels.pmLow != null) stats.push({ label: "Премаркет", value: `${fmtPrice(levels.pmLow)}–${fmtPrice(levels.pmHigh)}`, hint: "PML–PMH" });
  else if (levels.high != null && levels.low != null) stats.push({ label: "Диапазон дня", value: `${fmtPrice(levels.low)}–${fmtPrice(levels.high)}` });

  const tfOptions = TIMEFRAMES.map((tf) => ({ value: tf.key, label: tf.label, disabled: trAge > tf.maxAgeDays }));
  const ctxOptions = [0, 1, 2, 3, 5].map((n) => ({ value: String(n), label: n === 0 ? "День" : `+${n}д`, disabled: n > maxDaysBack }));
  const kindsPresent = Array.from(new Set(allExecutions.map((e) => e.kind))).filter((k) => prefs.adds || k !== "add");

  return (
    <section className={cn("glass-panel overflow-hidden rounded-2xl", className)} aria-label={`График ${ticker} за ${dateKey}`}>
      {/* Header */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CandlestickChart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">{ticker}</h3>
            <span className="text-xs tabular-nums text-muted-foreground">{dateKey}</span>
            <Pill tone={isShort ? "down" : "up"}>{isShort ? "Шорт" : "Лонг"}</Pill>
            {data?.interval && data.interval !== interval && (
              <Pill tone="warn">ТФ {INTERVAL_LABEL[data.interval] ?? data.interval}</Pill>
            )}
            {allExecutions.length > 0 && <Pill tone="accent">{allExecutions.length} исполн.</Pill>}
            {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Обновление" />}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => chartRef.current?.timeScale().fitContent()}
              aria-label="Показать весь день"
              title="Показать весь день"
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => updatePrefs({ tall: !prefs.tall })}
              aria-pressed={prefs.tall}
              aria-label={prefs.tall ? "Уменьшить высоту графика" : "Увеличить высоту графика"}
              title={prefs.tall ? "Компактнее" : "Выше"}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-primary"
            >
              <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" ariaLabel="Таймфрейм" options={tfOptions} value={interval} onChange={(v) => setIntervalState(v)} />
          <Segmented
            size="sm"
            ariaLabel="Дней контекста до сделки"
            options={ctxOptions}
            value={String(Math.min(prefs.daysBack, maxDaysBack))}
            onChange={(v) => updatePrefs({ daysBack: Number(v) })}
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5" role="group" aria-label="Слои графика">
          <FilterChip active={prefs.vwap} onClick={() => updatePrefs({ vwap: !prefs.vwap })} className="min-h-7 shrink-0 px-2.5 text-xs">
            <span className="h-0.5 w-3 rounded-full bg-[hsl(var(--chart-5))]" aria-hidden="true" /> VWAP
          </FilterChip>
          <FilterChip active={prefs.levels} onClick={() => updatePrefs({ levels: !prefs.levels })} className="min-h-7 shrink-0 px-2.5 text-xs">Уровни дня</FilterChip>
          <FilterChip active={prefs.rLevels} onClick={() => updatePrefs({ rLevels: !prefs.rLevels })} className="min-h-7 shrink-0 px-2.5 text-xs">R-уровни</FilterChip>
          <FilterChip active={prefs.volume} onClick={() => updatePrefs({ volume: !prefs.volume })} className="min-h-7 shrink-0 px-2.5 text-xs">Объём</FilterChip>
          <span className="shrink-0" title={needExtended ? "Исполнение вне основной сессии — пре/пост показаны всегда" : undefined}>
            <FilterChip active={extended} onClick={() => updatePrefs({ extended: !prefs.extended })} className="min-h-7 shrink-0 px-2.5 text-xs">Пре/пост</FilterChip>
          </span>
          {addCount > 0 && (
            <FilterChip active={prefs.adds} onClick={() => updatePrefs({ adds: !prefs.adds })} count={addCount} className="min-h-7 shrink-0 px-2.5 text-xs">Доборы</FilterChip>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-2 pb-2 pt-2 sm:px-3">
        {isLoading ? (
          <div className="relative" style={{ height: chartHeight }} aria-busy="true" aria-label="Загрузка свечей">
            <Skeleton className="h-full w-full rounded-xl" />
            <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Загружаю свечи…</span>
          </div>
        ) : error && !data ? (
          (() => {
            const info = errorInfo(error as Error & { reason?: string; status?: number }, dateKey);
            const Icon = info.icon;
            return (
              <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 px-4 py-6 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="max-w-sm text-sm text-muted-foreground">{info.text}</p>
                {info.retry && (
                  <button
                    type="button"
                    onClick={() => candlesQuery.refetch()}
                    disabled={isFetching}
                    className="chip inline-flex min-h-8 items-center gap-1.5 px-3 text-sm font-medium disabled:opacity-50"
                  >
                    <RotateCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden="true" /> Повторить
                  </button>
                )}
              </div>
            );
          })()
        ) : !candles.length ? (
          <div className="flex min-h-[120px] items-center justify-center gap-2 px-4 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Нет свечей за этот день
          </div>
        ) : (
          <div ref={wrapperRef} className="relative">
            <div ref={containerRef} className="isolate w-full" style={{ height: chartHeight }} />

            {/* OHLC legend */}
            {legendCandle && (
              <div className="pointer-events-none absolute left-2 top-1 z-raised flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg px-1.5 py-1 text-2xs tabular-nums text-muted-foreground">
                <span className="text-foreground/90">{fmtEtDateTime(new Date(legendCandle.t * 1000))}</span>
                <span>O <span className="text-foreground">{fmtPrice(legendCandle.o)}</span></span>
                <span>H <span className="text-foreground">{fmtPrice(legendCandle.h)}</span></span>
                <span>L <span className="text-foreground">{fmtPrice(legendCandle.l)}</span></span>
                <span>C <span className="text-foreground">{fmtPrice(legendCandle.c)}</span></span>
                {legendChg != null && (
                  <span className={toneText(toneOf(legendChg))}>{legendChg >= 0 ? "+" : "−"}{Math.abs(legendChg).toFixed(2)}%</span>
                )}
                {prefs.volume && <span>V <span className="text-foreground">{fmtVol(legendCandle.v)}</span></span>}
              </div>
            )}

            {/* Execution tooltip */}
            {tooltip && containerSize && (() => {
              const W = 224;
              const H = Math.min(200, 32 + tooltip.rows.length * 56);
              let left = tooltip.x + 14;
              let top = tooltip.y + 14;
              if (left + W > containerSize.width) left = tooltip.x - W - 14;
              if (top + H > containerSize.height) top = Math.max(4, tooltip.y - H - 14);
              left = Math.max(4, left);
              top = Math.max(4, top);
              return (
                <div className="glass-thick pointer-events-none absolute z-raised overflow-hidden rounded-xl" style={{ left, top, width: W }}>
                  {tooltip.rows.map((row, i) => (
                    <div key={row.exec.id} className={cn("px-3 py-2 text-xs", i > 0 && "border-t border-[var(--glass-border)]")}>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", KIND_DOT[row.exec.kind])} aria-hidden="true" />
                        <span className="font-semibold text-foreground">{KIND_LABEL[row.exec.kind]}</span>
                        <span className="tabular-nums text-foreground">${fmtPrice(row.price)}</span>
                        {row.exec.qty && <span className="tabular-nums text-muted-foreground">× {Number(row.exec.qty).toLocaleString("ru-RU")}</span>}
                      </div>
                      <div className="mt-0.5 text-2xs tabular-nums text-muted-foreground">
                        {row.at != null ? fmtEtDateTimeSec(row.at) : fmtEtDateTime(new Date(row.candle.t * 1000))}
                        {row.at == null && " · по цене"}
                        {row.at != null && (() => { const s = sessionOfEt(row.at); return s && s !== "regular" ? ` · ${ET_SESSION_LABEL[s]}` : ""; })()}
                        {row.exec.qty && <> · ${(row.price * Number(row.exec.qty)).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}</>}
                      </div>
                      {r && trade.effEntry != null && (row.exec.kind === "exit" || row.exec.kind === "trim" || row.exec.kind === "stop") && (
                        <div className={cn("text-2xs font-medium tabular-nums", toneText(toneOf(isShort ? trade.effEntry - row.price : row.price - trade.effEntry)))}>
                          {formatR((isShort ? trade.effEntry - row.price : row.price - trade.effEntry) / r, 2)}
                        </div>
                      )}
                      {row.exec.note && <div className="mt-0.5 truncate text-2xs italic text-foreground/80" title={row.exec.note}>{row.exec.note}</div>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Footer: trade stats + legend */}
      {candles.length > 0 && (stats.length > 0 || kindsPresent.length > 0) && (
        <div className="space-y-2 border-t border-[var(--glass-border)] px-4 py-3">
          {stats.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8">
              {stats.map((s) => <MiniStat key={s.label} {...s} />)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {kindsPresent.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={cn("h-2 w-2 rounded-full", KIND_DOT[k])} aria-hidden="true" /> {KIND_LABEL[k]}
              </span>
            ))}
            {!prefs.adds && addCount > 0 && <span>· доборов скрыто: {addCount}</span>}
            {allExecutions.length === 0 && (trade.entryNum != null || trade.exitNum != null) && (
              <span>Маркеры поставлены по совпадению цены — время исполнения не указано</span>
            )}
            {exc && <span>MFE/MAE оценены по свечам {INTERVAL_LABEL[data?.interval ?? interval] ?? interval}{trade.timed ? " (бары входа/выхода — только известный путь: открытие → цена исполнения → закрытие)" : ""}</span>}
            {extended && <span>Фон: синий — премаркет, жёлтый — афтермаркет · VWAP только по основной сессии{needExtended && !prefs.extended ? " · пре/пост включены автоматически: исполнение вне основной сессии" : ""}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
