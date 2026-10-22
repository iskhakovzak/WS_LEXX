/**
 * What a suggestion card shows besides its numbers (suggestions-panel.tsx) — pure, testable without a DOM:
 *  - at most two pills: the tier and one qualifier.
 *    Tier: the honest status once the server's check is ready («Подтверждено» / «Гипотеза»); «предварительно» for the
 *    fast cards shown while it runs (or when it is unavailable — then its tooltip says so, not «ещё считается»); team
 *    scope, a rolling / closed period («window») and older API builds keep «устойчиво» / «слабый сигнал» («мало
 *    данных — ориентир» on a small sample).
 *    Qualifier by priority: rests on a few days → checked on the same data → per trader (team scope, day rule);
 *  - the eyebrow «до входа» / «в сделке» / «разбор» (when the rule can be followed; not a pill);
 *  - the card line: the out-of-sample result when the server has one, else the in-sample range — on an honest-era card
 *    without it, a range of this same period with no probability attached (the rule was picked on these days);
 *  - a hypothesis: its next step next to «Применить» — how many more trading days would decide it; «проверка — на всём
 *    периоде» when this period cannot gather them; «разбери на отчёте дня» for a «разбор» card (more days can never
 *    confirm a rule built on marks set after the trade);
 *  - the first 5 cards, the rest behind «Ещё N» (UX law: few choices up front);
 *  - the removal line: trades removed, or trades scaled down (an estimate);
 *  - the section note under the title (computing, or taking longer / no confirmed rule yet / team / a period without the
 *    honest check / unavailable), always followed by «это история, а не обещание».
 */
import type { RuleType } from "./rules";
import { type HonestyState, type Suggestion, type SuggestionsResponse, type Timing, honestySlow } from "./api";

export const VISIBLE_CARDS = 5;

/** Day rules run per trader-day: in team scope their cards say so. */
const DAY_RULES: ReadonlySet<RuleType> = new Set<RuleType>(["dailyLossLimit", "maxTradesPerDay", "stopAfterLosses", "afterLoss", "profitGiveback", "dailyProfitTarget"]);

export type BadgeId = "confirmed" | "hypothesis" | "preliminary" | "smallSample" | "robust" | "weak" | "fragile" | "sameData" | "perTrader";

type BadgeCtx = { smallSample: boolean; team: boolean; honesty?: SuggestionsResponse["honesty"] };

function tierOf(s: Suggestion, ctx: BadgeCtx): BadgeId {
  const state = ctx.honesty?.state;
  if (state === "ready") return s.status === "confirmed" ? "confirmed" : "hypothesis";
  if (state === "queued" || state === "running" || state === "failed" || state === "unavailable") return "preliminary";
  return ctx.smallSample ? "smallSample" : s.robust === false ? "weak" : "robust";
}

/** Tooltip of «предварительно»: still computing, or the honest check is unavailable right now (failed / off). */
export function preliminaryHintKey(state: HonestyState | undefined): "preliminaryHint" | "preliminaryUnavailableHint" {
  return state === "failed" || state === "unavailable" ? "preliminaryUnavailableHint" : "preliminaryHint";
}

export function suggestionBadges(s: Suggestion, ctx: BadgeCtx): BadgeId[] {
  const tier = tierOf(s, ctx);
  const qualifier: BadgeId | null = s.fragile ? "fragile" : s.sameData ? "sameData" : ctx.team && DAY_RULES.has(s.rule.type) ? "perTrader" : null;
  return qualifier ? [tier, qualifier] : [tier];
}

/** When the rule can be followed; an older API sends no timing: a «label» card is «разбор», the rest «до входа». */
export function timingOf(s: Pick<Suggestion, "timing" | "kind">): Timing {
  return s.timing ?? (s.kind === "label" ? "review" : "exante");
}

/**
 * The number under the amount: the out-of-sample result (honest cards); else the per-rule range — «range» with its
 * 95% bootstrap reading on the fast / team / older cards, «rangeInSample» on an honest-era card (it carries a status)
 * without an out-of-sample result: a picked rule was chosen on these same days, so no probability is claimed (Ф6).
 */
export function cardLine(s: Pick<Suggestion, "oos" | "status">): "oos" | "range" | "rangeInSample" {
  if (s.oos) return "oos";
  return s.status ? "rangeInSample" : "range";
}

/** The next step of a hypothesis besides «Применить». */
export type NeedLine = { kind: "days"; days: number; atLeast: boolean } | { kind: "allTime" } | { kind: "review" };

/**
 * «нужно ещё ~N торговых дней» for an ex-ante hypothesis (the server's estimate; `atLeast` = a lower bound);
 * «проверка — на всём периоде» when this period cannot gather them; «разбери на отчёте дня» for a «разбор» card,
 * which no number of days can confirm. null = not a hypothesis.
 */
export function needLine(s: Pick<Suggestion, "status" | "needDays" | "needDaysAtLeast" | "needAllTime" | "timing" | "kind">): NeedLine | null {
  if (s.status !== "hypothesis") return null;
  if (timingOf(s) === "review") return { kind: "review" };
  if (s.needAllTime) return { kind: "allTime" };
  if (s.needDays == null) return null;
  return { kind: "days", days: s.needDays, atLeast: s.needDaysAtLeast === true };
}

export type SectionNote = "computing" | "slow" | "noConfirmed" | "team" | "window" | "facets" | "unavailable";

/** What the section says before «это история, а не обещание»; null = the plain hint (which already says it). */
export function sectionNote(data: SuggestionsResponse | undefined): SectionNote | null {
  const h = data?.honesty;
  if (!h) return null;
  switch (h.state) {
    case "queued":
    case "running":
      return honestySlow(data) ? "slow" : "computing";
    case "failed":
    case "unavailable":
      return "unavailable";
    case "team":
      return "team";
    case "window":
      return "window";
    case "facets":
      return "facets";
    case "ready":
      return h.confirmed === 0 && data.suggestions.length > 0 ? "noConfirmed" : null;
  }
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
