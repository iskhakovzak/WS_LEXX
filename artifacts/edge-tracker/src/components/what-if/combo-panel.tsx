import { Check, Layers, Plus, TriangleAlert } from "lucide-react";
import { EmptyState, Panel } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUsd } from "@/lib/format";
import { whatIfI18n } from "@/i18n/ns/whatIf";
import { cn } from "@/lib/utils";
import type { ComboEval, CombosResponse } from "./api";
import { type Rule, chipLabel, isApplied } from "./rules";
import { ConfidenceTicks } from "./confidence-ticks";

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

const COMBO_CONFIDENCE = { robust: 3, hypothesis: 2, weak: 1 } as const;

/**
 * One set: what each rule adds (a row per rule with its share of the set as a thin bar), the set's joint Δ as the
 * headline with «вместе», the sum of the singles and the interval underneath, the overlap warning as a note, and the
 * confidence ticks next to «Применить набор» (which drops under them on a narrow card).
 */
function ComboCard({ c, family, applied, own = false, onApply }: { c: ComboEval; family: number; applied: boolean; own?: boolean; onApply: () => void }) {
  const { t } = whatIfI18n.useT();
  const usd = (v: number) => fmtUsd(v, { signed: true, decimals: "auto" });
  const status = !c.gates ? "weak" : c.robust ? "robust" : "hypothesis";
  const maxAbs = Math.max(1, ...c.rules.map((_, i) => Math.abs(c.marginal[i] ?? 0)));
  return (
    <article className={cn("glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-[var(--panel-p)]", applied && !own && "ring-2 ring-[hsl(var(--primary)/0.55)]")}>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-2xl font-semibold leading-none tabular-nums tracking-tight", c.delta > 0 ? "text-up" : c.delta < 0 ? "text-down" : "text-muted-foreground")}>{usd(c.delta)}</span>
          <span className="text-xs text-muted-foreground">{t("combo.together")}</span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground tabular-nums">
          {t("combo.sum", { amount: usd(c.sumSingles) })} · {t("combo.range", { lo: usd(c.ci.lo), hi: usd(c.ci.hi) })}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-2xs text-muted-foreground">{t("combo.contrib")}</p>
        <ul className="flex flex-col gap-1.5">
          {c.rules.map((r, i) => {
            const m = c.marginal[i] ?? 0;
            return (
              <li key={r.type} className="flex flex-col gap-1" title={t("combo.marginal", { amount: usd(m) })}>
                <div className="flex items-baseline justify-between gap-3 text-sm leading-snug">
                  <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{chipLabel(r)}</span>
                  <span className={cn("shrink-0 tabular-nums font-medium", m > 0 ? "text-up" : m < 0 ? "text-down" : "text-muted-foreground")}>{usd(m)}</span>
                </div>
                <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-[hsl(var(--foreground)/0.08)]">
                  <span className={cn("block h-full rounded-full", m >= 0 ? "bg-[hsl(var(--up)/0.7)]" : "bg-[hsl(var(--down)/0.7)]")} style={{ width: `${Math.max(4, (Math.abs(m) / maxAbs) * 100)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {c.warning && (
        <p className="flex items-start gap-1.5 rounded-xl bg-[hsl(var(--warn)/0.1)] px-2.5 py-2 text-xs leading-snug text-[hsl(var(--warn))]">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t(`combo.warn.${c.warning}`, { overlap: Math.round(c.overlap * 100) })}</span>
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <ConfidenceTicks level={COMBO_CONFIDENCE[status]} label={t(`combo.status.${status}`)} hint={t(`combo.status.${status}Hint`, { count: family })} />
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
