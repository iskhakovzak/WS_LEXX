/**
 * Series primitive for the simulator chart: the player's fills (B / S circles, × stop, ✓ target), the open position
 * (average line, stop and target), and after the reveal the round trips with a mistake (tinted span + «#n») and the
 * desk's real fills (small triangles, one colour for the viewer's own trades, another for everyone else). Own mode adds
 * a dashed vertical marker where the player really entered (the decision moment). The trainer adds a planned stop line
 * while flat («размер по риску», draggable), and for «Найди вход» the decision window (tinted zone) and the picked /
 * ideal entry markers.
 * Position box (TradingView-like, position-box.ts): a red risk zone entry↔stop and a green reward zone entry↔target,
 * for the open position and for a plan made while flat (planned stop / target from the current price); the line
 * labels carry $ and R. Indices are base-bar indices; on an aggregated display timeframe the chart maps them first
 * (`mapOverlay`).
 * Labels arrive already translated; the primitive only draws.
 */
import { fmtPrice } from "@/lib/format";
import { planBox, positionBox, type Box } from "./position-box";
import { SeriesPrimitiveBase, type RenderCtx, hline, label } from "@/components/chart-engine/primitives/canvas";
import type { ChartTheme } from "@/components/chart-engine";

export type OverlayFill = { idx: number; price: number; qty: number; reason: "buy" | "sell" | "flat" | "stop" | "target" | "end" };
export type OverlaySpan = { from: number; to: number; text: string };
export type OverlayDeskFill = { idx: number; price: number; side: "in" | "out"; long: boolean; own: boolean; tag: string };

export type OverlayData = {
  fills: readonly OverlayFill[];
  pos: number;
  avg: number | null;
  stop: number | null;
  target: number | null;
  openIdx: number | null;
  cursor: number;
  spans: readonly OverlaySpan[];
  desk: readonly OverlayDeskFill[];
  text: { position: string | null; stop: string | null; target: string | null };
  /** Own mode: the real entry moment (drawn after the close of bar `idx`). */
  marker?: { idx: number; text: string } | null;
  /** A stop placed before the entry (flat only). */
  plan?: { price: number; text: string } | null;
  /** A target placed before the entry (flat only). */
  planTarget?: { price: number; text: string } | null;
  /** The current price: entry of the plan box while flat. */
  last?: number | null;
  /** «Не торгую» verdict: the move that was missed (from the decision bar), drawn as a tinted zone with an arrow. */
  move?: { from: number; to: number; entry: number; extreme: number; text: string } | null;
  /** «Найди вход»: the bars where the entry should be picked. */
  zone?: { from: number; to: number; text: string } | null;
  /** «Найди вход»: the player's pick and (after the answer) the reference entry. */
  picks?: readonly { idx: number; price: number; kind: "yours" | "ideal"; text: string }[];
};

export type DragLine = "stop" | "target" | "plan" | "planTarget";

export const EMPTY_OVERLAY: OverlayData = {
  fills: [], pos: 0, avg: null, stop: null, target: null, openIdx: null, cursor: 0, spans: [], desk: [], text: { position: null, stop: null, target: null },
};

/**
 * The overlay with every bar index passed through `f` (base index → display index on an aggregated timeframe).
 * The cursor maps to its display bar, so «after the cursor» stays the forming bar's right edge.
 */
export function mapOverlay(d: OverlayData, f: (i: number) => number): OverlayData {
  return {
    ...d,
    fills: d.fills.map((x) => ({ ...x, idx: f(x.idx) })),
    openIdx: d.openIdx != null ? f(d.openIdx) : null,
    cursor: f(d.cursor),
    spans: d.spans.map((s) => ({ ...s, from: f(s.from), to: f(s.to) })),
    desk: d.desk.map((x) => ({ ...x, idx: f(x.idx) })),
    marker: d.marker ? { ...d.marker, idx: f(d.marker.idx) } : d.marker,
    zone: d.zone ? { ...d.zone, from: f(d.zone.from), to: f(d.zone.to) } : d.zone,
    picks: d.picks?.map((p) => ({ ...p, idx: f(p.idx) })),
    move: d.move ? { ...d.move, from: f(d.move.from), to: f(d.move.to) } : d.move,
  };
}

/** Box zones of the overlay: the open position's, else the flat plan's (null when neither has a line). */
export function overlayBox(d: OverlayData): Box | null {
  if (d.pos !== 0) return positionBox({ pos: d.pos, avg: d.avg, stop: d.stop, target: d.target, unit: 1 });
  if (d.last == null) return null;
  return planBox({ price: d.last, stop: d.plan?.price ?? null, target: d.planTarget?.price ?? null, qty: 1, riskUnit: 1 });
}

/**
 * x of a fractional logical index. The time scale maps only whole indices (a fractional one comes back as 0), so the
 * half-bar edges of spans / zones are interpolated between neighbours (the last loaded bar uses the previous step).
 */
function xAt(rc: RenderCtx, v: number): number | null {
  const i = Math.floor(v);
  const a = rc.x(i);
  if (a == null) return null;
  const f = v - i;
  if (f === 0) return a;
  let b = rc.x(i + 1);
  if (b == null || b === 0) {
    const p = rc.x(i - 1);
    b = p != null ? 2 * a - p : null;
  }
  return b == null ? a : a + f * (b - a);
}

export class SimOverlayPrimitive extends SeriesPrimitiveBase {
  private d: OverlayData = EMPTY_OVERLAY;

  constructor(theme: ChartTheme) {
    super(theme, { zOrder: "top" });
  }

  /** Lines the player can drag right now, with their prices. */
  dragLines(): { kind: DragLine; price: number }[] {
    const d = this.d;
    const out: { kind: DragLine; price: number }[] = [];
    if (d.pos !== 0 && d.stop != null) out.push({ kind: "stop", price: d.stop });
    if (d.pos !== 0 && d.target != null) out.push({ kind: "target", price: d.target });
    if (d.pos === 0 && d.plan) out.push({ kind: "plan", price: d.plan.price });
    if (d.pos === 0 && d.planTarget) out.push({ kind: "planTarget", price: d.planTarget.price });
    return out;
  }

  /** Live preview while a line is dragged (the next `set` from React replaces it). */
  preview(kind: DragLine, price: number, text: string): void {
    const d = this.d;
    if (kind === "plan") this.set({ ...d, plan: { price, text } });
    else if (kind === "planTarget") this.set({ ...d, planTarget: { price, text } });
    else this.set({ ...d, [kind]: price, text: { ...d.text, [kind]: text } });
  }

  set(d: OverlayData): void {
    this.d = d;
    const th = this.theme;
    const labels: { price: number; text: string; color: string }[] = [];
    if (d.pos !== 0 && d.avg != null) labels.push({ price: d.avg, text: fmtPrice(d.avg), color: th.c1(1) });
    if (d.pos !== 0 && d.stop != null) labels.push({ price: d.stop, text: fmtPrice(d.stop), color: th.down(1) });
    if (d.pos !== 0 && d.target != null) labels.push({ price: d.target, text: fmtPrice(d.target), color: th.up(1) });
    if (d.pos === 0 && d.plan) labels.push({ price: d.plan.price, text: fmtPrice(d.plan.price), color: th.down(1) });
    if (d.pos === 0 && d.planTarget) labels.push({ price: d.planTarget.price, text: fmtPrice(d.planTarget.price), color: th.up(1) });
    this.setAxisLabels(labels);
    this.requestUpdate();
  }

  /** The missed move: a tinted zone entry↔extreme over its bars and an arrow from the entry to the extreme. */
  private drawMove(rc: RenderCtx, m: NonNullable<OverlayData["move"]>): void {
    const { ctx, theme, width, height } = rc;
    const x1 = xAt(rc, m.from), x2 = xAt(rc, m.to);
    const y1 = rc.y(m.entry), y2 = rc.y(m.extreme);
    if (x1 == null || x2 == null || y1 == null || y2 == null) return;
    const up = m.extreme > m.entry;
    const col = up ? theme.up : theme.down;
    ctx.fillStyle = col(theme.dark ? 0.14 : 0.1);
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.max(2, Math.abs(x2 - x1)), Math.abs(y2 - y1));
    ctx.save();
    ctx.strokeStyle = col(0.95);
    ctx.fillStyle = col(0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 9 * Math.cos(ang - 0.45), y2 - 9 * Math.sin(ang - 0.45));
    ctx.lineTo(x2 - 9 * Math.cos(ang + 0.45), y2 - 9 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    label(ctx, theme, m.text, x2 + 4, up ? y2 - 4 : y2 + 4, { anchor: up ? "bl" : "tl", bg: col(0.9), size: 10, clamp: { width, height } });
  }

  render(rc: RenderCtx): void {
    const d = this.d;
    const { ctx, theme, width, height } = rc;

    if (d.marker) {
      // Integer logical indices only (the decision bar may be the last one loaded): its centre + half a bar.
      const xc = rc.x(d.marker.idx), xp = rc.x(d.marker.idx - 1);
      const x = xc != null ? xc + (xp != null ? (xc - xp) / 2 : 0) : null;
      if (x != null && x >= 0 && x <= width) {
        ctx.save();
        ctx.strokeStyle = theme.c1(0.85);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
        ctx.stroke();
        ctx.restore();
        label(ctx, theme, d.marker.text, x + 3, 24, { anchor: "tl", bg: theme.c1(0.9), size: 10, clamp: { width, height } });
      }
    }

    if (d.zone) {
      const x1 = xAt(rc, d.zone.from - 0.5), x2 = xAt(rc, d.zone.to + 0.5);
      if (x1 != null && x2 != null && x2 >= 0 && x1 <= width) {
        ctx.fillStyle = theme.c1(theme.dark ? 0.12 : 0.09);
        ctx.fillRect(x1, 0, Math.max(2, x2 - x1), height);
        label(ctx, theme, d.zone.text, Math.max(4, x1 + 2), 6, { anchor: "tl", bg: theme.c1(0.85), size: 10, clamp: { width, height } });
      }
    }

    // Position box: the zones first (under the lines and labels).
    const box = overlayBox(d);
    if (box) {
      const x0 = d.pos !== 0 && d.openIdx != null ? (rc.x(d.openIdx) ?? 0) : (xAt(rc, d.cursor + 0.5) ?? 0);
      const zone = (z: { from: number; to: number } | null, color: string) => {
        if (!z) return;
        const ya = rc.y(z.from), yb = rc.y(z.to);
        if (ya == null || yb == null) return;
        ctx.fillStyle = color;
        ctx.fillRect(Math.max(0, x0), Math.min(ya, yb), Math.max(0, width - Math.max(0, x0)), Math.abs(yb - ya));
      };
      zone(box.risk, theme.down(theme.dark ? 0.16 : 0.12));
      zone(box.reward, theme.up(theme.dark ? 0.16 : 0.12));
    }

    if (d.pos === 0 && d.plan) {
      const y = rc.y(d.plan.price);
      if (y != null) {
        hline(ctx, 0, width, y, theme.down(0.9), 1.5, [6, 4]);
        label(ctx, theme, d.plan.text, 6, y + 3, { anchor: "tl", bg: theme.down(0.85), size: 10, clamp: { width, height } });
      }
    }
    if (d.pos === 0 && d.planTarget) {
      const y = rc.y(d.planTarget.price);
      if (y != null) {
        hline(ctx, 0, width, y, theme.up(0.9), 1.5, [6, 4]);
        const above = d.last == null || d.planTarget.price > d.last;
        label(ctx, theme, d.planTarget.text, 6, above ? y - 3 : y + 3, { anchor: above ? "bl" : "tl", bg: theme.up(0.85), size: 10, clamp: { width, height } });
      }
    }

    if (d.move) this.drawMove(rc, d.move);

    for (const s of d.spans) {
      const x1 = xAt(rc, s.from - 0.5), x2 = xAt(rc, s.to + 0.5);
      if (x1 == null || x2 == null || x2 < 0 || x1 > width) continue;
      ctx.fillStyle = theme.down(theme.dark ? 0.1 : 0.08);
      ctx.fillRect(x1, 0, Math.max(2, x2 - x1), height);
      label(ctx, theme, s.text, Math.max(4, x1 + 2), 6, { anchor: "tl", bg: theme.down(0.85), size: 10, clamp: { width, height } });
    }

    if (d.pos !== 0 && d.avg != null && d.openIdx != null) {
      const x0 = rc.x(d.openIdx) ?? 0;
      const xc = xAt(rc, d.cursor + 0.5) ?? width;
      const y = rc.y(d.avg);
      if (y != null) {
        hline(ctx, x0, xc, y, theme.c1(0.95), 1.5);
        hline(ctx, xc, width, y, theme.c1(0.35), 1, [4, 4]);
        if (d.text.position) label(ctx, theme, d.text.position, Math.max(4, x0), y - 4, { anchor: "bl", bg: theme.c1(0.9), size: 10, clamp: { width, height } });
      }
      if (d.stop != null) {
        const ys = rc.y(d.stop);
        if (ys != null) {
          hline(ctx, x0, width, ys, theme.down(0.95), 1.5);
          if (d.text.stop) label(ctx, theme, d.text.stop, Math.max(4, x0), d.pos > 0 ? ys + 3 : ys - 3, { anchor: d.pos > 0 ? "tl" : "bl", bg: theme.down(0.9), size: 10, clamp: { width, height } });
        }
      }
      if (d.target != null) {
        const yt = rc.y(d.target);
        if (yt != null) {
          hline(ctx, x0, width, yt, theme.up(0.95), 1.5);
          if (d.text.target) label(ctx, theme, d.text.target, Math.max(4, x0), d.pos > 0 ? yt - 3 : yt + 3, { anchor: d.pos > 0 ? "bl" : "tl", bg: theme.up(0.9), size: 10, clamp: { width, height } });
        }
      }
    }

    for (const f of d.desk) {
      const x = rc.x(f.idx), y = rc.y(f.price);
      if (x == null || y == null || x < -10 || x > width + 10) continue;
      // Buying (long in / short out) points up, selling points down.
      const up = f.side === "in" ? f.long : !f.long;
      const col = f.own ? theme.c1(1) : theme.c5(1);
      const s = 5;
      ctx.beginPath();
      if (up) { ctx.moveTo(x, y + 2); ctx.lineTo(x - s, y + 2 + s * 1.6); ctx.lineTo(x + s, y + 2 + s * 1.6); }
      else { ctx.moveTo(x, y - 2); ctx.lineTo(x - s, y - 2 - s * 1.6); ctx.lineTo(x + s, y - 2 - s * 1.6); }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      if (f.tag) {
        ctx.fillStyle = col;
        ctx.font = `600 9px ${theme.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = up ? "top" : "bottom";
        ctx.fillText(f.tag, x, up ? y + 4 + s * 1.6 : y - 4 - s * 1.6);
      }
    }

    for (const f of d.fills) {
      const x = rc.x(f.idx), y = rc.y(f.price);
      if (x == null || y == null || x < -10 || x > width + 10) continue;
      const buy = f.qty > 0;
      const col = f.reason === "stop" ? theme.down(1) : f.reason === "target" ? theme.up(1) : buy ? theme.up(1) : theme.down(1);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.bg(1);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `700 9px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.reason === "stop" ? "×" : f.reason === "target" ? "✓" : buy ? "B" : "S", x, y + 0.5);
    }

    for (const p of d.picks ?? []) {
      const x = rc.x(p.idx), y = rc.y(p.price);
      if (x == null || y == null) continue;
      const col = p.kind === "ideal" ? theme.up(1) : theme.c1(1);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 13, y); ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y); ctx.lineTo(x + 13, y);
      ctx.stroke();
      ctx.restore();
      label(ctx, theme, p.text, x + 12, p.kind === "ideal" ? y + 10 : y - 10, { anchor: p.kind === "ideal" ? "tl" : "bl", bg: col, size: 10, clamp: { width, height } });
    }
  }
}
