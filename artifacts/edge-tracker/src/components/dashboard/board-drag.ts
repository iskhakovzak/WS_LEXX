/**
 * Pointer drag for the dashboard edit mode (no drag library in the app; framer-motion animates the reflow).
 *
 * - Mouse / pen: press on a tile (or its handle) and move 4px. Touch: the handle drags at once; the tile body after a
 *   380ms press without moving (a long press), so scrolling the page still works.
 * - While dragging, the tile follows the pointer (a transform over its slot) and the layout reflows live: over another
 *   tile of the same section → it takes that tile's place. Near the window's top / bottom edge the page scrolls.
 * - Release → the new order is kept; Esc / a cancelled pointer → back to where it was. The tile settles into its slot
 *   with a spring (none with reduced motion).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { animate, useMotionValue } from "framer-motion";
import { moveItem, moveOnto, sectionItems, sectionOf, type BoardSection, type DashLayout } from "./layout-model";
import type { SectionId } from "./use-dashboard";

type Drag = {
  id: SectionId;
  section: BoardSection;
  grabX: number;
  grabY: number;
  clientX: number;
  clientY: number;
  /** The tile it was last moved onto, and where the pointer was then (no ping-pong on a boundary). */
  lock: SectionId | null;
  lockX: number;
  lockY: number;
};

type Pending = { id: SectionId; pointerId: number; x: number; y: number; touch: boolean; immediate: boolean; timer: number | null };

export type BoardDragOptions = {
  /** The layout being rendered right now (the draft while dragging). */
  current: () => DashLayout;
  begin: (id: SectionId) => void;
  move: (next: DashLayout) => void;
  end: (commit: boolean) => void;
  grid: (s: BoardSection) => HTMLElement | null;
  tile: (id: SectionId) => HTMLElement | null;
  reduced: boolean;
};

const EDGE = 72;
const LONG_PRESS_MS = 380;

export function useBoardDrag(opts: BoardDragOptions) {
  const o = useRef(opts);
  useEffect(() => { o.current = opts; });
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [dragId, setDragId] = useState<SectionId | null>(null);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<Pending | null>(null);
  const settle = useRef(false);
  const raf = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  /** Put the dragged tile under the pointer, relative to its current slot (offsets ignore transforms). */
  const place = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const g = o.current.grid(d.section);
    const el = o.current.tile(d.id);
    if (!g || !el) return;
    const r = g.getBoundingClientRect();
    x.set(d.clientX - r.left - d.grabX * el.offsetWidth - el.offsetLeft);
    y.set(d.clientY - r.top - d.grabY * el.offsetHeight - el.offsetTop);
  }, [x, y]);

  const hitTest = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const g = o.current.grid(d.section);
    if (!g) return;
    const r = g.getBoundingClientRect();
    const px = d.clientX - r.left;
    const py = d.clientY - r.top;
    const lay = o.current.current();
    const others = sectionItems(lay, d.section).map((it) => it.id).filter((id) => id !== d.id);
    let target: SectionId | null = null;
    for (const id of others) {
      const el = o.current.tile(id);
      if (el && px >= el.offsetLeft && px < el.offsetLeft + el.offsetWidth && py >= el.offsetTop && py < el.offsetTop + el.offsetHeight) {
        target = id;
        break;
      }
    }
    const far = Math.hypot(d.clientX - d.lockX, d.clientY - d.lockY) > 8;
    if (target && target !== d.lock && (d.lock === null || far)) {
      const next = moveOnto(lay, d.id, target);
      if (next !== lay) o.current.move(next);
      Object.assign(d, { lock: target, lockX: d.clientX, lockY: d.clientY });
    } else if (!target && far) {
      // Off every other tile (over its own slot): the lock is released. Below the section's last row → its end.
      d.lock = null;
      if (py > g.offsetHeight) {
        const next = moveItem(lay, d.id, others.length);
        if (next !== lay) o.current.move(next);
        Object.assign(d, { lockX: d.clientX, lockY: d.clientY });
      }
    }
  }, []);

  const tick = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const h = window.innerHeight;
    const dy = d.clientY < EDGE ? -(EDGE - d.clientY) : d.clientY > h - EDGE ? d.clientY - (h - EDGE) : 0;
    if (dy) {
      window.scrollBy(0, Math.round(Math.max(-18, Math.min(18, dy / 3))));
      place();
      hitTest();
    }
    raf.current = window.requestAnimationFrame(tick);
  }, [place, hitTest]);

  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
    if (raf.current) window.cancelAnimationFrame(raf.current);
    raf.current = null;
    document.body.classList.remove("dash-dragging");
  }, []);

  const finish = useCallback((commit: boolean) => {
    const d = drag.current;
    stop();
    if (!d) return;
    drag.current = null;
    settle.current = true;
    o.current.end(commit);
  }, [stop]);

  /** After every render of the board while a tile is dragged or settling (the slot may have moved). */
  const reposition = useCallback(() => {
    if (drag.current) { place(); return; }
    if (!settle.current) return;
    settle.current = false;
    const done = () => { x.set(0); y.set(0); setDragId(null); };
    if (o.current.reduced) { done(); return; }
    const spring = { type: "spring" as const, stiffness: 520, damping: 40 };
    void Promise.all([animate(x, 0, spring), animate(y, 0, spring)]).then(done);
  }, [place, x, y]);

  const activate = useCallback((clientX: number, clientY: number) => {
    const p = pending.current;
    if (!p) return;
    const el = o.current.tile(p.id);
    if (!el) return;
    if (p.timer) window.clearTimeout(p.timer);
    const r = el.getBoundingClientRect();
    drag.current = {
      id: p.id,
      section: sectionOf(p.id),
      grabX: Math.min(1, Math.max(0, (p.x - r.left) / r.width)),
      grabY: Math.min(1, Math.max(0, (p.y - r.top) / r.height)),
      clientX,
      clientY,
      lock: null,
      lockX: clientX,
      lockY: clientY,
    };
    pending.current = null;
    document.body.classList.add("dash-dragging");
    if (p.touch) navigator.vibrate?.(8);
    setDragId(p.id);
    o.current.begin(p.id);
    place();
    raf.current = window.requestAnimationFrame(tick);
  }, [place, tick]);

  const onPointerDown = useCallback((e: ReactPointerEvent, id: SectionId, handle: boolean) => {
    if (e.button !== 0 || drag.current) return;
    if ((e.target as HTMLElement).closest("[data-tile-control]")) return;
    stop();
    const touch = e.pointerType === "touch";
    const p: Pending = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch, immediate: handle || !touch, timer: null };
    pending.current = p;
    if (touch && !handle) p.timer = window.setTimeout(() => activate(p.x, p.y), LONG_PRESS_MS);
    if (handle) e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      const d = drag.current;
      if (d) {
        d.clientX = ev.clientX;
        d.clientY = ev.clientY;
        place();
        hitTest();
        return;
      }
      if (!pending.current) return;
      const dist = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      if (!p.immediate) { if (dist > 8) stop(); return; } // a scroll, not a long press
      if (dist > 4) activate(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === p.pointerId) { if (drag.current) finish(true); else stop(); } };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === p.pointerId) { if (drag.current) finish(false); else stop(); } };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && drag.current) { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
    // While a tile is dragged by touch the page must not scroll under the finger.
    const onTouchMove = (ev: TouchEvent) => { if (drag.current) ev.preventDefault(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [activate, finish, hitTest, place, stop]);

  useEffect(() => stop, [stop]);

  return { dragId, x, y, onPointerDown, reposition, dragging: () => drag.current !== null };
}
