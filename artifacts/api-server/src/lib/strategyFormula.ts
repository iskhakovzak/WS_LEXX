/**
 * The strategy formula of a playbook setup (SMB Capital: «a strategy is three lines — catalyst → setup → trade»).
 * Stored in playbook.formula (migration 0276) as a document, written through PATCH /playbook/:id { formula }:
 *
 *   catalyst  { kind, strength, direction }  the catalyst the setup needs: type (lib/catalyst/model KINDS), the required
 *                                            strength (weak / strong) and direction (bull / bear); null = any
 *   setup     the setup line in the author's words («Opening Drive above the premarket high»)
 *   trade     the specific entry («first 1-min pullback to the 9 EMA, stop under the low»)
 *
 * Pure. normFormula() is the one validator (write path and read path); an empty formula is stored as null.
 */
import { DIRECTIONS, KINDS, STRENGTHS, type Direction, type Kind, type Strength } from "./catalyst/codes";

export type FormulaCatalyst = { kind: Kind | null; strength: Strength | null; direction: Direction | null };
export type StrategyFormula = { catalyst: FormulaCatalyst; setup: string | null; trade: string | null };

export const FORMULA_LINE_MAX = 300;

const pick = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const line = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, FORMULA_LINE_MAX);
  return s ? s : null;
};

/** Any input → a clean formula, or null when nothing is filled in. */
export function normFormula(input: unknown): StrategyFormula | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const c = (o.catalyst && typeof o.catalyst === "object" ? o.catalyst : {}) as Record<string, unknown>;
  const f: StrategyFormula = {
    catalyst: { kind: pick(KINDS, c.kind), strength: pick(STRENGTHS, c.strength), direction: pick(DIRECTIONS, c.direction) },
    setup: line(o.setup),
    trade: line(o.trade),
  };
  return isEmptyFormula(f) ? null : f;
}

export function isEmptyFormula(f: StrategyFormula | null | undefined): boolean {
  if (!f) return true;
  return !f.catalyst.kind && !f.catalyst.strength && !f.catalyst.direction && !f.setup && !f.trade;
}

/** All three lines filled: a catalyst requirement (any of its parts), the setup and the trade — the lesson's «done». */
export function isCompleteFormula(f: StrategyFormula | null | undefined): boolean {
  if (!f) return false;
  return !!(f.catalyst.kind || f.catalyst.strength || f.catalyst.direction) && !!f.setup && !!f.trade;
}

/** The catalyst part asks for something a plan mark can confirm (strength or direction). */
export function hasCatalystRequirement(f: StrategyFormula | null | undefined): boolean {
  return !!f && (f.catalyst.strength != null || f.catalyst.direction != null);
}
