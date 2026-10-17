/**
 * <EquityCandles> — equity curve built from daily (or weekly) candles on lightweight-charts 5.
 *
 *   <EquityCandles trades={trades} />                         // net $, trader derived from the trades
 *   <EquityCandles trades={trades} unit="r" trader="Ориф" />  // R, explicit trader for the day-report link
 *
 * Candle = cumulative result: open = start of the day, close = end of the day, wicks = best / worst point of the
 * cumulative curve inside the day (trades walked in close-time order). Hover → rich tooltip; click → «Разбор дня»
 * (/day-report?date&trader); a weekly candle click expands that week by days. ←/→ step through candles, Enter opens.
 * Controls: period 1М/3М/YTD/Всё, day/week, candles/line, drawdown pane, trade-count / fees histogram.
 */
import * as React from "react";
import { useLocation } from "wouter";
import {
  BaselineSeries, CrosshairMode, HistogramSeries, LineStyle, createChart, TickMarkType,
  type IChartApi, type ISeriesApi, type Logical, type MouseEventParams, type Time, type SeriesType, type SeriesPartialOptions,
} from "lightweight-charts";
import { ArrowRight, CandlestickChart, LineChart as LineIcon, SlidersHorizontal } from "lucide-react";
import { EmptyState, Segmented, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { readChartTheme } from "@/components/chart-engine/theme";
import { useThemeVersion } from "@/components/chart-engine/hooks/useThemeVersion";
import { RoundedCandlesView, type RoundedCandleData, type RoundedCandleOptions } from "./rounded-candles";
import {
  buildCandles, dateRu, dayReportHref, filterPeriod, fmtAxis, fmtValue, rangeRu, soleTrader, summarize, weekdayRu,
  type EquityAgg, type EquityCandle, type EquityPeriod, type EquityTradeInput, type EquityUnit,
} from "./lib";

type Mode = "candles" | "line";
type HistKind = "trades" | "fees" | "off";

export interface EquityCandlesProps {
  trades: EquityTradeInput[];
  /** Value of a trade: net $ (default), gross $ or R. */
  unit?: EquityUnit;
  /** Trader for the day-report link; default — the only trader of `trades` (none when several). */
  trader?: string | null;
  /** Chart height in px (all panes). */
  height?: number;
  /** localStorage namespace for the controls (period / aggregation / mode / panes). */
  storageKey?: string;
  /** Hide the period switch when the host already filters by period. */
  showPeriod?: boolean;
  className?: string;
}

const PERIODS: { value: EquityPeriod; label: string }[] = [
  { value: "1m", label: "1М" },
  { value: "3m", label: "3М" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "Всё" },
];

function toYmd(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

type Refs = {
  chart: IChartApi;
  main: ISeriesApi<SeriesType>;
  isCandles: boolean;
};

export function EquityCandles({
  trades, unit = "net", trader, height = 340, storageKey = "equity-candles", showPeriod = true, className,
}: EquityCandlesProps) {
  const [, navigate] = useLocation();
  const themeVersion = useThemeVersion();
  const [periodPref, setPeriod] = usePersistentState<EquityPeriod>(`${storageKey}.period`, "all");
  const [agg, setAgg] = usePersistentState<EquityAgg>(`${storageKey}.agg`, "day");
  const [mode, setMode] = usePersistentState<Mode>(`${storageKey}.mode`, "candles");
  const [showDd, setShowDd] = usePersistentState<boolean>(`${storageKey}.dd`, true);
  const [histPref, setHist] = usePersistentState<HistKind>(`${storageKey}.hist`, "trades");
  const period: EquityPeriod = showPeriod ? periodPref : "all";
  const hist: HistKind = unit === "r" && histPref === "fees" ? "trades" : histPref;

  const who = trader === undefined ? soleTrader(trades) : trader;
  const candles = React.useMemo(() => buildCandles(filterPeriod(trades, period), { unit, agg }), [trades, period, unit, agg]);
  const sum = React.useMemo(() => summarize(candles), [candles]);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const refs = React.useRef<Refs | null>(null);
  const [active, setActive] = React.useState<number | null>(null);
  const [anchor, setAnchor] = React.useState<{ x: number; w: number } | null>(null);
  const focusWeek = React.useRef<string | null>(null);

  const live = React.useRef({ candles, agg, who, navigate, setAgg });
  live.current = { candles, agg, who, navigate, setAgg };

  const openCandle = React.useCallback((idx: number) => {
    const s = live.current;
    const c = s.candles[idx];
    if (!c) return;
    if (s.agg === "week") {
      focusWeek.current = c.from;
      s.setAgg("day");
      return;
    }
    s.navigate(dayReportHref(c.key, s.who));
  }, []);

  // ── Chart build (per data / mode / panes / theme) ───────────────────────
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || !candles.length) return;
    const th = readChartTheme();
    const fmt = (v: number) => fmtAxis(v, unit);
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height,
      layout: {
        background: { color: "transparent" }, textColor: th.muted(), fontFamily: th.font, fontSize: 11, attributionLogo: false,
        panes: { separatorColor: th.border(0.6), separatorHoverColor: th.primary(0.2), enableResize: false },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: th.border(th.dark ? 0.28 : 0.45) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: {
        borderVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, minBarSpacing: 2,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const d = toYmd(time);
          if (type === TickMarkType.Year) return d.slice(0, 4);
          if (type === TickMarkType.Month) return MONTH_SHORT[Number(d.slice(5, 7)) - 1] ?? "";
          return String(Number(d.slice(8, 10)));
        },
      },
      localization: {
        locale: "ru-RU",
        priceFormatter: fmt,
        timeFormatter: (time: Time) => {
          const d = toYmd(time);
          return `${weekdayRu(d).slice(0, 2)}, ${Number(d.slice(8, 10))} ${MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: th.muted(0.35), width: 1, style: LineStyle.Dotted, labelBackgroundColor: th.labelBg },
        horzLine: { color: th.muted(0.35), width: 1, style: LineStyle.Dotted, labelBackgroundColor: th.labelBg },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    const times = candles.map((c) => c.key as Time);
    const priceFormat = { type: "custom" as const, formatter: fmt, minMove: 0.01 };
    let main: ISeriesApi<SeriesType>;
    const isCandles = mode === "candles";
    if (isCandles) {
      const s = chart.addCustomSeries<RoundedCandleData, RoundedCandleOptions>(new RoundedCandlesView(), {
        upColor: th.up(), downColor: th.down(), flatColor: th.muted(0.8), activeColor: th.primary(),
        activeIndex: -1, priceFormat, priceLineVisible: false, lastValueVisible: true, color: th.c1(),
      });
      s.setData(candles.map((c, i) => ({ time: times[i], open: c.open, high: c.high, low: c.low, close: c.close, color: c.close >= 0 ? th.up() : th.down() })));
      main = s as unknown as ISeriesApi<SeriesType>;
    } else {
      const s = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: th.up(), topFillColor1: th.up(0.28), topFillColor2: th.up(0.02),
        bottomLineColor: th.down(), bottomFillColor1: th.down(0.02), bottomFillColor2: th.down(0.28),
        lineWidth: 2, priceFormat, priceLineVisible: false, lastValueVisible: true,
        crosshairMarkerRadius: 4, crosshairMarkerBorderColor: th.bg(), crosshairMarkerBorderWidth: 2,
      });
      s.setData(candles.map((c, i) => ({ time: times[i], value: c.close })));
      main = s as unknown as ISeriesApi<SeriesType>;
    }
    main.createPriceLine({ price: 0, color: th.muted(0.55), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    let pane = 1;
    const stretch: number[] = [72];

    if (hist !== "off") {
      const h = chart.addSeries(HistogramSeries, {
        priceFormat: hist === "fees" ? { type: "custom", formatter: (v: number) => `$${v.toFixed(v >= 100 ? 0 : 2)}`, minMove: 0.01 } : { type: "custom", formatter: (v: number) => String(Math.round(v)), minMove: 1 },
        priceLineVisible: false, lastValueVisible: false,
      }, pane);
      h.setData(candles.map((c, i) => ({
        time: times[i],
        value: hist === "fees" ? c.fees : c.trades,
        color: hist === "fees" ? th.c3(0.55) : c.value >= 0 ? th.up(0.38) : th.down(0.38),
      })));
      h.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
      stretch.push(13);
      pane++;
    }
    if (showDd) {
      const d = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: th.down(0), topFillColor1: th.down(0), topFillColor2: th.down(0),
        bottomLineColor: th.down(0.9), bottomFillColor1: th.down(0.06), bottomFillColor2: th.down(0.32),
        lineWidth: 1, priceFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, pane);
      d.setData(candles.map((c, i) => ({ time: times[i], value: c.drawdown })));
      d.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.02 } });
      stretch.push(15);
    }
    chart.panes().forEach((p, i) => p.setStretchFactor(stretch[i] ?? 10));

    // Viewport: a week expanded from the weekly view, else everything.
    const fw = focusWeek.current;
    focusWeek.current = null;
    if (fw) {
      const i0 = candles.findIndex((c) => c.from >= fw);
      if (i0 >= 0) chart.timeScale().setVisibleLogicalRange({ from: i0 - 6, to: Math.min(candles.length - 1, i0 + 4) + 6 });
      else chart.timeScale().fitContent();
    } else {
      chart.timeScale().fitContent();
    }

    refs.current = { chart, main, isCandles };

    let raf = 0;
    let pending: number | null = null;
    const onMove = (p: MouseEventParams) => {
      const idx = p.point && p.logical != null ? Math.round(Number(p.logical)) : null;
      const valid = idx != null && idx >= 0 && idx < candles.length ? idx : null;
      if (valid === null && wrapRef.current && document.activeElement === wrapRef.current) return; // keep the keyboard selection
      pending = valid;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setActive(pending); });
    };
    const onClick = (p: MouseEventParams) => {
      if (p.logical == null || !p.point) return;
      const idx = Math.round(Number(p.logical));
      if (idx >= 0 && idx < candles.length) openCandle(idx);
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      refs.current = null;
      setActive(null);
    };
  }, [candles, mode, hist, showDd, height, unit, themeVersion, openCandle]);

  // Active candle → ring in the renderer + tooltip anchor.
  React.useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (r.isCandles) (r.main as unknown as ISeriesApi<"Custom", Time, RoundedCandleData, RoundedCandleOptions, SeriesPartialOptions<RoundedCandleOptions>>).applyOptions({ activeIndex: active ?? -1 });
    if (active == null) { setAnchor(null); return; }
    const x = r.chart.timeScale().logicalToCoordinate(active as Logical);
    const w = boxRef.current?.clientWidth ?? 0;
    setAnchor(x == null ? null : { x: Number(x), w });
  }, [active]);

  // ── Keyboard: ←/→ step, Home/End, Enter opens ───────────────────────────
  const step = React.useCallback((to: number) => {
    const r = refs.current;
    if (!r || !candles.length) return;
    const idx = Math.max(0, Math.min(candles.length - 1, to));
    const ts = r.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (range && (idx < range.from + 1 || idx > range.to - 1)) {
      const span = range.to - range.from;
      const from = idx < range.from + 1 ? idx - 2 : idx - span + 3;
      ts.setVisibleLogicalRange({ from, to: from + span });
    }
    setActive(idx);
  }, [candles.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!candles.length) return;
    const cur = active ?? candles.length;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(cur - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(active == null ? candles.length - 1 : cur + 1); }
    else if (e.key === "Home") { e.preventDefault(); step(0); }
    else if (e.key === "End") { e.preventDefault(); step(candles.length - 1); }
    else if (e.key === "Enter" && active != null) { e.preventDefault(); openCandle(active); }
    else if (e.key === "Escape") setActive(null);
  };

  const c = active != null ? candles[active] ?? null : null;
  const isWeek = agg === "week";
  const unitLabel = unit === "r" ? "R" : unit === "gross" ? "брутто, $" : "нетто, $";

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {showPeriod && <Segmented<EquityPeriod> size="sm" ariaLabel="Период кривой" value={period} onChange={setPeriod} options={PERIODS} />}
        <Segmented<EquityAgg> size="sm" ariaLabel="Свеча — день или неделя" value={agg} onChange={setAgg}
          options={[{ value: "day", label: "День" }, { value: "week", label: "Неделя" }]} />
        <Segmented<Mode> size="sm" ariaLabel="Вид кривой" value={mode} onChange={setMode}
          options={[
            { value: "candles", label: <><CandlestickChart className="h-3.5 w-3.5" aria-hidden="true" />Свечи</> },
            { value: "line", label: <><LineIcon className="h-3.5 w-3.5" aria-hidden="true" />Линия</> },
          ]} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs">
              <SlidersHorizontal aria-hidden="true" /> Панели
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuCheckboxItem checked={showDd} onCheckedChange={(v) => setShowDd(v === true)}>Просадка от пика</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Гистограмма</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={hist} onValueChange={(v) => setHist(v as HistKind)}>
              <DropdownMenuRadioItem value="trades">Число сделок</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="fees" disabled={unit === "r"}>Комиссии, $</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="off">Скрыть</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {candles.length > 0 && (
          <dl className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <div className="flex items-baseline gap-1.5">
              <dt>Итог</dt>
              <dd className={cn("text-sm font-semibold", sum.total > 0 ? "text-up" : sum.total < 0 ? "text-down" : "text-foreground")}>{fmtValue(sum.total, unit)}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>{isWeek ? "Недель" : "Дней"} в плюс</dt>
              <dd className="text-foreground"><span className="text-up">{sum.green}</span> / {sum.candles}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>Макс. просадка</dt>
              <dd className={sum.maxDrawdown < 0 ? "text-down" : "text-foreground"}>{fmtValue(sum.maxDrawdown, unit)}</dd>
            </div>
          </dl>
        )}
      </div>

      {candles.length === 0 ? (
        <EmptyState compact icon={CandlestickChart} title="Нет закрытых сделок за период"
          description={period !== "all" ? "Выберите период длиннее." : `Свечи строятся по сделкам с ${unit === "r" ? "R" : "P&L"}.`}
          action={period !== "all" ? <Button type="button" variant="outline" size="sm" onClick={() => setPeriod("all")}>Всё время</Button> : undefined} />
      ) : (
        <div
          ref={wrapRef}
          tabIndex={0}
          role="group"
          aria-roledescription="график"
          aria-label={`Кривая капитала свечами, ${unitLabel}: итог ${fmtValue(sum.total, unit)} за ${sum.candles} ${isWeek ? "нед" : "дн"}. Стрелки влево и вправо — по свечам, Enter — ${isWeek ? "раскрыть неделю" : "разбор дня"}.`}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Escape"
          title="← → — по свечам · Enter — открыть · Esc — сброс"
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          style={{ height, cursor: c ? "pointer" : undefined }}
        >
          <div ref={boxRef} className="absolute inset-0 isolate" />
          {c && anchor && <CandleTooltip c={c} unit={unit} week={isWeek} anchor={anchor} />}
          <span className="sr-only" aria-live="polite">{c ? srText(c, unit, isWeek) : ""}</span>
        </div>
      )}

      {candles.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Свеча = {isWeek ? "неделя" : "день"}: тело — от начала до конца {isWeek ? "недели" : "дня"}, фитили — лучшая и худшая точка накопленного {unitLabel}.</span>
          <span>Клик по свече — {isWeek ? "раскрыть неделю по дням" : "разбор дня"}.</span>
        </p>
      )}
    </div>
  );
}

function srText(c: EquityCandle, unit: EquityUnit, week: boolean): string {
  const when = week ? `Неделя ${rangeRu(c.from, c.to)}` : `${weekdayRu(c.key)}, ${dateRu(c.key)}`;
  return `${when}: ${fmtValue(c.value, unit)}, сделок ${c.trades}, накоплено ${fmtValue(c.close, unit)}`;
}

const TIP_W = 296;

function CandleTooltip({ c, unit, week, anchor }: { c: EquityCandle; unit: EquityUnit; week: boolean; anchor: { x: number; w: number } }) {
  const right = anchor.x + 18 + TIP_W <= anchor.w - 56;
  const left = right ? anchor.x + 18 : Math.max(4, anchor.x - 18 - TIP_W);
  const tone = (v: number | null | undefined) => (v == null ? "text-foreground" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-foreground");
  const usd = unit !== "r";
  const wd = weekdayRu(c.key);
  const span = week ? "недели" : "дня";
  const Row = ({ k, children, cls }: { k: React.ReactNode; children: React.ReactNode; cls?: string }) => (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("whitespace-nowrap text-right", cls ?? "text-foreground")}>{children}</dd>
    </>
  );
  return (
    <div
      className="glass-thick pointer-events-none absolute top-2 z-raised flex flex-col gap-2.5 rounded-xl border border-border/70 p-3 text-xs shadow-lg tabular-nums"
      style={{ left, width: TIP_W }}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-0.5">
        <div className="text-xs font-semibold text-foreground">
          {week ? `Неделя ${rangeRu(c.from, c.to)}` : `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${dateRu(c.key)}`}
          {week && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">{c.days} торг. {c.days === 1 ? "день" : c.days < 5 ? "дня" : "дней"}</span>}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">{usd ? (unit === "gross" ? "Брутто" : "Нетто") : "Результат"} {span}</span>
          <span className={cn("text-lg font-semibold leading-none", tone(c.value))}>{fmtValue(c.value, unit)}</span>
        </div>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border/60 pt-2">
        {usd && c.gross != null && unit !== "gross" && <Row k="Брутто" cls={tone(c.gross)}>{fmtValue(c.gross, "net")}</Row>}
        {usd && c.fees > 0 && <Row k="Комиссии" cls="text-down">−${c.fees.toFixed(2)}</Row>}
        <Row k="Сделок">
          {c.trades} · <span className="text-up">{c.wins}W</span>/<span className="text-down">{c.losses}L</span>
          {c.winRate != null && <span className="text-muted-foreground"> · WR {Math.round(c.winRate * 100)}%</span>}
        </Row>
        <Row k={`Хай ${span}`} cls={tone(c.peakIn)}>{fmtValue(c.peakIn, unit)}</Row>
        <Row k={`Лой ${span}`} cls={tone(c.troughIn)}>{fmtValue(c.troughIn, unit)}</Row>
        <Row k="Накоплено" cls={cn("font-medium", tone(c.close))}>{fmtValue(c.close, unit)}</Row>
        {c.closeDrawdown < 0 && <Row k="Ниже пика капитала" cls="text-down">{fmtValue(c.closeDrawdown, unit)}</Row>}
      </dl>

      {(c.best || c.worst) && (
        <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
          {c.best && (
            <div className="min-w-0">
              <div className="text-2xs text-muted-foreground">Лучшая сделка</div>
              <div className="truncate"><span className="font-medium text-foreground">{c.best.ticker}</span> <span className={tone(c.best.value)}>{fmtValue(c.best.value, unit)}</span></div>
            </div>
          )}
          {c.worst && c.trades > 1 && (
            <div className="min-w-0">
              <div className="text-2xs text-muted-foreground">Худшая сделка</div>
              <div className="truncate"><span className="font-medium text-foreground">{c.worst.ticker}</span> <span className={tone(c.worst.value)}>{fmtValue(c.worst.value, unit)}</span></div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>{c.timeOrdered ? "по времени закрытия сделок" : "по порядку сделок"}</span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-primary">{week ? "по дням" : "разбор дня"}<ArrowRight className="h-3 w-3" aria-hidden="true" /></span>
      </div>
    </div>
  );
}
