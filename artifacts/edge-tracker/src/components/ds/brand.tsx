/**
 * WS_Desk brand: the WS mark and the «WS_Desk» lockup (owner, 2026-10-24: monochrome; designed by Paul Rand's seven
 * checks, see demo-video-work/logo-canon/canon.md).
 *
 * The mark is the name: a geometric, flat-cut W (four straight strokes) next to an italic serif S (Source Serif 4, OFL,
 * slanted 12 degrees). Upright sans + italic serif is the product's own pairing (the intro's «Good morning, *Zakir*»).
 * Solid shapes in `currentColor`, no strokes / masks / ids, so it follows the theme and renders identically everywhere.
 * Two optical cuts on one 64 grid: «regular», and «small» for tiny renders (wider, opened-up W, heavier S, more air).
 * The same outlines are in public/favicon.svg and rasterised into the ICO / PNG / apple-touch / PWA icons.
 */
import { cn } from "@/lib/utils";

const CUTS = {
  regular: {
    w: "M3.69 18L9.43 46L18.73 46L19.31 41.46L20.41 46L29.99 46L33.49 18L26.84 18L24.66 35.48L20.42 18L15.64 18L13.65 33.69L10.43 18Z",
    s: "M44.38 46.7Q41.8 46.7 39.36 46.18Q36.92 45.67 35.32 44.77L36.85 38.16H40.69L40.55 44.72L37.61 44.24L38.09 41.97Q39.11 42.56 40.1 42.99Q41.1 43.41 42.24 43.65Q43.39 43.89 44.83 43.89Q46.53 43.89 47.67 43.41Q48.8 42.93 49.5 42.1Q50.19 41.28 50.4 40.28Q50.62 39.23 50.35 38.53Q50.08 37.83 49.36 37.28Q48.63 36.73 47.31 36.17L46.14 35.57Q43.75 34.48 42.1 33.23Q40.45 31.98 39.76 30.31Q39.08 28.63 39.59 26.19Q40.17 23.48 41.96 21.65Q43.74 19.81 46.43 18.84Q49.12 17.87 52.27 17.87Q54.95 17.87 57.02 18.43Q59.09 18.98 60.31 19.71L58.77 26.02H55.07L55.17 19.82L58.22 20.43L57.74 22.67Q56.48 21.74 55.2 21.19Q53.93 20.64 52.06 20.64Q50.77 20.64 49.75 21.06Q48.72 21.48 48.05 22.25Q47.37 23.03 47.16 24.01Q46.95 25.02 47.24 25.72Q47.52 26.42 48.29 27.01Q49.05 27.59 50.34 28.23L51.63 28.81Q54.08 29.96 55.69 31.17Q57.3 32.39 57.93 34.03Q58.56 35.67 58.06 38Q57.49 40.68 55.66 42.62Q53.83 44.56 50.96 45.63Q48.09 46.7 44.38 46.7Z",
    box: [3.2, 17.4, 57.6, 29.8] as const,
  },
  small: {
    w: "M0.51 18L7.23 46L17.58 46L18.92 38.18L21.36 46L32.04 46L36.03 18L28.96 18L26.14 37.8L19.96 18L15.28 18L12.13 36.4L7.71 18Z",
    s: "M44.96 46.71Q42.41 46.71 39.92 46.23Q37.43 45.75 35.75 44.83L37.3 38.14H41.35L41.2 44.75L38.2 44.29L38.68 42.03Q39.7 42.57 40.7 42.97Q41.7 43.37 42.84 43.6Q43.99 43.83 45.41 43.83Q47.04 43.83 48.1 43.37Q49.15 42.91 49.8 42.13Q50.44 41.36 50.64 40.44Q50.85 39.44 50.6 38.77Q50.34 38.1 49.66 37.58Q48.98 37.06 47.71 36.51L46.58 35.93Q44.15 34.8 42.48 33.53Q40.8 32.25 40.12 30.56Q39.43 28.87 39.96 26.4Q40.54 23.64 42.36 21.78Q44.18 19.92 46.91 18.94Q49.65 17.96 52.87 17.96Q55.59 17.96 57.71 18.5Q59.83 19.04 61.1 19.76L59.53 26.15H55.64L55.74 19.96L58.88 20.55L58.41 22.76Q57.13 21.89 55.87 21.34Q54.61 20.8 52.72 20.8Q51.51 20.8 50.55 21.2Q49.59 21.59 48.95 22.33Q48.32 23.06 48.12 23.98Q47.92 24.94 48.19 25.61Q48.47 26.27 49.21 26.84Q49.94 27.4 51.19 28.03L52.44 28.61Q54.91 29.79 56.53 31.02Q58.15 32.25 58.78 33.9Q59.41 35.55 58.91 37.89Q58.34 40.61 56.48 42.57Q54.62 44.54 51.69 45.62Q48.76 46.71 44.96 46.71Z",
    box: [0, 17.4, 64, 29.8] as const,
  },
} as const;

/** Product name as shown to people (titles, aria labels). Internal keys keep their old «ws_lexx» prefix. */
export const BRAND_NAME = "WS_Desk";

/**
 * The WS mark. Square by default (`size` = the square's side, mark centred on the 64 grid: avatars, tiles);
 * `tight` crops to the letters (`size` = height, width follows the ~2:1 mark) for lockups and headers.
 * Renders whose letters would be under ~14 px tall use the small optical cut.
 */
export function WsMark({ size = 40, className, title, tight }: { size?: number; className?: string; title?: string; tight?: boolean }) {
  const capPx = tight ? size * 0.94 : size * (28 / 64);
  const cut = capPx < 14.5 ? CUTS.small : CUTS.regular;
  const [x, y, w, h] = cut.box;
  return (
    <svg
      width={tight ? Math.round((size * w) / h) : size}
      height={size}
      viewBox={tight ? `${x} ${y} ${w} ${h}` : "0 0 64 64"}
      fill="currentColor"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={cut.w} />
      <path d={cut.s} />
    </svg>
  );
}

/**
 * «WS_Desk»: the mark is the «WS» (dominant, ~1.3x the text's cap height), «_Desk» follows in the text face, regular
 * weight and muted, so the name reads in one go but the tag stays secondary. Sized by the font size of `className`.
 * `deskClassName` lets a narrow header drop the tag and keep the mark.
 */
export function Wordmark({ className, deskClassName }: { className?: string; deskClassName?: string }) {
  return (
    // items-baseline: an <svg> has no text baseline, so its bottom edge sits on the text baseline; the mark's own baseline
    // is 0.02em above that edge (the S overshoot), which is where a round letter belongs.
    <span className={cn("inline-flex items-baseline whitespace-nowrap leading-none", className)}>
      <svg
        viewBox={`${CUTS.regular.box.join(" ")}`}
        height="1em"
        width={`${(CUTS.regular.box[2] / CUTS.regular.box[3]).toFixed(3)}em`}
        fill="currentColor"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d={CUTS.regular.w} />
        <path d={CUTS.regular.s} />
      </svg>
      <span className="sr-only">WS</span>
      <span className={cn("ml-[0.06em] font-normal tracking-[0.01em] text-muted-foreground", deskClassName)}>_Desk</span>
    </span>
  );
}
