/**
 * Series primitive: horizontal key levels (PDH/PDL/PDC, PMH/PML, ORB 5/15, stop / R ladder, VWAP value…).
 *
 * Lines are drawn under the candles; their labels sit on ONE rail along the right edge of the pane, on top of the
 * candles, laid out so they never overlap (close prices such as PMH/PDH are stacked apart with a leader line to their
 * level). The top-left corner stays free for the legend. A level outside the visible price range keeps a dimmed label
 * pinned to the top / bottom edge with an arrow, so the trader still knows it is there.
 * `setDynamic` adds labels computed at render time (e.g. the VWAP value at the right edge of the view).
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, PrimitivePaneViewZOrder } from "lightweight-charts";
import { fmtPrice } from "@/lib/format";
import { SeriesPrimitiveBase, type RenderCtx, type RenderTarget, hline, label, layoutLabels, leader, measureLabel, runRender } from "./canvas";

export type LevelLine = {
  key: string;
  price: number;
  text: string;
  color: string;
  dash?: number[];
  width?: number;
  /** Only draw from this bar index onward (e.g. ORB from the open). */
  fromIdx?: number;
  /** Label only (the line is drawn elsewhere, e.g. the VWAP curve or the stop line). */
  noLine?: boolean;
};

const OPTS = { size: 10, pad: 3 } as const;
/** Narrower panes (phones) do not pin off-screen levels to the edges. */
const PIN_MIN_WIDTH = 520;
const PINNED_MAX = 3;
/** Distance of y outside [0, height] (0 when inside). */
const edgeGap = (y: number | null, height: number) => (y == null ? Infinity : y < 0 ? -y : y > height ? y - height : 0);

export class LevelsPrimitive extends SeriesPrimitiveBase {
  private levels: readonly LevelLine[] = [];
  private dynamic: ((rc: RenderCtx) => readonly LevelLine[]) | null = null;
  private topInset = 0;
  private readonly views: readonly IPrimitivePaneView[];

  constructor(theme: ConstructorParameters<typeof SeriesPrimitiveBase>[0], opts: { zOrder?: PrimitivePaneViewZOrder } = {}) {
    super(theme, opts);
    const view = (zOrder: PrimitivePaneViewZOrder, render: (rc: RenderCtx) => void): IPrimitivePaneView => {
      const renderer: IPrimitivePaneRenderer = { draw: (t: RenderTarget) => runRender(t, (s) => this.buildCtx(s), render) };
      return { zOrder: () => zOrder, renderer: () => renderer };
    };
    this.views = [view(opts.zOrder ?? "bottom", (rc) => this.renderLines(rc)), view("top", (rc) => this.renderLabels(rc))];
  }

  override paneViews(): readonly IPrimitivePaneView[] { return this.views; }

  set(levels: readonly LevelLine[]): void {
    this.levels = levels.filter((l) => Number.isFinite(l.price) && l.price > 0);
    this.requestUpdate();
  }
  setDynamic(fn: ((rc: RenderCtx) => readonly LevelLine[]) | null): void { this.dynamic = fn; this.requestUpdate(); }
  /** Keep the rail below this many px from the top (buttons over the top-right corner of the chart). */
  setTopInset(px: number): void { this.topInset = Math.max(0, px); this.requestUpdate(); }

  /** Unused: the two views above render lines and labels separately. */
  render(): void { /* see renderLines / renderLabels */ }

  private renderLines(rc: RenderCtx): void {
    const { ctx, width, height } = rc;
    for (const l of this.levels) {
      if (l.noLine) continue;
      const y = rc.y(l.price);
      if (y == null || y < -2 || y > height + 2) continue;
      const x0 = Math.max(0, l.fromIdx != null ? (rc.x(l.fromIdx - 0.5) ?? 0) : 0);
      hline(ctx, x0, width, y, l.color, l.width ?? 1, l.dash ?? [2, 3]);
    }
  }

  private renderLabels(rc: RenderCtx): void {
    const all = this.dynamic ? [...this.levels, ...this.dynamic(rc).filter((l) => Number.isFinite(l.price) && l.price > 0)] : this.levels;
    if (!all.length) return;
    const { ctx, theme, width, height } = rc;
    const items: { text: string; y: number; h: number; w: number; lineY: number | null; color: string }[] = [];
    // Off-screen levels are pinned to the edges only where there is room (a phone-sized chart keeps its candles clear),
    // at most PINNED_MAX per edge, the closest ones first.
    const pinRoom = width >= PIN_MIN_WIDTH;
    const pinned = { above: 0, below: 0 };
    const ordered = [...all].map((l) => ({ l, y: rc.y(l.price) })).sort((a, b) => Math.abs(edgeGap(a.y, height)) - Math.abs(edgeGap(b.y, height)));
    for (const { l, y } of ordered) {
      if (y == null) continue;
      const above = y < 0, below = y > height;
      if (above || below) {
        if (!pinRoom) continue;
        const k = above ? "above" : "below";
        if (pinned[k] >= PINNED_MAX) continue;
        pinned[k] += 1;
      }
      const text = `${above ? "↑ " : below ? "↓ " : ""}${l.text} ${fmtPrice(l.price)}`;
      const box = measureLabel(ctx, theme, text, OPTS);
      const at = above ? this.topInset : below ? height : y;
      items.push({ text, y: at - box.h / 2, h: box.h, w: box.w, lineY: above || below ? null : y, color: above || below ? dim(l.color) : l.color });
    }
    if (!items.length) return;
    const inset = this.topInset;
    const tops = layoutLabels(items.map((it) => ({ y: it.y - inset, h: it.h })), height - inset).map((y) => y + inset);
    items.forEach((it, i) => {
      const bx = Math.max(2, width - it.w - 4);
      const box = label(ctx, theme, it.text, bx, tops[i], { anchor: "tl", bg: it.color, size: OPTS.size, pad: OPTS.pad });
      if (it.lineY != null) leader(ctx, box.x + box.w - 8, it.lineY, box, it.color);
    });
  }
}

/** Halve the alpha of an rgba() colour (pinned off-screen levels are secondary). */
function dim(color: string): string {
  const m = /rgba\(([^)]+),\s*([\d.]+)\)$/.exec(color);
  return m ? `rgba(${m[1]}, ${(Number(m[2]) * 0.55).toFixed(2)})` : color;
}
