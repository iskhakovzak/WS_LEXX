import * as React from "react";
import { Camera, ChevronDown, Eraser, Keyboard, Layers, Loader2, Maximize2, Minimize2, MousePointer2, MoveHorizontal, Pencil, Scan, Square, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { ChartMode, DrawingType, Timeframe } from "../types";
import { TF_LABEL } from "../types";
import { timeframeUnavailableReason } from "../lib/aggregate";
import { DRAWING_LABEL } from "../lib/drawings";

export type Overlays = {
  session: boolean;
  vwap: boolean;
  vwapBands: boolean;
  avwap: boolean;
  levels: boolean;
  orb: boolean;
  profile: boolean;
  events: boolean;
  zone: boolean;
  excursion: boolean;
  stopTarget: boolean;
};

/** A calm default: candles, volume, VWAP line, key levels and the position zone. Everything else is opt-in. */
export const DEFAULT_OVERLAYS: Overlays = {
  session: true, vwap: true, vwapBands: false, avwap: false, levels: true, orb: false, profile: false, events: false, zone: true, excursion: false, stopTarget: true,
};

/** Volume is an overlay at the bottom of the price pane; the P&L pane is an optional pane below. */
export type PaneToggles = { volume: boolean; pnl: boolean };
export const DEFAULT_PANES: PaneToggles = { volume: true, pnl: false };

const OVERLAY_LABEL: Record<keyof Overlays, string> = {
  session: "Пре/постмаркет (фон)", vwap: "VWAP", vwapBands: "VWAP ±1σ/2σ", avwap: "AVWAP от входа", levels: "Уровни PDH/PDL/PDC, PMH/PML", orb: "ORB 5/15",
  profile: "Профиль объёма", events: "События", zone: "Позиция (зона входа–выхода)", excursion: "MFE / MAE", stopTarget: "Стоп / цель",
};
/** Shown in the «Слои» menu (VWAP, levels and volume also have one-click chips in the bar). */
const MENU: readonly (keyof Overlays)[] = ["zone", "stopTarget", "vwapBands", "avwap", "orb", "profile", "excursion", "session", "events"];
/** Overlays that would reveal the real trade — locked off in training until the reveal. */
export const TRADE_OVERLAYS: readonly (keyof Overlays)[] = ["zone", "avwap", "excursion", "stopTarget"];

const MODE_LABEL: Record<ChartMode, string> = { analysis: "Анализ", replay: "Реплей", training: "Тренировка" };
const TOOL_ICON: Record<DrawingType, React.ComponentType<{ className?: string }>> = { hline: MoveHorizontal, trend: TrendingUp, rect: Square, fib: Layers };

function CheckRow({ id, label, checked, onChange, disabled, note }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <label htmlFor={id} title={note} className={cn("flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--glass-bg)]", disabled && "cursor-not-allowed opacity-50")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span>{label}</span>
    </label>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export type HotkeyRow = [keys: string[], text: string];

export function HotkeysHelp({ rows, className }: { rows: HotkeyRow[]; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8 shrink-0 text-muted-foreground", className)} aria-label="Горячие клавиши" title="Горячие клавиши">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="mb-2 text-xs font-semibold">Горячие клавиши</p>
        <ul className="flex flex-col gap-1.5 text-xs">
          {rows.map(([keys, text]) => (
            <li key={text} className="flex items-center justify-between gap-3">
              <span className="inline-flex shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              <span className="text-right text-muted-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One compact row: timeframe · mode · VWAP / Уровни / Объём chips · «Слои ▾» · drawing · fit · screenshot · hotkeys ·
 * fullscreen. Scrolls sideways on a phone instead of wrapping into three rows.
 */
export function ChartToolbar({
  timeframe, timeframes, allTimeframes, baseSec, onTimeframe, mode, onMode, showModes = true, overlays, onOverlay, panes, onPane, hasPosition, hasEvents, hasStopOrTarget, lockTrade,
  tool, onTool, drawingsCount, onClearDrawings, onScreenshot, onFit, onFullscreen, fullscreen, fetching, hotkeys, className,
}: {
  timeframe: Timeframe;
  /** Timeframes the loaded bars allow. */
  timeframes: readonly Timeframe[];
  /** All timeframes to show; those not in `timeframes` are drawn disabled with the reason in the tooltip. */
  allTimeframes?: readonly Timeframe[];
  /** Seconds per served bar (for the reason text). */
  baseSec?: number;
  onTimeframe: (tf: Timeframe) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  showModes?: boolean;
  overlays: Overlays;
  onOverlay: (k: keyof Overlays, v: boolean) => void;
  panes: PaneToggles;
  onPane: (k: keyof PaneToggles, v: boolean) => void;
  hasPosition: boolean;
  hasEvents: boolean;
  hasStopOrTarget: boolean;
  /** Training before the reveal: overlays that show the real trade are locked off. */
  lockTrade: boolean;
  tool: DrawingType | null;
  onTool: (t: DrawingType | null) => void;
  drawingsCount: number;
  onClearDrawings: () => void;
  onScreenshot: () => void;
  onFit: () => void;
  onFullscreen: () => void;
  fullscreen: boolean;
  fetching?: boolean;
  hotkeys: HotkeyRow[];
  className?: string;
}) {
  const uid = React.useId();
  const menu = MENU.filter((k) => (k !== "events" || hasEvents) && (k !== "stopTarget" || hasStopOrTarget));
  const onCount = menu.filter((k) => overlays[k] && !(lockTrade && TRADE_OVERLAYS.includes(k))).length + (panes.pnl && hasPosition ? 1 : 0);
  const ToolIcon = tool ? TOOL_ICON[tool] : Pencil;
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]", className)} role="toolbar" aria-label="Панель графика">
      <Segmented
        size="sm" ariaLabel="Таймфрейм (T)" value={timeframe} onChange={onTimeframe} className="shrink-0"
        options={(allTimeframes ?? timeframes).map((tf) => {
          const reason = timeframes.includes(tf) ? null : baseSec != null ? timeframeUnavailableReason(tf, baseSec) : "Нет данных";
          return { value: tf, label: TF_LABEL[tf], disabled: reason != null, title: reason ?? undefined };
        })}
      />
      {showModes && (
        <Segmented size="sm" ariaLabel="Режим" value={mode} onChange={onMode} options={(["analysis", "replay", "training"] as ChartMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} className="shrink-0" />
      )}
      <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--glass-border)]" aria-hidden="true" />
      <Chip on={overlays.vwap} onClick={() => onOverlay("vwap", !overlays.vwap)} title="VWAP сессии">VWAP</Chip>
      <Chip on={overlays.levels} onClick={() => onOverlay("levels", !overlays.levels)} title="PDH / PDL / PDC и хай/лоу премаркета">Уровни</Chip>
      <Chip on={panes.volume} onClick={() => onPane("volume", !panes.volume)} title="Объём внизу графика">Объём</Chip>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--glass-hover-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ещё слои, включено: ${onCount}`}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" /> Слои
            {onCount > 0 && <span className="rounded-full bg-primary/15 px-1.5 tabular-nums text-primary">{onCount}</span>}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(90vw,290px)] p-2">
          {menu.map((k) => {
            const locked = lockTrade && TRADE_OVERLAYS.includes(k);
            return <CheckRow key={k} id={`${uid}-ov-${k}`} label={OVERLAY_LABEL[k]} checked={overlays[k] && !locked} disabled={locked} note={locked ? "Скрыто до конца тренировки — иначе видно реальную сделку" : undefined} onChange={(v) => onOverlay(k, v)} />;
          })}
          <div className="mt-1 border-t border-[var(--glass-border)] pt-1">
            <CheckRow id={`${uid}-pane-pnl`} label="Панель P&L позиции" checked={panes.pnl && hasPosition && !lockTrade} disabled={!hasPosition || lockTrade} onChange={(v) => onPane("pnl", v)} />
          </div>
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
        {fetching && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Загрузка" />}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={tool ? "secondary" : "ghost"} size="icon" className="h-8 w-8" aria-label={tool ? `Рисование: ${DRAWING_LABEL[tool]}` : "Рисование"} title="Рисование">
              <ToolIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1.5">
            <button type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--glass-bg)]", tool == null && "text-primary")} onClick={() => onTool(null)}>
              <MousePointer2 className="h-4 w-4" aria-hidden="true" /> Курсор <Kbd className="ml-auto">Esc</Kbd>
            </button>
            {(Object.keys(TOOL_ICON) as DrawingType[]).map((t) => {
              const Icon = TOOL_ICON[t];
              return (
                <button key={t} type="button" aria-pressed={tool === t} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--glass-bg)]", tool === t && "text-primary")} onClick={() => onTool(tool === t ? null : t)}>
                  <Icon className="h-4 w-4" aria-hidden="true" /> {DRAWING_LABEL[t]}
                </button>
              );
            })}
            <button type="button" disabled={!drawingsCount} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-[var(--glass-border)] px-2 py-1.5 text-sm text-muted-foreground hover:bg-[var(--glass-bg)] disabled:opacity-50" onClick={onClearDrawings}>
              <Eraser className="h-4 w-4" aria-hidden="true" /> Удалить рисунки{drawingsCount ? ` (${drawingsCount})` : ""}
            </button>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Показать сделку целиком (F)" title="Показать сделку целиком — F" onClick={onFit}><Scan /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Скриншот графика (PNG)" title="Скриншот PNG" onClick={onScreenshot}><Camera /></Button>
        <HotkeysHelp rows={hotkeys} />
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран (Shift+F)"} title={fullscreen ? "Свернуть — Esc" : "На весь экран — Shift+F"} onClick={onFullscreen}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
    </div>
  );
}
