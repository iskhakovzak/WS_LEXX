/**
 * Drawing interaction of WS Chart: pick a tool (level · trend line · zone), click / tap the anchor points, select a
 * drawing by clicking it, drag it (or one of its handles) to move / reshape it, Delete removes it, Esc cancels.
 * While a drag is in progress the chart's own pan / zoom is switched off so the candles do not move under the pointer.
 * WsChart calls `bind` when it builds the chart and the returned function when it tears it down.
 */
import * as React from "react";
import type { IChartApi, ISeriesApi, Logical, MouseEventParams, Time } from "lightweight-charts";
import type { Bar, Drawing, DrawingPoint, DrawingRole, DrawingType } from "../types";
import { logicalToTime } from "../lib/time";
import { DRAWING_POINTS, makeDrawing, moveDrawing, movePoint } from "../lib/drawings";
import type { DrawingsPrimitive } from "../primitives/DrawingsPrimitive";
import type { DrawingsStore } from "./useDrawings";

type Bound = { chart: IChartApi; series: ISeriesApi<"Candlestick">; prim: DrawingsPrimitive; el: HTMLElement };
type Drag = { id: string; handle: number | null; from: DrawingPoint; orig: Drawing; moved: boolean; pointerId: number };

export function useDrawingTools(store: DrawingsStore, scale: { bars: readonly Bar[]; barSec: number }) {
  const [tool, setTool] = React.useState<DrawingType | null>(null);
  const [role, setRole] = React.useState<DrawingRole>("accent");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const pending = React.useRef<DrawingPoint[]>([]);
  const live = React.useRef({ tool, role, selected, store, scale });
  live.current = { tool, role, selected, store, scale };
  const bound = React.useRef<Bound | null>(null);

  const pointAt = React.useCallback((x: number, y: number): DrawingPoint | null => {
    const b = bound.current;
    if (!b) return null;
    const price = b.series.coordinateToPrice(y);
    const logical = b.chart.timeScale().coordinateToLogical(x);
    if (price == null || logical == null) return null;
    const { bars, barSec } = live.current.scale;
    return { time: logicalToTime(bars, Number(logical as Logical), barSec), price: Number(price) };
  }, []);

  const cancel = React.useCallback(() => {
    pending.current = []; setPendingCount(0); bound.current?.prim.setPreview(null);
  }, []);
  React.useEffect(() => { if (!tool) cancel(); }, [tool, cancel]);
  React.useEffect(() => { bound.current?.prim.setSelected(selected); }, [selected]);
  React.useEffect(() => { bound.current?.prim.setDrawings(store.drawings); }, [store.drawings]);

  const remove = React.useCallback((id: string | null) => {
    if (!id) return;
    live.current.store.update((d) => d.filter((x) => x.id !== id));
    setSelected(null);
  }, []);
  const setDrawingRole = React.useCallback((id: string, r: DrawingRole) => {
    setRole(r);
    live.current.store.update((d) => d.map((x) => (x.id === id ? { ...x, role: r } : x)));
  }, []);
  const clearAll = React.useCallback(() => { live.current.store.update(() => []); setSelected(null); }, []);

  const bind = React.useCallback((chart: IChartApi, series: ISeriesApi<"Candlestick">, prim: DrawingsPrimitive, el: HTMLElement) => {
    bound.current = { chart, series, prim, el };
    prim.setScale(live.current.scale.bars, live.current.scale.barSec);
    prim.setDrawings(live.current.store.drawings);
    prim.setSelected(live.current.selected);
    let hasPreview = false;
    let drag: Drag | null = null;
    /** A pointer-up just finished on a drawing: the click that follows must not clear the selection. */
    let dragJustEnded = false;

    const onMove = (param: MouseEventParams<Time>) => {
      const st = live.current;
      if (st.tool && pending.current.length && param.point && param.paneIndex === 0) {
        const p = pointAt(param.point.x, param.point.y);
        if (p) { prim.setPreview(makeDrawing(st.tool, [...pending.current, p], st.role)); hasPreview = true; }
      } else if (hasPreview) { prim.setPreview(null); hasPreview = false; }
    };
    const onClick = (param: MouseEventParams<Time>) => {
      const st = live.current;
      if (!param.point || param.paneIndex !== 0) return;
      if (!st.tool) {
        // A click that ended a drag already selected the drawing; a click on empty space clears the selection.
        if (!dragJustEnded) setSelected(prim.hit(param.point.x, param.point.y)?.id ?? null);
        dragJustEnded = false;
        return;
      }
      const p = pointAt(param.point.x, param.point.y);
      if (!p) return;
      const pts = [...pending.current, p];
      if (pts.length >= DRAWING_POINTS[st.tool]) {
        const d = makeDrawing(st.tool, pts, st.role);
        pending.current = []; setPendingCount(0);
        prim.setPreview(null); hasPreview = false;
        st.store.update((list) => [...list, d]);
        setSelected(d.id);
        setTool(null);
      } else {
        pending.current = pts; setPendingCount(pts.length);
      }
    };

    // Drag to move / reshape (pointer events on the chart element; the pane starts at its top-left corner).
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const lockChart = (on: boolean) => chart.applyOptions({ handleScroll: !on ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false } : false, handleScale: !on ? { axisPressedMouseMove: true, axisDoubleClickReset: true, mouseWheel: true, pinch: true } : false });
    const onDown = (e: PointerEvent) => {
      dragJustEnded = false;
      if (live.current.tool || e.button !== 0) return;
      const { x, y } = local(e);
      const hit = prim.hit(x, y);
      const from = hit ? pointAt(x, y) : null;
      const orig = hit ? live.current.store.drawings.find((d) => d.id === hit.id) : null;
      if (!hit || !from || !orig) return;
      drag = { id: hit.id, handle: hit.handle, from, orig, moved: false, pointerId: e.pointerId };
      setSelected(hit.id);
      lockChart(true);
      el.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { x, y } = local(e);
      const p = pointAt(x, y);
      if (!p) return;
      const d = drag;
      d.moved = true;
      const next = d.handle != null ? movePoint(d.orig, d.handle, p) : moveDrawing(d.orig, p.time - d.from.time, p.price - d.from.price);
      live.current.store.update((list) => list.map((x2) => (x2.id === d.id ? next : x2)), { save: false });
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;
      lockChart(false);
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      dragJustEnded = true;
      if (d.moved) live.current.store.update((list) => [...list]); // commit (save) the final position
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (bound.current?.chart === chart) bound.current = null;
    };
  }, [pointAt]);

  return { tool, setTool, role, setRole, selected, setSelected, pendingCount, cancel, remove, setDrawingRole, clearAll, bind };
}
