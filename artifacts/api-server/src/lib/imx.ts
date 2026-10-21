/**
 * IMX — close-auction (imbalance) trades, marked apart from the «идейные» trades but never removed (owner, 2026-10-21).
 *
 *   currentImxWindow()      the desk window (settings trades.imxWindowStart / trades.imxWindowEnd, default 15:50–16:00 NY)
 *   withImxTag(tags, imx)   the stored tags with the desk tag «IMX» added (an IMX trade) or taken off (not one any more)
 *
 * A trade is IMX when its strategy (lib/tradeStrategy) is MOC: any fill inside the window. Lists and numbers keep
 * them by default; «Исключить IMX» (a per-user switch) filters `strategy = 'MOC'` out (lib/tradeFacetsSql).
 */
import { setting } from "./settings/registry";
import { imxWindowOf, type ImxWindow } from "./tradeStrategy";

export const IMX_TAG = "IMX";

export function currentImxWindow(): ImxWindow {
  return imxWindowOf(setting("trades.imxWindowStart"), setting("trades.imxWindowEnd"));
}

/** Split a stored tags string ("a, b") into trimmed, non-empty tags. */
export function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Tags with «IMX» present exactly when `imx` (case-insensitive match; other tags and their order are kept). null = none. */
export function withImxTag(tags: string | null | undefined, imx: boolean): string | null {
  const list = splitTags(tags);
  const has = list.some((t) => t.toUpperCase() === IMX_TAG);
  const next = imx ? (has ? list : [...list, IMX_TAG]) : list.filter((t) => t.toUpperCase() !== IMX_TAG);
  return next.length ? next.join(", ") : null;
}
