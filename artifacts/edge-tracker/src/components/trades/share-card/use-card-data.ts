/**
 * Data of the share card: the price line (shared useCardSeries — the same bars and fills the trade chart already
 * fetched) and the background images (shared «Олимп» loader, the user's own photo decoded here).
 */
import type { LoadedImage } from "@/components/shared/share-canvas/art";

export { useCardSeries, type CardSeriesState } from "@/components/chart-engine/hooks/useCardSeries";
export { loadArt, type LoadedImage } from "@/components/shared/share-canvas/art";

/** The user's own photo, decoded in the browser (never uploaded). EXIF rotation is applied where supported. */
export async function loadPhoto(file: File): Promise<LoadedImage | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bmp, w: bmp.width, h: bmp.height };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // Draw once into a canvas so the object URL can go right away.
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      return { image: c, w: c.width, h: c.height };
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
