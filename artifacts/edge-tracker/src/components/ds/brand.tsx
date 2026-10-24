/**
 * WS_Desk brand: the WS mark and the «WS_Desk» lockup (owner, 2026-10-24: direction 01 «One line», see
 * demo-video-work/redesign-options/logos.html, MARKS.line; final files in demo-video-work/logo-final).
 *
 * The mark is the name written in one continuous line, like a trader's signature on a trade: the W's fourth stroke
 * turns into the S. One monoline path with round caps and joins on a 64 grid, single colour (`currentColor`), so it
 * follows the theme and renders identically everywhere. Two cuts of the same line: «regular», and a heavier «small»
 * for tiny renders (favicon, small avatars). The same path is in public/favicon.svg and rasterised into the
 * ICO / PNG / apple-touch / PWA icons.
 */
import { cn } from "@/lib/utils";

/** The one line: W (four strokes) whose last stroke runs on into the S. 64 x 64 grid, W baseline y 46. */
const LINE = "M6.5 17L15.5 46L24.5 23.5L33.5 46C38 50.5 56 50 56.5 40.5C57 31.5 40.5 34 40.5 25.5C40.5 16.5 54.5 15.5 57.5 21";

/** Stroke width and ink box ([x, y, w, h] of the stroked line, caps included) per cut. */
const CUTS = {
  regular: { sw: 5.2, box: [3.9, 14.4, 56.2, 36.95] },
  small: { sw: 7, box: [3, 13.5, 58, 38.75] },
} as const;

/** Renders whose 64 grid would be under ~26 px use the small cut (the board's threshold). */
const SMALL_BELOW = 26;

/**
 * «_Desk» in Geist Regular (OFL, the face the lockup was designed in), converted to outlines on the mark's grid: 1 em =
 * 41.74 units (the board's mark at 46 px next to a 30 px tag), letter-spacing -0.02em, baseline on the W's (y 46), the
 * tag 0.05em after the 64 grid. Outlines, so the lockup never depends on a font load or on the user's Appearance font.
 */
const TAG =
  "M67.92 49.26V46H87.5V49.26ZM92.34 46V16.37H101.52Q108.37 16.37 112.06 20.23Q115.76 24.09 115.76 31.22Q115.76 38.32 112.13 42.16Q108.49 46 101.77 46ZM95.93 42.49H101.52Q106.74 42.49 109.37 39.68Q112 36.86 112 31.22Q112 25.51 109.37 22.69Q106.74 19.87 101.52 19.87H95.93ZM129.2 46.5Q126.07 46.5 123.79 45.08Q121.52 43.66 120.29 41.05Q119.05 38.45 119.05 34.94Q119.05 31.43 120.29 28.85Q121.52 26.26 123.75 24.82Q125.98 23.38 129.03 23.38Q131.91 23.38 134.12 24.73Q136.33 26.09 137.57 28.68Q138.8 31.27 138.8 34.98V36.02H122.73Q122.94 39.57 124.63 41.37Q126.32 43.16 129.2 43.16Q131.37 43.16 132.77 42.14Q134.16 41.12 134.71 39.45L138.46 39.74Q137.59 42.7 135.14 44.6Q132.7 46.5 129.2 46.5ZM122.73 32.94H134.96Q134.71 29.72 133.1 28.22Q131.49 26.72 129.03 26.72Q126.48 26.72 124.83 28.28Q123.19 29.85 122.73 32.94ZM150.78 46.5Q147.73 46.5 145.66 45.54Q143.6 44.58 142.49 42.89Q141.38 41.2 141.22 39.03L144.89 38.78Q145.22 40.78 146.54 41.97Q147.85 43.16 150.78 43.16Q153.03 43.16 154.26 42.43Q155.49 41.7 155.49 40.07Q155.49 39.2 155.1 38.61Q154.7 38.03 153.53 37.59Q152.36 37.15 150.11 36.73Q147.02 36.15 145.27 35.27Q143.51 34.4 142.8 33.14Q142.09 31.89 142.09 30.14Q142.09 27.18 144.29 25.28Q146.48 23.38 150.48 23.38Q153.41 23.38 155.26 24.4Q157.12 25.42 158.08 27.05Q159.04 28.68 159.25 30.47L155.58 30.72Q155.49 29.68 154.95 28.76Q154.41 27.84 153.32 27.28Q152.24 26.72 150.4 26.72Q148.02 26.72 146.89 27.63Q145.77 28.55 145.77 29.97Q145.77 31.06 146.21 31.75Q146.64 32.43 147.75 32.87Q148.86 33.31 150.78 33.65Q154.03 34.19 155.87 35.02Q157.7 35.86 158.43 37.09Q159.17 38.32 159.17 40.07Q159.17 43.12 156.81 44.81Q154.45 46.5 150.78 46.5ZM163.17 46V16.37H166.68V35.77L177.45 23.88H182.12L173.4 33.27L182.5 46H178.24L171.02 35.65L166.68 40.24V46Z";
/** 1 em of the lockup's text size, in grid units. */
const EM = 41.74;
/** Right edge of the tag's ink. */
const TAG_RIGHT = 182.5;

/** Product name as shown to people (titles, aria labels). Internal keys keep their old «ws_lexx» prefix. */
export const BRAND_NAME = "WS_Desk";

function Line({ cut }: { cut: keyof typeof CUTS }) {
  return (
    <path
      d={LINE}
      fill="none"
      stroke="currentColor"
      strokeWidth={CUTS[cut].sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * The WS mark. Square by default (`size` = the square's side, mark centred on the 64 grid: avatars, tiles);
 * `tight` crops to the ink (`size` = height, width follows the ~3:2 mark) for lockups and headers.
 * Renders whose 64 grid would be under ~26 px use the heavier small cut.
 */
export function WsMark({ size = 40, className, title, tight }: { size?: number; className?: string; title?: string; tight?: boolean }) {
  const gridPx = tight ? (size * 64) / CUTS.regular.box[3] : size;
  const cut = gridPx < SMALL_BELOW ? "small" : "regular";
  const [x, y, w, h] = CUTS[cut].box;
  return (
    <svg
      width={tight ? Math.round((size * w) / h) : size}
      height={size}
      viewBox={tight ? `${x} ${y} ${w} ${h}` : "0 0 64 64"}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Line cut={cut} />
    </svg>
  );
}

/**
 * «WS_Desk»: the mark carries «WS», «_Desk» follows lighter and muted (Geist Regular outlines, `text-muted-foreground`),
 * so the name reads in one go and the tag stays secondary. Sized by the font size of `className` (1em = the tag's
 * size). `deskClassName` lets a narrow header drop the tag and keep the mark. Both parts share one vertical frame, so
 * they line up without baseline tricks.
 */
export function Wordmark({ className, deskClassName }: { className?: string; deskClassName?: string }) {
  const [x, y, w, h] = CUTS.regular.box;
  const em = (v: number) => `${(v / EM).toFixed(3)}em`;
  const tagW = TAG_RIGHT - (x + w);
  return (
    <span className={cn("inline-flex items-start whitespace-nowrap leading-none", className)}>
      <span className="sr-only">{BRAND_NAME}</span>
      <svg viewBox={`${x} ${y} ${w} ${h}`} width={em(w)} height={em(h)} aria-hidden="true" className="shrink-0">
        <Line cut="regular" />
      </svg>
      <svg
        viewBox={`${x + w} ${y} ${tagW} ${h}`}
        width={em(tagW)}
        height={em(h)}
        aria-hidden="true"
        className={cn("shrink-0 text-muted-foreground", deskClassName)}
      >
        <path d={TAG} fill="currentColor" />
      </svg>
    </span>
  );
}
