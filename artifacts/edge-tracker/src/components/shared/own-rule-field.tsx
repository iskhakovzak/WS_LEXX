import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PICKABLE_MISTAKES, mistakeLabel, type MistakeGroup } from "@/components/shared/mistake-labels";
import { fmtUsd } from "@/lib/format";
import { dailyI18n } from "@/i18n/ns/daily";
import { gpI18n } from "@/i18n/ns/gamePlan";
import type { PlanPrefill } from "./plan-prefill";

/** The suggested own rule (item 1.9): the costliest pattern of two weeks, from GET /api/game-plan/my/prefill. */
export type RuleSuggestionData = NonNullable<PlanPrefill["rule"]>;

/** «Предложено правило дня: Сделки на усталости: −$241 за 2 недели · 40 раз [Принять]» — one tap accepts it. */
export function RuleSuggestion({ rule, accepted, onAccept, label }: { rule: RuleSuggestionData; accepted: boolean; onAccept: () => void; label?: string }) {
  const { t } = gpI18n.useT();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium">{t("suggest.title")}</span>
      <span className="min-w-0 tabular-nums text-muted-foreground [overflow-wrap:anywhere]">
        {t("suggest.line", { rule: mistakeLabel(rule.mistake), cost: fmtUsd(rule.costNet, { decimals: 0 }), times: t("suggest.times", { count: rule.count }) })}
      </span>
      <Button type="button" size="sm" variant={accepted ? "ghost" : "default"} className="ml-auto min-h-10 sm:min-h-8" disabled={accepted} onClick={onAccept}>
        {accepted && <Check aria-hidden="true" />}
        {accepted ? t("suggest.accepted") : (label ?? t("suggest.accept"))}
      </Button>
    </div>
  );
}

const NONE = "__none__";
const GROUPS: { group: Exclude<MistakeGroup, "rule" | "other">; label: () => string }[] = [
  { group: "behavior", label: () => dailyI18n.t("ownRule.groupBehavior") },
  { group: "structure", label: () => dailyI18n.t("ownRule.groupExecution") },
  { group: "day", label: () => dailyI18n.t("ownRule.groupDay") },
];

/**
 * «Не повторяю сегодня» (rule of the day) in the personal plan's risk block: one mistake not to repeat today, checked from the trades like the
 * focus. Prefilled with today's focus (the plan does that when the rule was never chosen); the focus is listed first.
 */
export function OwnRuleField({
  id,
  value,
  onChange,
  focusMistake,
  suggestion,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  /** Today's focus (MistakeId), when the plan is for the focus day. */
  focusMistake?: string | null;
  /** The costliest pattern of two weeks (item 1.9) — offered with one tap when it is not the rule already. */
  suggestion?: RuleSuggestionData | null;
}) {
  const { t } = dailyI18n.useT();
  const known = new Set(PICKABLE_MISTAKES.map((m) => m.id));
  const extra = value && !known.has(value) && value !== focusMistake ? value : null;
  const prefilled = !!value && value === focusMistake;
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-md">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {t("ownRule.label")}
      </label>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id} className="h-9">
          <SelectValue placeholder={t("ownRule.none")} />
        </SelectTrigger>
        <SelectContent>
          {focusMistake && (
            <SelectGroup>
              <SelectLabel>{t("ownRule.groupFocus")}</SelectLabel>
              <SelectItem value={focusMistake}>{mistakeLabel(focusMistake)}</SelectItem>
            </SelectGroup>
          )}
          {GROUPS.map((g) => (
            <SelectGroup key={g.group}>
              <SelectLabel>{g.label()}</SelectLabel>
              {PICKABLE_MISTAKES.filter((m) => m.group === g.group && m.id !== focusMistake).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {mistakeLabel(m.id)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          {extra && (
            <SelectGroup>
              <SelectLabel>{t("ownRule.groupOther")}</SelectLabel>
              <SelectItem value={extra}>{mistakeLabel(extra)}</SelectItem>
            </SelectGroup>
          )}
          <SelectItem value={NONE}>{t("ownRule.none")}</SelectItem>
        </SelectContent>
      </Select>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {prefilled && <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />}
        {prefilled ? t("ownRule.fromFocus") : t("ownRule.hint")}
      </span>
      {suggestion && suggestion.mistake !== value && (
        <RuleSuggestion rule={suggestion} accepted={false} onAccept={() => onChange(suggestion.mistake)} />
      )}
    </div>
  );
}
