/**
 * <LineCanvas> — small canvas line engine for «Статистика офиса»: several cumulative series on one numeric X
 * (day of year, or a day index), an optional horizontal goal line + straight «pace» diagonal, optional area to
 * zero (underwater curve), crosshair + DOM tooltip on hover, click to pick a point, direct end labels.
 * Colours / font come from the app's chart theme (chart-engine/theme), ticks from the equity-chart scale, so it
 * matches the rest of the app's canvas charts in dark and light.
 */
import * as React from "react";
import { readChartTheme, type ChartTheme } from "@/components/chart-engine/theme";
import { useThemeVersion } from "@/components/chart-engine/hooks/useThemeVersion";
import { niceTicks } from "@/components/equity-chart/scale";
import { cn } from "@/lib/utils";
import { fmtMonth, localeTag } from "@/lib/format";
import { CANVAS, DRAW_MS, prefersReducedMotion } from "@/components/shared/charts/theme";
import { monotoneCurve } from "@/components/shared/charts/path";
import { TOOLTIP_SURFACE } from "@/components/shared/charts/tooltip";

export type LinePoint = { x: number; y: number; date: string };
export type LineSeries = {
  key: string;
  label: string;
  color: string;
  points: LinePoint[];
  width?: number;
  /** Fill between the line and zero (underwater curve). */
  area?: boolean;
  /** Start the line at (startX, 0) — cumulative curves begin at zero. */
  fromZero?: boolean;
};

export type HoverRow = { key: string; label: string; color: string; point: LinePoint | null };

export interface LineCanvasProps {
  series: LineSeries[];
  xMin: number;
  xMax: number;
  xTicks?: { x: number; label: string }[];
  /**
   * Horizontal goal line (+ optional diagonal from (xMin, 0) to (xMax, goal)). `fit: false` keeps the y-scale on the
   * data: a goal beyond it is not drawn as a line, a chip with `offLabel` at the top edge says where it is, and the pace
   * diagonal is clipped to the plot.
   */
  goal?: { y: number; label: string; pace?: boolean; fit?: boolean; offLabel?: string } | null;
  fmtY: (v: number) => string;
  height: number;
  compact?: boolean;
  /** Direct labels at the series ends (≤ 4 series, non-compact). */
  endLabels?: boolean;
  /** Tooltip body; default lists series values. */
  renderTooltip?: (x: number, rows: HoverRow[]) => React.ReactNode;
  onPick?: (row: HoverRow) => void;
  ariaLabel: string;
  className?: string;
}

const PAD_COMPACT = { l: 6, r: 6, t: 8, b: 6 };

/** Last point at or before x (cumulative values carry forward); null before the first point or after the last. */
function pointAt(pts: LinePoint[], x: number, slack: number): LinePoint | null {
  if (!pts.length || x < pts[0].x - slack || x > pts[pts.length - 1].x + slack) return null;
  let lo = 0, hi = pts.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x <= x) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return pts[0];
  // Snap to the nearer neighbour so a click lands on the day under the cursor.
  const nxt = pts[best + 1];
  return nxt && Math.abs(nxt.x - x) < Math.abs(x - pts[best].x) ? nxt : pts[best];
}

export function LineCanvas({
  series, xMin, xMax, xTicks = [], goal, fmtY, height, compact = false, endLabels = false, renderTooltip, onPick, ariaLabel, className,
}: LineCanvasProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [hoverX, setHoverX] = React.useState<number | null>(null);
  const themeV = useThemeVersion();
  // Draw-in: the series reveal left → right once on mount (skipped under prefers-reduced-motion).
  const [reveal, setReveal] = React.useState(() => (prefersReducedMotion() ? 1 : 0));
  React.useEffect(() => {
    if (reveal >= 1) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / DRAW_MS);
      setReveal(1 - (1 - k) ** 3);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Y domain + left padding (room for the widest tick label).
  const geo = React.useMemo(() => {
    let min = 0, max = 0;
    for (const s of series) for (const p of s.points) { if (p.y < min) min = p.y; if (p.y > max) max = p.y; }
    if (goal && goal.fit !== false) { min = Math.min(min, goal.y); max = Math.max(max, goal.y); }
    if (max - min < 1e-9) { max += 1; min -= 1; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.1;
    const ticks = niceTicks(min, max, compact ? 3 : 5);
    const labelW = compact ? 0 : Math.max(32, ...ticks.map((t) => fmtY(t).length * 6.4 + 10));
    const pad = compact ? PAD_COMPACT : { l: labelW, r: endLabels ? 84 : 12, t: 12, b: 24 };
    return { min, max, ticks, pad };
  }, [series, goal, compact, endLabels, fmtY]);

  const sx = React.useCallback((x: number) => geo.pad.l + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * Math.max(1, width - geo.pad.l - geo.pad.r), [geo, xMin, xMax, width]);
  const sy = React.useCallback((y: number) => geo.pad.t + (1 - (y - geo.min) / (geo.max - geo.min)) * Math.max(1, height - geo.pad.t - geo.pad.b), [geo, height]);
  const invX = React.useCallback((px: number) => xMin + ((px - geo.pad.l) / Math.max(1, width - geo.pad.l - geo.pad.r)) * (xMax - xMin), [geo, xMin, xMax, width]);

  const slack = (xMax - xMin) / Math.max(1, width) * 6;
  const rows: HoverRow[] = React.useMemo(
    () => (hoverX == null ? [] : series.map((s) => ({ key: s.key, label: s.label, color: s.color, point: pointAt(s.points, hoverX, slack) }))),
    [hoverX, series, slack],
  );

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const th = readChartTheme();
    draw(ctx, th);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, series, goal, geo, themeV, rows, compact, endLabels, reveal]);

  function draw(ctx: CanvasRenderingContext2D, th: ChartTheme) {
    const { pad, ticks } = geo;
    const x0 = pad.l, x1 = width - pad.r, yTop = pad.t, yBot = height - pad.b;
    ctx.font = `500 ${compact ? 10 : 11}px ${th.font}`;
    // grid + y labels
    ctx.lineWidth = 1;
    for (const t of ticks) {
      const y = Math.round(sy(t)) + 0.5;
      // Dotted, faint horizontal guides; the zero rule is the emphasised (solid) one.
      const zero = Math.abs(t) < 1e-9;
      ctx.setLineDash(zero ? [] : (CANVAS.gridDash as number[]));
      ctx.strokeStyle = zero ? th.fg(CANVAS.zeroAlpha(th.dark)) : th.border(CANVAS.gridAlpha(th.dark) * (compact ? 0.7 : 1));
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.setLineDash([]);
      if (!compact) {
        ctx.fillStyle = th.muted(0.95);
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(fmtY(t), x0 - 6, y);
      }
    }
    if (!ticks.some((t) => Math.abs(t) < 1e-9) && geo.min < 0 && geo.max > 0) {
      const y = Math.round(sy(0)) + 0.5;
      ctx.strokeStyle = th.fg(CANVAS.zeroAlpha(th.dark));
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    // x ticks
    if (!compact && xTicks.length) {
      ctx.fillStyle = th.muted(0.95);
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      let lastRight = -Infinity;
      for (const t of xTicks) {
        const x = sx(t.x);
        if (x < x0 - 1 || x > x1 + 1) continue;
        const w = ctx.measureText(t.label).width;
        if (x - w / 2 > lastRight + 6) { ctx.fillText(t.label, x + (w / 2 < 14 ? 8 : 0), yBot + 6); lastRight = x + w / 2; }
      }
    }
    // goal + pace
    const goalOff = !!goal && goal.fit === false && (goal.y > geo.max || goal.y < geo.min);
    if (goal) {
      const gy = Math.round(sy(goal.y)) + 0.5;
      ctx.save();
      // Clip to the plot: with a data-fitted scale the goal (and the far end of its pace line) can lie outside.
      ctx.beginPath(); ctx.rect(x0, yTop, x1 - x0, yBot - yTop); ctx.clip();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = th.fg(0.55);
      ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
      if (goal.pace) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = th.fg(0.3);
        ctx.beginPath(); ctx.moveTo(sx(xMin), sy(0)); ctx.lineTo(sx(xMax), gy); ctx.stroke();
      }
      ctx.restore();
      if (!compact) {
        const text = goalOff ? (goal.offLabel ?? goal.label) : goal.label;
        ctx.font = `600 12px ${th.font}`;
        const w = ctx.measureText(text).width + 12;
        const lx = x0 + 6, ly = goalOff ? (goal.y > geo.max ? yTop + 10 : yBot - 10) : gy - 10;
        ctx.fillStyle = th.labelBg;
        roundRect(ctx, lx, ly - 9, w, 18, 9); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(text, lx + 6, ly + 0.5);
        ctx.font = `500 12px ${th.font}`;
      }
    }
    // series (context first, focus last)
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 - 2, yTop - 2, (x1 - x0) * reveal + 4, yBot - yTop + 4); ctx.clip();
    for (let si = series.length - 1; si >= 0; si--) {
      const s = series[si];
      if (!s.points.length) continue;
      const pts = s.fromZero ? [{ x: Math.max(xMin, s.points[0].x - 1), y: 0, date: "" }, ...s.points] : s.points;
      if (s.area) {
        ctx.beginPath();
        ctx.moveTo(sx(pts[0].x), sy(0));
        monotoneCurve(ctx, pts.map((p) => [sx(p.x), sy(p.y)] as const), true);
        ctx.lineTo(sx(pts[pts.length - 1].x), sy(0));
        ctx.closePath();
        // Soft fade: strongest at the curve's far edge, transparent at the zero line.
        let far = sy(0);
        for (const p of pts) far = Math.abs(sy(p.y) - sy(0)) > Math.abs(far - sy(0)) ? sy(p.y) : far;
        const g = ctx.createLinearGradient(0, sy(0), 0, far === sy(0) ? sy(0) + 1 : far);
        g.addColorStop(0, withAlpha(s.color, 0));
        g.addColorStop(1, withAlpha(s.color, CANVAS.fillTop(th.dark) + 0.06));
        ctx.fillStyle = g;
        ctx.fill();
      }
      // Smooth monotone line (passes through every point, no overshoot).
      ctx.beginPath();
      monotoneCurve(ctx, pts.map((p) => [sx(p.x), sy(p.y)] as const));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? (compact ? CANVAS.lineDense : CANVAS.line);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
    // end labels
    if (endLabels && !compact && series.length <= 4) {
      const placed: number[] = [];
      ctx.font = `600 12px ${th.font}`;
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      for (const s of series) {
        const last = s.points[s.points.length - 1];
        if (!last) continue;
        let y = sy(last.y);
        for (const py of placed) if (Math.abs(py - y) < 14) y = py + (y >= py ? 14 : -14);
        placed.push(y);
        const x = Math.min(sx(last.x) + 6, x1 + 6);
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(x + 3, y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = th.fg(0.92);
        ctx.fillText(`${s.label} ${fmtY(last.y)}`, x + 10, y);
      }
    }
    // crosshair
    if (rows.length && hoverX != null) {
      const anyPt = rows.find((r) => r.point);
      const cx = anyPt?.point ? sx(anyPt.point.x) : sx(hoverX);
      // Crosshair: a solid hairline + dots snapped onto the curves.
      ctx.strokeStyle = th.fg(th.dark ? 0.28 : 0.24);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, yTop); ctx.lineTo(Math.round(cx) + 0.5, yBot); ctx.stroke();
      for (const r of rows) {
        if (!r.point) continue;
        ctx.beginPath();
        ctx.arc(sx(r.point.x), sy(r.point.y), compact ? 3.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = r.color; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = th.bg(1); ctx.stroke();
      }
    }
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < geo.pad.l - 4 || px > width - geo.pad.r + 4) { setHoverX(null); return; }
    setHoverX(Math.max(xMin, Math.min(xMax, invX(px))));
  };
  const visibleRows = rows.filter((r) => r.point);
  const tipX = visibleRows[0]?.point ? sx(visibleRows[0].point.x) : hoverX != null ? sx(hoverX) : 0;
  const tipLeft = tipX > width / 2;

  return (
    <div
      ref={wrapRef}
      className={cn("relative w-full touch-pan-y select-none", onPick && visibleRows.length > 0 && "cursor-pointer", className)}
      style={{ height }}
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHoverX(null)}
      onClick={() => { const r = visibleRows[0]; if (r && onPick) onPick(r); }}
      role="img"
      aria-label={ariaLabel}
    >
      <canvas ref={canvasRef} className="block" />
      {visibleRows.length > 0 && hoverX != null && (
        <div
          className={cn(
            TOOLTIP_SURFACE, "absolute top-1 z-raised min-w-[9rem] max-w-[16rem]",
            compact && "px-2 py-1.5 text-2xs",
          )}
          style={tipLeft ? { right: Math.max(4, width - tipX + 12) } : { left: Math.min(width - 150, tipX + 12) }}
        >
          {renderTooltip ? renderTooltip(hoverX, visibleRows) : (
            <div className="flex flex-col gap-1">
              {visibleRows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />{r.label}
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">{fmtY(r.point!.y)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** #rrggbb / rgba(...) → same colour at alpha a. */
function withAlpha(c: string, a: number): string {
  if (c.startsWith("#") && c.length === 7) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(",").map((s) => s.trim()); return `rgba(${r}, ${g}, ${b}, ${a})`; }
  return c;
}

/** Saves the first canvas inside `root` as a PNG on the page background. */
export type PngMeta = {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string; dashed?: boolean }[];
};

/**
 * Saves the chart canvas found in `root` as a PNG on the page background. With `meta` the image gets a header
 * (title, period / units) and a legend row, so a chart pasted into a chat or a report reads on its own.
 */
export function downloadCanvasPng(root: HTMLElement | null, filename: string, meta?: PngMeta) {
  const src = root?.querySelector("canvas");
  if (!src) return;
  const th = readChartTheme();
  const dpr = src.width / Math.max(1, src.clientWidth || src.width);
  const pad = 16 * dpr;
  const headH = meta ? (meta.subtitle ? 50 : 32) * dpr : 0;
  const legH = meta?.legend?.length ? 24 * dpr : 0;
  const out = document.createElement("canvas");
  out.width = src.width + (meta ? pad * 2 : 0);
  out.height = src.height + headH + legH + (meta ? pad * 2 : 0);
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = th.bg(1);
  ctx.fillRect(0, 0, out.width, out.height);
  if (!meta) {
    ctx.drawImage(src, 0, 0);
  } else {
    ctx.save();
    ctx.scale(dpr, dpr);
    const p = pad / dpr;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = th.fg(0.95);
    ctx.font = `600 15px ${th.font}`;
    ctx.fillText(meta.title, p, p);
    if (meta.subtitle) {
      ctx.fillStyle = th.muted(0.95);
      ctx.font = `500 12px ${th.font}`;
      ctx.fillText(meta.subtitle, p, p + 22);
    }
    ctx.restore();
    ctx.drawImage(src, pad, pad + headH);
    if (meta.legend?.length) {
      ctx.save();
      ctx.scale(dpr, dpr);
      let x = pad / dpr;
      const y = (pad + headH + src.height) / dpr + 12;
      ctx.font = `500 12px ${th.font}`;
      ctx.textBaseline = "middle";
      for (const l of meta.legend) {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(l.dashed ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke();
        ctx.fillStyle = th.muted(0.95);
        ctx.fillText(l.label, x + 22, y);
        x += 22 + ctx.measureText(l.label).width + 18;
      }
      ctx.restore();
    }
  }
  const a = document.createElement("a");
  a.href = out.toDataURL("image/png");
  a.download = filename;
  a.click();
}

/**
 * Month ticks (1st of each month) on a day-of-year axis; labels in the UI language («янв» / «Jan»). Built at call
 * time and cached per language, so the array stays referentially stable between renders.
 */
let ticksCache: { tag: string; ticks: { x: number; label: string }[] } | null = null;
export function monthTicks(): { x: number; label: string }[] {
  const tag = localeTag();
  if (ticksCache?.tag !== tag) {
    ticksCache = {
      tag,
      ticks: Array.from({ length: 12 }, (_, i) => ({
        x: Math.round((Date.UTC(2026, i, 1) - Date.UTC(2026, 0, 1)) / 86_400_000) + 1,
        label: fmtMonth(i, "short").replace(".", ""),
      })),
    };
  }
  return ticksCache.ticks;
}
