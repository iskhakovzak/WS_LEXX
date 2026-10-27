/**
 * «Олимп» backgrounds of the image cards = public-domain classical artworks (public/share-art, 1080×1350 WebP crops;
 * full credits and licences in public/share-art/CREDITS.txt). The rest are drawn in canvas (backdrop.ts).
 *
 * `credit` is the small line printed on the card itself (artist, title, year): artists' names and titles are not
 * translated.
 */
import { BASE } from "@/lib/api";

export type Artwork = { id: string; credit: string };

export const OLYMP_ART: readonly Artwork[] = [
  { id: "atlas-globe", credit: "Atlas on the globe · Danckerts atlas title page, c. 1680" },
  { id: "zeus-ingres", credit: "J.-A.-D. Ingres · Jupiter and Thetis, 1811" },
  { id: "farnese-hercules", credit: "Hendrick Goltzius · The Farnese Hercules, c. 1592" },
  { id: "athena-stuck", credit: "Franz von Stuck · Pallas Athene, 1898" },
  { id: "apollo-coypel", credit: "Noël Coypel · Apollo Crowned by Victory, 1688" },
  { id: "phaeton-rubens", credit: "Peter Paul Rubens · The Fall of Phaeton, c. 1605" },
  { id: "hercules-zurbaran", credit: "Francisco de Zurbarán · Hercules and the Nemean Lion, 1634" },
  { id: "hermes-goltzius", credit: "Hendrick Goltzius · Mercury, 1611" },
  { id: "atlas-hercules", credit: "Caspar Luyken · Atlas and Hercules carry the heavens, 1710" },
];

export function artOf(id: string | null | undefined): Artwork {
  return OLYMP_ART.find((a) => a.id === id) ?? OLYMP_ART[0]!;
}

/** Next / previous artwork (wraps around). */
export function stepArt(id: string, delta: number): Artwork {
  const i = Math.max(0, OLYMP_ART.findIndex((a) => a.id === id));
  const n = OLYMP_ART.length;
  return OLYMP_ART[(((i + delta) % n) + n) % n]!;
}

export const artUrl = (id: string) => `${BASE}/share-art/${id}.webp`;
export const artThumbUrl = (id: string) => `${BASE}/share-art/thumb/${id}.webp`;

export type LoadedImage = { image: CanvasImageSource; w: number; h: number };

const artCache = new Map<string, Promise<LoadedImage | null>>();

/** A «Олимп» artwork as a decoded image (cached for the session; null when it fails to load). */
export function loadArt(id: string): Promise<LoadedImage | null> {
  const hit = artCache.get(id);
  if (hit) return hit;
  const p = new Promise<LoadedImage | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ image: img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => { artCache.delete(id); resolve(null); };
    img.src = artUrl(id);
  });
  artCache.set(id, p);
  return p;
}
