/**
 * Custom lightweight-charts 5 series: soft rounded candles with thin wicks, a subtle top highlight and an
 * "active" ring for the hovered / keyboard-selected candle. Drawn in bitmap space for crisp edges on any DPR.
 */
import type {
  CustomData, CustomSeriesOptions, CustomSeriesPricePlotValues, CustomSeriesWhitespaceData, ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView, PaneRendererCustomData, PriceToCoordinateConverter, Time,
} from "lightweight-charts";
import { customSeriesDefaultOptions } from "lightweight-charts";

export interface RoundedCandleData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RoundedCandleOptions extends CustomSeriesOptions {
  upColor: string;
  downColor: string;
  flatColor: string;
  /** Ring / column colour for the active candle. */
  activeColor: string;
  /** Logical index of the active candle (−1 = none). */
  activeIndex: number;
}

type Target = Parameters<ICustomSeriesPaneRenderer["draw"]>[0];

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** rgba(r, g, b, a) → same colour with a new alpha (theme colours are always rgba). */
function withAlpha(c: string, a: number): string {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c;
  const [r, g, b] = m[1].split(",").map((s) => s.trim());
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

class Renderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, RoundedCandleData> | null = null;
  private opts: RoundedCandleOptions | null = null;

  update(data: PaneRendererCustomData<Time, RoundedCandleData>, opts: RoundedCandleOptions) {
    this.data = data;
    this.opts = opts;
  }

  draw(target: Target, toY: PriceToCoordinateConverter): void {
    const data = this.data, o = this.opts;
    if (!data || !o || !data.visibleRange || !data.bars.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      const spacing = data.barSpacing * (data.conflationFactor || 1);
      const bodyCss = Math.max(1, Math.min(spacing * 0.7, 26));
      const bodyW = Math.max(1, Math.round(bodyCss * hr));
      const wickW = Math.max(1, Math.round(Math.min(2, Math.max(1, spacing / 12)) * hr));
      const radius = Math.min(bodyW / 2, 3.5 * hr);
      const from = Math.max(0, data.visibleRange!.from), to = Math.min(data.bars.length, data.visibleRange!.to);

      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        const d = bar.originalData;
        if (d.close === undefined) continue;
        const yO = toY(d.open), yC = toY(d.close), yH = toY(d.high), yL = toY(d.low);
        if (yO == null || yC == null || yH == null || yL == null) continue;
        const up = d.close > d.open, down = d.close < d.open;
        const color = up ? o.upColor : down ? o.downColor : o.flatColor;
        const xc = Math.round(bar.x * hr);
        const active = bar.time === o.activeIndex;

        if (active) {
          // Soft column behind the active candle.
          const colW = Math.max(bodyW + 8 * hr, Math.round(spacing * hr));
          ctx.fillStyle = withAlpha(o.activeColor, 0.1);
          ctx.fillRect(xc - colW / 2, 0, colW, bitmapSize.height);
        }

        // Wick: high → low (the best / worst point of the day).
        const wTop = Math.round(Math.min(yH, yL) * vr), wBot = Math.round(Math.max(yH, yL) * vr);
        ctx.fillStyle = withAlpha(color, 0.75);
        ctx.fillRect(xc - Math.floor(wickW / 2), wTop, wickW, Math.max(1, wBot - wTop));

        // Body: open → close, rounded.
        const top = Math.round(Math.min(yO, yC) * vr), bot = Math.round(Math.max(yO, yC) * vr);
        const h = Math.max(Math.round(1.5 * vr), bot - top);
        const x0 = xc - Math.floor(bodyW / 2);
        roundRectPath(ctx, x0, top, bodyW, h, radius);
        if (bodyW >= 4 * hr && h >= 4 * vr) {
          const g = ctx.createLinearGradient(0, top, 0, top + h);
          g.addColorStop(0, withAlpha(color, 1));
          g.addColorStop(1, withAlpha(color, 0.78));
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = color;
        }
        ctx.fill();
        if (active) {
          ctx.lineWidth = Math.max(1, Math.round(1.5 * hr));
          ctx.strokeStyle = o.activeColor;
          roundRectPath(ctx, x0 - 2 * hr, top - 2 * vr, bodyW + 4 * hr, h + 4 * vr, radius + 2 * hr);
          ctx.stroke();
        }
      }
    });
  }
}

export class RoundedCandlesView implements ICustomSeriesPaneView<Time, RoundedCandleData, RoundedCandleOptions> {
  private readonly r = new Renderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.r;
  }

  update(data: PaneRendererCustomData<Time, RoundedCandleData>, options: RoundedCandleOptions): void {
    this.r.update(data, options);
  }

  priceValueBuilder(d: RoundedCandleData): CustomSeriesPricePlotValues {
    return [d.low, d.high, d.close];
  }

  isWhitespace(d: RoundedCandleData | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    return (d as Partial<RoundedCandleData>).close === undefined;
  }

  defaultOptions(): RoundedCandleOptions {
    return {
      ...customSeriesDefaultOptions,
      upColor: "rgba(84, 203, 142, 1)",
      downColor: "rgba(242, 107, 107, 1)",
      flatColor: "rgba(163, 167, 173, 1)",
      activeColor: "rgba(10, 132, 255, 1)",
      activeIndex: -1,
    };
  }
}
