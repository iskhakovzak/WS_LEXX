/**
 * The dashboard's lead card by the trader's day state (lib/day-state; composition: ./state-layout). One card, one
 * primary action — closure (status + the next step) for the three states that change what the day is about:
 *   stopped   the rule, used / limit, what lifts the stop, «Написать куратору» (the hero cell stays a quiet fact)
 *   paused    «С возвращением»: where you stopped, ONE small step, the old review backlog as one line
 *   newcomer  how far to the first conclusions (N of 20 trades) and the next Academy step
 * Numbers of the stop are read exactly like the hero cell (today-hero haltFacts over GET /api/risk/me).
 */
import { Link } from "wouter";
import { ArrowRight, ChevronRight, Compass, HeartHandshake, OctagonPause, Sprout } from "lucide-react";
import { LimitBar, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { AskCuratorButton } from "@/components/shared/ask-curator";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import type { TraderState } from "@/lib/day-state";
import { commonI18n } from "@/i18n/ns/common";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { dayStateI18n } from "@/i18n/ns/dayState";
import { DashCard } from "./dash-card";
import { haltFacts } from "./today-hero";
import type { RiskMe } from "./use-dashboard";

const usd0 = (n: number) => fmtUsd(n, { decimals: 0 });

function LeadIcon({ icon: Icon, tone }: { icon: typeof Compass; tone: "down" | "accent" | "neutral" }) {
  return (
    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "down" ? "bg-down/15 text-down" : tone === "accent" ? "bg-primary/15 text-primary" : "bg-[var(--glass-hover-bg)] text-muted-foreground")}>
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

/** stopped: the one alarm of the dashboard. */
export function StopCard({ risk, state, quietDay }: { risk: RiskMe | null | undefined; state: TraderState; quietDay: boolean }) {
  const { t } = dayStateI18n.useT();
  const { t: td } = dashboardI18n.useT();
  const facts = risk?.halted ? haltFacts(risk) : null;
  const rule = facts ? facts.state : state.stop?.state === "drawdown" || state.stop?.state === "weekly" ? state.stop.state : "stop";
  const ruleText = td(`hero.haltRule.${rule}`);
  const used = facts ? usd0(facts.used) : null;
  const limit = facts?.limit != null ? usd0(facts.limit) : null;
  return (
    <DashCard aria-label={t("stop.aria")} bodyClassName="gap-4">
      <div className="flex items-start gap-3">
        <LeadIcon icon={OctagonPause} tone={quietDay ? "neutral" : "down"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{ruleText}</p>
          <h2 className={cn("text-lg font-semibold leading-7", quietDay ? "text-foreground" : toneText("down"))}>{t("stop.title")}</h2>
          {used && <p className="text-sm tabular-nums text-foreground">{limit ? t("stop.usedOf", { used, limit }) : used}</p>}
        </div>
      </div>
      {facts && facts.limit != null && <LimitBar used={facts.used} limit={facts.limit} warnAt={0.7} size="sm" showValues={false} ariaLabel={ruleText} />}
      <p className="max-w-prose text-sm text-muted-foreground">{quietDay ? t("stop.closed") : t(`stop.lift.${rule}`)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <AskCuratorButton
          kind="other"
          label={td("hero.writeCurator")}
          prefill={td("hero.writeCuratorPrefill", { rule: ruleText.toLowerCase(), used: used ?? "—", limit: limit ?? "—" })}
        />
        <Button asChild size="sm" variant="ghost">
          <Link href={links.risk(state.trader)}>
            {t("stop.riskDesk")}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </DashCard>
  );
}

/** paused: a kind return — where you stopped, one small step, the backlog as one line. */
export function WelcomeBackCard({ state }: { state: TraderState }) {
  const { t } = dayStateI18n.useT();
  const tc = commonI18n.useT().t;
  const last = state.lastTrade;
  const planStep = state.phase === "premarket" || state.phase === "session";
  const href = planStep ? links.myPlan(state.today) : "/trainer";
  const lastLine = last
    ? [
        t("back.last", { date: fmtDate(last.date, "weekdayDayMonth") }),
        tc("units.trades", { count: last.trades }),
        last.pnl != null ? fmtUsd(last.pnl, { signed: true }) : null,
      ].filter(Boolean).join(" · ")
    : t("back.never");
  const b = state.backlog;
  return (
    <DashCard aria-label={t("back.aria")} bodyClassName="gap-4">
      <div className="flex items-start gap-3">
        <LeadIcon icon={HeartHandshake} tone="accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-7">{t("back.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("back.lead")}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{lastLine}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button asChild size="sm">
          <Link href={href}>
            {planStep ? t("back.step.plan") : t("back.step.warmup")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">{planStep ? t("back.step.planHint") : t("back.step.warmupHint")}</span>
      </div>
      {b.count > 0 && b.oldest && (
        <Link href="/journal" className="-mx-2 flex min-h-11 items-center gap-2 rounded-xl border-t border-[var(--glass-border)] px-2 pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0 flex-1">{t("back.backlog", { count: b.count, date: fmtDate(b.oldest, "dayMonth") })}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium">{t("back.backlogCta")}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
        </Link>
      )}
    </DashCard>
  );
}

/** newcomer: the path to the first trades and to the first honest conclusions. */
export function NewcomerCard({ state }: { state: TraderState }) {
  const { t } = dayStateI18n.useT();
  const n = state.newcomer ?? { trades: state.closedTrades, target: state.thresholds.newcomerTrades };
  const pct = n.target > 0 ? Math.min(100, Math.round((n.trades / n.target) * 100)) : 0;
  return (
    <DashCard aria-label={t("newcomer.aria")} bodyClassName="gap-4">
      <div className="flex items-start gap-3">
        <LeadIcon icon={Sprout} tone="accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-7">{t("newcomer.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("newcomer.lead", { target: n.target, count: n.trades })}</p>
        </div>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={n.target} aria-valuenow={n.trades} aria-label={t("newcomer.progressAria", { count: n.trades, target: n.target })} className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-hover-bg)]">
        <div className="h-full rounded-full bg-foreground/70 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href="/academy/learn">
            {t("newcomer.step.academy")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost"><Link href="/trainer">{t("newcomer.step.trainer")}</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link href={links.myPlan(state.today)}>{t("newcomer.step.plan")}</Link></Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("newcomer.step.academyHint")}</p>
    </DashCard>
  );
}

/** The state's lead card (nothing for the time-of-day states: the board's order does the work there). */
export function StateLead({ state, risk, quietDay }: { state: TraderState | null | undefined; risk: RiskMe | null | undefined; quietDay: boolean }) {
  if (!state) return null;
  if (state.state === "stopped") return <StopCard risk={risk} state={state} quietDay={quietDay} />;
  if (state.state === "paused") return <WelcomeBackCard state={state} />;
  if (state.state === "newcomer") return <NewcomerCard state={state} />;
  return null;
}

/** The mentor tile while stopped: the stop comes first (no «соберите бриф» on a halted day). */
export function StopMentorLine() {
  const { t } = dayStateI18n.useT();
  return (
    <Link
      href="/coach"
      aria-label={t("mentor.open")}
      className="group flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Compass className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0 font-semibold text-foreground">{t("mentor.label")}:</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{t("mentor.stop")}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
