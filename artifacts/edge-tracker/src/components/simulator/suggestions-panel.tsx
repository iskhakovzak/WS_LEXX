import { Check, Info, Lightbulb, Plus } from "lucide-react";
import { EmptyState, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtUsd, sdeal } from "@/components/analytics-page/metrics";
import { cn } from "@/lib/utils";
import type { Suggestion, SuggestionsResponse } from "./api";
import { type Rule, ifNotPhrase, isApplied } from "./rules";

/**
 * Top of the simulator: the 3–5 best single rules found by the server grid search, as cards
 * «Если бы ты не … → +$Y за период [интервал]». «Применить» adds the rule to the scenario, a second
 * click (or ✕ on its chip) takes it back out.
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
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[168px] rounded-2xl" />)}
        <span className="sr-only" role="status">Ищем правила, которые дали бы больше всего…</span>
      </div>
    );
  }
  if (!data.suggestions.length) {
    return (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          compact
          icon={Lightbulb}
          title="Нет простого «если бы», которое заметно помогло бы"
          description="Ни одно правило не улучшило результат за период. Попробуй период длиннее или собери свой сценарий ниже."
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-[var(--grid-gap)]">
      {data.suggestions.slice(0, 5).map((s, i) => {
        const applied = isApplied(rules, s.rule);
        const weak = s.robust === false;
        return (
          <article
            key={i}
            className={cn(
              "glass-panel flex min-w-0 flex-col gap-2 rounded-2xl p-[var(--panel-p)] transition-shadow duration-[var(--dur-1)]",
              applied && "ring-2 ring-[hsl(var(--primary)/0.55)]",
            )}
          >
            <p className="text-sm font-medium leading-snug text-foreground">{ifNotPhrase(s.rule)}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-up">{fmtUsd(s.improvement)}</span>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground">
                    от {fmtUsd(s.ci.lo)} до {fmtUsd(s.ci.hi)}
                    <Info className="h-3 w-3" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Диапазон, в который с вероятностью 95% попадает эффект, если перемешать торговые дни (бутстреп). Если нижняя граница выше нуля — это устойчивый результат, а не случайность.
                </TooltipContent>
              </Tooltip>
              <span aria-hidden="true">·</span>
              <span>убирает {sdeal(s.excluded)}</span>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              {weak ? (
                <Pill tone="warn" title="Диапазон эффекта захватывает ноль: может быть случайностью">слабый сигнал</Pill>
              ) : (
                <Pill tone="up" title="Нижняя граница диапазона выше нуля">устойчиво</Pill>
              )}
              <button
                type="button"
                aria-pressed={applied}
                onClick={() => onToggle(s, applied)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-[var(--dur-1)]",
                  applied
                    ? "bg-[hsl(var(--primary)/0.15)] text-primary hover:bg-[hsl(var(--primary)/0.22)]"
                    : "bg-primary-solid text-primary-foreground hover:opacity-90",
                )}
                aria-label={applied ? `Убрать из сценария: ${s.label}` : `Применить: ${s.label}`}
              >
                {applied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                {applied ? "Применено" : "Применить"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
