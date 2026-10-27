/**
 * The «Олимп» coin: one crisp inline SVG (no raster, no filters) that scales from 24 px to 240 px.
 * Layers: bevelled rim → beading → rim legend (engraved, top and bottom arcs) → recessed field → laurel wreath →
 * struck emblem (shadow + highlight + face passes) → specular sheen → optional one-off shine sweep.
 * Detail follows the rendered size: ≥ 72 px rim legend, ≥ 40 px beading and wreath, below that a bold emblem only.
 */
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Emblem, type EmblemKey, type EmblemPaint } from "./emblems";
import type { MetalPaint } from "./metal";

const SERIF = "Georgia, 'Times New Roman', serif";
const C = 100;

export type CoinProps = {
  /** Rendered size in px (24…240). */
  size: number;
  paint: MetalPaint;
  emblem: EmblemKey;
  /** A blank (unearned) coin: no sheen, flat relief. */
  locked?: boolean;
  /** Laurel wreath around the emblem (stage medals). */
  wreath?: boolean;
  /** Rim legend, upper and lower arcs (shown from 72 px). */
  rimTop?: string;
  rimBottom?: string;
  /** Plays the shine sweep once (the caller decides when; never under reduced motion). */
  shine?: boolean;
  /** Progress 0…1 drawn as a ring around the coin (quests in progress). */
  ring?: number | null;
  /** Accessible name; without it the coin is decorative (aria-hidden). */
  label?: string;
  className?: string;
};

type Leaf = { x: number; y: number; rot: number; s: number };

/** Leaves of the left branch: from the tie at the bottom up the left side; the right branch is its mirror. */
function wreathLeaves(r: number): Leaf[] {
  const out: Leaf[] = [];
  const from = 108, to = 238, n = 10;
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / (n - 1);
    const rad = (a * Math.PI) / 180;
    const s = 1.25 - (0.5 * i) / (n - 1);
    const tangent = a + 90;
    for (const side of [1, -1] as const) {
      const rr = r + side * 3.2 * s;
      out.push({ x: C + rr * Math.cos(rad), y: C + rr * Math.sin(rad), rot: tangent - side * 34, s });
    }
  }
  return out;
}

const LEAF = "M0 0 C3.5 -3.6 8.5 -3.8 12 0 C8.5 3.8 3.5 3.6 0 0 Z";

function arc(r: number, a0: number, a1: number, sweep: 0 | 1) {
  const p = (a: number) => `${(C + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(C + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(a0)} A${r} ${r} 0 0 ${sweep} ${p(a1)}`;
}

function Wreath({ r, paint, ids }: { r: number; paint: MetalPaint; ids: { leaf: string } }) {
  const leaves = wreathLeaves(r);
  const stem = arc(r, 104, 236, 1);
  const branch = (fill: string, line: string, dx = 0, dy = 0, opacity = 1) => (
    <g transform={`translate(${dx} ${dy})`} opacity={opacity}>
      <path d={stem} fill="none" stroke={line} strokeWidth={1.6} strokeLinecap="round" />
      {leaves.map((l, i) => (
        <path key={i} d={LEAF} transform={`translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) rotate(${l.rot.toFixed(1)}) scale(${l.s.toFixed(3)})`} fill={fill} stroke={line} strokeWidth={0.7 / l.s} />
      ))}
    </g>
  );
  const both = (node: ReactNode) => (
    <>
      {node}
      <g transform="matrix(-1 0 0 1 200 0)">{node}</g>
    </>
  );
  return (
    <g>
      {both(branch(paint.deep, paint.deep, 0.9, 1.1, 0.55))}
      {both(branch(`url(#${ids.leaf})`, paint.dark))}
      {/* the tie */}
      <path d={`M${C - 7} ${C + r + 5} Q${C} ${C + r - 2} ${C + 7} ${C + r + 5}`} fill="none" stroke={paint.dark} strokeWidth={2.2} strokeLinecap="round" />
      <ellipse cx={C} cy={C + r + 1} rx={3.6} ry={3} fill={`url(#${ids.leaf})`} stroke={paint.dark} strokeWidth={0.9} />
    </g>
  );
}

export function Coin({ size, paint, emblem, locked = false, wreath = false, rimTop, rimBottom, shine = false, ring = null, label, className }: CoinProps) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (k: string) => `coin${raw}${k}`;
  const ids = { rim: id("r"), field: id("f"), face: id("e"), leaf: id("l"), sheen: id("s"), shine: id("h"), clip: id("c"), top: id("t"), bot: id("b") };
  const u = 200 / size; // SVG units per CSS pixel
  const legend = size >= 72 && !!(rimTop || rimBottom);
  const detailed = size >= 40;
  const fieldR = legend ? 78 : detailed ? 84 : 86;
  const showWreath = wreath && detailed;
  const wreathR = fieldR - 13;
  // Emblem scale: room inside the wreath, or the whole field when the coin is too small for a wreath.
  const emblemScale = showWreath ? (legend ? 0.8 : 0.88) : detailed ? 1.08 : 1.2;
  // The relief shadow grows on small coins so the emblem keeps a dark edge against the field.
  const sh = Math.max(1.5, 0.55 * u) / emblemScale;
  const outline = Math.max(1.4, 0.75 * u);
  const face: EmblemPaint = { body: `url(#${ids.face})`, line: paint.dark, deep: paint.deep };
  const flat = (c: string): EmblemPaint => ({ body: c, line: c, deep: c });
  const fs = (text: string) => Math.max(8.5, Math.min(13, 150 / Math.max(6, text.length * 0.92)));
  const pct = ring == null ? null : Math.max(0, Math.min(1, ring));
  const body = (
    <g>
      {/* rim, bevelled */}
      <circle cx={C} cy={C} r={98.5} fill={`url(#${ids.rim})`} />
      <circle cx={C} cy={C} r={98.5 - outline / 2} fill="none" stroke={paint.deep} strokeWidth={outline} />
      <circle cx={C} cy={C} r={96} fill="none" stroke={paint.hi} strokeWidth={0.8} opacity={locked ? 0.4 : 0.7} />
      {detailed && <circle cx={C} cy={C} r={92.5} fill="none" stroke={paint.dark} strokeWidth={2.4} strokeDasharray={size >= 72 ? "0.01 5.3" : "0.01 7.6"} strokeLinecap="round" />}
      {legend && (
        <g fontFamily={SERIF} fontWeight={700} letterSpacing={2.2}>
          {rimTop && (
            <>
              <text fontSize={fs(rimTop)} fill={paint.hi} opacity={0.75} transform="translate(0.6 0.8)"><textPath href={`#${ids.top}`} startOffset="50%" textAnchor="middle">{rimTop}</textPath></text>
              <text fontSize={fs(rimTop)} fill={paint.deep}><textPath href={`#${ids.top}`} startOffset="50%" textAnchor="middle">{rimTop}</textPath></text>
            </>
          )}
          {rimBottom && (
            <>
              <text fontSize={fs(rimBottom) * 0.86} fill={paint.hi} opacity={0.75} transform="translate(0.6 0.8)"><textPath href={`#${ids.bot}`} startOffset="50%" textAnchor="middle">{rimBottom}</textPath></text>
              <text fontSize={fs(rimBottom) * 0.86} fill={paint.deep}><textPath href={`#${ids.bot}`} startOffset="50%" textAnchor="middle">{rimBottom}</textPath></text>
            </>
          )}
          <path d="M8 100 l4 -3 l4 3 l-4 3 Z M184 100 l4 -3 l4 3 l-4 3 Z" fill={paint.deep} />
        </g>
      )}
      {/* recessed field: shadow on the upper-left lip, light on the lower-right */}
      <circle cx={C} cy={C} r={fieldR} fill={`url(#${ids.field})`} />
      <circle cx={C} cy={C} r={fieldR} fill="none" stroke={paint.deep} strokeWidth={Math.max(1.6, 0.9 * u)} />
      <circle cx={C + 0.8} cy={C + 0.8} r={fieldR - 1.6} fill="none" stroke={paint.hi} strokeWidth={0.9} opacity={locked ? 0.3 : 0.55} />
      {showWreath && <Wreath r={wreathR} paint={paint} ids={ids} />}
      {/* struck emblem */}
      <g transform={`translate(${C} ${C}) scale(${emblemScale}) translate(${-C} ${-C})`}>
        <g transform={`translate(${sh.toFixed(2)} ${(sh * 1.25).toFixed(2)})`} opacity={0.72}><Emblem name={emblem} paint={flat(paint.deep)} /></g>
        {!locked && <g transform="translate(-0.9 -0.9)" opacity={0.85}><Emblem name={emblem} paint={flat(paint.hi)} /></g>}
        <Emblem name={emblem} paint={face} />
      </g>
      {!locked && <ellipse cx={74} cy={60} rx={58} ry={34} transform="rotate(-32 74 60)" fill={`url(#${ids.sheen})`} />}
      {shine && !locked && (
        <g clipPath={`url(#${ids.clip})`}>
          <g transform="rotate(22 100 100)">
            <rect x={-70} y={-40} width={56} height={280} fill={`url(#${ids.shine})`}>
              <animateTransform attributeName="transform" type="translate" from="0 0" to="300 0" dur="1.1s" begin="0.75s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" />
            </rect>
          </g>
        </g>
      )}
    </g>
  );
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("shrink-0 select-none", className)}
    >
      {label && <title>{label}</title>}
      <defs>
        <linearGradient id={ids.rim} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor={paint.hi} />
          <stop offset="0.28" stopColor={paint.light} />
          <stop offset="0.62" stopColor={paint.mid} />
          <stop offset="1" stopColor={paint.dark} />
        </linearGradient>
        <radialGradient id={ids.field} cx="0.4" cy="0.36" r="0.75">
          <stop offset="0" stopColor={paint.mid} />
          <stop offset="1" stopColor={paint.dark} />
        </radialGradient>
        {/* the struck relief is polished: a step lighter than the frosted field, so it reads even at 24 px */}
        <linearGradient id={ids.face} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={paint.hi} />
          <stop offset="0.6" stopColor={paint.light} />
          <stop offset="1" stopColor={paint.light} />
        </linearGradient>
        <linearGradient id={ids.leaf} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={paint.hi} />
          <stop offset="1" stopColor={paint.light} />
        </linearGradient>
        <radialGradient id={ids.sheen}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.32} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={ids.shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.7} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <clipPath id={ids.clip}><circle cx={C} cy={C} r={98} /></clipPath>
        <path id={ids.top} d={arc(83.5, 180, 360, 1)} />
        <path id={ids.bot} d={arc(91.5, 180, 0, 0)} />
      </defs>
      {pct == null ? body : (
        <>
          <circle cx={C} cy={C} r={94} fill="none" stroke="hsl(var(--foreground) / 0.12)" strokeWidth={11} />
          {pct > 0 && (
            <circle cx={C} cy={C} r={94} fill="none" stroke="hsl(var(--primary))" strokeWidth={11} strokeLinecap="round"
              strokeDasharray={`${(2 * Math.PI * 94 * pct).toFixed(1)} 1000`} transform="rotate(-90 100 100)" />
          )}
          <g transform="translate(100 100) scale(0.8) translate(-100 -100)">{body}</g>
        </>
      )}
    </svg>
  );
}
