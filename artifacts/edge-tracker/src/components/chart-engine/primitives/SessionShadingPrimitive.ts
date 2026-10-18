/**
 * Pane primitive: premarket / after-hours shaded background bands (with a small caption) + 9:30 / 16:00 boundary lines.
 * Attached to the price pane (and optionally the volume pane) — it only needs the time scale.
 */
import type { Candle, Session } from "../types";
import { sessionOf } from "../lib/time";
import { chartI18n } from "@/i18n/ns/chart";
import { PanePrimitiveBase, font, type RenderCtx, vline } from "./canvas";

type Segment = { from: number; to: number; session: Session };

export class SessionShadingPrimitive extends PanePrimitiveBase {
  private segments: Segment[] = [];
  private enabled = true;
  private captions = true;

  setBars(bars: readonly Candle[], intraday: boolean): void {
    const segs: Segment[] = [];
    if (intraday) {
      let cur: Segment | null = null;
      for (let i = 0; i < bars.length; i++) {
        const s = sessionOf(bars[i].t);
        if (cur && cur.session === s) cur.to = i;
        else { cur = { from: i, to: i, session: s }; segs.push(cur); }
      }
    }
    this.segments = segs;
    this.requestUpdate();
  }

  setEnabled(on: boolean): void { this.enabled = on; this.requestUpdate(); }
  /** «премаркет» / «постмаркет» captions at the bottom of the shaded bands (on by default). */
  setCaptions(on: boolean): void { this.captions = on; this.requestUpdate(); }

  render(rc: RenderCtx): void {
    if (!this.enabled || !this.segments.length) return;
    const { ctx, height, theme, range } = rc;
    const lo = range ? Math.floor(range.from) - 1 : -Infinity;
    const hi = range ? Math.ceil(range.to) + 1 : Infinity;
    for (const s of this.segments) {
      if (s.to < lo || s.from > hi) continue;
      const x1 = rc.x(s.from - 0.5), x2 = rc.x(s.to + 0.5);
      if (x1 == null || x2 == null) continue;
      if (s.session === "rth") {
        // Boundary hairlines at the open / close of regular hours.
        vline(ctx, x1, 0, height, theme.muted(0.35), 1, [2, 3]);
        vline(ctx, x2, 0, height, theme.muted(0.35), 1, [2, 3]);
        continue;
      }
      // Extended hours: one neutral shade (premarket and after-hours read as «not the main session»), with a small
      // caption at the bottom-left of the band when there is room for it.
      ctx.fillStyle = s.session === "closed" ? theme.muted(0.05) : theme.muted(theme.dark ? 0.09 : 0.07);
      ctx.fillRect(x1, 0, x2 - x1, height);
      const caption = s.session === "pre" ? chartI18n.t("session.premarket") : s.session === "post" ? chartI18n.t("session.postmarket") : null;
      if (caption && this.captions && x2 - x1 > 70) {
        ctx.save();
        ctx.font = font(theme, 10, 500);
        ctx.fillStyle = theme.muted(0.75);
        ctx.textBaseline = "bottom";
        ctx.fillText(caption, Math.max(4, x1 + 6), height - 4);
        ctx.restore();
      }
    }
  }
}
