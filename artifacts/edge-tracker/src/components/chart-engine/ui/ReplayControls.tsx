import * as React from "react";
import { ChevronLeft, ChevronRight, Keyboard, LogIn, LogOut, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { ExecutionKind, PositionState, Side } from "../types";
import { fmtMoney } from "../lib/format";

export const REPLAY_SPEEDS = [1, 2, 5, 10] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Where the replay starts: N minutes before the entry or the regular-session open of the trade day. */
export type ReplayStart = "5" | "15" | "30" | "open";
export const REPLAY_STARTS: { value: ReplayStart; label: string }[] = [
  { value: "5", label: "−5м" },
  { value: "15", label: "−15м" },
  { value: "30", label: "−30м" },
  { value: "open", label: "открытие" },
];

export type ReplayMark = { idx: number; kind: ExecutionKind; label: string };
export type ReplayEvent = { kind: ExecutionKind; label: string; current: boolean };

const OPENING = (k: ExecutionKind) => k === "entry" || k === "add";

/**
 * Compact replay dock under the chart (fixed rows, so neither the chart nor the content below moves when
 * the state changes): big play, scrubber with fill marks, live position P&L, speeds, start point,
 * «пауза на исполнениях», jumps and a hotkey cheat-sheet. In training the scrubber cannot seek past the
 * furthest bar already watched, and exit marks are not drawn.
 */
export function ReplayControls({
  playing, speed, cursor, start, last, viewEnd, frontier, training, marks, timeLabel, startLabel,
  hasEntry, hasExit, nextFillLabel, startPreset, canStartAtOpen, pauseOnFills, position, side, event,
  onToggle, onStep, onSpeed, onSeek, onNextFill, onEntry, onExit, onRestart, onStartPreset, onPauseOnFills, className,
}: {
  playing: boolean;
  speed: ReplaySpeed;
  cursor: number;
  start: number;
  last: number;
  /** Right edge of the scrubber (a window around the trade, not the whole loaded day; grows with the cursor). */
  viewEnd: number;
  /** Furthest index the scrubber may seek to (training: the furthest bar already revealed). */
  frontier: number;
  training: boolean;
  /** Fills visible in this mode (training: opening fills only until the answer is given). */
  marks: ReplayMark[];
  timeLabel: string;
  startLabel: string;
  hasEntry: boolean;
  hasExit: boolean;
  nextFillLabel: string | null;
  startPreset: ReplayStart;
  canStartAtOpen: boolean;
  pauseOnFills: boolean;
  position: PositionState | null;
  side: Side;
  event: ReplayEvent | null;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onSpeed: (s: ReplaySpeed) => void;
  onSeek: (idx: number) => void;
  onNextFill: () => void;
  onEntry: () => void;
  onExit: () => void;
  onRestart: () => void;
  onStartPreset: (s: ReplayStart) => void;
  onPauseOnFills: (v: boolean) => void;
  className?: string;
}) {
  const atEnd = cursor >= last;
  return (
    <div className={cn("@container flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2.5", className)} role="group" aria-label="Реплей">
      <div className="flex flex-wrap items-center gap-3 @2xl:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          disabled={atEnd && !playing && training}
          aria-label={playing ? "Пауза (пробел)" : atEnd ? "Сначала (пробел)" : "Играть (пробел)"}
          title={playing ? "Пауза — пробел" : atEnd ? "Проиграть сначала — пробел" : "Играть — пробел"}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-solid text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] transition-opacity duration-[var(--dur-1)] hover:opacity-90 disabled:opacity-40"
        >
          {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />}
        </button>
        <Scrubber cursor={cursor} start={start} last={Math.max(cursor, Math.min(last, viewEnd))} frontier={frontier} training={training} marks={marks} onSeek={onSeek} timeLabel={timeLabel} startLabel={startLabel} event={event} />
        <PnlCounter position={position} side={side} />
        <HotkeysHelp training={training} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <div className="inline-flex items-center gap-1" role="group" aria-label="Шаги">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Бар назад (←)" title="Бар назад — ←" onClick={() => onStep(-1)} disabled={cursor <= start}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Бар вперёд (→)" title="Бар вперёд — →" onClick={() => onStep(1)} disabled={atEnd}><ChevronRight /></Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" aria-label="К следующему исполнению (N)" title={nextFillLabel ? `К следующему исполнению — N: ${nextFillLabel}` : "Исполнений впереди нет"} onClick={onNextFill} disabled={!nextFillLabel}>
            <SkipForward /> исполнение
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" aria-label="К входу (E)" title="К входу — E" onClick={onEntry} disabled={!hasEntry}><LogIn /> вход</Button>
          {!training && <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" aria-label="К выходу (X)" title="К выходу — X" onClick={onExit} disabled={!hasExit}><LogOut /> выход</Button>}
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="В начало (Home)" title="В начало — Home" onClick={onRestart}><RotateCcw /></Button>
        </div>
        <Segmented size="sm" ariaLabel="Скорость" value={String(speed)} onChange={(v) => onSpeed(Number(v) as ReplaySpeed)} options={REPLAY_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
        <div className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground" title="С какого момента начинать: за 5, 15 или 30 минут до входа или с открытия сессии">Старт</span>
          <Segmented<ReplayStart>
            size="sm"
            ariaLabel="Откуда начинать реплей"
            value={startPreset}
            onChange={onStartPreset}
            options={REPLAY_STARTS.map((o) => ({ ...o, disabled: o.value === "open" ? !canStartAtOpen : !hasEntry }))}
          />
        </div>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground" title="Реплей сам встаёт на паузу на каждом входе, доборе и выходе — P">
          <Switch checked={pauseOnFills} onCheckedChange={onPauseOnFills} aria-label="Пауза на исполнениях" />
          пауза на исполнениях
        </label>
      </div>
    </div>
  );
}

function Scrubber({ cursor, start, last, frontier, training, marks, onSeek, timeLabel, startLabel, event }: {
  cursor: number; start: number; last: number; frontier: number; training: boolean; marks: ReplayMark[]; onSeek: (idx: number) => void; timeLabel: string; startLabel: string; event: ReplayEvent | null;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef(false);
  const span = Math.max(1, last - start);
  const pos = (i: number) => `${(Math.max(0, Math.min(span, i - start)) / span) * 100}%`;
  const idxAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return cursor;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    return Math.min(frontier, start + Math.round(frac * span));
  };
  const seek = (clientX: number) => {
    const i = idxAt(clientX);
    if (i !== cursor) onSeek(i);
  };
  return (
    <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={training ? "Позиция реплея (вперёд — только проигрыванием)" : "Позиция реплея"}
        aria-valuemin={start}
        aria-valuemax={last}
        aria-valuenow={cursor}
        aria-valuetext={timeLabel}
        className="relative h-6 cursor-pointer touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) seek(e.clientX); }}
        onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[hsl(var(--muted-foreground)/0.18)]" />
        {training && frontier < last && (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full bg-[repeating-linear-gradient(135deg,hsl(var(--muted-foreground)/0.22)_0_4px,transparent_4px_8px)]"
            style={{ left: pos(frontier), right: 0 }}
            title="Будущее скрыто — смотри проигрыванием"
            aria-hidden="true"
          />
        )}
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary" style={{ width: pos(cursor) }} aria-hidden="true" />
        {spread(marks.filter((m) => m.idx >= start && m.idx <= last)).map(({ m, dx }, i) => (
          <span
            key={`${m.idx}-${i}`}
            className={cn("absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full", OPENING(m.kind) ? "bg-primary ring-2 ring-background" : "bg-purple ring-2 ring-background")}
            style={{ left: `calc(${pos(m.idx)} + ${dx}px)` }}
            title={m.label}
            aria-hidden="true"
          />
        ))}
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm"
          style={{ left: pos(cursor) }}
          aria-hidden="true"
        />
      </div>
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        <span>{startLabel}</span>
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="font-medium text-foreground">{timeLabel}</span>
          <EventBadge event={event} />
        </span>
        <span className="hidden shrink-0 items-center gap-2 @2xl:inline-flex">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-1 rounded-full bg-primary" aria-hidden="true" />вход/добор</span>
          {!training && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-1 rounded-full bg-purple" aria-hidden="true" />выход</span>}
        </span>
      </div>
    </div>
  );
}

/** Fills on the same bar (e.g. entry and exit inside one 5-minute bar) are fanned out a few pixels so both stay visible. */
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

/** Live P&L of the position at the cursor (fixed width and two lines: the numbers change, the layout does not). */
function PnlCounter({ position, side }: { position: PositionState | null; side: Side }) {
  const total = position?.total ?? null;
  const flat = !position || (position.qty < 1e-9 && position.fillsSoFar === 0);
  const open = !!position && position.qty > 1e-9;
  const partial = open && position!.realized !== 0;
  return (
    <div className="ml-auto flex w-[13rem] shrink-0 flex-col items-end gap-1 text-right" title="P&L позиции на текущем баре: зафиксированное + плавающее по цене закрытия бара">
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {flat ? "Позиции ещё нет" : open ? `${side === "short" ? "Шорт" : "Лонг"} ${Math.round(position!.qty)} акц.` : "Позиция закрыта"}
        {partial && ` · зафикс. ${fmtMoney(position!.realized)}`}
      </span>
      <span className={cn("text-xl font-semibold leading-none tabular-nums", total == null || flat ? "text-muted-foreground" : total > 0 ? "text-up" : total < 0 ? "text-down" : "text-foreground")}>
        {flat || total == null ? "—" : fmtMoney(total)}
      </span>
    </div>
  );
}

function EventBadge({ event }: { event: ReplayEvent | null }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-[15rem] items-center truncate rounded-full px-2 text-xs font-medium transition-colors duration-[var(--dur-1)]",
        !event ? "invisible" : event.current ? (OPENING(event.kind) ? "bg-primary/15 text-primary" : "bg-purple/15 text-purple") : "text-muted-foreground",
      )}
      aria-live="polite"
    >
      {event ? (event.current ? event.label : `последнее: ${event.label}`) : "—"}
    </span>
  );
}

function HotkeysHelp({ training }: { training: boolean }) {
  const rows: [string[], string][] = [
    [["Space"], "играть / пауза"],
    [["←", "→"], "бар назад / вперёд (Shift — 10 баров)"],
    [["+", "−"], "быстрее / медленнее"],
    [["N"], "к следующему исполнению"],
    [["E"], "к входу"],
    ...(training ? ([[["Enter"], "«Я бы вышел здесь»"]] as [string[], string][]) : ([[["X"], "к выходу"]] as [string[], string][])),
    [["P"], "пауза на исполнениях вкл/выкл"],
    [["Home"], "в начало"],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Горячие клавиши" title="Горячие клавиши">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="mb-2 text-xs font-semibold">Горячие клавиши (кликни по графику)</p>
        <ul className="flex flex-col gap-1.5 text-xs">
          {rows.map(([keys, text]) => (
            <li key={text} className="flex items-center justify-between gap-3">
              <span className="inline-flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              <span className="text-right text-muted-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
