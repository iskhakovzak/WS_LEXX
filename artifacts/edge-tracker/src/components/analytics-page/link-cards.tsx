/**
 * The link cards /analytics shows instead of a second copy of another page (design audit wave 2B): the period report
 * (/stats), the behaviour block (/behavior) and the rule simulator (/what-if), each carrying the same person and period.
 */
import { useMemo } from "react";
import { BarChart3, Brain, FlaskConical } from "lucide-react";
import { PageLinkCard } from "@/components/shared/page-link-card";
import { periodLabel } from "@/components/shared/period/PeriodPicker";
import { personName } from "@/i18n";
import { analyticsI18n } from "@/i18n/ns/analytics";
import { behaviorHref, statsHref, whatIfHref } from "./links";
import { customRangeOf, type AnalyticsFilters } from "./metrics";

/** «квартал» / «3–21 окт. 2026 г.» — the period of the view in a summary line. */
export function analyticsPeriodText(f: AnalyticsFilters): string {
  const custom = f.period === "custom" ? customRangeOf(f) : null;
  return custom ? periodLabel("custom", custom) : periodLabel(f.period === "custom" ? "quarter" : f.period, null).toLowerCase();
}

export function useAnalyticsLinkCards(view: AnalyticsFilters, scope: { self: boolean; team: boolean; trader: string | null }) {
  const { t } = analyticsI18n.useT();
  return useMemo(() => {
    // What a card carries over: the person and the period («мои сделки · квартал»).
    const carried = [
      scope.self ? t("summary.mine") : scope.team ? t("summary.team") : personName(scope.trader),
      analyticsPeriodText(view),
    ].join(" · ");
    const to = { trader: scope.trader, team: scope.team };
    return {
      report: <PageLinkCard href={statsHref(view, to)} icon={BarChart3} title={t("links.report.title")} description={t("links.report.description")} scope={carried} />,
      behavior: <PageLinkCard href={behaviorHref(view, to)} icon={Brain} title={t("links.behavior.title")} description={t("links.behavior.description")} scope={carried} />,
      whatIf: <PageLinkCard href={whatIfHref(view)} icon={FlaskConical} title={t("links.whatIf.title")} description={t("links.whatIf.description")} scope={carried} />,
    };
  }, [view, scope.self, scope.team, scope.trader, t]);
}
