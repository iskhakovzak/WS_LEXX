/**
 * What a suggestion card shows besides its numbers (suggestions-panel.tsx) — pure, testable without a DOM:
 *  - at most two pills: the tier («устойчиво» / «слабый сигнал», or «мало данных — ориентир» for a small sample) and
 *    one qualifier by priority: checked on the same data → depends on the trader's own marks → per trader (team scope,
 *    day rule);
 *  - the first 5 cards, the rest behind «Ещё N» (UX law: few choices up front);
 *  - the removal line: trades removed, or trades scaled down (an estimate).
 */
import type { RuleType } from "./rules";
import type { Suggestion } from "./api";

export const VISIBLE_CARDS = 5;

/** Day rules run per trader-day: in team scope their cards say so. */
const DAY_RULES: ReadonlySet<RuleType> = new Set<RuleType>(["dailyLossLimit", "maxTradesPerDay", "stopAfterLosses", "afterLoss", "profitGiveback", "dailyProfitTarget"]);

export type BadgeId = "smallSample" | "robust" | "weak" | "sameData" | "label" | "perTrader";

export function suggestionBadges(s: Suggestion, ctx: { smallSample: boolean; team: boolean }): BadgeId[] {
  const tier: BadgeId = ctx.smallSample ? "smallSample" : s.robust === false ? "weak" : "robust";
  const qualifier: BadgeId | null = s.sameData ? "sameData" : s.kind === "label" ? "label" : ctx.team && DAY_RULES.has(s.rule.type) ? "perTrader" : null;
  return qualifier ? [tier, qualifier] : [tier];
}

/**
 * What the robust tooltip may say about the last third of the period (TEST days, sent for every card from 30 days):
 * «выбрано по первым двум третям и дало плюс на последней» only for a card picked by its own past result (worst tickers /
 * setups / tags — picked on the first two thirds); any other card was chosen on the whole period, so it only says the
 * last third was in the plus too.
 */
export function holdoutNote(s: Pick<Suggestion, "picked" | "holdout">): { key: "holdoutHint" | "holdoutTailHint"; days: number } | null {
  if (!s.holdout || !(s.holdout.delta > 0)) return null;
  return { key: s.picked ? "holdoutHint" : "holdoutTailHint", days: s.holdout.days };
}

/** The cards on screen and how many wait behind «Ещё N» (0 when expanded or when all fit). */
export function visibleCards<T>(list: T[], expanded: boolean, max = VISIBLE_CARDS): { shown: T[]; hidden: number } {
  if (expanded || list.length <= max) return { shown: list, hidden: 0 };
  return { shown: list.slice(0, max), hidden: list.length - max };
}

/** «убирает N сделок» when the rule removes trades, «уменьшает N сделок (оценка)» when it scales them. */
export function removalLine(s: Suggestion): { kind: "removes" | "changes"; count: number } {
  if (s.excluded > 0 || !s.changed) return { kind: "removes", count: s.excluded };
  return { kind: "changes", count: s.changed };
}
