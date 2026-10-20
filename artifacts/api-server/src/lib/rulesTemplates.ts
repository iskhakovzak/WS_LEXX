/**
 * Rules by ladder level out of the box (Волна 2, item 2.6).
 *
 * A desk-wide rule (trading_rules.trader = '*') may carry a ladder stage (trading_rules.stage = junior | trader | senior):
 * it then applies only to traders on that stage — resolved by the one stage source lib/people/stage.ts (a trader without
 * an assigned stage is a Джун). Migration 0235 seeds the office set per stage (STAGE_RULE_TEMPLATES below, one row per
 * `template_key`); curators edit, disable or delete them in /rules like any desk rule.
 *
 *  - When does a stage rule start counting? From max(the rule's creation day, the day the trader got that stage) — a
 *    promotion never floods the queue with the trader's past under the new rules (same idea as rulesEngine ruleSince).
 *  - On a stage change (lib/academy/stage-actions.ts setStage → onStageAssigned) the cached stage is dropped and the
 *    trader's rules are re-scanned in the background, so the new set is live at once.
 *  - The seeded rows keep their Russian name in the table; while a curator has not renamed one, the API shows the
 *    name in the reader's language (shownRuleName).
 */
import { loadStageInfo } from "./people/stage";
import { STAGE_KEYS, isStageKey, type StageKey } from "./promotionEngine";
import { rulesT } from "./rulesI18n";
import { logger } from "./logger";
import type { Lang } from "../i18n";

export type StageRuleTemplate = { key: string; stage: StageKey; kind: string; threshold: Record<string, number> };

/** The seeded set (migration 0235 — keep in sync; a test compares them). Empty threshold = the trader's risk limit. */
export const STAGE_RULE_TEMPLATES: readonly StageRuleTemplate[] = [
  { key: "junior.daily_stop", stage: "junior", kind: "max_daily_loss_usd", threshold: {} },
  { key: "junior.max_trades", stage: "junior", kind: "max_trades_per_day", threshold: { n: 8 } },
  { key: "junior.no_size_up", stage: "junior", kind: "no_size_up_after_loss", threshold: { factor: 1.3 } },
  { key: "junior.stop_after_losses", stage: "junior", kind: "no_trade_after_n_losses", threshold: { n: 2 } },
  { key: "junior.no_overnight", stage: "junior", kind: "no_overnight", threshold: {} },
  { key: "trader.daily_stop", stage: "trader", kind: "max_daily_loss_usd", threshold: {} },
  { key: "trader.max_trades", stage: "trader", kind: "max_trades_per_day", threshold: { n: 15 } },
  { key: "trader.no_size_up", stage: "trader", kind: "no_size_up_after_loss", threshold: { factor: 1.5 } },
  { key: "trader.stop_after_losses", stage: "trader", kind: "no_trade_after_n_losses", threshold: { n: 3 } },
];

/** A stored stage tag: a known ladder stage or null (= every trader). */
export function ruleStageOf(v: unknown): StageKey | null {
  return isStageKey(v) ? v : null;
}

/** A request's rule stage: undefined = not given, null = every trader, a stage, or "invalid". */
export function parseRuleStage(v: unknown): StageKey | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "" || v === "all") return null;
  return isStageKey(v) ? v : "invalid";
}

export { STAGE_KEYS };

/** Does a desk rule tagged `ruleStage` apply to a trader on `stage`? Untagged rules apply to everyone. */
export function stageRuleApplies(ruleStage: unknown, stage: StageKey | null): boolean {
  const s = ruleStageOf(ruleStage);
  return s == null || s === stage;
}

/** First NY day the rule counts for this trader: the later of its own start and (stage rules only) the stage's start. */
export function ruleStartFor(ruleSinceDay: string | null, ruleStage: unknown, stageSince: string | null): string | null {
  if (!ruleStageOf(ruleStage) || !stageSince) return ruleSinceDay;
  const s = stageSince.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ruleSinceDay;
  return !ruleSinceDay || s > ruleSinceDay ? s : ruleSinceDay;
}

/** Seeded name in the reader's language while the stored one is still the seeded Russian text; else the stored name. */
export function shownRuleName(name: string, templateKey: string | null | undefined, lang: Lang | null | undefined): string {
  if (!templateKey) return name;
  const key = `stageTemplates.${templateKey}`;
  if (rulesT.tryFor("ru", key) !== name) return name;
  return rulesT.tryFor(lang, key) ?? name;
}

// ─── The trader's stage (cached; dropped on a stage change) ────────────────────────────────────────────────────────

export type TraderStage = { stage: StageKey | null; since: string | null };
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; v: TraderStage }>();

export async function traderStage(trader: string): Promise<TraderStage> {
  const hit = cache.get(trader);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  let v: TraderStage = { stage: null, since: null };
  try {
    const info = (await loadStageInfo([trader])).get(trader);
    v = { stage: info?.stage ?? null, since: info?.since ?? null };
  } catch (err) {
    logger.warn({ err, trader }, "rules: stage lookup failed");
  }
  cache.set(trader, { at: Date.now(), v });
  if (cache.size > 500) for (const [k, e] of cache) if (Date.now() - e.at > TTL_MS) cache.delete(k);
  return v;
}

export function forgetTraderStage(trader: string): void {
  cache.delete(trader);
}

/**
 * Stage change hook (lib/academy/stage-actions.ts setStage, after COMMIT): the rules of the new stage are live at once —
 * the cached stage is dropped and the trader is re-scanned in the background (from the stage day on, see ruleStartFor).
 */
export function onStageAssigned(user: string, _stage: StageKey): void {
  forgetTraderStage(user);
  void import("./rulesEngine")
    .then(({ scanRulesForTrader }) => scanRulesForTrader(user))
    .catch((err) => logger.warn({ err, user }, "rules: re-scan after a stage change failed"));
}
