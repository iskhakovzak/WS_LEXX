/**
 * Series primitive: the viewer's drawings — horizontal level, trend line, zone (rectangle) — stored in (time, price)
 * so they survive timeframe switches. Colours come from theme roles (accent / up / down / warn). Renders the
 * in-progress preview and the selection with drag handles; `hit()` tells the host what is under the pointer (a whole
 * drawing or one of its handles) so it can select, move or reshape it, and `hitTest` gives the pointer cursor.
 */
import type { PrimitiveHoveredItem } from "lightweight-charts";
import type { Candle, Drawing, DrawingRole } from "../types";
import type { ChartTheme } from "../theme";
import { timeToLogical } from "../lib/time";
import { distToSegment } from "../lib/drawings";
import { fmtPrice } from "@/lib/format";
import { SeriesPrimitiveBase, type RenderCtx, hline, label, line } from "./canvas";

type Shape = { id: string; segments: [number, number, number, number][]; rect?: [number, number, number, number]; handles: [number, number][] };
export type DrawingHit = { id: string; handle: number | null };

const HIT_PX = 7;
const HANDLE_PX = 9;

export function roleColor(theme: ChartTheme, role: DrawingRole | undefined): (a?: number) => string {
  return role === "up" ? theme.up : role === "down" ? theme.down : role === "warn" ? theme.c3 : theme.primary;
}

export class DrawingsPrimitive extends SeriesPrimitiveBase {
  private drawings: readonly Drawing[] = [];
  private preview: Drawing | null = null;
  private selected: string | null = null;
  private bars: readonly Candle[] = [];
  private barSec = 60;
  private shapes: Shape[] = [];

  setScale(bars: readonly Candle[], barSec: number): void { this.bars = bars; this.barSec = barSec; this.requestUpdate(); }
  setDrawings(d: readonly Drawing[]): void { this.drawings = d; this.requestUpdate(); }
  setPreview(d: Drawing | null): void { this.preview = d; this.requestUpdate(); }
  setSelected(id: string | null): void { this.selected = id; this.requestUpdate(); }

  private xOf(rc: RenderCtx, time: number): number | null {
    return rc.x(timeToLogical(this.bars, time, this.barSec));
  }

  render(rc: RenderCtx): void {
    this.shapes = [];
    for (const d of this.drawings) this.renderOne(rc, d, false);
    if (this.preview) this.renderOne(rc, this.preview, true);
  }

  private renderOne(rc: RenderCtx, d: Drawing, isPreview: boolean): void {
    const { ctx, theme, width, height } = rc;
    const col = roleColor(theme, d.role);
    const color = col(0.95);
    const sel = d.id === this.selected;
    const w = sel ? 2 : 1.5;
    const dash = isPreview ? [4, 3] : [];
    const shape: Shape = { id: d.id, segments: [], handles: [] };
    const p0 = d.points[0], p1 = d.points[1] ?? d.points[0];
    const y0 = rc.y(p0.price), y1 = rc.y(p1.price);
    const x0 = this.xOf(rc, p0.time), x1 = this.xOf(rc, p1.time);
    if (y0 == null) return;
    switch (d.type) {
      case "hline": {
        hline(ctx, 0, width, y0, color, w, dash);
        // Left of the levels rail (which owns the right edge), so the two never collide.
        label(ctx, theme, d.label ? `${d.label} ${fmtPrice(p0.price)}` : fmtPrice(p0.price), Math.min(width * 0.62, width - 150), y0, { anchor: "r", bg: col(0.85), size: 10, pad: 3, clamp: { width, height } });
        shape.segments.push([0, y0, width, y0]);
        if (x0 != null) shape.handles.push([Math.max(8, Math.min(width - 8, x0)), y0]);
        break;
      }
      case "trend": {
        if (x0 == null || x1 == null || y1 == null) return;
        line(ctx, x0, y0, x1, y1, color, w, dash);
        shape.segments.push([x0, y0, x1, y1]);
        shape.handles.push([x0, y0], [x1, y1]);
        break;
      }
      case "rect": {
        if (x0 == null || x1 == null || y1 == null) return;
        const rx = Math.min(x0, x1), ry = Math.min(y0, y1), rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
        ctx.fillStyle = col(sel ? 0.16 : 0.1);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh); ctx.restore();
        label(ctx, theme, `${fmtPrice(Math.max(p0.price, p1.price))} – ${fmtPrice(Math.min(p0.price, p1.price))}`, rx + 3, ry + 3, { anchor: "tl", bg: col(0.85), size: 10, pad: 3, clamp: { width, height } });
        shape.rect = [rx, ry, rw, rh];
        shape.handles.push([x0, y0], [x1, y1]);
        break;
      }
      default:
        return;
    }
    if (sel && !isPreview) {
      for (const [hx, hy] of shape.handles) {
        ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = theme.bg(1); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      }
    }
    if (!isPreview) this.shapes.push(shape);
  }

  /** What is under (x, y) in pane pixels: a handle of the selected drawing first, then the closest drawing. */
  hit(x: number, y: number): DrawingHit | null {
    const sel = this.shapes.find((s) => s.id === this.selected);
    if (sel) {
      const i = sel.handles.findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) <= HANDLE_PX);
      if (i >= 0) return { id: sel.id, handle: i };
    }
    let best: Shape | null = null, bestD = HIT_PX;
    for (const s of this.shapes) {
      const d = shapeDistance(s, x, y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best ? { id: best.id, handle: null } : null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hit(x, y);
    if (!h) return null;
    return { externalId: `drawing:${h.id}`, zOrder: "top", cursorStyle: h.handle != null ? "grab" : this.selected === h.id ? "move" : "pointer", distance: 0, itemType: "primitive" };
  }
}

function shapeDistance(s: Shape, x: number, y: number): number {
  let best = Infinity;
  for (const [x1, y1, x2, y2] of s.segments) best = Math.min(best, distToSegment(x, y, x1, y1, x2, y2));
  if (s.rect) {
    const [rx, ry, rw, rh] = s.rect;
    // A zone is grabbed anywhere inside it, not only on its border.
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return 0;
    const edges: [number, number, number, number][] = [[rx, ry, rx + rw, ry], [rx + rw, ry, rx + rw, ry + rh], [rx, ry + rh, rx + rw, ry + rh], [rx, ry, rx, ry + rh]];
    for (const [x1, y1, x2, y2] of edges) best = Math.min(best, distToSegment(x, y, x1, y1, x2, y2));
  }
  return best;
}
