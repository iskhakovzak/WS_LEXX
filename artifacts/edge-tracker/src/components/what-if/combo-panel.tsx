import { Check, Layers, Plus, TriangleAlert } from "lucide-react";
import { EmptyState, Panel, Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUsd } from "@/lib/format";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { ComboEval, CombosResponse } from "./api";
import { type Rule, chipLabel, isApplied } from "./rules";

/** Distinct rule types of the scenario, at most 3 (the own set the server checks; fewer than 2 = no set). */
export function ownSet(rules: Rule[]): Rule[] {
  const seen = new Set<string>();
  return rules.filter((r) => r.type !== "commissionPlan" && !seen.has(r.type) && seen.add(r.type)).slice(0, 3);
}

/** Every rule of the set is already in the scenario. */
export const setApplied = (rules: Rule[], set: Rule[]) => set.every((r) => isApplied(rules, r));

/**
 * «Набор правил»: up to 3 rules together. The search's best sets (blocks picked on the earlier days, every pair and
 * triple built, ONE correction over everything tried — the count is said in the note) and the trader's own set from
 * the scenario; per set: the joint Δ against the sum of the singles, what each rule adds, the overlap warning and the
 * honest status («Устойчиво» / «Гипотеза»).
 */
export function ComboPanel({ data, isLoading, rules, onApply }: { data: CombosResponse | undefined; isLoading: boolean; rules: Rule[]; onApply: (set: Rule[]) => void }) {
  const { t } = whatIfI18n.useT();
  const own = ownSet(rules);
  return (
    <Panel title={t("combo.title")} icon={Layers} description={t("combo.hint")}>
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {data.holdout ? t("combo.searched", { sets: data.searched, singles: data.singles, family: data.family }) : t("combo.fewDays")}
          </p>
          {data.combos.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
              {data.combos.map((c) => <ComboCard key={c.labels.join("|")} c={c} family={data.family} applied={setApplied(rules, c.rules)} onApply={() => onApply(c.rules)} />)}
            </div>
          ) : (
            <EmptyState compact icon={Layers} title={t("combo.noneTitle")} description={t("combo.none")} />
          )}
          <div className="border-t border-[var(--glass-border)] pt-3">
            <p className="mb-2 text-sm font-semibold">{t("combo.own")}</p>
            {own.length < 2 ? (
              <p className="text-xs text-muted-foreground">{t("combo.ownNeed")}</p>
            ) : data.own ? (
              <div className="max-w-xl"><ComboCard c={data.own} family={data.family} applied own onApply={() => undefined} /></div>
            ) : (
              <Skeleton className="h-32 max-w-xl rounded-2xl" />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ComboCard({ c, family, applied, own = false, onApply }: { c: ComboEval; family: number; applied: boolean; own?: boolean; onApply: () => void }) {
  const { t } = whatIfI18n.useT();
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  const status = !c.gates ? "weak" : c.robust ? "robust" : "hypothesis";
  return (
    <article className={cn("glass-panel flex min-w-0 flex-col gap-2 rounded-2xl p-[var(--panel-p)]", applied && !own && "ring-2 ring-[hsl(var(--primary)/0.55)]")}>
      <ul className="flex flex-wrap gap-1">
        {c.rules.map((r, i) => (
          <li key={r.type} className="chip min-h-7 px-2.5 text-xs" title={t("combo.marginal", { amount: usd(c.marginal[i] ?? 0) })}>
            {chipLabel(r)} <span className={cn("ml-1 tabular-nums", (c.marginal[i] ?? 0) > 0 ? "text-up" : "text-down")}>{usd(c.marginal[i] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", c.delta > 0 ? "text-up" : c.delta < 0 ? "text-down" : "text-muted-foreground")}>{usd(c.delta)}</span>
        <span className="text-xs text-muted-foreground">{t("combo.sum", { amount: usd(c.sumSingles) })}</span>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{t("combo.range", { lo: usd(c.ci.lo), hi: usd(c.ci.hi) })}</p>
      {c.warning && (
        <p className="flex items-start gap-1 text-xs text-[hsl(var(--warn))]">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {t(`combo.warn.${c.warning}`, { overlap: Math.round(c.overlap * 100) })}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <Pill tone={status === "robust" ? "up" : status === "hypothesis" ? "warn" : "neutral"} title={t(`combo.status.${status}Hint`, { count: family })}>{t(`combo.status.${status}`)}</Pill>
        {!own && (
          <button
            type="button"
            onClick={onApply}
            disabled={applied}
            className={cn("inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-[var(--dur-1)]",
              applied ? "bg-[hsl(var(--primary)/0.15)] text-primary" : "bg-primary-solid text-primary-foreground hover:opacity-90")}
          >
            {applied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {applied ? t("combo.applied") : t("combo.apply")}
          </button>
        )}
      </div>
    </article>
  );
}
