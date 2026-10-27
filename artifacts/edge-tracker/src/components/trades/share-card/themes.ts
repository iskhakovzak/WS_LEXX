/**
 * Backgrounds of the share card. «Олимп» artworks live in components/shared/share-canvas/art.ts (shared with the
 * «Итоги» story cards); the rest are drawn in canvas (shared backdrop.ts) or the user's own photo (read in the browser
 * only, never uploaded).
 */
export { OLYMP_ART, artOf, artThumbUrl, artUrl, stepArt } from "@/components/shared/share-canvas/art";
export type { Artwork } from "@/components/shared/share-canvas/art";
