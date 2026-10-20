/**
 * «Мой разбор» — the three answers as cards (phone-first: one column at 375 px, rows ≥ 44 px, no tables):
 *   RuleCard    — the focal point: one rule for tomorrow + «Открыть план на завтра» (the plan prefills it);
 *   AnswerCard  — «Где зарабатываю» / «Где теряю»: up to 3 rows per setups / tickers / entry time; a setup or ticker
 *                 row opens the period's trades; «Где теряю» starts with the costliest behaviour patterns.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Brain, ChevronRight, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { mistakeLabel, mistakeRule } from "@/components/shared/mistake-labels";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { myReviewI18n } from "@/i18n/ns/myReview";
import type { MyReview, ReviewBucket, ReviewDimension, ReviewPattern } from "./api";
import { bucketHref, bucketLabel, bucketValue, costText, nextPlanDate, sectionsOf, winText } from "./model";

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

function BucketRow({ dim, b, review }: { dim: ReviewDimension; b: ReviewBucket; review: MyReview }) {
  const { t } = myReviewI18n.useT();
  const label = bucketLabel(dim, b.key);
  const href = bucketHref(dim, b.key, review);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" title={label}>{label}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">{commonI18n.t("units.trades", { count: b.trades })} · {winText(b.winRate)}</span>
      </span>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", toneText(toneOf(b.net)))}>{bucketValue(b)}</span>
      {href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  const cls = "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5";
  return (
    <li>
      {href ? (
        <Link href={href} aria-label={t("openTrades", { label })} className={cn(cls, "transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{body}</Link>
      ) : (
        <div className={cls} aria-label={t("bucketAria", { label, net: bucketValue(b), trades: commonI18n.t("units.trades", { count: b.trades }) })}>{body}</div>
      )}
    </li>
  );
}

function PatternRow({ p }: { p: ReviewPattern }) {
  const { t } = myReviewI18n.useT();
  return (
    <li>
      <Link href="/behavior" aria-label={t("openBehavior")} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{mistakeLabel(p.mistake)}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">{t("lose.patternLine", { times: t("times", { count: p.count }), days: t("daysN", { count: p.days }) })}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-down">{costText(p.costNet)}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h3 className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{icon}{title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

export function AnswerCard({ kind, review }: { kind: "earn" | "lose"; review: MyReview }) {
  const { t } = myReviewI18n.useT();
  const sections = sectionsOf(kind === "earn" ? review.earn : review.lose);
  const patterns = kind === "lose" ? review.lose.patterns : [];
  const empty = !sections.length && !patterns.length;
  const Icon = kind === "earn" ? TrendingUp : TrendingDown;
  return (
    <Panel title={t(`${kind}.title`)} icon={Icon} fill>
      {empty ? (
        <p className="text-sm text-muted-foreground">{t(`${kind}.empty`)}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {patterns.length > 0 && (
            <Group title={t("lose.patterns")} icon={<Brain className="h-3.5 w-3.5" aria-hidden="true" />}>
              {patterns.map((p) => <PatternRow key={p.mistake} p={p} />)}
            </Group>
          )}
          {sections.map((s) => (
            <Group key={s.dim} title={t(`dim.${s.dim}`)}>
              {s.rows.map((b) => <BucketRow key={b.key} dim={s.dim} b={b} review={review} />)}
            </Group>
          ))}
        </div>
      )}
    </Panel>
  );
}
