/**
 * Adapter for a future «rule trial» framework (a coach proposes a rule for N days and the trader tries it — work on the
 * coach-w0 / coach-w1 branches): «Мои правила в деле» (lib/whatIfMyRules) reads trials through this one seam, so when
 * the framework lands on main it only has to register a source — nothing in the what-if changes.
 *
 *   registerRuleTrialSource({ list: async (trader) => [...] })   // once, at startup, by the trial module
 *
 * A trial is mapped like a catalogue rule: `kind` + `threshold` in the rules-catalogue vocabulary (lib/rulesCatalog), its
 * start day as the adoption day. Without a registered source there are simply no trials.
 */
import type { AdoptedRule } from "./whatIfMyRules";

export interface RuleTrialRecord {
  id: string | number;
  name: string;
  /** rules-catalogue kind (max_trades_per_day, min_pause_after_loss, …). */
  kind: string;
  threshold: Record<string, unknown>;
  /** First trading day of the trial (YYYY-MM-DD, NY). */
  startedOn: string | null;
}

export interface RuleTrialSource {
  list(trader: string): Promise<RuleTrialRecord[]>;
}

let source: RuleTrialSource | null = null;

export function registerRuleTrialSource(s: RuleTrialSource | null): void {
  source = s;
}

/** Trials of a trader as adopted rules; [] without a source or when it fails (a broken adapter must not break the page). */
export async function trialRules(trader: string): Promise<AdoptedRule[]> {
  if (!source) return [];
  try {
    const list = await source.list(trader);
    return list.map((t) => ({ id: `trial:${t.id}`, name: t.name, kind: t.kind, threshold: t.threshold ?? {}, since: t.startedOn, source: "trial" as const }));
  } catch {
    return [];
  }
}
