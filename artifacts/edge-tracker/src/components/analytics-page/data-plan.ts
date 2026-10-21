/**
 * Which data /analytics loads (staff = traders + extras, owner rule 2026-10-21). One person — the viewer's own book by
 * default, for staff too — is EXACTLY the trader experience: raw trades on every tab (OverviewTab with the equity
 * chart, edge / weak panels…). Server sums (GET /api/stats/aggregate, Волна 2 п. 2.5) only for an explicit
 * «Вся команда», and there only on the tabs that read them; the per-trade tabs load the desk's raw trades.
 */
import { resolveTraderScope, type TraderScope } from "@/components/people/staff-scope";

export type AnalyticsTabKey = "overview" | "edge" | "matrix" | "whatif" | "montecarlo" | "desk" | "psychology" | "pro";

/** Tabs that compute from every trade (in the team view too). */
export const RAW_TABS: readonly AnalyticsTabKey[] = ["edge", "whatif", "montecarlo", "psychology", "pro"];

export type AnalyticsDataPlan = {
  scope: TraderScope;
  /** The visible tab reads the desk aggregate (team view, not a per-trade tab). */
  aggregate: boolean;
  /** The visible tab reads raw trades. Exactly one of aggregate / needRaw is true. */
  needRaw: boolean;
};

export function analyticsDataPlan(o: {
  staff: boolean; me: string | null | undefined; picked: string | null | undefined; team: boolean; tab: AnalyticsTabKey;
}): AnalyticsDataPlan {
  const scope = resolveTraderScope({ staff: o.staff, me: o.me, picked: o.picked, team: o.team });
  const aggregate = scope.team && !RAW_TABS.includes(o.tab);
  return { scope, aggregate, needRaw: !aggregate };
}
