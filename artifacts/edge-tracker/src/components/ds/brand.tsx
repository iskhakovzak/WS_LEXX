/**
 * WS_LEXX brand: the WS monogram and the «WS_LEXX» wordmark (owner, 2026-10-24: monochrome, after the opening intro).
 *
 * The mark is a monoline W with an S woven through it: the S passes over the W at the upper crossing and under it at
 * the lower ones (each crossing is a knockout gap, so it reads as engraved on any background). Straight W + fluid S is
 * the same sans + italic-serif pairing as the intro's «Good morning, *Zakir*». It draws in `currentColor`, so it follows
 * the theme. ≤ 32 px uses a heavier optical cut (thicker strokes, tighter gaps) so the favicon / rail sizes stay legible.
 * The same geometry is drawn in public/favicon.svg and rasterised into the PNG / ICO icons and the PWA icons.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";

const WS_MARK_W = "M6 14L18.5 50L32 22L45.5 50L58 14";
const WS_MARK_S = "M45 15.5C41.5 8.5 23 8 22.5 19C22 29 41.5 29.5 41.5 41.5C41.5 54 22 55.5 18.5 47.5";

export function WsMark({ size = 40, className, title }: { size?: number; className?: string; title?: string }) {
  // useId gives «r1» / :r1: (not valid inside url(#…)): keep letters and digits only.
  const uid = `ws${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const small = size <= 32;
  const stroke = small ? 6.5 : 5;
  const gap = small ? 9 : 10.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={`${uid}t`}><rect width="64" height="31" /></clipPath>
        <clipPath id={`${uid}b`}><rect y="31" width="64" height="33" /></clipPath>
        {/* W is cut where the S passes over it (upper half); the S is cut where it passes under the W (lower half). */}
        <mask id={`${uid}w`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path clipPath={`url(#${uid}t)`} d={WS_MARK_S} stroke="#000" strokeWidth={gap} strokeLinecap="round" />
        </mask>
        <mask id={`${uid}s`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path clipPath={`url(#${uid}b)`} d={WS_MARK_W} stroke="#000" strokeWidth={gap} strokeMiterlimit={10} />
        </mask>
      </defs>
      <path mask={`url(#${uid}w)`} d={WS_MARK_W} stroke="currentColor" strokeWidth={stroke} strokeMiterlimit={10} />
      <path mask={`url(#${uid}s)`} d={WS_MARK_S} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

/** «WS_LEXX»: the monogram letters carry the weight, «_LEXX» steps back in a lighter cut with a little air. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-semibold leading-none tracking-[-0.02em]", className)}>
      WS<span className="font-normal tracking-[0.06em] text-muted-foreground">_LEXX</span>
    </span>
  );
}
