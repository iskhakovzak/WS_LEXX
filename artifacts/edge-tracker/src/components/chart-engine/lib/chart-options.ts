/**
 * One look and one behaviour for every candle chart of the app (trade sheet, «График и разбор», desk-day, trainer):
 * theme colours only, the same grid / crosshair / time axis, the same touch rules (a vertical swipe scrolls the page, a
 * horizontal drag pans, a pinch zooms) and a price format that suits the price level (sub-dollar stocks get 4 decimals).
 * Pure apart from the types — no DOM.
 */
import { CrosshairMode, type ChartOptions, type DeepPartial, type PriceFormat, type Time } from "lightweight-charts";
import { fmtEtDateTime, tickMarkLabel } from "./time";
import { fmtPrice, localeTag } from "@/lib/format";
import type { ChartTheme } from "../theme";

/**
 * Price format of a candle series: a $0.42 stock needs 4 decimals and a 0.0001 step, everything else cents. Set per
 * series (not as a chart-wide formatter) so other panes — P&L in $, the desk position in % — keep their own format.
 */
export function priceFormatFor(refPrice: number | null | undefined): PriceFormat {
  const p = Math.abs(Number(refPrice));
  const sub = Number.isFinite(p) && p > 0 && p < 1;
  return { type: "custom", minMove: sub ? 0.0001 : 0.01, formatter: (v: number) => fmtPrice(v, { decimals: sub ? 4 : 2 }) };
}

/** Median close — a robust reference for the price format (one bad print does not switch the precision). */
export function refPrice(closes: readonly number[]): number | null {
  const v = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Top margin of the price scale that keeps the candles clear of the legend in the top-left corner. */
export function topMargin(heightPx: number, legendPx = 44): number {
  if (!(heightPx > 0)) return 0.1;
  return Math.max(0.08, Math.min(0.3, (legendPx + 8) / heightPx));
}

export type BaseChartOpts = { width: number; height: number; intraday?: boolean; rightOffset?: number };

/** createChart options shared by every candle chart. */
export function baseChartOptions(theme: ChartTheme, o: BaseChartOpts): DeepPartial<ChartOptions> {
  const grid = theme.border(theme.dark ? 0.18 : 0.3);
  return {
    width: o.width, height: o.height,
    layout: {
      background: { color: "transparent" }, textColor: theme.muted(), fontFamily: theme.font, fontSize: 11, attributionLogo: false,
      panes: { separatorColor: theme.border(0.9), separatorHoverColor: theme.primary(0.25), enableResize: true },
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    timeScale: {
      timeVisible: o.intraday !== false, secondsVisible: false, borderColor: theme.border(), rightOffset: o.rightOffset ?? 6, barSpacing: 8, minBarSpacing: 0.3,
      shiftVisibleRangeOnNewBar: false,
      tickMarkFormatter: (time: Time, type: number) => (typeof time === "number" ? tickMarkLabel(time, type) : ""),
    },
    localization: { locale: localeTag(), timeFormatter: (time: Time) => (typeof time === "number" ? fmtEtDateTime(time) : String(time)) },
    rightPriceScale: { borderColor: theme.border(), scaleMargins: { top: 0.1, bottom: 0.2 } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.muted(0.45), labelBackgroundColor: theme.labelBg, width: 1, style: 3 },
      horzLine: { color: theme.muted(0.45), labelBackgroundColor: theme.labelBg, width: 1, style: 3 },
    },
    // Touch: a vertical swipe scrolls the page (never fights it), a horizontal drag pans, a pinch zooms; a long press
    // shows the crosshair and the next tap hides it.
    handleScale: { axisPressedMouseMove: true, axisDoubleClickReset: true, mouseWheel: true, pinch: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    kineticScroll: { touch: true, mouse: false },
  };
}

/** Candlestick colours from the theme. */
export function candleColors(theme: ChartTheme) {
  return {
    upColor: theme.up(), downColor: theme.down(), borderUpColor: theme.up(), borderDownColor: theme.down(), wickUpColor: theme.up(0.9), wickDownColor: theme.down(0.9),
  } as const;
}

/**
 * Embedded charts (a sheet, a card) must not eat the page's wheel scroll: the wheel scrolls the page and Ctrl/⌘ + wheel
 * zooms. Installs a capture-phase listener on `host` that keeps plain wheel events away from the chart. Returns a cleanup.
 */
export function wheelNeedsModifier(host: HTMLElement): () => void {
  const on = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); };
  host.addEventListener("wheel", on, { capture: true });
  return () => host.removeEventListener("wheel", on, { capture: true });
}
