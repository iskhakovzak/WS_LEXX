/**
 * Desk market regimes (api lib/marketRegime/regimes.ts mirrors these keys). Stored and sent as keys; the names, the
 * one-line playbook hints and the descriptions are in i18n (ns marketRegime). Pure.
 */
export const REGIME_KEYS = ["theme_bull", "macro", "range", "panic", "idiosyncratic", "euphoria"] as const;
export type RegimeKey = (typeof REGIME_KEYS)[number];

export const isRegimeKey = (v: unknown): v is RegimeKey => typeof v === "string" && (REGIME_KEYS as readonly string[]).includes(v);

/** Base daily loss limit × multiplier (cents); null without a base. Same rule as the API (suggestedLimit). */
export function suggestedLimit(base: number | null | undefined, multiplier: number): number | null {
  if (base == null || !Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * multiplier * 100) / 100;
}
