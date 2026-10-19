/**
 * Pointer interaction of the simulator chart (sim-chart.tsx): drag the stop / target / planned lines with a mouse or a
 * finger (panning paused while a line is held), a tap / click → `onPick` («Найди вход»), Shift+click → stop,
 * Alt+click → target (`onPlace`), a touch long-press or a right-click → `onMenu` («stop / target here»). Public
 * lightweight-charts API only (coordinate ↔ logical index / price).
 */
import * as React from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { fmtPrice } from "@/lib/format";
import { roundPrice } from "./model";
import { placeKind } from "./position-box";
import type { DragLine, SimOverlayPrimitive } from "./sim-overlay";

/** Pan / zoom options while no line is held (restored after a drag). */
export const SCROLL_ON = { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false } as const;
export const SCALE_ON = { axisPressedMouseMove: true, axisDoubleClickReset: true, mouseWheel: true, pinch: true } as const;
/** How close (px) a pointer must be to grab a line: a finger needs more room than a mouse. */
const GRAB_MOUSE = 8;
const GRAB_TOUCH = 16;
/** Touch long-press (ms) that opens the «stop / target here» menu; a move beyond TAP_SLOP px cancels it. */
const LONG_PRESS_MS = 500;
const TAP_SLOP = 8;

export type PointerTarget = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  overlay: SimOverlayPrimitive;
  resetOverlay: () => void;
};
export type PointerHandlers = {
  onDragLine?: (kind: DragLine, price: number) => void;
  dragLabel?: (kind: DragLine, price: number) => string;
  onPick?: (idx: number, price: number) => void;
  onPlace?: (kind: "stop" | "target", price: number) => void;
  onMenu?: (price: number, x: number, y: number) => void;
};

export function useChartPointer(
  boxRef: React.RefObject<HTMLDivElement | null>,
  refs: React.RefObject<PointerTarget | null>,
  live: React.RefObject<PointerHandlers>,
  deps: React.DependencyList,
): void {
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let held: { kind: DragLine; id: number; price: number } | null = null;
    // A tap / click (no drag) for `onPick` / `onPlace`: pointer events work the same for a mouse and a finger.
    let press: { id: number; x: number; y: number; at: number; mods: { shiftKey: boolean; altKey: boolean } } | null = null;
    let longTimer = 0;
    const cancelLong = () => { if (longTimer) { window.clearTimeout(longTimer); longTimer = 0; } };
    const yOf = (clientY: number) => clientY - el.getBoundingClientRect().top;
    const xOf = (clientX: number) => clientX - el.getBoundingClientRect().left;
    const priceAt = (clientY: number): number | null => {
      const p = refs.current?.candles.coordinateToPrice(yOf(clientY));
      return p != null && p > 0 ? roundPrice(p) : null;
    };
    const grab = (y: number, touch: boolean): { kind: DragLine; price: number } | null => {
      const r = refs.current;
      if (!r || !live.current.onDragLine) return null;
      let best: { kind: DragLine; price: number; d: number } | null = null;
      for (const l of r.overlay.dragLines()) {
        const ly = r.candles.priceToCoordinate(l.price);
        if (ly == null) continue;
        const d = Math.abs(ly - y);
        if (d <= (touch ? GRAB_TOUCH : GRAB_MOUSE) && (!best || d < best.d)) best = { ...l, d };
      }
      return best;
    };
    const pause = (on: boolean) => refs.current?.chart.applyOptions(on ? { handleScroll: false, handleScale: false } : { handleScroll: SCROLL_ON, handleScale: SCALE_ON });
    const onDown = (e: PointerEvent) => {
      press = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), mods: { shiftKey: e.shiftKey, altKey: e.altKey } } : null;
      cancelLong();
      const g = grab(yOf(e.clientY), e.pointerType !== "mouse");
      if (!g) {
        // A finger held still on the chart opens the «stop / target here» menu.
        if (e.pointerType === "touch" && e.isPrimary && live.current.onMenu) {
          const at = { x: e.clientX, y: e.clientY };
          longTimer = window.setTimeout(() => {
            longTimer = 0;
            const price = priceAt(at.y);
            if (price != null && press) { press = null; live.current.onMenu?.(price, xOf(at.x), yOf(at.y)); }
          }, LONG_PRESS_MS);
        }
        return;
      }
      held = { kind: g.kind, id: e.pointerId, price: g.price };
      pause(true);
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      const r = refs.current;
      if (!r) return;
      if (!held) {
        if (longTimer && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) cancelLong();
        if (e.pointerType === "mouse") el.style.cursor = grab(yOf(e.clientY), false) ? "ns-resize" : (e.shiftKey || e.altKey) && live.current.onPlace ? "crosshair" : "";
        return;
      }
      if (e.pointerId !== held.id) return;
      const p = r.candles.coordinateToPrice(yOf(e.clientY));
      if (p == null || !(p > 0)) return;
      held.price = roundPrice(p);
      r.overlay.preview(held.kind, held.price, live.current.dragLabel?.(held.kind, held.price) ?? fmtPrice(held.price));
    };
    const onUp = (e: PointerEvent) => {
      const p = press;
      press = null;
      cancelLong();
      const tap = !!p && e.type === "pointerup" && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) < TAP_SLOP && performance.now() - p.at < 600;
      const kind = p ? placeKind(p.mods) : null;
      if (!held && tap && kind && live.current.onPlace) {
        const price = priceAt(e.clientY);
        if (price != null) live.current.onPlace(kind, price);
      } else if (!held && tap && live.current.onPick) {
        const r = refs.current;
        if (r) {
          const logical = r.chart.timeScale().coordinateToLogical(xOf(e.clientX));
          const price = r.candles.coordinateToPrice(yOf(e.clientY));
          if (logical != null && price != null) live.current.onPick(Math.round(logical), price);
        }
      }
      if (!held || e.pointerId !== held.id) return;
      const h = held;
      held = null;
      pause(false);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (e.type === "pointerup") live.current.onDragLine?.(h.kind, h.price);
      else refs.current?.resetOverlay();
    };
    // A finger on a line must not scroll the page (touch-action can't be decided per touch, so cancel here).
    const onTouch = (e: TouchEvent) => {
      const t0 = e.touches[0];
      if (t0 && grab(yOf(t0.clientY), true)) e.preventDefault();
    };
    // Right-click (and a long-press the browser reports as a context menu) → the same menu instead of the native one.
    const onContext = (e: MouseEvent) => {
      if (!live.current.onMenu) return;
      e.preventDefault();
      if (held) return;
      const touchy = (e as PointerEvent).pointerType === "touch";
      if (touchy && !longTimer && !press) return; // the long-press timer already opened it
      cancelLong();
      press = null;
      const price = priceAt(e.clientY);
      if (price != null) live.current.onMenu(price, xOf(e.clientX), yOf(e.clientY));
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("touchstart", onTouch, { capture: true, passive: false });
    el.addEventListener("contextmenu", onContext);
    return () => {
      cancelLong();
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("touchstart", onTouch, true);
      el.removeEventListener("contextmenu", onContext);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt with the chart (the caller's deps)
  }, deps);

}
