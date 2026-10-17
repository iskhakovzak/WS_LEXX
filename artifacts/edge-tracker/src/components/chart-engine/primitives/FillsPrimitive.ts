/**
 * Series primitive: execution arrows at the exact fill price.
 * Entry = solid triangle, add = smaller triangle with a ring, trim = hollow triangle, exit = solid
 * triangle in the exit colour, stop = square. Hover shows qty · price · time. Fills past the replay
 * cursor (or explicitly hidden ids) are not drawn.
 */
import type { PrimitiveHoveredItem } from "lightweight-charts";
import type { Fill, Side } from "../types";
import { fmtEtTime } from "../lib/time";
import { fmtPrice, fmtQty } from "../lib/format";
import { KIND_LABEL, isOpening } from "../lib/position";
import { SeriesPrimitiveBase, type RenderCtx, hline, label, triangle } from "./canvas";

type Placed = { fill: Fill; x: number; y: number };

export class FillsPrimitive extends SeriesPrimitiveBase {
  private fills: readonly Fill[] = [];
  private side: Side = "long";
  private limit: number | null = null;
  private hidden = new Set<number>();
  private hovered: number | null = null;
  private placed: Placed[] = [];

  setFills(fills: readonly Fill[], side: Side): void { this.fills = fills; this.side = side; this.requestUpdate(); }
  /** Hide fills on bars after `idx` (replay cursor). Null = show all. */
  setLimit(idx: number | null): void { if (this.limit !== idx) { this.limit = idx; this.requestUpdate(); } }
  setHidden(ids: Iterable<number>): void { this.hidden = new Set(ids); this.requestUpdate(); }

  private visible(): Fill[] {
    return this.fills.filter((f) => (this.limit == null || f.idx <= this.limit) && !this.hidden.has(f.id));
  }

  private colorOf(f: Fill): { fill: string; stroke?: string } {
    const th = this.theme;
    switch (f.kind) {
      case "entry": return { fill: th.primary(1) };
      case "add": return { fill: th.c1(0.85), stroke: th.fg(0.9) };
      case "trim": return { fill: th.c3(0.2), stroke: th.c3(1) };
      case "exit": return { fill: th.c5(1) };
      default: return { fill: th.down(1) };
    }
  }

  render(rc: RenderCtx): void {
    const { ctx, theme, width, height } = rc;
    this.placed = [];
    const vis = this.visible();
    if (!vis.length) return;
    const spacing = this.chart?.timeScale().options().barSpacing ?? 6;
    const size = Math.max(8, Math.min(14, spacing * 1.6));
    for (const f of vis) {
      const x = rc.x(f.idx), y = rc.y(f.price);
      if (x == null || y == null) continue;
      this.placed.push({ fill: f, x, y });
      const buy = (this.side === "long") === isOpening(f.kind);
      const col = this.colorOf(f);
      // price tick across the bar
      hline(ctx, x - spacing * 0.6, x + spacing * 0.6, y, col.stroke ?? col.fill, 1.5);
      if (f.kind === "stop") {
        ctx.fillStyle = col.fill;
        ctx.fillRect(x - size / 2, y + 3, size, size);
        continue;
      }
      const s = f.kind === "add" || f.kind === "trim" ? size * 0.8 : size;
      // Buys point up with the tip just under the price, sells point down from just above it.
      if (buy) triangle(ctx, x, y + 2, s, "down", col.fill, col.stroke);
      else triangle(ctx, x, y - 2, s, "up", col.fill, col.stroke);
      if (f.kind === "add") {
        ctx.beginPath(); ctx.arc(x, buy ? y + 2 + s * 1.1 + 4 : y - 2 - s * 1.1 - 4, 2, 0, Math.PI * 2); ctx.fillStyle = col.fill; ctx.fill();
      }
    }
    const hov = this.hovered != null ? this.placed.find((p) => p.fill.id === this.hovered) : null;
    if (hov) {
      const f = hov.fill;
      const parts = [`${KIND_LABEL[f.kind]} ${fmtPrice(f.price)}`];
      if (f.qty != null) parts.push(`× ${fmtQty(f.qty)} шт.`);
      if (f.time != null) parts.push(`${fmtEtTime(f.time, true)} ET`);
      else if (f.byPrice) parts.push("по цене (время неизвестно)");
      const buy = (this.side === "long") === isOpening(f.kind);
      label(ctx, theme, parts.join(" · "), hov.x + 10, buy ? hov.y + 14 : hov.y - 14, { anchor: buy ? "tl" : "bl", clamp: { width, height }, weight: 500 });
    }
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    let best: Placed | null = null, bestD = 10;
    for (const p of this.placed) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    const id = best ? best.fill.id : null;
    if (id !== this.hovered) { this.hovered = id; this.requestUpdate(); }
    return best ? { externalId: `fill:${best.fill.id}`, zOrder: "top", cursorStyle: "pointer", distance: bestD, itemType: "marker" } : null;
  }
}
