/**
 * IMX — close-auction (imbalance) trades, marked apart from the «идейные» trades but never removed (owner, 2026-10-21).
 *
 *   currentImxWindow()      the desk window (settings trades.imxWindowStart / trades.imxWindowEnd, default 15:50–16:00 NY)
 *   withImxTag(tags, imx)   the stored tags with the desk tag «IMX» added (an IMX trade) or taken off (not one any more)
 *
 * A trade is IMX when any of its fills is inside the window (lib/tradeStrategy isImxTrade) — stored as trades.is_imx
 * (migration 0243, lib/tradeStrategyStore), apart from the strategy: a pre-market entry closed in the close auction is
 * OPGtoDAY + IMX, a regular-session one MOC + IMX. Lists and numbers keep them by default; «Исключить IMX» (a per-user
 * switch) filters them out (lib/tradeFacetsSql, lib/imxSummary) with imxSql.
 */
import { setting } from "./settings/registry";
import { imxWindowOf, type ImxWindow } from "./tradeStrategy";

export const IMX_TAG = "IMX";

/** SQL: the trade (alias `a`) is IMX — the stored mark; a row the backfill has not reached yet falls back to strategy MOC. */
export function imxSql(a = "t"): string {
  return `COALESCE(${a}.is_imx, ${a}.strategy = 'MOC', false)`;
}

/** API / row: the same rule as imxSql for a loaded row. */
export function rowIsImx(r: { isImx?: boolean | null; strategy?: string | null }): boolean {
  return r.isImx ?? r.strategy === "MOC";
}

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
