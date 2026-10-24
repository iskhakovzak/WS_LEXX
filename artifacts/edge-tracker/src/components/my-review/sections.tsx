/**
 * «Мой разбор» — the three answers as cards (phone-first: one column at 375 px, rows ≥ 44 px, no tables):
 *   RuleCard    — the focal point: one rule for tomorrow + «Открыть план на завтра» (the plan prefills it);
 *   AnswerCard  — «Где зарабатываю» / «Где теряю»: the edge map (roadmap R4) — at most 3 slices per side that passed
 *                 every gate (desk shrinkage, chance check, persistence, $ floor), each in $ per trading day with its 80%
 *                 interval. No raw buckets: a 2-trade group is noise, not a finding.
 */
import { Link } from "wouter";
import { ArrowRight, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { mistakeLabel, mistakeRule } from "@/components/shared/mistake-labels";
import { links } from "@/lib/links";
import { myReviewI18n } from "@/i18n/ns/myReview";
import { coachI18n } from "@/i18n/ns/coach";
import { EdgeVerdictList } from "@/components/shared/edge-map/edge-verdicts";
import type { MyReview } from "./api";
import { costText, nextPlanDate } from "./model";

export function RuleCard({ review }: { review: MyReview }) {
  const { t } = myReviewI18n.useT();
  const rule = review.rule;
  return (
    <Panel title={t("rule.title")} icon={Lightbulb} className="ring-1 ring-primary/40">
      {rule ? (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{mistakeRule(rule.mistake)}</p>
          <p className="text-sm text-muted-foreground">
            {t("rule.why", { mistake: mistakeLabel(rule.mistake), cost: costText(rule.costNet), times: t("times", { count: rule.count }), days: t("daysN", { count: rule.days }) })}
          </p>
          {rule.source === "plan" && <p className="text-xs text-muted-foreground">{t("rule.planSource")}</p>}
          <Button asChild className="h-11 w-full sm:w-fit">
            <Link href={links.myPlan(nextPlanDate(review.to))}>{t("rule.toPlan")}<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("rule.none")}</p>
      )}
    </Panel>
  );
}

export function AnswerCard({ kind, review }: { kind: "earn" | "lose"; review: MyReview }) {
  const { t } = myReviewI18n.useT();
  const tc = coachI18n.useT().t;
  const Icon = kind === "earn" ? TrendingUp : TrendingDown;
  return (
    <Panel title={t(`${kind}.title`)} icon={Icon} fill>
      {review.edge?.asOf ? (
        <div className="flex flex-col gap-2">
          <EdgeVerdictList rows={kind === "earn" ? review.edge.earn : review.edge.lose} kind={kind} />
          <p className="px-2 text-xs text-muted-foreground">{tc("edgeMap.hint")}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{tc("edgeMap.notComputed")}</p>
      )}
    </Panel>
  );
}
