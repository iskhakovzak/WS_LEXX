import * as React from "react";
import { Camera, ChevronDown, Eraser, Layers, Loader2, MousePointer2, MoveHorizontal, Square, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { ChartMode, DrawingType, Timeframe } from "../types";
import { TF_LABEL } from "../types";
import { DRAWING_LABEL } from "../lib/drawings";

export type Overlays = {
  session: boolean;
  vwap: boolean;
  avwap: boolean;
  levels: boolean;
  orb: boolean;
  profile: boolean;
  events: boolean;
  zone: boolean;
  excursion: boolean;
  stopTarget: boolean;
};

/** A small default set; the rest is off until switched on in «Слои». */
export const DEFAULT_OVERLAYS: Overlays = {
  session: true, vwap: true, avwap: false, levels: true, orb: false, profile: false, events: false, zone: true, excursion: false, stopTarget: false,
};

/** Extra panes below the price pane. */
export type PaneToggles = { volume: boolean; pnl: boolean };
export const DEFAULT_PANES: PaneToggles = { volume: true, pnl: true };

const OVERLAY_LABEL: Record<keyof Overlays, string> = {
  session: "Сессии", vwap: "VWAP ±σ", avwap: "AVWAP от входа", levels: "Уровни (PDH/PDL/PDC, PMH/PML)", orb: "ORB 5/15", profile: "Профиль объёма", events: "События", zone: "Позиция (зона входа–выхода)", excursion: "MFE/MAE", stopTarget: "Стоп / цель",
};
/** Everything sits under one «Слои (n) ▾» menu (design audit: one row of controls instead of three). */
const ALL: readonly (keyof Overlays)[] = ["zone", "session", "vwap", "levels", "avwap", "orb", "profile", "excursion", "stopTarget", "events"];
const PANE_LABEL: Record<keyof PaneToggles, string> = { volume: "Объём", pnl: "P&L позиции" };

const MODE_LABEL: Record<ChartMode, string> = { analysis: "Анализ", replay: "Реплей", training: "Тренировка" };

const TOOL_ICON: Record<DrawingType, React.ComponentType<{ className?: string }>> = { hline: MoveHorizontal, trend: TrendingUp, rect: Square, fib: Layers };

function CheckRow({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cn("flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--glass-bg)]", disabled && "cursor-not-allowed opacity-50")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span>{label}</span>
    </label>
  );
}

export function ChartToolbar({
  timeframe, timeframes, onTimeframe, mode, onMode, overlays, onOverlay, panes, onPane, tool, onTool, drawingsCount, onClearDrawings, onScreenshot, fetching, hasEvents, hasStopOrTarget, hasPosition, className,
}: {
  timeframe: Timeframe;
  timeframes: readonly Timeframe[];
  onTimeframe: (tf: Timeframe) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  overlays: Overlays;
  onOverlay: (k: keyof Overlays, v: boolean) => void;
  panes: PaneToggles;
  onPane: (k: keyof PaneToggles, v: boolean) => void;
  tool: DrawingType | null;
  onTool: (t: DrawingType | null) => void;
  drawingsCount: number;
  onClearDrawings: () => void;
  onScreenshot: () => void;
  fetching?: boolean;
  hasEvents: boolean;
  hasStopOrTarget: boolean;
  /** Whether a P&L series exists for this trade (pane toggle is disabled otherwise). */
  hasPosition: boolean;
  className?: string;
}) {
  const uid = React.useId();
  const available = ALL.filter((k) => (k !== "events" || hasEvents) && (k !== "stopTarget" || hasStopOrTarget));
  const onCount = available.filter((k) => overlays[k]).length + (panes.volume ? 1 : 0) + (panes.pnl && hasPosition ? 1 : 0);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Segmented size="sm" ariaLabel="Таймфрейм" value={timeframe} onChange={onTimeframe} options={timeframes.map((tf) => ({ value: tf, label: TF_LABEL[tf] }))} />
      <Segmented size="sm" ariaLabel="Режим" value={mode} onChange={onMode} options={(["analysis", "replay", "training"] as ChartMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-[var(--dur-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "border-[var(--field-border)] bg-[var(--glass-bg)] text-foreground hover:border-primary/40",
            )}
            aria-label={`Слои и панели, включено: ${onCount}`}
          >
            <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Слои
            <span className="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary">{onCount}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(90vw,280px)] p-2">
          <div className="px-1.5 pb-1 text-xs font-semibold text-muted-foreground">На графике</div>
          {available.map((k) => <CheckRow key={k} id={`${uid}-ov-${k}`} label={OVERLAY_LABEL[k]} checked={overlays[k]} onChange={(v) => onOverlay(k, v)} />)}
          <div className="mt-2 border-t border-[var(--glass-border)] px-1.5 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Панели под графиком</div>
          <CheckRow id={`${uid}-pane-volume`} label={PANE_LABEL.volume} checked={panes.volume} onChange={(v) => onPane("volume", v)} />
          <CheckRow id={`${uid}-pane-pnl`} label={PANE_LABEL.pnl} checked={panes.pnl && hasPosition} disabled={!hasPosition} onChange={(v) => onPane("pnl", v)} />
        </PopoverContent>
      </Popover>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="Инструменты рисования">
        <Button variant={tool == null ? "secondary" : "ghost"} size="icon" className="h-8 w-8" aria-label="Выбор (Esc)" aria-pressed={tool == null} onClick={() => onTool(null)}><MousePointer2 /></Button>
        {(Object.keys(TOOL_ICON) as DrawingType[]).map((t) => {
          const Icon = TOOL_ICON[t];
          return (
            <Button key={t} variant={tool === t ? "secondary" : "ghost"} size="icon" className="h-8 w-8" aria-label={DRAWING_LABEL[t]} title={DRAWING_LABEL[t]} aria-pressed={tool === t} onClick={() => onTool(tool === t ? null : t)}><Icon /></Button>
          );
        })}
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Удалить все рисунки" title={drawingsCount ? `Удалить рисунки (${drawingsCount})` : "Рисунков нет"} onClick={onClearDrawings} disabled={!drawingsCount}><Eraser /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Скриншот графика (PNG)" title="Скриншот PNG" onClick={onScreenshot}><Camera /></Button>
        {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Загрузка" />}
      </div>
    </div>
  );
}
