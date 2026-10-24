/**
 * Data of the share card: the price line (the same bars and fills the trade chart already fetched — useChartData with
 * the chart's own window, so an opened chart makes the card instant) and the background images.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { useChartData } from "@/components/chart-engine/hooks/useChartData";
import { isoToEpoch } from "@/components/chart-engine/lib/time";
import { cardSeries, fallbackSeries, type CardSeries } from "./model";
import { artUrl } from "./themes";

export type CardSeriesState = { series: CardSeries | null; loading: boolean };

export function useCardSeries(trade: Trade, entry: number | null, exit: number | null): CardSeriesState {
  const data = useChartData(trade);
  const series = React.useMemo(() => {
    const opening = data.executions.filter((e) => (e.kind === "entry" || e.kind === "add") && e.executedAt);
    const closing = data.executions.filter((e) => e.kind !== "entry" && e.kind !== "add" && e.executedAt);
    const entryTime = opening.length ? isoToEpoch(opening[0]!.executedAt) : null;
    const exitTime = closing.length ? isoToEpoch(closing[closing.length - 1]!.executedAt) : null;
    const fromBars = cardSeries(data.bars, Number.isFinite(entryTime) ? entryTime : null, Number.isFinite(exitTime) ? exitTime : null, entry, exit);
    return fromBars ?? fallbackSeries(entry, exit);
  }, [data.bars, data.executions, entry, exit]);
  return { series: data.loading ? null : series, loading: data.loading };
}

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
