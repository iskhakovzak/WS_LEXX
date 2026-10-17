import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, AreaSeries,
  type IChartApi, type ISeriesApi, type SeriesType, type Time,
} from "lightweight-charts";
import { LineChart } from "lucide-react";
import { Panel, Segmented, EmptyState, toneOf, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { type Metric, type OhlcCandle, fmtDayLong } from "@/lib/analytics-pro";
import { cssVarColor, fmtVal, loadPref, savePref, useThemeVersion } from "./pro-format";

type Mode = "candles" | "line";
const MODES = ["candles", "line"] as const;
const MODE_KEY = "analyticsPro.equityMode";

function themeColors() {
  return {
    text: cssVarColor("--muted-foreground", 0.95),
    grid: cssVarColor("--border", 0.55),
    border: cssVarColor("--border", 0.9),
    up: cssVarColor("--up"),
    down: cssVarColor("--down"),
    upSoft: cssVarColor("--up", 0.45),
    downSoft: cssVarColor("--down", 0.45),
    line: cssVarColor("--chart-1"),
    areaTop: cssVarColor("--chart-1", 0.28),
    areaBottom: cssVarColor("--chart-1", 0.02),
    crosshair: cssVarColor("--muted-foreground", 0.5),
  };
}

/** Cumulative equity by day: candles (open/close of the day, wick = intraday extreme) or area line. */
export function EquityPanel({ candles, metric }: { candles: OhlcCandle[]; metric: Metric }) {
  const [mode, setMode] = useState<Mode>(() => loadPref(MODE_KEY, MODES) ?? "candles");
  const setModePersist = (m: Mode) => { setMode(m); savePref(MODE_KEY, m); };

  return (
    <Panel
      icon={LineChart}
      title="Кривая капитала"
      description={metric === "r" ? "Накопленный результат в R по дням" : "Накопленный P&L по дням"}
      actions={
        <Segmented
          size="sm"
          ariaLabel="Вид графика"
          value={mode}
          onChange={setModePersist}
          options={[{ value: "candles", label: "Свечи" }, { value: "line", label: "Линия" }]}
        />
      }
    >
      {candles.length === 0 ? (
        <EmptyState icon={LineChart} title="Нет данных для графика" description="В выборке нет сделок с датой." />
      ) : (
        <EquityChart candles={candles} metric={metric} mode={mode} />
      )}
    </Panel>
  );
}

function EquityChart({ candles, metric, mode }: { candles: OhlcCandle[]; metric: Metric; mode: Mode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const themeV = useThemeVersion();
  const [hover, setHover] = useState<OhlcCandle | null>(candles.length ? candles[candles.length - 1] : null);

  // Create chart + series per mode/theme (cheap; keeps colours in sync with the theme tokens).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = themeColors();
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight || 340,
      layout: {
        background: { color: "transparent" },
        textColor: c.text,
        fontSize: 11,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: c.border, timeVisible: false },
      crosshair: {
        mode: 1,
        vertLine: { color: c.crosshair, labelBackgroundColor: c.line },
        horzLine: { color: c.crosshair, labelBackgroundColor: c.line },
      },
      localization: {
        priceFormatter: (p: number) => fmtVal(metric, p, { compact: true }),
      },
    });
    chartRef.current = chart;

    mainRef.current = mode === "candles"
      ? chart.addSeries(CandlestickSeries, {
        upColor: c.up, downColor: c.down,
        borderUpColor: c.up, borderDownColor: c.down,
        wickUpColor: c.up, wickDownColor: c.down,
      })
      : chart.addSeries(AreaSeries, {
        lineColor: c.line, topColor: c.areaTop, bottomColor: c.areaBottom, lineWidth: 2,
      });

    volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const handleResize = () => chart.applyOptions({ width: el.clientWidth });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    ro?.observe(el);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        const all = candlesRef.current;
        setHover(all.length ? all[all.length - 1] : null);
        return;
      }
      const t = String(param.time);
      const found = candlesRef.current.find((x) => x.time === t);
      if (found) setHover(found);
    });

    return () => {
      ro?.disconnect();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
    };
  }, [mode, metric, themeV]);

  // Push data whenever candles (or the rebuilt chart) change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !mainRef.current || !volRef.current) return;
    const c = themeColors();
    if (mode === "candles") {
      (mainRef.current as ISeriesApi<"Candlestick">).setData(candles.map((k) => ({
        time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close,
      })));
    } else {
      (mainRef.current as ISeriesApi<"Area">).setData(candles.map((k) => ({ time: k.time as Time, value: k.close })));
    }
    volRef.current.setData(candles.map((k) => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? c.upSoft : c.downSoft,
    })));
    chart.timeScale().fitContent();
    setHover(candles.length ? candles[candles.length - 1] : null);
  }, [candles, mode, metric, themeV]);

  const dayNet = hover ? hover.close - hover.open : 0;

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-live="off">
        <LegendItem label="Дата" value={hover ? fmtDayLong(hover.time) : "—"} />
        <LegendItem label="Капитал" value={fmtVal(metric, hover?.close)} className={toneText(toneOf(hover?.close))} />
        <LegendItem label="За день" value={fmtVal(metric, dayNet, { sign: true })} className={toneText(toneOf(dayNet))} />
        <LegendItem label="Макс." value={fmtVal(metric, hover?.high)} />
        <LegendItem label="Мин." value={fmtVal(metric, hover?.low)} />
        <LegendItem label="Сделок" value={hover ? String(hover.volume) : "—"} />
      </dl>
      <div
        ref={ref}
        className="h-[280px] w-full sm:h-[340px]"
        role="img"
        aria-label={`График накопленного результата: ${candles.length} торговых дней, итог ${fmtVal(metric, candles[candles.length - 1]?.close)}`}
      />
    </div>
  );
}

function LegendItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums text-foreground", className)}>{value}</dd>
    </div>
  );
}
