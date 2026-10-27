import { Check, Crosshair, Info, Lightbulb, Loader2, type LucideIcon, NotebookPen, Plus, ShieldCheck, Timer } from "lucide-react";
import { EmptyState, Pill, type Tone } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { Suggestion, SuggestionsResponse, Timing } from "./api";
import { WhyFold } from "./why-fold";
import { ConfidenceTicks } from "./confidence-ticks";
import { type Rule, chipLabel, ifNotPhrase, isApplied } from "./rules";
import {
  type BadgeId, type NeedLine, cardLine, holdoutNote, needLine, preliminaryHintKey, removalLine, sectionNote, suggestionBadges, timingOf,
} from "./suggestion-badges";

/**
 * «Что ещё дало бы больше всего»: the best single rules found by the server search, as cards
 * «Если бы ты не … → +$Y за период [интервал]» — all of them at once. Each card carries its timing eyebrow
 * («до входа» / «в сделке» / «разбор»), how much to trust it as 1–3 ticks (the tier's word and why in the tooltip)
 * and at most one qualifier pill. Once the
 * server's honest check is ready the cards are «Подтверждено» or «Гипотеза» with their next step (days still needed,
 * the «всё время» period, or a review on the day report); until then the fast cards are «предварительно». «Применить»
 * adds the rule to the scenario, a second click (or ✕ on its chip) takes it back. `onAllTime` switches the page to
 * «всё время» (where the honest check runs).
 */
export function SuggestionCards({
  data,
  isLoading,
  rules,
  periodLabel,
  onToggle,
  onAllTime,
  onDay,
}: {
  data: SuggestionsResponse | undefined;
  isLoading: boolean;
  rules: Rule[];
  periodLabel: string;
  onToggle: (s: Suggestion, applied: boolean) => void;
  onAllTime?: () => void;
  /** «Почему»: a day of the decomposition opens its report. */
  onDay?: (day: string) => void;
}) {
  const { t } = whatIfI18n.useT();
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[168px] rounded-2xl" />)}
        <span className="sr-only" role="status">{t("suggestions.searching")}</span>
      </div>
    );
  }
  if (!data.suggestions.length) {
    const honest = data.honesty?.state === "ready";
    return (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          compact
          icon={honest ? ShieldCheck : Lightbulb}
          title={honest ? t("suggestions.honestEmptyTitle") : t("suggestions.emptyTitle")}
          description={honest ? t("suggestions.honestEmptyHint") : t("suggestions.emptyHint")}
        />
      </div>
    );
  }
  // Every variant at once (owner: no «Ещё» — the whole picture is the point).
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]">
        {data.suggestions.map((s) => (
          <SuggestionCard key={JSON.stringify(s.rule)} s={s} data={data} rules={rules} periodLabel={periodLabel} onToggle={onToggle} onAllTime={onAllTime} onDay={onDay} />
        ))}
      </div>
    </div>
  );
}

/**
 * The line under the section title: today's «Подбираем по твоим сделкам … Это история, а не обещание.», or what the
 * honest check says — still computing (with a spinner), taking longer than usual (no spinner, no «до минуты»), no
 * confirmed rule yet, team view, a period without the honest check (with the switch to «всё время»), unavailable —
 * always followed by «Это история, а не обещание», whatever the cards are.
 */
export function SuggestionsNote({ data, periodPhrase, onAllTime }: { data: SuggestionsResponse | undefined; periodPhrase: string; onAllTime?: () => void }) {
  const { t } = whatIfI18n.useT();
  const note = sectionNote(data);
  if (!note) return <p className="text-xs text-muted-foreground">{t("suggestionsHint", { period: periodPhrase })}</p>;
  const pending = note === "computing" || note === "slow";
  return (
    <p className="text-xs text-muted-foreground" role={pending ? "status" : undefined}>
      {note === "computing" && <Loader2 className="mr-1.5 inline h-3 w-3 shrink-0 animate-spin align-[-2px] motion-reduce:animate-none" aria-hidden="true" />}
      {t("suggestions.noteLine", { note: t(`suggestions.note.${note}`) })}
      {note === "window" && onAllTime && (
        <>
          {" "}
          <button type="button" onClick={onAllTime} className="font-medium text-primary underline-offset-2 hover:underline">
            {t("suggestions.allTime")}
          </button>
        </>
      )}
    </p>
  );
}

const TIMING_ICON: Record<Timing, LucideIcon> = { exante: Crosshair, inTrade: Timer, review: NotebookPen };

/** How sure the card is, as 1–3 ticks instead of a word pill (the tier's label and explanation stay in the tooltip). */
const CONFIDENCE = { confirmed: 3, robust: 3, hypothesis: 2, preliminary: 1, smallSample: 1, weak: 1 } as const;


function SuggestionCard({ s, data, rules, periodLabel, onToggle, onAllTime, onDay }: {
  s: Suggestion; data: SuggestionsResponse; rules: Rule[]; periodLabel: string; onToggle: (s: Suggestion, applied: boolean) => void; onAllTime?: () => void;
  onDay?: (day: string) => void;
}) {
  const { t } = whatIfI18n.useT();
  const applied = isApplied(rules, s.rule);
  const name = chipLabel(s.rule);
  const line = removalLine(s);
  const trades = commonI18n.t("units.trades", { count: line.count });
  const badges = suggestionBadges(s, { smallSample: data.smallSample, team: data.scope == null, honesty: data.honesty });
  const timing = timingOf(s);
  const TimingIcon = TIMING_ICON[timing];
  const need = needLine(s);
  const pill = usePills(s, data);
  return (
    <article
      className={cn(
        "glass-panel flex min-w-0 flex-col gap-2 rounded-2xl p-[var(--panel-p)] transition-shadow duration-[var(--dur-1)]",
        applied && "ring-2 ring-[hsl(var(--primary)/0.55)]",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="inline-flex items-center gap-1 self-start text-2xs text-muted-foreground" title={t(`suggestions.timing.${timing}Hint`)}>
          <TimingIcon className="h-3 w-3" aria-hidden="true" />
          {t(`suggestions.timing.${timing}`)}
        </p>
        <p className="text-sm font-medium leading-snug text-foreground">{ifNotPhrase(s.rule)}</p>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          {/* «разбор» does not promise «+$»: its amount is muted, not green. */}
          <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", timing === "review" ? "text-muted-foreground" : "text-up")}>
            {fmtUsd(s.improvement, { signed: true, decimals: "auto" })}
          </span>
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
        </div>
        {need && <NextStep need={need} onAllTime={onAllTime} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <CardLine s={s} />
        <span aria-hidden="true">·</span>
        <span>{line.kind === "changes" ? t("suggestions.changes", { trades }) : t("suggestions.removes", { trades })}</span>
      </div>
      {s.why && <WhyFold why={s.why} onDay={onDay} />}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {badges.map((b, i) => i === 0 && b in CONFIDENCE
            ? <ConfidenceTicks key={b} level={CONFIDENCE[b as keyof typeof CONFIDENCE]} label={pill[b].label} hint={pill[b].hint} />
            : <Pill key={b} tone={pill[b].tone} title={pill[b].hint}>{pill[b].label}</Pill>)}
        </div>
        <button
          type="button"
          aria-pressed={applied}
          onClick={() => onToggle(s, applied)}
          className={cn(
            "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-[var(--dur-1)]",
            applied
              ? "bg-[hsl(var(--primary)/0.15)] text-primary hover:bg-[hsl(var(--primary)/0.22)]"
              : "bg-primary-solid text-primary-foreground hover:opacity-90",
          )}
          aria-label={applied ? t("suggestions.removeAria", { label: name }) : t("suggestions.applyAria", { label: name })}
        >
          {applied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {applied ? t("suggestions.applied") : t("suggestions.apply")}
        </button>
      </div>
    </article>
  );
}

/** A hypothesis's next step: the days still needed, the «всё время» period (a switch when the page offers one), or a review. */
function NextStep({ need, onAllTime }: { need: NeedLine; onAllTime?: () => void }) {
  const { t } = whatIfI18n.useT();
  if (need.kind === "allTime" && onAllTime) {
    return (
      <button type="button" onClick={onAllTime} title={t("suggestions.needAllTimeHint")} className="self-start text-xs font-medium text-primary underline-offset-2 hover:underline">
        {t("suggestions.needAllTime")}
      </button>
    );
  }
  const [text, hint] = need.kind === "days"
    ? [t(need.atLeast ? "suggestions.needDaysAtLeast" : "suggestions.needDays", { days: commonI18n.t("units.tradingDays", { count: need.days }) }), t("suggestions.needDaysHint")]
    : need.kind === "allTime" ? [t("suggestions.needAllTime"), t("suggestions.needAllTimeHint")] : [t("suggestions.reviewNext"), t("suggestions.reviewNextHint")];
  return <p className="self-start text-xs text-muted-foreground" title={hint}>{text}</p>;
}

/**
 * Out of sample for an honest card («на следующих месяцах … · помогло в k из m»); else the per-rule range — with its
 * 95% bootstrap reading on the fast / team cards, with no probability on an honest-era card (picked on these days).
 */
function CardLine({ s }: { s: Suggestion }) {
  const { t } = whatIfI18n.useT();
  const signed = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  const kind = cardLine(s);
  const oos = kind === "oos" ? s.oos : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground">
          {oos
            ? t("suggestions.oos", { sum: signed(oos.sum), positive: oos.positive, months: oos.months })
            : t("suggestions.range", { lo: signed(s.ci.lo), hi: signed(s.ci.hi) })}
          <Info className="h-3 w-3" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {oos ? t("suggestions.oosHint") : t(kind === "rangeInSample" ? "suggestions.rangeHintInSample" : "suggestions.rangeHint")}
      </TooltipContent>
    </Tooltip>
  );
}

/** Label, tone and tooltip of every pill a card may carry (suggestion-badges picks at most two). */
function usePills(s: Suggestion, data: SuggestionsResponse): Record<BadgeId, { tone: Tone; label: string; hint: string }> {
  const { t } = whatIfI18n.useT();
  const tested = data.tested ?? data.suggestions.length;
  const note = holdoutNote(s);
  const robustHint = t("suggestions.robustHint", { count: tested }) + (note ? ` ${t(`suggestions.${note.key}`, { days: note.days })}` : "");
  const fragileDays = s.fragile?.days ?? 0;
  return {
    confirmed: { tone: "up", label: t("suggestions.status.confirmed"), hint: t("suggestions.status.confirmedHint", { count: tested }) },
    hypothesis: { tone: "warn", label: t("suggestions.status.hypothesis"), hint: t("suggestions.status.hypothesisHint") },
    preliminary: { tone: "neutral", label: t("suggestions.status.preliminary"), hint: t(`suggestions.status.${preliminaryHintKey(data.honesty?.state)}`) },
    smallSample: { tone: "neutral", label: t("suggestions.smallSample"), hint: t("suggestions.smallSampleHint") },
    robust: { tone: "up", label: t("suggestions.robust"), hint: robustHint },
    weak: { tone: "warn", label: t("suggestions.weak"), hint: t("suggestions.weakHint", { count: tested }) },
    fragile: { tone: "neutral", label: t("suggestions.fragile", { count: fragileDays }), hint: t("suggestions.fragileHint") },
    sameData: { tone: "neutral", label: t("suggestions.sameData"), hint: t("suggestions.sameDataHint") },
    perTrader: { tone: "neutral", label: t("suggestions.perTrader"), hint: t("suggestions.perTraderHint") },
  };
}
