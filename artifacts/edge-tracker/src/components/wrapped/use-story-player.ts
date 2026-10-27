/**
 * Story navigation: the current card, tap zones (left third = back, the rest = next), swipes (left / right = next /
 * back, down = close), press-and-hold pauses, arrow keys / Space. Auto-advance itself is the progress bar's animation
 * (StoryBars) — it calls `next` when the bar fills, and stops on the last card.
 */
import * as React from "react";

const SWIPE = 50;
const SWIPE_DOWN = 90;
const HOLD_MS = 220;

export type Gesture = "next" | "prev" | "close" | null;

/** What a pointer gesture means: a swipe by its direction, a short tap by where it landed (`relX` 0…1). */
export function gestureOf(dx: number, dy: number, ms: number, relX: number): Gesture {
  if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next" : "prev";
  if (dy > SWIPE_DOWN && dy > Math.abs(dx)) return "close";
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && ms < 450) return relX < 1 / 3 ? "prev" : "next";
  return null;
}

export function useStoryPlayer(count: number, onClose: () => void) {
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const start = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const holdTimer = React.useRef<number | null>(null);

  React.useEffect(() => { if (index > 0 && index >= count) setIndex(Math.max(0, count - 1)); }, [count, index]);

  const go = React.useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(count - 1, i + delta))), [count]);
  const next = React.useCallback(() => go(1), [go]);
  const prev = React.useCallback(() => go(-1), [go]);

  const clearHold = () => { if (holdTimer.current != null) window.clearTimeout(holdTimer.current); holdTimer.current = null; };
  React.useEffect(() => clearHold, []);

  const stage = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      clearHold();
      holdTimer.current = window.setTimeout(() => setHeld(true), HOLD_MS);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      clearHold();
      setHeld(false);
      const s = start.current;
      start.current = null;
      if (!s) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const g = gestureOf(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t, rect.width ? (e.clientX - rect.left) / rect.width : 1);
      if (g === "next") next();
      else if (g === "prev") prev();
      else if (g === "close") onClose();
    },
    onPointerCancel: () => { clearHold(); setHeld(false); start.current = null; },
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Page hotkeys listen on window: keep them away while the story is open (Escape still reaches Radix).
    if (e.key !== "Escape") e.stopPropagation();
    if (e.target instanceof HTMLElement && e.target.closest("button, a, input") && (e.key === " " || e.key === "Enter")) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  };

  return { index, setIndex, next, prev, held, stage, onKeyDown };
}
