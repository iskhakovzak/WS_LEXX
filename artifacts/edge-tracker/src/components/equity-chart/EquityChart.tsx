/**
 * <EquityChart> — the equity curve on our own canvas engine (./engine.ts).
 *
 *   <EquityChart days={buildDayCandles(trades, "net")} unit="net" trader="Ориф" storageKey="analytics.equity" />
 *   <EquityChart days={fromDashboardDays(data.days, "net")} unit="net" period={{ value, options, onChange }} />
 *
 * Views: candles (body = start → end of the day, wicks = intraday best / worst of the cumulative curve) or a
 * line with an area split green above / red below the start; aggregation day / week / month. Presets 1Н–Всё
 * zoom the loaded curve (or, with `period`, ask the host for another server window). Drag to pan, ctrl / ⌘ +
 * wheel or pinch to zoom, double-click to reset, navigator strip below to jump anywhere. Hover → rich card;
 * click a day → «Разбор дня», a week / month → open it by days. Keyboard: ← → Home End Enter + − Esc.
 */
import * as React from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, CandlestickChart, LineChart as LineIcon, SlidersHorizontal } from "lucide-react";
import { EmptyState, Segmented, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { weekHref } from "@/lib/period-links";
import { readChartTheme } from "@/components/chart-engine/theme";
import { useThemeVersion } from "@/components/chart-engine/hooks/useThemeVersion";
import { dayReportHref, fmtValue, rangeRu, type EquityCandle, type EquityUnit } from "@/components/equity-candles/lib";
import { aggregate, derive, windowStats, type EquityAgg } from "./model";
import { EquityEngine, type HoverInfo, type ViewMode } from "./engine";
import { candleText } from "./render";
import { EquityTooltip, candleTitle } from "./tooltip";
import {
  PRESETS, ensureVisible, fullView, indexFrom, presetUseful, presetView, rangeView, visibleRange, type Preset, type View,
} from "./viewport";

export interface EquityPeriodControl<T extends string> {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}

export interface EquityChartProps<T extends string = string> {
  /** Day candles, chronological (buildDayCandles / fromDashboardDays / fromOhlc). */
  days: EquityCandle[];
  unit: EquityUnit;
  /** Trader for the day-report link (none — the report opens for the viewer). */
  trader?: string | null;
  /** Height of the drawing area in px (panes + time axis + navigator); "fill" — take the parent's free height. */
  height?: number | "fill";
  /** localStorage namespace for the view / aggregation / preset / panes. */
  storageKey: string;
  /** Server-side window instead of zoom presets (dashboard). */
  period?: EquityPeriodControl<T>;
  /** Defaults for a fresh viewer (per host). */
  defaults?: Partial<Prefs>;
  /** Visible-window numbers in the toolbar (result, green days, drawdown). */
  showSummary?: boolean;
  /** Shown instead of the built-in empty state. */
  empty?: React.ReactNode;
  className?: string;
}

interface Panes { pnl: boolean; dd: boolean; nav: boolean; marks: boolean }
interface Prefs { mode: ViewMode; agg: EquityAgg; preset: Preset; panes: Panes }

const DEFAULTS: Prefs = { mode: "candles", agg: "day", preset: "all", panes: { pnl: false, dd: true, nav: true, marks: true } };
const NAV_MIN_BARS = 12;

const AGG_OPTIONS: { value: EquityAgg; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Нед" },
  { value: "month", label: "Мес" },
];

export function EquityChart<T extends string = string>({
  days, unit, trader, height = 380, storageKey, period, defaults, showSummary = true, empty, className,
}: EquityChartProps<T>) {
  const [, navigate] = useLocation();
  const themeVersion = useThemeVersion();
  const base = { ...DEFAULTS, ...defaults, panes: { ...DEFAULTS.panes, ...defaults?.panes } };
  const [mode, setMode] = usePersistentState<ViewMode>(`${storageKey}.mode`, base.mode);
  const [agg, setAgg] = usePersistentState<EquityAgg>(`${storageKey}.agg`, base.agg);
  const [presetPref, setPresetPref] = usePersistentState<Preset>(`${storageKey}.preset`, base.preset);
  const [panesPref, setPanes] = usePersistentState<Panes>(`${storageKey}.panes`, base.panes);
  const panes = { ...base.panes, ...panesPref };
  const [custom, setCustom] = React.useState(false);

  const bars = React.useMemo(() => aggregate(days, agg), [days, agg]);
  const derived = React.useMemo(() => derive(bars), [bars]);
  const tos = React.useMemo(() => bars.map((b) => b.to), [bars]);
  const n = bars.length;
  const showNav = panes.nav && n >= NAV_MIN_BARS;

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const engineRef = React.useRef<EquityEngine | null>(null);
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const [selected, setSelected] = React.useState(-1);
  const [visible, setVisible] = React.useState<[number, number]>([0, Math.max(0, n - 1)]);
  const [hint, setHint] = React.useState(false);
  const [touch, setTouch] = React.useState(false);
  const focusRange = React.useRef<{ from: string; to: string } | null>(null);
  /** The week opened by days (click on a weekly candle) — offers its weekly review. */
  const [drill, setDrill] = React.useState<{ from: string; to: string } | null>(null);
  const prev = React.useRef<{ agg: EquityAgg; first: string; last: string; n: number; view: View; bars: EquityCandle[] } | null>(null);

  // Latest values for the engine callbacks (created once).
  const live = React.useRef({ bars, agg, trader, navigate, setAgg, n, setDrill });
  live.current = { bars, agg, trader, navigate, setAgg, n, setDrill };

  const activate = React.useCallback((i: number) => {
    const s = live.current;
    const c = s.bars[i];
    if (!c) return;
    if (s.agg !== "day") {
      // A week / month opens by days, zoomed to that span.
      focusRange.current = { from: c.from, to: c.to };
      s.setDrill(s.agg === "week" ? { from: c.from, to: c.to } : null);
      s.setAgg("day");
      return;
    }
    s.navigate(dayReportHref(c.key, s.trader));
  }, []);

  // ── Engine lifecycle ──
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let pendingView: [number, number] | null = null;
    let hintTimer: ReturnType<typeof setTimeout> | null = null;
    const eng = new EquityEngine(host, readChartTheme(), {
      onHover: setHover,
      onActivate: (i) => activate(i),
      onView: (v, user) => {
        if (user) setCustom(true);
        pendingView = visibleRange(v, live.current.n);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pendingView) setVisible(pendingView); });
      },
      onWheelHint: () => {
        setHint(true);
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => setHint(false), 1400);
      },
    });
    engineRef.current = eng;
    const onPointer = (e: PointerEvent) => setTouch(e.pointerType === "touch");
    host.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      host.removeEventListener("pointerdown", onPointer);
      if (raf) cancelAnimationFrame(raf);
      if (hintTimer) clearTimeout(hintTimer);
      eng.destroy();
      engineRef.current = null;
      prev.current = null;
    };
    // The host div exists only with data; re-create when it (re)appears.
  }, [activate, n > 0]);

  React.useEffect(() => { engineRef.current?.setTheme(readChartTheme()); }, [themeVersion]);
  React.useEffect(() => {
    engineRef.current?.setOptions({ mode, pnl: panes.pnl, dd: panes.dd, nav: showNav, marks: panes.marks });
  }, [mode, panes.pnl, panes.dd, panes.marks, showNav, n > 0]);

  // ── Data → engine, choosing where to look ──
  React.useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !n) return;
    const p = prev.current;
    let view: View;
    let fade = false;
    const fr = focusRange.current;
    focusRange.current = null;
    if (fr && agg === "day") {
      view = rangeView(tos, fr.from, fr.to);
      fade = true;
      setCustom(true);
    } else if (p && p.agg !== agg && p.n) {
      // Aggregation switch: keep the same dates in view.
      const [a, b] = visibleRange(p.view, p.n);
      const i0 = indexFrom(tos, p.bars[a]?.from ?? tos[0]);
      const i1 = Math.min(n - 1, indexFrom(tos, p.bars[b]?.to ?? tos[n - 1]));
      const full = fullView(n);
      view = a <= 0 && b >= p.n - 1 ? full : { from: i0 - 0.5, to: i1 + 1.5 };
      fade = true;
    } else if (p && p.n === n && p.first === bars[0].key && p.last === bars[n - 1].key) {
      // Same days (unit switch, refetch): stay put.
      view = p.view;
      fade = true;
    } else {
      view = period ? fullView(n) : custom ? fullView(n) : presetView(tos, presetPref);
      if (!period && custom) setCustom(false);
    }
    eng.setData(bars, derived, unit, agg, { view, fade });
    prev.current = { agg, first: bars[0].key, last: bars[n - 1].key, n, view: eng.getView(), bars };
    setSelected(-1);
    // presetPref / custom / period are read once per data swap on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, derived, unit, n > 0]);

  // Track the current view for the next swap.
  React.useEffect(() => {
    if (prev.current && engineRef.current) prev.current.view = engineRef.current.getView();
  }, [visible]);

  React.useEffect(() => { engineRef.current?.setSelected(selected); }, [selected]);

  const applyPreset = (p: Preset) => {
    setDrill(null);
    setPresetPref(p);
    setCustom(false);
    engineRef.current?.setView(presetView(tos, p));
  };

  const resetZoom = () => {
    setDrill(null);
    setCustom(false);
    if (period) engineRef.current?.setView(fullView(n));
    else applyPreset("all");
  };

  // ── Keyboard ──
  const step = (to: number) => {
    const eng = engineRef.current;
    if (!eng || !n) return;
    const i = Math.max(0, Math.min(n - 1, to));
    setSelected(i);
    const v = eng.getView();
    const nv = ensureVisible(v, i, n);
    if (nv !== v) eng.setView(nv, { user: true });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!n) return;
    const eng = engineRef.current;
    const v1 = visible[1];
    const cur = selected >= 0 ? selected : -1;
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); step(cur < 0 ? v1 : cur - 1); break;
      case "ArrowRight": e.preventDefault(); step(cur < 0 ? v1 : cur + 1); break;
      case "Home": e.preventDefault(); step(0); break;
      case "End": e.preventDefault(); step(n - 1); break;
      case "Enter": case " ":
        if (cur >= 0) { e.preventDefault(); activate(cur); }
        break;
      case "+": case "=": e.preventDefault(); eng?.zoom(0.7); break;
      case "-": case "_": e.preventDefault(); eng?.zoom(1 / 0.7); break;
      case "0": e.preventDefault(); resetZoom(); break;
      case "Escape": setSelected(-1); break;
    }
  };

  // ── Derived UI numbers ──
  const win = React.useMemo(() => windowStats(bars, visible[0], visible[1]), [bars, visible]);
  const all = React.useMemo(() => windowStats(bars, 0, n - 1), [bars, n]);
  const hoverBar = hover ? bars[hover.index] ?? null : null;
  const selBar = selected >= 0 ? bars[selected] ?? null : null;
  const unitLabel = unit === "r" ? "R" : unit === "gross" ? "брутто, $" : "нетто, $";
  const aggWord = agg === "week" ? ["неделя", "недели", "недель"] : agg === "month" ? ["месяц", "месяца", "месяцев"] : ["день", "дня", "дней"];
  const presetValue: Preset | "custom" = custom ? "custom" : presetPref;
  const fillH = height === "fill";

  const srSummary = all
    ? `Кривая капитала, ${unitLabel}: итог ${fmtValue(all.result, unit)} за ${all.bars} ${aggWord[2]}` +
      (derived.best >= 0 ? `; лучший — ${candleTitle(bars[derived.best], agg)}, ${fmtValue(bars[derived.best].value, unit)}` : "") +
      (derived.worst >= 0 ? `; худший — ${candleTitle(bars[derived.worst], agg)}, ${fmtValue(bars[derived.worst].value, unit)}` : "") +
      `; макс. просадка ${fmtValue(derived.maxDrawdown, unit)}.`
    : "";

  if (!days.length) {
    return (
      <div className={cn("flex min-w-0 flex-col", fillH && "flex-1", className)}>
        {empty ?? <EmptyState compact icon={CandlestickChart} title="Нет закрытых сделок" description={`Кривая строится по сделкам с ${unit === "r" ? "R" : "P&L"}.`} />}
      </div>
    );
  }

  return (
    <div className={cn("@container flex min-w-0 flex-col gap-2.5", fillH && "min-h-0 flex-1", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Segmented<ViewMode>
          size="sm" ariaLabel="Вид кривой" value={mode} onChange={setMode}
          options={[
            { value: "candles", label: <><CandlestickChart className="h-3.5 w-3.5" aria-hidden="true" /><span className="@max-2xl:sr-only">Свечи</span></> },
            { value: "line", label: <><LineIcon className="h-3.5 w-3.5" aria-hidden="true" /><span className="@max-2xl:sr-only">Линия</span></> },
          ]}
        />
        <Segmented<EquityAgg> size="sm" ariaLabel="Свеча — день, неделя или месяц" value={agg} onChange={(v) => { setDrill(null); setAgg(v); }} options={AGG_OPTIONS} />
        {period ? (
          <Segmented<T> size="sm" ariaLabel="Период" value={period.value} onChange={period.onChange} options={period.options} />
        ) : (
          <Segmented<Preset | "custom">
            size="sm" ariaLabel="Окно просмотра" value={presetValue} onChange={(v) => v !== "custom" && applyPreset(v)}
            options={PRESETS.map((p) => ({ value: p.value, label: <span title={p.title}>{p.label}</span>, disabled: !presetUseful(tos, p.value) }))}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-2.5 text-xs" aria-label="Панели графика">
              <SlidersHorizontal aria-hidden="true" /><span className="@max-2xl:sr-only">Панели</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Под графиком</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={panes.pnl} onCheckedChange={(v) => setPanes({ ...panes, pnl: v === true })}>
              P&L по {agg === "week" ? "неделям" : agg === "month" ? "месяцам" : "дням"}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={panes.dd} onCheckedChange={(v) => setPanes({ ...panes, dd: v === true })}>Просадка от пика</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={panes.nav} disabled={n < NAV_MIN_BARS} onCheckedChange={(v) => setPanes({ ...panes, nav: v === true })}>Навигатор</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={panes.marks} onCheckedChange={(v) => setPanes({ ...panes, marks: v === true })}>Пик и отметки</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetZoom}>Показать всё</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {showSummary && win && (
          <dl className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground" aria-live="off">
            <div className="flex items-baseline gap-1.5" title={`Видимое окно: ${rangeRu(win.from, win.to)}`}>
              <dt className="@max-2xl:sr-only">{rangeRu(win.from, win.to)}</dt>
              <dd className={cn("text-sm font-semibold", win.result > 0 ? "text-up" : win.result < 0 ? "text-down" : "text-foreground")}>{fmtValue(win.result, unit)}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>В плюс</dt>
              <dd className="text-foreground"><span className="text-up">{win.green}</span>/{win.bars}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt>Просадка</dt>
              <dd className={win.maxDrawdown < 0 ? "text-down" : "text-foreground"}>{fmtValue(win.maxDrawdown, unit)}</dd>
            </div>
          </dl>
        )}
        {drill && (
          <Link
            href={weekHref(drill.from, trader)}
            className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-primary hover:bg-primary/10", !(showSummary && win) && "ml-auto")}
            title={`Отчёт недели ${rangeRu(drill.from, drill.to)}`}
          >
            Отчёт недели <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-roledescription="интерактивный график"
        aria-label={`${srSummary} Стрелки — по ${agg === "day" ? "дням" : agg === "week" ? "неделям" : "месяцам"}, Enter — ${agg === "day" ? "разбор дня" : "раскрыть по дням"}, плюс и минус — масштаб, 0 — всё.`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter + - 0 Escape"
        onKeyDown={onKeyDown}
        onBlur={() => setSelected(-1)}
        className={cn(
          "relative select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          fillH && "min-h-[240px] flex-1",
        )}
        style={fillH ? undefined : { height }}
      >
        <div ref={hostRef} className="absolute inset-0 isolate" />
        {hover && hoverBar && (
          <EquityTooltip
            c={hoverBar} unit={unit} agg={agg} underwater={derived.underwater[hover.index] ?? 0}
            x={hover.x} width={hover.width} top={hover.plotTop + 4} touch={touch}
          />
        )}
        {hint && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 z-raised flex justify-center" aria-hidden="true">
            <span className="glass-thick rounded-full border border-border/70 px-3 py-1.5 text-xs text-foreground shadow-lg">
              Ctrl + колесо — масштаб · перетащите — сдвиг
            </span>
          </div>
        )}
        <span className="sr-only" aria-live="polite">{selBar ? `${candleTitle(selBar, agg)}: ${candleText(selBar, unit)}` : ""}</span>
      </div>

      <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground @lg:flex">
        <span>Перетащите — сдвиг</span>
        <span>Ctrl + колесо — масштаб</span>
        <span>Двойной клик — всё</span>
        <span>Клик по {agg === "day" ? "дню — разбор дня" : agg === "week" ? "неделе — по дням и отчёт недели" : "месяцу — по дням"}</span>
        {mode === "candles" && <span className="ml-auto max-w-full @max-3xl:hidden">Свеча: тело — начало → конец {agg === "day" ? "дня" : agg === "week" ? "недели" : "месяца"}, фитили — лучшая и худшая точка, {unitLabel}</span>}
      </p>
    </div>
  );
}
