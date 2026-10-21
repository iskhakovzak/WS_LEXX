import { useState } from "react";
import { Check, ChevronDown, Info, Lightbulb, Plus } from "lucide-react";
import { EmptyState, Pill, type Tone } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { Suggestion, SuggestionsResponse } from "./api";
import { type Rule, chipLabel, ifNotPhrase, isApplied } from "./rules";
import { type BadgeId, VISIBLE_CARDS, holdoutNote, removalLine, suggestionBadges, visibleCards } from "./suggestion-badges";

/**
 * «Что ещё дало бы больше всего»: the best single rules found by the server search, as cards
 * «Если бы ты не … → +$Y за период [интервал]» — the first 5, the rest behind «Ещё N». Each card carries at most two
 * pills (how much to trust it, and one qualifier). «Применить» adds the rule to the scenario, a second click (or ✕ on
 * its chip) takes it back out.
 */
export function SuggestionCards({
  data,
  isLoading,
  rules,
  periodLabel,
  onToggle,
}: {
  data: SuggestionsResponse | undefined;
  isLoading: boolean;
  rules: Rule[];
  periodLabel: string;
  onToggle: (s: Suggestion, applied: boolean) => void;
}) {
  const { t } = whatIfI18n.useT();
  const [expanded, setExpanded] = useState(false);
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[168px] rounded-2xl" />)}
        <span className="sr-only" role="status">{t("suggestions.searching")}</span>
      </div>
    );
  }
  if (!data.suggestions.length) {
    return (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          compact
          icon={Lightbulb}
          title={t("suggestions.emptyTitle")}
          description={t("suggestions.emptyHint")}
        />
      </div>
    );
  }
  const { shown, hidden } = visibleCards(data.suggestions, expanded);
  const canToggle = data.suggestions.length > VISIBLE_CARDS;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]">
        {shown.map((s) => (
          <SuggestionCard key={JSON.stringify(s.rule)} s={s} data={data} rules={rules} periodLabel={periodLabel} onToggle={onToggle} />
        ))}
      </div>
      {canToggle && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-8 items-center gap-1 self-start rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors duration-[var(--dur-1)] hover:bg-[var(--glass-hover-bg)] hover:text-foreground"
        >
          {expanded ? t("suggestions.less") : t("suggestions.more", { count: hidden })}
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SuggestionCard({ s, data, rules, periodLabel, onToggle }: { s: Suggestion; data: SuggestionsResponse; rules: Rule[]; periodLabel: string; onToggle: (s: Suggestion, applied: boolean) => void }) {
  const { t } = whatIfI18n.useT();
  const applied = isApplied(rules, s.rule);
  const name = chipLabel(s.rule);
  const line = removalLine(s);
  const trades = commonI18n.t("units.trades", { count: line.count });
  const badges = suggestionBadges(s, { smallSample: data.smallSample, team: data.scope == null });
  const tested = data.tested ?? data.suggestions.length;
  const note = holdoutNote(s);
  const robustHint = t("suggestions.robustHint", { count: tested }) + (note ? ` ${t(`suggestions.${note.key}`, { days: note.days })}` : "");
  const pill: Record<BadgeId, { tone: Tone; label: string; hint: string }> = {
    smallSample: { tone: "neutral", label: t("suggestions.smallSample"), hint: t("suggestions.smallSampleHint") },
    robust: { tone: "up", label: t("suggestions.robust"), hint: robustHint },
    weak: { tone: "warn", label: t("suggestions.weak"), hint: t("suggestions.weakHint", { count: tested }) },
    sameData: { tone: "neutral", label: t("suggestions.sameData"), hint: t("suggestions.sameDataHint") },
    label: { tone: "neutral", label: t("suggestions.label"), hint: t("suggestions.labelHint") },
    perTrader: { tone: "neutral", label: t("suggestions.perTrader"), hint: t("suggestions.perTraderHint") },
  };
  return (
    <article
      className={cn(
        "glass-panel flex min-w-0 flex-col gap-2 rounded-2xl p-[var(--panel-p)] transition-shadow duration-[var(--dur-1)]",
        applied && "ring-2 ring-[hsl(var(--primary)/0.55)]",
      )}
    >
      <p className="text-sm font-medium leading-snug text-foreground">{ifNotPhrase(s.rule)}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-up">{fmtUsd(s.improvement, { signed: true, decimals: "auto" })}</span>
        <span className="text-xs text-muted-foreground">{periodLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground">
              {t("suggestions.range", { lo: fmtUsd(s.ci.lo, { signed: true, decimals: "auto" }), hi: fmtUsd(s.ci.hi, { signed: true, decimals: "auto" }) })}
              <Info className="h-3 w-3" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {t("suggestions.rangeHint")}
          </TooltipContent>
        </Tooltip>
        <span aria-hidden="true">·</span>
        <span>{line.kind === "changes" ? t("suggestions.changes", { trades }) : t("suggestions.removes", { trades })}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {badges.map((b) => <Pill key={b} tone={pill[b].tone} title={pill[b].hint}>{pill[b].label}</Pill>)}
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
