/**
 * Links from /analytics to the pages that own a block it no longer copies (design audit, wave 2B), carrying the same
 * slice in the analytics group's scope params (hooks/use-analytics-scope): `period` (the vocabulary, or «custom» with
 * from / to), `trader` (staff: the picked person, `all` = «Вся команда») and, where the other page has it, the horizon.
 * The pages also share the scope through storage; the link makes it exact for a copied URL.
 */
import { encodeRules, type Rule } from "@/components/shared/what-if-rules";
import { TEAM_PARAM } from "@/hooks/use-analytics-scope";
import { customRangeOf, type AnalyticsFilters } from "./metrics";

type Scope = { trader: string | null; team: boolean };

function periodParams(sp: URLSearchParams, f: AnalyticsFilters): void {
  const custom = f.period === "custom" ? customRangeOf(f) : null;
  if (f.period === "custom" && !custom) return; // no valid range: the target keeps its own scope
  sp.set("period", f.period);
  if (custom) {
    sp.set("from", custom.from);
    sp.set("to", custom.to);
  }
}

/** /stats — «отчёт за период»: total, curve, calendar, broker block. */
export function statsHref(f: AnalyticsFilters, scope: Scope): string {
  const sp = new URLSearchParams();
  periodParams(sp, f);
  if (scope.team) sp.set("trader", TEAM_PARAM);
  else if (scope.trader) sp.set("trader", scope.trader);
  if (f.horizon) sp.set("horizon", f.horizon);
  return `/stats?${sp.toString()}`;
}

/** /behavior — habits with their $ cost, the trader profile (one person: no team view there). */
export function behaviorHref(f: AnalyticsFilters, scope: Scope): string {
  const sp = new URLSearchParams();
  periodParams(sp, f);
  if (!scope.team && scope.trader) sp.set("trader", scope.trader);
  return `/behavior?${sp.toString()}`;
}

/** /what-if with the same trader and period and optional rules. */
export function whatIfHref(filters: AnalyticsFilters, rules: Rule[] = [], hash = ""): string {
  const sp = new URLSearchParams();
  const r = encodeRules(rules);
  if (r) sp.set("r", r);
  periodParams(sp, filters);
  // No trader here = the whole scope; /what-if reads `all` as «Вся команда» (ignored for traders).
  sp.set("trader", filters.trader || TEAM_PARAM);
  const q = sp.toString();
  return `/what-if${q ? `?${q}` : ""}${hash}`;
}
