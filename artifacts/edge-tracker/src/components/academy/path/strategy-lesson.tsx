/**
 * Lesson card «Три строки стратегии» on the Джун → Трейдер step of «Путь трейдера»: catalyst → setup → trade in three
 * short lines, then the exercise — fill the formula of one of the junior's own playbook setups, right here. The lesson
 * is done when a formula with all three lines is saved (read from the setups themselves, nothing extra is stored).
 * A mentor looking at a junior's path sees whether it is done.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Workflow } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { strategyI18n } from "@/i18n/ns/strategy";
import { ownSetupsQuery, type OwnSetup } from "@/components/shared/strategy/api";
import { StrategyFormulaCard } from "@/components/shared/strategy/formula-card";
import { isCompleteFormula, isEmptyFormula } from "@/components/shared/strategy/model";

const STEPS = ["catalyst", "setup", "trade"] as const;

/** Prefill: a setup that already has part of a formula, else the newest top-level setup without one, else the newest. */
function defaultPick(list: readonly OwnSetup[]): number | null {
  const partial = list.find((s) => !isEmptyFormula(s.formula) && !isCompleteFormula(s.formula));
  const blank = list.find((s) => s.parentId == null && isEmptyFormula(s.formula));
  return (partial ?? blank ?? list[0])?.id ?? null;
}

export function StrategyLinesLesson({ user, isSelf }: { user: string; isSelf: boolean }) {
  const { t } = strategyI18n.useT();
  const q = useQuery(ownSetupsQuery(user, isSelf));
  const setups = React.useMemo(() => q.data ?? [], [q.data]);
  const done = setups.find((s) => isCompleteFormula(s.formula)) ?? null;
  const [picked, setPicked] = React.useState<number | null>(null);
  const pickId = picked ?? defaultPick(setups);
  const pick = setups.find((s) => s.id === pickId) ?? null;

  const intro = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">{t("lesson.intro")}</p>
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((k, i) => (
          <li key={k} className="relative rounded-xl bg-[var(--glass-bg)] px-3 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground">{i + 1}. {t(`formula.line.${k}`)}</p>
            <p className="mt-0.5 text-sm text-foreground">{t(`lesson.steps.${k}`)}</p>
            {i < STEPS.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground sm:block" aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">{t("lesson.example")}</p>
    </div>
  );

  return (
    <Panel
      title={<span className="flex items-center gap-2">{t("lesson.title")}<Pill tone={done ? "up" : "accent"} dot>{t("lesson.badge")}</Pill></span>}
      icon={Workflow}
    >
      <div className="flex flex-col gap-4">
        {done && (
          <p className="flex items-center gap-2 text-sm font-medium text-up" role="status">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {isSelf ? t("lesson.done", { setup: done.name }) : t("lesson.staffDone", { setup: done.name })}
          </p>
        )}
        {/* Closure: once done the lesson folds away; the result stays in view. */}
        {done ? <details><summary className="cursor-pointer text-xs text-muted-foreground">{t("lesson.title")}</summary><div className="mt-3">{intro}</div></details> : intro}

        {!isSelf ? (
          !done && <p className="text-sm text-muted-foreground">{t("lesson.staffNotDone")}</p>
        ) : q.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : setups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("lesson.noSetups")}{" "}
            <Link href="/playbook" className="font-medium text-primary hover:underline">{t("lesson.openPlaybook")}</Link>
          </p>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--field-border)] p-3">
            <p className="text-sm font-medium text-foreground">{t("lesson.exercise")}</p>
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("lesson.pick")}
              <Select value={pickId != null ? String(pickId) : undefined} onValueChange={(v) => setPicked(Number(v))}>
                <SelectTrigger className="h-8 w-auto min-w-48 text-sm" aria-label={t("lesson.pickAria")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {setups.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {pick && <StrategyFormulaCard key={pick.id} setupId={pick.id} formula={pick.formula} canEdit title={false} />}
            {!done && <p className="text-xs text-muted-foreground">{t("lesson.notDone")}</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}
