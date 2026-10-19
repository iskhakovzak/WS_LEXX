/**
 * Series primitive: stop / target lines and +1R / +2R / +3R guides (when a stop exists). Their labels are rail items
 * (stopTargetRail) drawn by LevelsPrimitive together with the key levels, so no two labels overlap.
 */
import { fmtPrice, fmtR } from "@/lib/format";
import type { ChartTheme } from "../theme";
import type { LevelLine } from "./LevelsPrimitive";
import { chartI18n } from "@/i18n/ns/chart";
import { SeriesPrimitiveBase, type RenderCtx, hline } from "./canvas";

export type StopTargetData = {
  stop: number | null;
  target: number | null;
  avgEntry: number | null;
  side: "long" | "short";
};

export class StopTargetPrimitive extends SeriesPrimitiveBase {
  private data: StopTargetData | null = null;
  private visible = true;

  set(data: StopTargetData | null): void {
    this.data = data;
    this.syncAxis();
    this.requestUpdate();
  }
  setVisible(on: boolean): void { this.visible = on; this.syncAxis(); this.requestUpdate(); }

  private syncAxis(): void {
    const data = this.visible ? this.data : null;
    const labels: { price: number; text: string; color: string }[] = [];
    if (data?.stop != null) labels.push({ price: data.stop, text: fmtPrice(data.stop), color: this.theme.down(1) });
    if (data?.target != null) labels.push({ price: data.target, text: fmtPrice(data.target), color: this.theme.up(1) });
    this.setAxisLabels(labels);
  }

  render(rc: RenderCtx): void {
    const d = this.data;
    if (!d || !this.visible) return;
    const { ctx, theme, width, height } = rc;
    // Lines only: the labels go to the right-edge rail of LevelsPrimitive (see stopTargetRail) so they never collide.
    if (d.stop != null) { const y = rc.y(d.stop); if (y != null) hline(ctx, 0, width, y, theme.down(0.9), 1, [6, 4]); }
    if (d.target != null) { const y = rc.y(d.target); if (y != null) hline(ctx, 0, width, y, theme.up(0.9), 1, [6, 4]); }
    for (const p of rLadder(d)) {
      const y = rc.y(p.price);
      if (y == null || y < 0 || y > height) continue;
      hline(ctx, 0, width, y, theme.up(0.35), 1, [1, 4]);
    }
  }
}

/** +1R / +2R / +3R prices (skipping the one that coincides with the target). */
function rLadder(d: StopTargetData): { k: number; price: number }[] {
  const dir = d.side === "short" ? -1 : 1;
  const risk = d.stop != null && d.avgEntry != null ? Math.abs(d.avgEntry - d.stop) : null;
  if (!risk || d.avgEntry == null) return [];
  const out: { k: number; price: number }[] = [];
  for (const k of [1, 2, 3]) {
    const price = d.avgEntry + dir * k * risk;
    if (d.target != null && Math.abs(price - d.target) < risk * 0.05) continue;
    out.push({ k, price });
  }
  return out;
}

/** Labels of the stop, the target and the R ladder for the right-edge rail (LevelsPrimitive, label-only items). */
export function stopTargetRail(d: StopTargetData | null, theme: ChartTheme): LevelLine[] {
  if (!d) return [];
  const dir = d.side === "short" ? -1 : 1;
  const risk = d.stop != null && d.avgEntry != null ? Math.abs(d.avgEntry - d.stop) : null;
  const out: LevelLine[] = [];
  if (d.stop != null) out.push({ key: "stop", price: d.stop, text: `${chartI18n.t("canvas.stopShort")}${risk ? " −1R" : ""}`, color: theme.down(0.9), noLine: true });
  if (d.target != null) {
    const r = risk && d.avgEntry != null ? (dir * (d.target - d.avgEntry)) / risk : null;
    out.push({ key: "target", price: d.target, text: `${chartI18n.t("canvas.targetShort")}${r != null ? ` ${fmtR(r)}` : ""}`, color: theme.up(0.9), noLine: true });
  }
  for (const p of rLadder(d)) out.push({ key: `r${p.k}`, price: p.price, text: `+${p.k}R`, color: theme.up(0.55), noLine: true });
  return out;
}
