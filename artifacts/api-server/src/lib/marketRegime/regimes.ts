/**
 * Market regime layer (Lance Breitstein, SMB Capital: a discretionary desk runs a different playbook and a different
 * amount of risk in each market regime). Pure: the regime keys, the limit multiplier per regime and how it applies to
 * a daily loss limit. Names and playbook hints live in the web i18n (ns marketRegime) — the DB stores keys only.
 *
 *   multiplier     settings regime.mult.<key> (admin, audited in settings history); 1 when no regime is set
 *   suggested      base daily loss limit × multiplier (rounded to cents) — shown on the risk screen and the trader's day
 *   effective      = suggested only while settings regime.applyLimits is on AND the day has a regime; else the base.
 *                  Stored limits never change, so switching applyLimits off restores them at once.
 */

export const REGIME_KEYS = ["theme_bull", "macro", "range", "panic", "idiosyncratic", "euphoria"] as const;
export type RegimeKey = (typeof REGIME_KEYS)[number];

export const isRegimeKey = (v: unknown): v is RegimeKey => typeof v === "string" && (REGIME_KEYS as readonly string[]).includes(v);

/** The setting that holds a regime's multiplier. */
export const multiplierSetting = (k: RegimeKey) => `regime.mult.${k}` as const;

/** Bounds of a multiplier (mirror the registry): a stored value outside them never reaches a limit. */
export const MULT_MIN = 0.1;
export const MULT_MAX = 2;

export type RegimeLimitAdj = {
  /** The desk regime of the day (null = not set yet). */
  regime: RegimeKey | null;
  /** Multiplier of that regime (1 without a regime). */
  multiplier: number;
  /** Settings regime.applyLimits: the multiplier changes the effective daily limit, not only the suggestion. */
  apply: boolean;
};

export const NO_ADJ: RegimeLimitAdj = { regime: null, multiplier: 1, apply: false };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Multiplier of a regime from a settings reader; 1 for no regime or a value that is not a finite number in bounds. */
export function multiplierOf(regime: RegimeKey | null, read: (k: RegimeKey) => unknown): number {
  if (!regime) return 1;
  const v = Number(read(regime));
  return Number.isFinite(v) && v >= MULT_MIN && v <= MULT_MAX ? v : 1;
}

/** Base daily loss limit × multiplier; null without a base limit. */
export function suggestedLimit(base: number | null | undefined, multiplier: number): number | null {
  if (base == null || !Number.isFinite(base) || base <= 0) return null;
  return round2(base * multiplier);
}

/** The daily loss limit the stops count against: the suggestion only when applying is on and a regime is set. */
export function effectiveDailyLimit(base: number | null | undefined, adj: RegimeLimitAdj): number | null {
  const b = base == null || !Number.isFinite(base) ? null : base;
  if (!adj.apply || !adj.regime) return b;
  return suggestedLimit(b, adj.multiplier) ?? b;
}

/** Limits with the effective daily loss limit (a copy; the input is never mutated; null stays null). */
export function withRegimeLimits<L extends { dailyLossLimit: number | null }>(limits: L | null, adj: RegimeLimitAdj): L | null {
  if (!limits || !adj.apply || !adj.regime) return limits;
  const daily = effectiveDailyLimit(limits.dailyLossLimit, adj);
  return daily === limits.dailyLossLimit ? limits : { ...limits, dailyLossLimit: daily };
}
