/**
 * Screener presets (desk settings group «finviz») and the feature switch. Pure apart from reading settings/config.
 *
 *   gappers         gap ≥ 4 % (ta_gap_u4), sorted by gap desc
 *   relvol          relative volume ≥ 2 (sh_relvol_o2), sorted by rel volume desc
 *   earnings_today  reports today (earningsdate_today), sorted by market cap desc
 *
 * Filters are the admin's text (comma / space separated Finviz codes); anything that is not a plain code is dropped.
 */
import { setting } from "../settings/registry";
import { hasFinvizToken } from "./client";
import type { ScreenerPreset, ScreenerRow } from "./types";

type PresetDef = { setting: "finviz.gappersFilters" | "finviz.relvolFilters" | "finviz.earningsFilters"; order: string; sort: (r: ScreenerRow) => number | null };

export const PRESETS: Record<ScreenerPreset, PresetDef> = {
  gappers: { setting: "finviz.gappersFilters", order: "-gap", sort: (r) => r.gapPct },
  relvol: { setting: "finviz.relvolFilters", order: "-relativevolume", sort: (r) => r.relVolume },
  earnings_today: { setting: "finviz.earningsFilters", order: "-marketcap", sort: (r) => r.marketCap },
};

const CODE_RE = /^[a-z0-9_.\-]{2,60}$/;

/** "geo_usa, sh_price_o2  ta_gap_u4" → ["geo_usa", "sh_price_o2", "ta_gap_u4"] (lower-cased, unique, valid only). */
export function parseFilters(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const c = raw.trim().toLowerCase();
    if (CODE_RE.test(c) && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 30);
}

export function presetFilters(preset: ScreenerPreset): string[] {
  return parseFilters(setting(PRESETS[preset].setting));
}

/** Sort a run's rows the preset's way (desc, nulls last) and keep the first `max`. */
export function rankRows<T extends ScreenerRow>(preset: ScreenerPreset, rows: readonly T[], max: number): T[] {
  const key = PRESETS[preset].sort;
  return [...rows]
    .sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x == null && y == null) return a.ticker.localeCompare(b.ticker);
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, Math.max(0, max));
}

/** The feature is on: the token is set and the desk switch is on. */
export function finvizEnabled(): boolean {
  return hasFinvizToken() && setting("finviz.enabled");
}
