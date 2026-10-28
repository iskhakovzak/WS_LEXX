/**
 * «A strategy is three lines: catalyst → setup → trade» — the web side of api lib/catalyst/* and lib/strategyFormula.
 * Types of GET /api/catalysts/day|edge, the strategy formula of a playbook setup, the day-two lines, and the pure
 * helpers (prefill of the catalyst direction, formula completeness). No React here.
 */
export const DIRECTIONS = ["bull", "bear"] as const;
export const STRENGTHS = ["weak", "strong"] as const;
export const KINDS = ["earnings", "news", "fda", "offering", "corporate", "macro", "other"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Strength = (typeof STRENGTHS)[number];
export type Kind = (typeof KINDS)[number];
export type MarkSource = "plan" | "watchlist";

export type CatalystMark = {
  trader: string; day: string; ticker: string; direction: Direction | null; strength: Strength | null; kind: Kind | null;
  source: MarkSource; suggested: boolean;
};
export type CatalystHint = { ticker: string; direction: Direction | null; kind: Kind | null; source: "event" | "earnings" | "gap"; movePct: number | null };
export type CatalystDay = { trader: string; date: string; marks: CatalystMark[]; hints: CatalystHint[] };

/** The $ block of the shared math (api lib/playbookEdge computeUsdStats; $ fields null when hidden). */
export type UsdBlock = {
  n: number; wins: number; losses: number; winrate: number | null; net: number | null; expectancy: number | null;
  avgWin: number | null; avgLoss: number | null; payoff: number | null; profitFactor: number | null; best: number | null; worst: number | null;
};
export type BucketKey =
  | "strong_bull" | "strong_bear" | "weak_bull" | "weak_bear" | "strong_unset" | "weak_unset" | "unset_bull" | "unset_bear" | "none";
export type CellKey = Strength | "unset" | "none";
export type CatalystEdge = {
  trader: string; from: string; to: string; total: number; marked: number;
  buckets: (UsdBlock & { key: BucketKey })[];
  bySetup: { setupId: number; setupName: string; n: number; cells: (UsdBlock & { strength: CellKey })[] }[];
  insight: { setupId: number; setupName: string; strength: CellKey; n: number; net: number } | null;
};

export type StrategyFormula = {
  catalyst: { kind: Kind | null; strength: Strength | null; direction: Direction | null };
  setup: string | null;
  trade: string | null;
};
export const emptyFormula = (): StrategyFormula => ({ catalyst: { kind: null, strength: null, direction: null }, setup: null, trade: null });

/** All three lines filled — the lesson's «done» (same rule as api lib/strategyFormula isCompleteFormula). */
export function isCompleteFormula(f: StrategyFormula | null | undefined): boolean {
  if (!f) return false;
  const c = f.catalyst ?? emptyFormula().catalyst;
  return !!(c.kind || c.strength || c.direction) && !!f.setup?.trim() && !!f.trade?.trim();
}

export function isEmptyFormula(f: StrategyFormula | null | undefined): boolean {
  if (!f) return true;
  const c = f.catalyst ?? emptyFormula().catalyst;
  return !c.kind && !c.strength && !c.direction && !f.setup?.trim() && !f.trade?.trim();
}

export type DayTwoHint = {
  ticker: string; direction: Direction; source: "mark" | "event" | "earnings"; kind: Kind | null; movePct: number;
  setupId: number | null; setupName: string | null;
};

/** Where a suggested direction comes from: the plan's own ticker direction first, then the day's event / earnings / gap. */
export type Suggestion = { direction: Direction; source: "plan" | "event" | "earnings" | "gap"; kind: Kind | null; movePct: number | null };

/**
 * The direction to prefill when the ticker has no mark yet (the trader only confirms). `planBias` is the ticker's
 * direction in the plan (bull / bear / neutral); `gapPct` is the live gap a screen already has (watchlist quote).
 */
export function suggestDirection(x: { planBias?: string | null; hint?: CatalystHint | null; gapPct?: number | null }): Suggestion | null {
  if (x.planBias === "bull" || x.planBias === "bear") return { direction: x.planBias, source: "plan", kind: x.hint?.kind ?? null, movePct: null };
  if (x.hint?.direction) return { direction: x.hint.direction, source: x.hint.source, kind: x.hint.kind, movePct: x.hint.movePct };
  if (x.gapPct != null && Number.isFinite(x.gapPct) && Math.abs(x.gapPct) >= GAP_HINT_PCT) {
    return { direction: x.gapPct > 0 ? "bull" : "bear", source: "gap", kind: x.hint?.kind ?? null, movePct: x.gapPct };
  }
  return null;
}

/** Same threshold as the api (lib/catalyst/model GAP_HINT_PCT). */
export const GAP_HINT_PCT = 2;

/** The next state of the two taps after one tap: the same value again clears it. A pending suggestion is confirmed. */
export function tapMark(
  cur: Pick<CatalystMark, "direction" | "strength"> | null,
  tap: { direction: Direction } | { strength: Strength },
  suggestion: Suggestion | null,
): { direction: Direction | null; strength: Strength | null; suggested: boolean } {
  const direction0 = cur?.direction ?? null;
  const strength0 = cur?.strength ?? null;
  if ("direction" in tap) {
    const direction = direction0 === tap.direction ? null : tap.direction;
    return { direction, strength: strength0, suggested: !direction0 && !!suggestion && suggestion.direction === direction };
  }
  const strength = strength0 === tap.strength ? null : tap.strength;
  // Tapping the strength while the direction is only a suggestion (no mark yet) takes the suggestion too: one tap
  // instead of two. A direction the trader cleared on purpose stays cleared.
  const direction = direction0 ?? (cur == null ? suggestion?.direction ?? null : null);
  return { direction, strength, suggested: !direction0 && !!suggestion && direction === suggestion.direction };
}
