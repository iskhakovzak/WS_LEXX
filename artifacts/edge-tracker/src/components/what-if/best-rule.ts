/**
 * /what-if prefill (design audit wave 2B): a visit without a scenario in the link opens on the rule that would have
 * given the most — the best of the cards «Что ещё дало бы больше всего» — instead of «пока как было». Once per visit;
 * any own choice (a scenario in the link, a rule picked before the cards arrive) wins.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Suggestion } from "./api";
import type { Rule, RuleType } from "./rules";

/**
 * The suggestion with the biggest gain, the ones the data backs first (confirmed, then robust, then the rest — the
 * cards show their own status); never a rule this server cannot run; null when nothing would have helped.
 */
export function pickBestSuggestion(list: readonly Suggestion[], supported: ReadonlySet<RuleType>): Suggestion | null {
  const ok = list.filter((x) => x.improvement > 0 && supported.has(x.rule.type));
  if (!ok.length) return null;
  const rank = (x: Suggestion) => (x.status === "confirmed" ? 2 : x.robust !== false && x.status !== "hypothesis" ? 1 : 0);
  return [...ok].sort((a, b) => rank(b) - rank(a) || b.improvement - a.improvement)[0] ?? null;
}

/** Applies the best rule once; `isAuto` = the scenario is still exactly that rule (the «Выбрано по данным» mark). */
export function useBestRulePrefill(o: {
  linked: boolean; suggestions: readonly Suggestion[] | undefined; supported: ReadonlySet<RuleType>;
  rules: Rule[]; setRules: Dispatch<SetStateAction<Rule[]>>;
}): { isAuto: boolean } {
  const { linked, suggestions, supported, rules, setRules } = o;
  const done = useRef(linked);
  const [auto, setAuto] = useState<Rule | null>(null);
  useEffect(() => {
    if (done.current || !suggestions) return;
    done.current = true;
    const best = pickBestSuggestion(suggestions, supported);
    if (best) { setAuto(best.rule); setRules((rs) => (rs.length ? rs : [best.rule])); }
  }, [suggestions, supported, setRules]);
  return { isAuto: auto != null && rules.length === 1 && JSON.stringify(rules[0]) === JSON.stringify(auto) };
}
