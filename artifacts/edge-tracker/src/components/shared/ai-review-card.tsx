/**
 * «AI review» of a trade (trade sheet → Review) or a day (day report): the verdict, what went well / wrong with the
 * evidence (fills, minutes, stats, rules, the edge map) and each point marked fact or hypothesis, the edge-map line
 * with its interval, ONE rule / focus for tomorrow as an implementation intention («if … — then …»), a «What if» link
 * for the proposed rule, the data gaps. Day reviews add the day's state machine as plain facts (computed by the server,
 * not by the model). Opening a stored review costs nothing; «Review» / «Refresh» spend the assistant's daily budget.
 * No model names: a deep review carries the ⚡ mark («deep analysis»).
 */
import * as React from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, ChevronDown, Copy, FlaskConical, Loader2, RefreshCw, Target, ThumbsUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaitProgress } from "@/components/ui/wait-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, type Tone } from "@/components/ds";
import { assistantI18n } from "@/i18n/ns/assistant";
import { humanizeApiError } from "@/lib/api/errors";
import { isApiError } from "@/lib/api/http";
import { fmtDate, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BoltMark, WsMark } from "./ws-mark";
import {
  clause, FOCUS_KEY, isPeriodSubject, reviewText, TITLE_KEY, useAiReview, whatIfHref, type DayFacts, type Evidence, type ReviewDto, type ReviewPoint, type ReviewSubject,
} from "./ai-review-data";

const GRADE_TONE: Record<string, Tone> = { A: "up", B: "accent", C: "warn", D: "down", F: "down" };
const PLAN_TONE: Record<string, Tone> = { yes: "up", partly: "warn", no: "down", unknown: "neutral" };

function EvidenceChip({ e }: { e: Evidence }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--glass-bg)] px-1.5 py-0.5 text-2xs text-muted-foreground tabular-nums ring-1 ring-[var(--glass-border)]">
      {e.ref != null && e.kind === "fill" ? <span className="font-semibold text-foreground">#{e.ref}</span> : null}
      <span className="truncate">{e.label}</span>
    </li>
  );
}

function Point({ p }: { p: ReviewPoint }) {
  const { t } = assistantI18n.useT();
  const hyp = p.basis === "hypothesis";
  return (
    <li className="space-y-1">
      <p className="text-sm leading-snug text-foreground/90">
        {p.text}{" "}
        <span
          className={cn("ml-0.5 inline-flex rounded-full px-1.5 py-px align-[1px] text-2xs font-medium", hyp ? "bg-[hsl(var(--chart-3)/0.14)] text-[hsl(var(--chart-3))]" : "bg-muted text-muted-foreground")}
          title={t(`review.basisHint.${p.basis}`)}
        >
          {t(`review.basis.${p.basis}`)}
        </span>
      </p>
      {p.evidence.length ? <ul className="flex flex-wrap gap-1">{p.evidence.map((e, i) => <EvidenceChip key={i} e={e} />)}</ul> : null}
    </li>
  );
}

function Column({ title, icon: Icon, tone, points }: { title: string; icon: LucideIcon; tone: "up" | "down"; points: ReviewPoint[] }) {
  const { t } = assistantI18n.useT();
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", tone === "up" ? "bg-up/10 text-up" : "bg-down/10 text-down")}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      </div>
      {points.length ? <ul className="space-y-2.5">{points.map((p, i) => <Point key={i} p={p} />)}</ul> : <p className="text-xs text-muted-foreground">{t("review.none")}</p>}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | null }) {
  return (
    <div className="min-w-0 rounded-lg px-2.5 py-1.5 ring-1 ring-[var(--glass-border)]">
      <div className="micro-label truncate">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
    </div>
  );
}

function DayFactsStrip({ f }: { f: DayFacts }) {
  const { t } = assistantI18n.useT();
  const nu = (n: number, net: number) => t("review.facts.count", { n, usd: fmtUsd(net, { signed: true }) });
  const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : null);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="ai-day-facts">
      <Fact label={t("review.facts.trades")} value={String(f.trades)} />
      <Fact label={t("review.facts.afterLoss")} value={nu(f.afterLoss.n, f.afterLoss.net)} tone={f.afterLoss.n ? tone(f.afterLoss.net) : null} />
      <Fact label={t("review.facts.afterWin")} value={nu(f.afterWin.n, f.afterWin.net)} tone={f.afterWin.n ? tone(f.afterWin.net) : null} />
      <Fact label={t("review.facts.afterPeak")} value={f.afterPeak.giveback > 0 ? t("review.facts.giveback", { usd: fmtUsd(f.afterPeak.giveback) }) : "—"} tone={f.afterPeak.giveback > 0 ? "down" : null} />
      <Fact label={t("review.facts.firstVsRest")} value={`${fmtUsd(f.firstThree.net, { signed: true })} / ${fmtUsd(f.rest.net, { signed: true })}`} />
    </div>
  );
}

function ReviewBody({ d }: { d: ReviewDto }) {
  const { t } = assistantI18n.useT();
  const r = d.review;
  const href = whatIfHref(d.whatIfRule);
  const [gapsOpen, setGapsOpen] = React.useState(false);
  return (
    <div className="space-y-3">
      <p className="border-l-2 border-foreground/60 pl-3 text-[0.9375rem] font-medium leading-relaxed text-foreground">{r.verdict.headline}</p>
      {d.facts ? <DayFactsStrip f={d.facts} /> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Column title={t("review.wentWell")} icon={ThumbsUp} tone="up" points={r.wentWell} />
        <Column title={t("review.wentWrong")} icon={AlertTriangle} tone="down" points={r.wentWrong} />
      </div>
      {r.edge ? (
        <p className="rounded-xl px-3 py-2 text-sm ring-1 ring-[var(--glass-border)]">
          <span className="micro-label mr-2">{t("review.edge")}</span>
          {r.edge.text}
          {r.edge.interval ? <span className="ml-1 text-muted-foreground tabular-nums">({r.edge.interval})</span> : null}
        </p>
      ) : null}
      <div className="rounded-xl bg-foreground px-3.5 py-3 text-background" data-testid="ai-review-tomorrow">
        <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold opacity-75">
          <Target className="h-3.5 w-3.5" aria-hidden="true" />
          {t(FOCUS_KEY[d.kind])}
        </div>
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">{t("review.if")}</span> {clause(r.tomorrow.if)} — <span className="font-semibold">{t("review.then")}</span> {clause(r.tomorrow.then)}
        </p>
      </div>
      {href && r.whatIf ? (
        <Link href={href} className="flex items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-[var(--glass-border)] transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-foreground">{t("review.whatIf")}</span>
            <span className="block text-xs text-muted-foreground">{r.whatIf.why}</span>
          </span>
        </Link>
      ) : null}
      {r.dataGaps.length ? (
        <div>
          <button type="button" onClick={() => setGapsOpen((v) => !v)} aria-expanded={gapsOpen} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {t("review.gaps", { n: r.dataGaps.length })}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-[var(--dur-2)] motion-reduce:transition-none", gapsOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {gapsOpen ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{r.dataGaps.map((g, i) => <li key={i}>{g}</li>)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AiReviewCard({ subject, className }: { subject: ReviewSubject; className?: string }) {
  const { t } = assistantI18n.useT();
  const { review: d, loading, loadError, refetch, run } = useAiReview(subject);
  const [copied, setCopied] = React.useState(false);
  const busy = run.isPending;
  const err = run.error;
  const budgetOut = isApiError(err) && err.code === "AI_BUDGET_EXCEEDED";
  const title = t(TITLE_KEY[subject.kind]);
  // Week / month: prepared overnight only — no button, and no card until one exists.
  const period = isPeriodSubject(subject);
  if (period && !d) return null;

  const copy = async () => {
    if (!d) return;
    try { await navigator.clipboard.writeText(reviewText(d, t as never)); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <section className={cn("glass-panel space-y-4 rounded-2xl p-4", className)} data-testid={subject.kind === "trade" ? "ai-review-panel" : `ai-${subject.kind}-review`} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background"><WsMark className="h-[18px] w-[18px]" still={!busy} /></span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {d ? (
            <>
              <Pill tone={GRADE_TONE[d.review.verdict.grade] ?? "neutral"}>{t("review.grade", { grade: d.review.verdict.grade })}</Pill>
              <Pill tone={PLAN_TONE[d.review.verdict.followedPlan] ?? "neutral"} dot>{t(`review.plan.${d.review.verdict.followedPlan}`)}</Pill>
              <Pill tone="neutral">{t(`review.confidence.${d.review.confidence}`)}</Pill>
              {d.tier === "deep" ? <span className="inline-flex items-center" title={t("tier.deep")} aria-label={t("tier.deep")}><BoltMark className="h-3.5 w-3.5 text-foreground" /></span> : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {d ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={copy} aria-label={t("review.copy")} title={copied ? t("review.copied") : t("review.copy")}>
              {copied ? <Check className="text-up" aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          ) : null}
          {period ? null : (
            <Button type="button" variant={d ? "outline" : "default"} size="sm" onClick={() => run.mutate(!!d)} disabled={busy || loading} className="relative" data-testid="button-ai-review">
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : d ? <RefreshCw aria-hidden="true" /> : <WsMark className="h-4 w-4" still />}
              {busy ? t("review.running") : d ? t("review.refresh") : t("review.run")}
              {busy && d ? <WaitProgress inButton expectedMs={25000} /> : null}
            </Button>
          )}
        </div>
      </div>

      {err ? (
        <div role="alert" className={cn("rounded-xl px-3 py-2 text-xs", budgetOut ? "bg-[var(--glass-bg)] text-muted-foreground ring-1 ring-[var(--glass-border)]" : "bg-down/10 text-down")}>
          {budgetOut ? <><p className="font-medium text-foreground">{t("budget.exhaustedTitle")}</p><p>{t("budget.exhaustedBody")}</p></> : humanizeApiError(err)}
        </div>
      ) : null}
      {loadError && !d ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">
          {humanizeApiError(loadError, t("review.loadFailed"))}
          <button type="button" onClick={() => void refetch()} className="font-medium text-primary hover:underline">{t("retry")}</button>
        </div>
      ) : null}

      {(loading || busy) && !d ? (
        <div className="space-y-3" aria-busy="true">
          {busy ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t(subject.kind === "trade" ? "review.stepsTrade" : "review.stepsDay")}</p> : null}
          {busy ? <WaitProgress expectedMs={25000} /> : null}
          <Skeleton className="h-4 w-3/4" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : null}

      {!loading && !busy && !d && !loadError ? (
        <div className="flex flex-col items-start gap-1.5 py-2">
          <p className="text-sm font-medium text-foreground">{t("review.emptyTitle")}</p>
          <p className="max-w-prose text-sm text-muted-foreground">{t(subject.kind === "trade" ? "review.emptyTrade" : "review.emptyDay")}</p>
          <p className="text-2xs text-muted-foreground">{t("review.costHint")}</p>
        </div>
      ) : null}

      {d ? (
        <div className={cn(busy && "opacity-60")}>
          <ReviewBody d={d} />
          <p className="mt-3 border-t border-[var(--glass-border)] pt-2 text-2xs text-muted-foreground">
            {t("review.generated", { date: fmtDate(d.createdAt, "dateTime") })}
            {period ? <> · {t("review.batchNote")}</> : d.cached ? <> · {t("review.cached")}</> : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
