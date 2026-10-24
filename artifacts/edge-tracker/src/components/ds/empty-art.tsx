/**
 * Engraved empty-state art: small monochrome line drawings in the «Олимп» spirit of the share cards (classical
 * engraving: thin contour, cross-hatched shadow, a dotted medallion rule). Abstract classical motifs drawn from
 * scratch — a column, a laurel wreath, an amphora, a scroll, scales, a temple front — no copied artwork.
 *
 * Everything strokes `currentColor`, so the art follows the theme (light / dark / custom accents) and stays
 * monochrome; the hatching is a pattern clipped to the shadow side of each motif. Decorative: `aria-hidden`.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";

export const EMPTY_ART = ["column", "laurel", "amphora", "scroll", "scales", "temple"] as const;
export type EmptyArt = (typeof EMPTY_ART)[number];

/** The wreath: leaves along an arc round the centre (left branch), mirrored for the right one. */
const WREATH = { cx: 48, cy: 47, r: 21, from: 105, to: 245, count: 7 };

function arcPoint(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [WREATH.cx + WREATH.r * Math.cos(a), WREATH.cy + WREATH.r * Math.sin(a)];
}

type Leaf = { x: number; y: number; rot: number; rx: number; inner: boolean };

const LEFT_LEAVES: Leaf[] = Array.from({ length: WREATH.count }, (_, k) => {
  const deg = WREATH.from + ((WREATH.to - WREATH.from) * (k + 0.5)) / WREATH.count;
  const [x, y] = arcPoint(deg);
  const a = (deg * Math.PI) / 180;
  return ([1, -1] as const).map((off) => ({
    x: x + off * Math.cos(a) * 3.4,
    y: y + off * Math.sin(a) * 3.4,
    rot: deg + 90 + off * -32,
    rx: 4.1 - k * 0.14,
    inner: off === -1,
  }));
}).flat();

const RIGHT_LEAVES: Leaf[] = LEFT_LEAVES.map((l) => ({ ...l, x: 2 * WREATH.cx - l.x, rot: 180 - l.rot }));

function wreathStem(side: 1 | -1): string {
  const [x0, y0] = arcPoint(WREATH.from - 8);
  const [x1, y1] = arcPoint(WREATH.to + 4);
  const mx = (x: number) => (side === 1 ? x : 2 * WREATH.cx - x);
  return `M${mx(x0).toFixed(2)} ${y0.toFixed(2)}A${WREATH.r} ${WREATH.r} 0 0 ${side === 1 ? 1 : 0} ${mx(x1).toFixed(2)} ${y1.toFixed(2)}`;
}

function Leaves({ leaves, hatch }: { leaves: Leaf[]; hatch: string }) {
  return (
    <>
      {leaves.map((l, i) => (
        <ellipse
          key={i}
          cx={l.x.toFixed(2)}
          cy={l.y.toFixed(2)}
          rx={l.rx.toFixed(2)}
          ry="1.7"
          transform={`rotate(${l.rot.toFixed(1)} ${l.x.toFixed(2)} ${l.y.toFixed(2)})`}
          fill={l.inner ? `url(#${hatch})` : "none"}
        />
      ))}
    </>
  );
}

function Motif({ art, hatch, clip }: { art: EmptyArt; hatch: string; clip: string }) {
  switch (art) {
    case "column":
      return (
        <>
          <clipPath id={clip}><path d="M53 33H59L61 66H53Z" /></clipPath>
          <rect x="29" y="23" width="38" height="3.5" rx="0.6" />
          <path d="M33 26.5C38 31 58 31 63 26.5" />
          <circle cx="31.5" cy="30" r="3.6" />
          <circle cx="31.5" cy="30" r="1.3" />
          <circle cx="64.5" cy="30" r="3.6" />
          <circle cx="64.5" cy="30" r="1.3" />
          <path d="M37 33L35 66M59 33L61 66" />
          <path d="M41.5 34V65.5M46 34V65.5M50.5 34V65.5M55 34V65.5" opacity="0.55" />
          <rect x="53" y="33" width="9" height="33" fill={`url(#${hatch})`} stroke="none" clipPath={`url(#${clip})`} />
          <rect x="33" y="66" width="30" height="3" rx="1.5" />
          <rect x="29" y="69" width="38" height="4" rx="0.6" />
        </>
      );
    case "laurel":
      return (
        <>
          <path d={wreathStem(1)} />
          <path d={wreathStem(-1)} />
          <Leaves leaves={LEFT_LEAVES} hatch={hatch} />
          <Leaves leaves={RIGHT_LEAVES} hatch={hatch} />
          <path d="M44.5 68.5C46 71 50 71 51.5 68.5M45.5 70L42 76M50.5 70L54 76" />
        </>
      );
    case "amphora":
      return (
        <>
          <clipPath id={clip}><path d="M48 33H51C63 37 65 56 52 67L54 72H48Z" /></clipPath>
          <path d="M42.5 22H53.5M44 22V25H52V22" />
          <path d="M45 25C45 29 46 31 45 33C33 37 31 56 44 67L42 72H54L52 67C65 56 63 37 51 33C50 31 51 29 51 25" />
          <path d="M45 27.5C37.5 26 36 33 39.5 37M51 27.5C58.5 26 60 33 56.5 37" />
          <path d="M36 43.5Q48 46.5 60 43.5M35 51Q48 54 61 51" />
          <path d="M37 47.3L40 45.6L43 47.6L46 45.9L49 47.9L52 46.2L55 48.1L58 46.3" opacity="0.6" />
          <rect x="48" y="33" width="18" height="39" fill={`url(#${hatch})`} stroke="none" clipPath={`url(#${clip})`} />
        </>
      );
    case "scroll":
      return (
        <>
          <path d="M31 31V63M65 31V63" />
          <path d="M36 37.5H58M36 41.5H55M36 45.5H59M36 49.5H52M36 53.5H57M36 57.5H48" opacity="0.55" />
          <rect x="27" y="25" width="42" height="7" rx="3.5" />
          <path d="M30.5 32V25M65.5 32V25" opacity="0.6" />
          <rect x="28" y="28.5" width="40" height="3.5" fill={`url(#${hatch})`} stroke="none" />
          <rect x="27" y="62" width="42" height="7" rx="3.5" />
          <path d="M30.5 69V62M65.5 69V62" opacity="0.6" />
          <rect x="28" y="65.5" width="40" height="3.5" fill={`url(#${hatch})`} stroke="none" />
        </>
      );
    case "scales":
      return (
        <>
          <circle cx="48" cy="24.5" r="2" />
          <path d="M48 26.5V68M27 32.5H69" />
          <path d="M29 32.5L23 50M29 32.5L35 50M67 32.5L61 50M67 32.5L73 50" opacity="0.7" />
          <path d="M21 50Q29 57.5 37 50Z" fill={`url(#${hatch})`} />
          <path d="M59 50Q67 57.5 75 50Z" fill={`url(#${hatch})`} />
          <path d="M40 72.5H56L53 68H43Z" fill={`url(#${hatch})`} />
        </>
      );
    case "temple":
      return (
        <>
          <path d="M23 36L48 22L73 36Z" />
          <path d="M30 34L48 24.5L66 34Z" fill={`url(#${hatch})`} opacity="0.9" />
          <rect x="23" y="36" width="50" height="4" rx="0.5" />
          <path d="M29 40V64M33 40V64M41 40V64M45 40V64M51 40V64M55 40V64M63 40V64M67 40V64" />
          <path d="M31 41V63M43 41V63M53 41V63M65 41V63" opacity="0.45" />
          <rect x="21" y="64" width="54" height="3" rx="0.5" />
          <rect x="18" y="67" width="60" height="3.5" rx="0.5" fill={`url(#${hatch})`} />
        </>
      );
  }
}

export function EngravedArt({ art = "column", size = 88, className }: { art?: EmptyArt; size?: number; className?: string }) {
  // useId gives «:r1:» (not valid inside url(#…)): keep letters and digits only.
  const uid = `ea${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const hatch = `${uid}h`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-art={art}
      className={cn("shrink-0", className)}
    >
      <defs>
        <pattern id={hatch} width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="2.6" strokeWidth="0.6" opacity="0.7" />
        </pattern>
      </defs>
      {/* Medallion: a fine outer rule and a dotted engraver's ring. */}
      <circle cx="48" cy="48" r="46" strokeWidth="0.75" opacity="0.35" />
      <circle cx="48" cy="48" r="43" strokeWidth="0.9" strokeDasharray="0.1 2.6" opacity="0.55" />
      <g>
        <Motif art={art} hatch={hatch} clip={`${uid}c`} />
      </g>
      {/* Ground line with a short engraved shadow under the motif. */}
      <path d="M20 77H76" strokeWidth="0.9" opacity="0.6" />
      <path d="M30 79.5H66M38 82H58" strokeWidth="0.6" opacity="0.35" />
    </svg>
  );
}
