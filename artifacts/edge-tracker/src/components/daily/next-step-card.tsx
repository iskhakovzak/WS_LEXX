/**
 * The phone dashboard's ONE focal point (Волна 1, item 1.3): «Следующий шаг» at the top — the day line and «Что важно
 * сейчас» merged by the phase of the day (next-step-model.ts): before the open «Напиши план», during the session the
 * contract + focus, after the close «Закрой день», then «Задача дня ждёт» (item 1.8). P&L and the limit card follow
 * below it (dashboard.tsx). Desktop keeps the header day line — this card is `md:hidden` there.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, ClipboardCheck, Gamepad2, NotebookPen, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";
import { trainerDailyQuery as dailyQuery } from "@/lib/api/queries";
import { contractDate, contractLine, dayView } from "./daily-model";
import { ContractLine } from "./contract-line";
import { FocusLine, dayShort } from "./focus-line";
import { useDailyMe, useTodayContract } from "./use-daily";
import { commonI18n } from "@/i18n/ns/common";
import { dashboardI18n } from "@/i18n/ns/dashboard";
import { nextStep, type NextStep } from "./next-step-model";

const ICON: Record<NextStep["kind"], LucideIcon> = {
  plan: NotebookPen,
  contract: ShieldCheck,
  close: ClipboardCheck,
  task: Gamepad2,
  done: CheckCircle2,
};

function StepButton({ href, label, primary = true }: { href: string; label: string; primary?: boolean }) {
  return (
    <Button asChild variant={primary ? "default" : "outline"} className="min-h-11 w-full sm:w-auto">
      <Link href={href}>
        {label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

export function NextStepCard({ enabled, journalOpenDate, className }: { enabled: boolean; journalOpenDate?: string | null; className?: string }) {
  const { t } = dashboardI18n.useT();
  const meQ = useDailyMe(enabled);
  const me = meQ.data ?? null;
  const session = me ? contractDate(me) : null;
  const planQ = useTodayContract(session, enabled && !!me);
  const late = me?.phase === "afterclose" || me?.phase === "weekend";
  const dailyQ = useQuery({ ...dailyQuery(), enabled: enabled && late, retry: false });
  if (!enabled) return null;
  if (meQ.isLoading) {
    return (
      <div className={cn("glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]", className)} aria-hidden="true">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-5 w-2/3 rounded" />
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
    );
  }
  const plan = planQ.isLoading ? undefined : (planQ.data ?? null);
  const step = nextStep({ me, plan, journalOpenDate, daily: dailyQ.data ?? null });
  if (!me || !step) return null;
  const Icon = ICON[step.kind];
  const view = dayView(me);
  const today = step.date === me.today;

  let title: string;
  let hint: string | null = null;
  let body: ReactNode = null;
  let cta: ReactNode = null;
  switch (step.kind) {
    case "plan":
      title = today ? t("step.plan.titleToday") : t("step.plan.titleOn", { date: dayShort(step.date) });
      hint = t("step.plan.hint");
      body = view?.focus ? <FocusLine focus={view.focus} compact /> : null;
      cta = step.href && <StepButton href={step.href} label={t("step.plan.cta")} />;
      break;
    case "contract":
      title = t("step.contract.title");
      body = (
        <div className="flex min-w-0 flex-col gap-2.5">
          {view?.focus && <FocusLine focus={view.focus} compact />}
          <ContractLine line={contractLine(plan, view?.focus)} date={step.date} intraday={me.intraday} />
        </div>
      );
      cta = step.href && <StepButton href={step.href} label={t("step.contract.cta")} primary={false} />;
      break;
    case "close":
      title = t("step.close.title", { date: dayShort(step.date) });
      hint = [
        step.trades ? commonI18n.t("units.trades", { count: step.trades }) : null,
        step.netPnl != null ? fmtUsd(step.netPnl, { signed: true }) : null,
      ].filter(Boolean).join(" · ") || t("step.close.hint");
      cta = step.href && <StepButton href={step.href} label={t("step.close.cta")} />;
      break;
    case "task":
      title = t("step.task.title");
      hint = t("step.task.hint");
      cta = step.href && <StepButton href={step.href} label={t("step.task.cta")} />;
      break;
    case "done":
      title = t("step.done.title", { date: dayShort(step.date) });
      hint = t("step.done.hint");
      break;
  }

  return (
    <section aria-label={t("step.aria")} className={cn("glass-panel flex flex-col gap-3 rounded-2xl p-[var(--panel-p)]", className)}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", step.kind === "done" ? "bg-up/15 text-up" : "bg-primary/15 text-primary")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="micro-label">{t("attention.nextStep")}</div>
          <h2 className="text-base font-semibold leading-6 [overflow-wrap:anywhere]">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{hint}</p>}
        </div>
      </div>
      {body}
      {cta}
    </section>
  );
}
