/**
 * Replay state of WS Chart, kept out of the component: the cursor (as a bar time, so a timeframe switch keeps the
 * moment), play / pause on a ~60 Hz timer with an exact pace, steps both ways, seeking, the start preset, the speed and
 * «пауза на исполнениях» (remembered in localStorage), jumps to the 9:30 open / the entry / the exit / the next fill.
 * The chart itself is pushed from the cursor by WsChart — this hook never touches lightweight-charts.
 */
import * as React from "react";
import type { Bar, Fill } from "../types";
import { barIndexForTime } from "../lib/time";
import {
  clockTick, dayFloorIndex, isReplaySpeed, isReplayStart, planAdvance, replayStartIndex, sessionEndIndex, sessionOpenIndex,
  type ReplaySpeed, type ReplayStart,
} from "../lib/replay-clock";

const REPLAY_KEY = "ws-chart:replay:v2";
type ReplayPrefs = { speed: ReplaySpeed; start: ReplayStart; pauseOnFills: boolean };
const DEFAULT_REPLAY: ReplayPrefs = { speed: 5, start: "15", pauseOnFills: true };

function loadPrefs(): ReplayPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(REPLAY_KEY) ?? "null") as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return DEFAULT_REPLAY;
    return {
      speed: isReplaySpeed(p.speed) ? (Number(p.speed) as ReplaySpeed) : DEFAULT_REPLAY.speed,
      start: isReplayStart(p.start) ? p.start : DEFAULT_REPLAY.start,
      pauseOnFills: typeof p.pauseOnFills === "boolean" ? p.pauseOnFills : DEFAULT_REPLAY.pauseOnFills,
    };
  } catch { return DEFAULT_REPLAY; }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type ReplayInput = {
  active: boolean;
  /** Changes when a different trade / day is opened (restarts the replay). */
  sessionId: string | number;
  bars: readonly Bar[];
  barSec: number;
  intraday: boolean;
  dayKey: string;
  entryIdx: number | null;
  entryTime: number | null;
  exitIdx: number | null;
  fills: readonly Fill[];
  /** Start this many bars before the entry until the viewer picks a start preset. */
  startBarsBefore?: number;
};

export type Replay = ReturnType<typeof useReplay>;

export function useReplay(o: ReplayInput) {
  const { active, bars, barSec, intraday, dayKey, entryIdx, entryTime, exitIdx, fills } = o;
  const last = Math.max(0, bars.length - 1);
  const [prefs, setPrefs] = React.useState<ReplayPrefs>(loadPrefs);
  const updatePrefs = React.useCallback((patch: Partial<ReplayPrefs>) => setPrefs((p) => {
    const n = { ...p, ...patch };
    try { localStorage.setItem(REPLAY_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ }
    return n;
  }), []);
  const [startChosen, setStartChosen] = React.useState(o.startBarsBefore == null);

  /** Earliest bar the cursor may reach: the first bar of the trade day (premarket included). */
  const floorIdx = React.useMemo(() => (intraday && bars.length ? dayFloorIndex(bars, dayKey) : 0), [intraday, bars, dayKey]);
  const openIdx = React.useMemo(() => (intraday && bars.length ? sessionOpenIndex(bars, dayKey) : floorIdx), [intraday, bars, dayKey, floorIdx]);
  const startIdx = React.useMemo(() => {
    if (!bars.length) return 0;
    if (!intraday) return Math.max(0, (entryIdx ?? last) - 20);
    if (!startChosen && o.startBarsBefore != null && entryIdx != null) return Math.max(floorIdx, entryIdx - o.startBarsBefore);
    return replayStartIndex(bars, prefs.start, { dayKey, entryIdx, entryTime });
  }, [bars, intraday, entryIdx, entryTime, last, startChosen, o.startBarsBefore, prefs.start, dayKey, floorIdx]);
  const sessionEnd = React.useMemo(() => (intraday && bars.length ? sessionEndIndex(bars, dayKey) : last), [intraday, bars, dayKey, last]);
  /** Right edge of the scrubber: the close of the day, or the exit when it is later (overnight). */
  const dockEnd = Math.min(last, Math.max(sessionEnd, exitIdx ?? 0));

  const [cursorTime, setCursorTime] = React.useState<number | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const cursorIdx = React.useMemo(() => {
    if (!active || cursorTime == null || !bars.length) return null;
    return clamp(barIndexForTime(bars, cursorTime, barSec), floorIdx, last);
  }, [active, cursorTime, bars, barSec, floorIdx, last]);
  const cursorRef = React.useRef<number | null>(null);
  if (!playing) cursorRef.current = cursorIdx;
  const setCursor = React.useCallback((idx: number) => {
    if (!bars.length) return;
    const i = clamp(idx, floorIdx, last);
    cursorRef.current = i;
    setCursorTime(bars[i].t);
  }, [bars, floorIdx, last]);

  // (Re)start whenever the trade or the start point changes.
  const sessionKey = `${o.sessionId}:${startIdx}:${bars.length > 0}`;
  const initialisedFor = React.useRef<string | null>(null);
  const restart = React.useCallback(() => { setPlaying(false); if (bars.length) { cursorRef.current = startIdx; setCursorTime(bars[startIdx].t); } }, [bars, startIdx]);
  React.useEffect(() => {
    if (!active) { initialisedFor.current = null; setPlaying(false); return; }
    if (initialisedFor.current === sessionKey || !bars.length) return;
    initialisedFor.current = sessionKey;
    restart();
  }, [sessionKey, active, bars.length, restart]);
  // A timeframe switch mid-play pauses (bar indices change meaning).
  React.useEffect(() => { setPlaying(false); }, [barSec]);

  const pauseIdx = React.useMemo(() => fills.map((f) => f.idx), [fills]);
  const live = React.useRef({ bars, speed: prefs.speed, last, pauseIdx, pauseOnFills: prefs.pauseOnFills, startIdx });
  live.current = { bars, speed: prefs.speed, last, pauseIdx, pauseOnFills: prefs.pauseOnFills, startIdx };

  // Play loop: a ~60 Hz timer + carried fractional bars, exact pace at any tick rate. A timer (not rAF) so it keeps its
  // pace in a background tab instead of freezing; clockTick clamps long gaps so it never jumps far.
  React.useEffect(() => {
    if (!playing) return;
    let lastTs = performance.now(), carry = 0;
    const id = window.setInterval(() => {
      const st = live.current;
      const ts = performance.now();
      const { steps, carry: c } = clockTick(carry, ts - lastTs, st.speed);
      lastTs = ts;
      carry = c;
      if (steps <= 0) return;
      const cur = cursorRef.current ?? st.startIdx;
      const r = planAdvance(cur, steps, { last: st.last, pauseOn: st.pauseOnFills ? st.pauseIdx : null });
      if (r.next !== cur && st.bars[r.next]) { cursorRef.current = r.next; setCursorTime(st.bars[r.next].t); }
      if (r.stopped) setPlaying(false);
    }, 16);
    return () => window.clearInterval(id);
  }, [playing]);

  const atEnd = cursorIdx != null && cursorIdx >= last;
  const togglePlay = React.useCallback(() => {
    if (cursorIdx == null) return;
    if (playing) { setPlaying(false); return; }
    if (atEnd) setCursor(startIdx);
    setPlaying(true);
  }, [cursorIdx, playing, atEnd, setCursor, startIdx]);
  const step = React.useCallback((delta: number) => {
    if (cursorIdx == null) return;
    setPlaying(false);
    setCursor(cursorIdx + delta);
  }, [cursorIdx, setCursor]);
  const seek = React.useCallback((idx: number) => { setPlaying(false); setCursor(idx); }, [setCursor]);
  const nextFill = cursorIdx != null ? fills.find((f) => f.idx > cursorIdx) ?? null : null;
  const toNextFill = React.useCallback(() => { setPlaying(false); if (nextFill) setCursor(nextFill.idx); }, [nextFill, setCursor]);
  const toEntry = React.useCallback(() => { setPlaying(false); if (entryIdx != null) setCursor(entryIdx); }, [entryIdx, setCursor]);
  const toExit = React.useCallback(() => { setPlaying(false); if (exitIdx != null) setCursor(exitIdx); }, [exitIdx, setCursor]);
  const toOpen = React.useCallback(() => { setPlaying(false); setCursor(openIdx); }, [openIdx, setCursor]);
  const chooseStart = React.useCallback((v: ReplayStart) => { setStartChosen(true); updatePrefs({ start: v }); }, [updatePrefs]);

  return {
    prefs, updatePrefs, cursorIdx, setCursor, playing, setPlaying, togglePlay, step, seek, atEnd,
    floorIdx, openIdx, startIdx, dockEnd, nextFill, toNextFill, toEntry, toExit, toOpen, restart, chooseStart,
  };
}
