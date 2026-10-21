/**
 * «Деск на тикере» chart: the archived ticker-day (candles + volume, pre / after-hours shaded) with every desk trader's
 * legs drawn by DeskFillsPrimitive. Built on the shared chart engine (theme, time axis, session shading, canvas helpers).
 * Clicking a marker focuses that trader (same as clicking their legend row).
 * «Позиция офиса» (toggle): a pane under the price with the desk's net position in % of the day's peak (+ above zero,
 * − below), dashed price lines at the office's average entry / exit and shaded main-position / exit zones.
 */
import * as React from "react";
import {
  createChart, BaselineSeries, CandlestickSeries, HistogramSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Timeframe } from "@/components/chart-engine/types";
import { TF_LABEL } from "@/components/chart-engine/types";
import { readChartTheme } from "@/components/chart-engine/theme";
import { aggregate } from "@/components/chart-engine/lib/aggregate";
import { fmtEtTime, isoToEpoch } from "@/components/chart-engine/lib/time";
import { baseChartOptions, candleColors, priceFormatFor, refPrice, topMargin } from "@/components/chart-engine/lib/chart-options";
import { dayLevels } from "@/components/chart-engine/lib/levels";
import { sessionVwap } from "@/components/chart-engine/lib/vwap";
import { LevelsPrimitive, type LevelLine } from "@/components/chart-engine/primitives/LevelsPrimitive";
import { VwapBandsPrimitive } from "@/components/chart-engine/primitives/VwapBandsPrimitive";
import { ChartLegend, type LegendInfo } from "@/components/chart-engine/ui/ChartLegend";
import { capVolumes } from "@/components/chart-engine/lib/view";
import { ROLE_LABEL } from "@/components/chart-engine/lib/structure";
import { useThemeVersion } from "@/components/chart-engine/hooks/useThemeVersion";
import { SessionShadingPrimitive } from "@/components/chart-engine/primitives/SessionShadingPrimitive";
import { cn } from "@/lib/utils";
import { fmtCount, fmtPrice, fmtR } from "@/lib/format";
import { deskDayI18n } from "@/i18n/ns/deskDay";
import type { DeskDay, DeskLeg, DeskOffice, DeskTrade } from "./api";
import { DeskFillsPrimitive, type DeskMarker } from "./DeskFillsPrimitive";
import { OfficeZonesPrimitive, type OfficeZoneBox } from "./OfficeZonesPrimitive";
import { buildMarkers, samplePath, windowBars } from "./model";
import { resultLabel, traderLabel } from "./labels";

type Props = {
  day: DeskDay;
  bars: readonly Candle[];
  baseSec: number;
  colors: ReadonlyMap<string, string>;
  focus: readonly string[];
  onToggle: (name: string) => void;
  /** The office position layer is on (the toggle lives on the chart; the state in the page). */
  showOffice: boolean;
  onShowOffice: (on: boolean) => void;
  /** Previous close (PDC level and the legend's change vs yesterday). */
  prevClose?: number | null;
  className?: string;
};

type Refs = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; fills: DeskFillsPrimitive; session: SessionShadingPrimitive;
  zones: OfficeZonesPrimitive; pos: ISeriesApi<"Baseline"> | null; lines: IPriceLine[];
  levels: LevelsPrimitive; vwap: VwapBandsPrimitive;
};

/** Tooltip lines of one marker (translated; $ / size only when the API sent them). */
function describe(day: DeskDay, m: DeskMarker, trade: DeskTrade | undefined, leg: DeskLeg | undefined): string[] {
  const t = deskDayI18n.t;
  const lines = [`${traderLabel(day, m.trader)} · ${ROLE_LABEL[m.role]}${m.inferred ? "?" : ""}`];
  const at = leg?.at ? isoToEpoch(leg.at) : NaN;
  lines.push(`${fmtPrice(m.price)}${Number.isFinite(at) ? ` · ${fmtEtTime(at, true)} ET` : ""}`);
  const extra: string[] = [];
  if (leg?.qty != null) extra.push(t("tip.qty", { qty: fmtCount(leg.qty) }));
  if (leg && leg.pieces > 1) extra.push(t("tip.pieces", { count: leg.pieces }));
  if (leg?.perShare != null) extra.push(t("tip.move", { move: `${leg.perShare > 0 ? "+" : leg.perShare < 0 ? "−" : ""}${fmtPrice(Math.abs(leg.perShare))}` }));
  if (leg?.r != null) extra.push(fmtR(leg.r));
  if (extra.length) lines.push(extra.join(" · "));
  if (trade && leg && !leg.opening && trade.r != null && (m.role === "exit" || m.role === "stop" || m.role === "flip")) lines.push(`${resultLabel(trade.result)} · ${fmtR(trade.r)}`);
  return lines;
}

/** Legend height to keep clear above the candles: on a narrow chart it sits under the office / timeframe buttons. */
const legendPx = (el: HTMLElement) => (el.clientWidth < 512 ? 76 : 40);

/** Pushes the office layer onto a built chart: position pane, average entry / exit lines, zones. */
function drawOffice(r: Refs, office: DeskOffice | null, on: boolean, bars: readonly Candle[], barSec: number): void {
  const t = deskDayI18n.t;
  const theme = readChartTheme();
  if (r.pos) { r.chart.removeSeries(r.pos); r.pos = null; }
  for (const l of r.lines) r.candles.removePriceLine(l);
  r.lines = [];
  r.zones.setZones([]);
  if (!office || !on) return;
  const vals = samplePath(office, bars, barSec);
  const pos = r.chart.addSeries(BaselineSeries, {
    baseValue: { type: "price", price: 0 },
    topLineColor: theme.up(1), topFillColor1: theme.up(0.32), topFillColor2: theme.up(0.04),
    bottomLineColor: theme.down(1), bottomFillColor1: theme.down(0.04), bottomFillColor2: theme.down(0.32),
    lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true,
    priceFormat: { type: "custom", formatter: (p: number) => `${Math.round(p)}%`, minMove: 1 },
    title: t("office.toggle"),
  }, 1);
  pos.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: vals[i] })));
  // Narrow screens: the price keeps most of the height, the pane stays a strip.
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches;
  pos.getPane().setStretchFactor(1);
  r.chart.panes()[0]?.setStretchFactor(narrow ? 4 : 3);
  r.pos = pos;
  // Narrow screens: no line titles (they cover the candles); the axis labels keep the prices, the summary line says which.
  const line = (price: number | null, title: string, color: string) => {
    if (price != null) r.lines.push(r.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: narrow ? "" : title }));
  };
  line(office.avgEntry, t("office.avgEntry"), theme.primary(0.95));
  line(office.avgExit, t("office.avgExit"), theme.muted(0.95));
  const zones: OfficeZoneBox[] = [];
  for (const [kind, z] of [["build", office.build], ["exit", office.exit]] as const) {
    const w = z ? windowBars(bars, barSec, z.from, z.to) : null;
    if (z && w) zones.push({ kind, from: w.from, to: w.to, low: z.low, high: z.high, text: t(kind === "build" ? "office.zoneBuild" : "office.zoneExit") });
  }
  r.zones.setZones(zones);
}

export function DeskDayChart({ day, bars: baseBars, baseSec, colors, focus, onToggle, showOffice, onShowOffice, prevClose = null, className }: Props) {
  const { t } = deskDayI18n.useT();
  const themeVersion = useThemeVersion();
  /** Hovered bar (rAF-throttled from the crosshair) for the legend; null = the last bar. */
  const [hover, setHover] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const refs = React.useRef<Refs | null>(null);
  const tfs: Timeframe[] = baseSec <= 60 ? ["1m", "5m"] : [];
  const [tf, setTf] = React.useState<Timeframe>("1m");
  const bars = React.useMemo<Candle[]>(() => (baseSec <= 60 && tf === "5m" ? aggregate(baseBars, baseSec, "5m") : [...baseBars]), [baseBars, baseSec, tf]);
  const barSec = baseSec <= 60 && tf === "5m" ? 300 : baseSec;
  const markers = React.useMemo(() => buildMarkers(day, bars, barSec, colors), [day, bars, barSec, colors]);
  const legOf = React.useMemo(() => {
    const m = new Map<string, { trade: DeskTrade; leg: DeskLeg }>();
    for (const tr of day.trades) tr.legs.forEach((leg, i) => m.set(`${tr.id}:${i}`, { trade: tr, leg }));
    return m;
  }, [day.trades]);
  const toggleRef = React.useRef(onToggle);
  toggleRef.current = onToggle;
  const markersRef = React.useRef(markers);
  markersRef.current = markers;
  /** View key the first range was set for; null after a rebuild so the new chart gets it too. */
  const lastView = React.useRef<string | null>(null);

  // ── build (bars / theme) ──
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || !bars.length) return;
    const theme = readChartTheme();
    // Explicit size (not autoSize): the first view range is set right after the build and needs a real width.
    // Shared options (chart-engine/lib/chart-options): same look, touch rules and price precision as every chart.
    const h = el.clientHeight || 340;
    const chart = createChart(el, baseChartOptions(theme, { width: el.clientWidth || 320, height: h, intraday: true, rightOffset: 4 }));
    const candles = chart.addSeries(CandlestickSeries, {
      ...candleColors(theme), priceLineVisible: false, lastValueVisible: false,
      // Per series (not chart-wide localization): the office pane formats its own scale in %.
      priceFormat: priceFormatFor(refPrice(bars.map((b) => b.c))),
    });
    candles.priceScale().applyOptions({ scaleMargins: { top: topMargin(h, legendPx(el)), bottom: 0.18 } });
    candles.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const capped = capVolumes(bars.map((b) => b.v)).values;
    volume.setData(bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: capped[i], color: b.c >= b.o ? theme.up(0.3) : theme.down(0.3) })));
    const session = new SessionShadingPrimitive(theme);
    chart.panes()[0]?.attachPrimitive(session);
    session.setBars(bars, true);
    const fills = new DeskFillsPrimitive(theme, { zOrder: "top" });
    candles.attachPrimitive(fills);
    const zones = new OfficeZonesPrimitive(theme);
    candles.attachPrimitive(zones);
    // Key levels + VWAP with one label rail on the right (the same as the trade chart).
    const levels = new LevelsPrimitive(theme, { zOrder: "bottom" });
    levels.setTopInset(36); // the office / timeframe buttons sit over the top-right corner
    const vwap = new VwapBandsPrimitive(theme, { color: theme.c5, bands: [], title: "" });
    candles.attachPrimitive(levels);
    candles.attachPrimitive(vwap);
    const vw = sessionVwap(bars);
    const idxOf = new Map(bars.map((b, i) => [b.t, i]));
    vwap.set(vw.map((p) => ({ idx: idxOf.get(p.t) ?? -1, vwap: p.vwap, sd: p.sd })).filter((p) => p.idx >= 0));
    const L = dayLevels(bars, day.date, prevClose);
    const lv: LevelLine[] = [];
    if (L.pdc != null) lv.push({ key: "pdc", price: L.pdc, text: "PDC", color: theme.muted(0.85), dash: [6, 4] });
    if (L.pmh != null) lv.push({ key: "pmh", price: L.pmh, text: "PMH", color: theme.c1(0.8) });
    if (L.pml != null) lv.push({ key: "pml", price: L.pml, text: "PML", color: theme.c1(0.8) });
    levels.set(lv);
    levels.setDynamic((rc) => { const v = vwap.edgeValue(rc.range); return v == null ? [] : [{ key: "vwap", price: v, text: "VWAP", color: theme.c5(0.9), noLine: true }]; });
    let raf = 0, lastHover: number | null = null;
    const onMove = (param: MouseEventParams<Time>) => {
      const i = param.logical != null && param.point ? Math.round(Number(param.logical)) : null;
      const idx = i != null && i >= 0 && i < bars.length ? i : null;
      if (idx === lastHover) return;
      lastHover = idx;
      if (!raf) raf = window.requestAnimationFrame(() => { raf = 0; setHover(lastHover); });
    };
    chart.subscribeCrosshairMove(onMove);
    const onClick = (param: MouseEventParams<Time>) => {
      const id = typeof param.hoveredObjectId === "string" && param.hoveredObjectId.startsWith("leg:") ? param.hoveredObjectId.slice(4) : null;
      const m = id ? markersRef.current.find((x) => x.key === id) : null;
      if (m) toggleRef.current(m.trader);
    };
    chart.subscribeClick(onClick);
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      chart.resize(el.clientWidth, el.clientHeight);
      candles.priceScale().applyOptions({ scaleMargins: { top: topMargin(el.clientHeight, legendPx(el)), bottom: 0.18 } });
    });
    ro.observe(el);
    refs.current = { chart, candles, volume, fills, session, zones, pos: null, lines: [], levels, vwap };
    lastView.current = null;
    return () => {
      ro.disconnect();
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      if (raf) window.cancelAnimationFrame(raf);
      refs.current = null;
      chart.remove();
    };
  }, [bars, themeVersion, day.date, prevClose]);

  // ── markers + first view ──
  const viewKey = `${day.ticker}|${day.date}|${tf}`;
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.fills.setMarkers(markers, (m) => { const x = legOf.get(m.key); return describe(day, m, x?.trade, x?.leg); });
    if (lastView.current !== viewKey) {
      lastView.current = viewKey;
      // The whole day on open (premarket and after-hours shaded), like every chart of the app.
      r.chart.timeScale().setVisibleLogicalRange({ from: -2, to: bars.length + 2 });
    }
  }, [day, markers, legOf, viewKey, bars.length, tf, themeVersion]);

  // ── office layer (after the build: a rebuilt chart starts without it) ──
  React.useEffect(() => {
    const r = refs.current;
    if (r) drawOffice(r, day.office, showOffice, bars, barSec);
  }, [day.office, showOffice, bars, barSec, themeVersion, t]);

  React.useEffect(() => { refs.current?.fills.setFocus(focus); }, [focus, markers, themeVersion]);

  const officeOn = showOffice && !!day.office;
  const legend = React.useMemo((): LegendInfo | null => {
    const idx = hover ?? bars.length - 1;
    const bar = bars[idx];
    if (!bar) return null;
    let sum = 0, n = 0;
    for (let i = Math.max(0, idx - 20); i < idx; i++) { sum += bars[i].v || 0; n++; }
    const avg = n ? sum / n : 0;
    const v = refs.current?.vwap.at(idx) ?? null;
    return {
      bar: { ...bar, n: 1 }, idx, hovered: hover != null, position: null, sinceEntry: null, vwap: v ? { vwap: v.vwap, sd: v.sd } : null, avwap: null, rvol: null,
      prevBarClose: idx > 0 ? bars[idx - 1].c : null, volRatio: avg > 0 && bar.v > 0 ? bar.v / avg : null, risk: null, side: "long", prevClose, redacted: true,
    };
  }, [hover, bars, prevClose]);
  return (
    <div className={cn("@container relative", className)}>
      <ChartLegend info={legend} ticker={day.ticker} tfLabel={TF_LABEL[tf]} className="top-10 max-w-[calc(100%-5rem)] @lg:top-2 @lg:max-w-[calc(100%-15rem)]" />
      {/* Above the chart (its canvases stack inside the isolated container below) and clear of the price scale. */}
      <div className="absolute right-[4.5rem] top-2 z-raised flex items-center gap-1.5">
      {day.office && (
        <button
          type="button"
          aria-pressed={showOffice}
          aria-label={t("office.toggleAria")}
          onClick={() => onShowOffice(!showOffice)}
          className={cn(
            "inline-flex min-h-8 items-center rounded-full border border-[var(--glass-border)] px-3 text-xs transition-colors duration-[var(--dur-1)]",
            showOffice ? "bg-primary text-primary-foreground" : "bg-background/90 text-muted-foreground hover:text-foreground",
          )}
        >
          {t("office.toggle")}
        </button>
      )}
      {tfs.length > 1 && (
        <div className="flex gap-1 rounded-full border border-[var(--glass-border)] bg-background/90 p-0.5" role="group" aria-label={t("tf")}>
          {tfs.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={tf === x}
              onClick={() => setTf(x)}
              className={cn("inline-flex min-h-7 items-center rounded-full px-2.5 text-xs tabular-nums transition-colors duration-[var(--dur-1)]", tf === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {TF_LABEL[x]}
            </button>
          ))}
        </div>
      )}
      </div>
      <div
        ref={containerRef}
        className={cn("relative isolate w-full", officeOn ? "h-[400px] sm:h-[540px]" : "h-[340px] sm:h-[460px]")}
        role="img"
        aria-label={t("chartAria", { ticker: day.ticker, date: day.date })}
      />
    </div>
  );
}
