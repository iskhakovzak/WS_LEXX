/**
 * Links from /analytics to the pages that own a block it no longer copies (design audit, wave 2B), carrying the same
 * slice: the period (a preset, or «Свой период» from / to), the person (staff: the picked one, or the whole team) and,
 * where the other page has it, the horizon.
 */
import { encodeRules, type Rule } from "@/components/shared/what-if-rules";
import { customRangeOf, type AnalyticsFilters } from "./metrics";

type Scope = { trader: string | null; team: boolean };

function periodParams(sp: URLSearchParams, f: AnalyticsFilters, key: string, map7d?: string): void {
  const custom = f.period === "custom" ? customRangeOf(f) : null;
  if (custom) {
    sp.set(key, "custom");
    sp.set("from", custom.from);
    sp.set("to", custom.to);
    return;
  }
  const p = f.period === "custom" ? "90d" : f.period === "7d" && map7d ? map7d : f.period;
  sp.set(key, p);
}

/** /stats — «отчёт за период»: total, curve, calendar, broker block. */
export function statsHref(f: AnalyticsFilters, scope: Scope): string {
  const sp = new URLSearchParams();
  periodParams(sp, f, "period");
  if (scope.team) sp.set("trader", "all");
  else if (scope.trader) sp.set("trader", scope.trader);
  if (f.horizon) sp.set("horizon", f.horizon);
  return `/stats?${sp.toString()}`;
}

/** /behavior — habits with their $ cost, the trader profile (no 7-day window there: 30 days). */
export function behaviorHref(f: AnalyticsFilters, scope: Scope): string {
  const sp = new URLSearchParams();
  periodParams(sp, f, "period", "30d");
  if (!scope.team && scope.trader) sp.set("trader", scope.trader);
  return `/behavior?${sp.toString()}`;
}

/** /what-if with the same trader and period (7 days has no twin there → 30 days) and optional rules. */
export function whatIfHref(filters: AnalyticsFilters, rules: Rule[] = [], hash = ""): string {
  const sp = new URLSearchParams();
  const r = encodeRules(rules);
  if (r) sp.set("r", r);
  const p = filters.period === "7d" ? "30d" : filters.period;
  if (p !== "all") sp.set("p", p);
  const custom = p === "custom" ? customRangeOf(filters) : null;
  if (custom) { sp.set("from", custom.from); sp.set("to", custom.to); }
  // No trader picked here = the whole scope; /what-if reads "__all__" as «Вся команда» (ignored for traders).
  sp.set("trader", filters.trader || "__all__");
  const q = sp.toString();
  return `/what-if${q ? `?${q}` : ""}${hash}`;
}
