import * as React from "react";
import { ChevronLeft, ChevronRight, Clock, LogIn, LogOut, MoreHorizontal, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { ExecutionKind } from "../types";
import { REPLAY_SPEEDS, replayStarts, type ReplaySpeed, type ReplayStart } from "../lib/replay-clock";
import { chartI18n } from "@/i18n/ns/chart";

export type ReplayMark = { idx: number; kind: ExecutionKind; label: string };

const OPENING = (k: ExecutionKind) => k === "entry" || k === "add";

/**
 * Replay transport under the chart, progressive disclosure:
 *  - always visible: step back · play / pause · step forward · the scrubber (fill marks, the time), the speed (1×–60×
 *    bars per second, keys 1–6) and «к входу» / «к выходу» of the real trade;
 *  - in «⋯»: where to start, the 9:30 open, the next fill, «пауза на исполнениях», back to the start;
 *  - a one-line shortcut hint (hidden on touch-sized screens, where the buttons are the controls).
 */
export function ReplayDock({
  playing, speed, cursor, start, end, marks, timeLabel, startLabel, endLabel,
  startPreset, onStartPreset, hasEntry, intraday, hasExit, nextFillLabel, pauseOnFills, onPauseOnFills, atEnd,
  onToggle, onStep, onSpeed, onSeek, onNextFill, onEntry, onExit, onOpen, onRestart, className,
}: {
  playing: boolean;
  speed: ReplaySpeed;
  cursor: number;
  /** Left edge of the scrubber (the first bar of the day). */
  start: number;
  /** Right edge of the scrubber. */
  end: number;
  marks: ReplayMark[];
  timeLabel: string;
  startLabel: string;
  endLabel: string;
  startPreset: ReplayStart;
  onStartPreset: (s: ReplayStart) => void;
  hasEntry: boolean;
  intraday: boolean;
  hasExit: boolean;
  nextFillLabel: string | null;
  pauseOnFills: boolean;
  onPauseOnFills: (v: boolean) => void;
  /** The cursor is on the last bar of the data. */
  atEnd: boolean;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onSpeed: (s: ReplaySpeed) => void;
  onSeek: (idx: number) => void;
  onNextFill: () => void;
  onEntry: () => void;
  onExit: () => void;
  onOpen: () => void;
  onRestart: () => void;
  className?: string;
}) {
  const { t } = chartI18n.useT();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const close = (fn: () => void) => () => { fn(); setMoreOpen(false); };
  return (
    <div className={cn("@container flex shrink-0 flex-col gap-1.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-2", className)} role="group" aria-label={t("replay.group")}>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t("replay.back")} title={t("replay.backTitle")} onClick={() => onStep(-1)} disabled={cursor <= start}><ChevronLeft /></Button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? t("replay.pause") : t("replay.play")}
          title={playing ? t("replay.pauseTitle") : atEnd ? t("replay.againTitle") : t("replay.playTitle")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-solid text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] transition-opacity duration-[var(--dur-1)] hover:opacity-90 disabled:opacity-40"
        >
          {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />}
        </button>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t("replay.forward")} title={t("replay.forwardTitle")} onClick={() => onStep(1)} disabled={atEnd}><ChevronRight /></Button>
        <Scrubber cursor={cursor} start={start} end={Math.max(cursor, end)} marks={marks} onSeek={onSeek} timeLabel={timeLabel} startLabel={startLabel} endLabel={endLabel} />
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <Segmented size="sm" ariaLabel={t("replay.speed")} value={String(speed)} onChange={(v) => onSpeed(Number(v) as ReplaySpeed)} options={REPLAY_SPEEDS.map((s, i) => ({ value: String(s), label: `${s}×`, title: t("replay.speedKey", { key: i + 1 }) }))} />
        <div className="inline-flex items-center gap-0.5" role="group" aria-label={t("replay.jumps")}>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" title={t("replay.toEntryTitle")} onClick={onEntry} disabled={!hasEntry}><LogIn className="h-3.5 w-3.5" aria-hidden="true" /> {t("replay.toEntry")}</Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" title={t("replay.toExitTitle")} onClick={onExit} disabled={!hasExit}><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> {t("replay.toExit")}</Button>
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("replay.more")} title={t("replay.more")}><MoreHorizontal /></Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-[min(92vw,330px)] flex-col gap-2 p-2.5">
              {intraday && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{t("replay.start")}</span>
                  <Segmented<ReplayStart>
                    size="sm" ariaLabel={t("replay.start")} value={startPreset} onChange={(v) => { onStartPreset(v); setMoreOpen(false); }}
                    options={replayStarts().map((o) => ({ value: o.value, label: o.label, title: o.title, disabled: o.value !== "pre" && o.value !== "open" && !hasEntry }))}
                  />
                </div>
              )}
              <div className="flex flex-col">
                <MenuItem icon={Clock} onClick={close(onOpen)} keys={["Home"]}>{t("replay.toOpen")}</MenuItem>
                <MenuItem icon={SkipForward} onClick={close(onNextFill)} keys={["N"]} disabled={!nextFillLabel} title={nextFillLabel ? t("replay.nextFillTitle", { label: nextFillLabel }) : t("replay.noFillsAhead")}>{t("replay.nextFill")}</MenuItem>
                <MenuItem icon={RotateCcw} onClick={close(onRestart)}>{t("replay.restart")}</MenuItem>
              </div>
              {marks.length > 0 && (
                <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-[var(--glass-border)] px-1 pt-2 text-sm" title={t("replay.pauseOnFillsTitle")}>
                  <span className="inline-flex items-center gap-2">{t("replay.pauseOnFills")} <Kbd>P</Kbd></span>
                  <Switch checked={pauseOnFills} onCheckedChange={onPauseOnFills} aria-label={t("replay.pauseOnFills")} />
                </label>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <ShortcutHint className="ml-auto hidden @2xl:flex" />
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, onClick, keys, disabled, title, children }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; keys?: string[]; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-[var(--glass-hover-bg)] disabled:opacity-50">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> <span className="flex-1">{children}</span>
      {keys?.map((k) => <Kbd key={k}>{k}</Kbd>)}
    </button>
  );
}

/** «Пробел пуск · ← → бар · 1–6 скорость · E вход · X выход» — always in sight on a keyboard-sized screen. */
function ShortcutHint({ className }: { className?: string }) {
  const { t } = chartI18n.useT();
  const items: [string[], string][] = [
    [[t("hotkeys.keySpace")], t("replay.hintPlay")], [["←", "→"], t("replay.hintStep")], [["1–6"], t("replay.hintSpeed")],
    [["E"], t("replay.hintEntry")], [["X"], t("replay.hintExit")],
  ];
  return (
    <p className={cn("items-center gap-2.5 whitespace-nowrap text-2xs text-muted-foreground", className)} aria-label={t("hotkeys.title")}>
      {items.map(([keys, text]) => (
        <span key={text} className="inline-flex items-center gap-1">{keys.map((k) => <Kbd key={k} className="px-1 py-0 text-[10px]">{k}</Kbd>)} {text}</span>
      ))}
    </p>
  );
}

function Scrubber({ cursor, start, end, marks, onSeek, timeLabel, startLabel, endLabel }: {
  cursor: number; start: number; end: number; marks: ReplayMark[]; onSeek: (idx: number) => void; timeLabel: string; startLabel: string; endLabel: string;
}) {
  const { t } = chartI18n.useT();
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef(false);
  const span = Math.max(1, end - start);
  const pos = (i: number) => `${(Math.max(0, Math.min(span, i - start)) / span) * 100}%`;
  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    const i = start + Math.round(frac * span);
    if (i !== cursor) onSeek(i);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t("replay.position")}
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={cursor}
        aria-valuetext={timeLabel}
        className="relative h-6 cursor-pointer touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) seek(e.clientX); }}
        onPointerUp={(e) => { dragging.current = false; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: pos(cursor) }} aria-hidden="true" />
        {spread(marks.filter((m) => m.idx >= start && m.idx <= end)).map(({ m, dx }, i) => (
          <span
            key={`${m.idx}-${i}`}
            className={cn("absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background", OPENING(m.kind) ? "bg-primary" : "bg-purple")}
            style={{ left: `calc(${pos(m.idx)} + ${dx}px)` }}
            title={m.label}
            aria-hidden="true"
          />
        ))}
        <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm" style={{ left: pos(cursor) }} aria-hidden="true" />
      </div>
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
        <span>{startLabel}</span>
        <span className="text-xs font-medium text-foreground">{timeLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

/** Fills on the same bar are fanned out a few pixels so each stays visible. */
function spread(marks: ReplayMark[]): { m: ReplayMark; dx: number }[] {
  const count = new Map<number, number>();
  for (const m of marks) count.set(m.idx, (count.get(m.idx) ?? 0) + 1);
  const seen = new Map<number, number>();
  return marks.map((m) => {
    const n = count.get(m.idx) ?? 1;
    const k = seen.get(m.idx) ?? 0;
    seen.set(m.idx, k + 1);
    return { m, dx: (k - (n - 1) / 2) * 6 };
  });
}
