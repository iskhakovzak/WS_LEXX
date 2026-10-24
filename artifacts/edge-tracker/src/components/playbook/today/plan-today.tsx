/**
 * «Мой план на сегодня» — the focal point at the top of «Сегодня» (figure-ground): the plan strip from the personal
 * plan (daily stop · max trades · rule of the day · 1R, «Изменить план») and the picked setups as FULL cheat sheets,
 * one under another (two columns on wide screens). Nothing picked yet → one step: the suggested setups pre-selected
 * and one «Взять в план» button (prefill).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, ChevronRight, ShieldCheck, Target } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { mistakeRule } from "@/components/shared/mistake-labels";
import { dailyMeQuery, myPlanQuery, riskMeQuery } from "@/lib/api/queries";
import type { PlaybookToday, TodaySetup } from "@/lib/playbook-today/types";
import { fmtDate, fmtUsd } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { CheatCard } from "./cheat-card";
import { SetupSchema } from "./schema-art";
import { SetupDetails } from "./setup-details";
import { MAX_PICKS, pickCandidates, planFacts, suggestionSource } from "./today-model";
import { edgeChip, edgeDetail, timeText } from "./today-text";

type PlanRes = { plan?: { doc?: Record<string, unknown> | null } | null } | null;

function Fact({ label, value, muted, loading }: { label: string; value: string; muted?: boolean; loading?: boolean }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {loading ? (
        <span className="skeleton inline-block h-4 w-12 self-center rounded-full" aria-hidden="true" />
      ) : (
        <span className={cn("text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere]", muted ? "font-normal text-muted-foreground" : "text-foreground")}>{value}</span>
      )}
    </span>
  );
}

/** Daily stop · max trades · rule of the day · 1R — what the trader promised for today, and the way to change it. */
export function PlanStrip({ today }: { today: PlaybookToday }) {
  const { t } = playbookTodayI18n.useT();
  const plan = useQuery(myPlanQuery<PlanRes>(today.date));
  const me = useQuery(dailyMeQuery());
  const desk = useQuery({ ...riskMeQuery<{ dailyLossLimit?: number | null } | null>(), select: (r) => r?.dailyLossLimit ?? null, retry: false });
  const focus = me.data?.focus && me.data.focus.date === today.date ? me.data.focus : null;
  const f = planFacts(plan.data, focus, desk.data);
  const unset = t("myPlan.unset");
  // While the plan / limits are still loading, show placeholders instead of «—» that then jump to numbers.
  const loading = plan.isLoading || desk.isLoading;
  // Nothing set at all: one actionable line instead of three dashes (closure: say what to do, and where).
  const noLimits = !loading && f.maxLossUsd == null && f.maxTrades == null && !today.oneR;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5" aria-busy={loading || undefined}>
      <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      {noLimits ? (
        <span className="min-w-0 flex-1 text-sm text-foreground/80">{t("myPlan.unsetAll")}</span>
      ) : (
        <>
          <Fact loading={loading} label={t("myPlan.stop")} value={f.maxLossUsd != null ? (f.stopSource === "limits" ? `${fmtUsd(f.maxLossUsd, { decimals: 0 })} · ${t("card.oneRSource.limits")}` : fmtUsd(f.maxLossUsd, { decimals: 0 })) : unset} muted={f.maxLossUsd == null} />
          <Fact loading={plan.isLoading} label={t("myPlan.maxTrades")} value={f.maxTrades != null ? String(f.maxTrades) : unset} muted={f.maxTrades == null} />
          <Fact label={t("myPlan.oneR")} value={today.oneR ? `${fmtUsd(today.oneR.usd, { decimals: 0 })} · ${t(`card.oneRSource.${today.oneR.source}`)}` : unset} muted={!today.oneR} />
        </>
      )}
      {f.rule && <Fact label={t("myPlan.rule")} value={f.ruleFromFocus ? `${f.rule} (${t("myPlan.fromFocus")})` : f.rule} />}
      {f.avoid && <Fact label={t("myPlan.avoid")} value={f.avoidFromFocus ? `${mistakeRule(f.avoid)} (${t("myPlan.fromFocus")})` : mistakeRule(f.avoid)} />}
      <Link href={links.myPlan(today.date)} className="ml-auto inline-flex min-h-9 items-center gap-0.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {noLimits ? t("myPlan.setInPlan") : t("myPlan.edit")} <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

const PROMPT_HINT = { edge: "myPlan.promptHint", mixed: "myPlan.promptHintMixed", starter: "myPlan.promptHintStarter" } as const;

/** Nothing saved yet: the suggestion pre-selected (plus anything starred below), one «Взять в план». */
function PickPrompt({
  today, suggestion, draft, saving, onToggle, onSave,
}: {
  today: PlaybookToday;
  suggestion: number[];
  draft: number[];
  saving: boolean;
  onToggle: (id: number) => void;
  onSave: () => void;
}) {
  const { t } = playbookTodayI18n.useT();
  const byId = new Map(today.setups.map((s) => [s.id, s]));
  const tiles = pickCandidates(suggestion, draft).map((id) => byId.get(id)).filter((s): s is TodaySetup => !!s);
  if (!tiles.length) {
    return <p className="rounded-xl border border-dashed border-[var(--field-border)] px-3 py-3 text-[15px] text-foreground/85">{t("myPlan.emptyNoSuggestion")}</p>;
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-primary/35 bg-primary/5 p-3 sm:p-4">
      <div>
        <p className="text-base font-semibold text-foreground">{t("myPlan.promptTitle")}</p>
        <p className="text-sm text-foreground/80">{t(PROMPT_HINT[suggestionSource(today.setups, suggestion)])}</p>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((s) => {
          const on = draft.includes(s.id);
          const chip = edgeChip(s.myEdge);
          return (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(s.id)}
                title={edgeDetail(s.myEdge)}
                className={cn(
                  "flex h-full w-full min-w-0 items-start gap-3 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary/60 bg-primary/10" : "border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-[var(--field-border)]")}>
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{s.name}</span>
                  <span className="mt-0.5 block text-sm text-foreground/75">{timeText(s)}</span>
                  <Pill tone={chip.tone} className="mt-1 h-auto whitespace-normal py-1 text-left leading-tight">{chip.text}</Pill>
                </span>
                <SetupSchema schema={s.schema} className="hidden h-12 w-20 shrink-0 min-[420px]:block" title="" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-11 bg-primary-solid px-5 text-base" onClick={onSave} disabled={saving || draft.length === 0}>
          {saving ? t("picks.saving") : t("myPlan.take", { count: draft.length })}
        </Button>
        <span className="text-sm text-foreground/75">{t("myPlan.takeHint", { max: MAX_PICKS })}</span>
      </div>
    </div>
  );
}

export function PlanToday({
  today, saved, draft, suggestion, saving, onToggle, onTake,
}: {
  today: PlaybookToday;
  /** Picks saved in the personal plan (each one is a full cheat sheet here). */
  saved: number[];
  /** The prefill draft while nothing is saved. */
  draft: number[];
  suggestion: number[];
  saving: boolean;
  onToggle: (id: number) => void;
  onTake: () => void;
}) {
  const { t } = playbookTodayI18n.useT();
  const byId = new Map(today.setups.map((s) => [s.id, s]));
  const cards = saved.map((id) => byId.get(id)).filter((s): s is TodaySetup => !!s);
  return (
    <section aria-labelledby="pb-plan-h" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="pb-plan-h" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          <Target className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("myPlan.title")}
        </h2>
        <span className="text-sm text-foreground/75">
          {fmtDate(today.date, "weekdayDayMonth")}
          {cards.length > 0 && <span className="tabular-nums text-muted-foreground"> · {t("myPlan.count", { count: cards.length, max: MAX_PICKS })}</span>}
        </span>
      </header>
      <PlanStrip today={today} />
      {cards.length === 0 ? (
        <PickPrompt today={today} suggestion={suggestion} draft={draft} saving={saving} onToggle={onToggle} onSave={onTake} />
      ) : (
        <div className={cn("grid min-w-0 items-start gap-[var(--grid-gap)]", cards.length > 1 && "xl:grid-cols-2")}>
          {cards.map((s) => (
            <CheatCard key={s.id} setup={s} oneR={today.oneR} date={today.date} canPick picked onTogglePick={() => onToggle(s.id)}>
              <SetupDetails setupId={s.id} />
            </CheatCard>
          ))}
        </div>
      )}
    </section>
  );
}
