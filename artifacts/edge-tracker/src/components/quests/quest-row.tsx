import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, CheckCircle2, Circle, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDayMonth } from "@/lib/format";
import { personName } from "@/i18n";
import { questsI18n } from "@/i18n/ns/quests";
import type { Quest } from "@/lib/quests/types";
import { daysLeft, isOptionalStep, questDescription, questPct, questTitle } from "./model";
import { TaskDoneButton } from "@/components/shared/curator-task-done";

/**
 * «Перейти» to the page the viewer is already on is a dead link (e.g. the focus quest → the dashboard). A link with its
 * own query («/?review=1» opens the day card) still does something, so only an exact match counts.
 */
export function useIsHere(): (href: string | null | undefined) => boolean {
  const [location] = useLocation();
  const search = useSearch();
  const here = search ? `${location}?${search}` : location;
  return (href) => !!href && href.split("#")[0] === here;
}

/** «до 24 окт · осталось 3 дня» / «до конца дня»; nothing without a deadline. */
function Deadline({ q, today }: { q: Quest; today: string }) {
  const { t } = questsI18n.useT();
  if (!q.endsOn) return null;
  const left = daysLeft(q.endsOn, today);
  if (left <= 0) return <span className={cn(left === 0 && "font-medium text-warn")}>{left === 0 ? t("row.untilToday") : t("row.until", { date: fmtDate(q.endsOn, "dayMonth") })}</span>;
  return (
    <span className={cn(left <= 1 && "text-warn")}>
      {t("row.until", { date: fmtDate(q.endsOn, "dayMonth") })} · {t("row.daysLeft", { count: left })}
    </span>
  );
}

export function QuestStatusIcon({ q }: { q: Pick<Quest, "status"> }) {
  if (q.status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-up" aria-hidden="true" />;
  if (q.status === "active") return <Circle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
  return <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Progress bar with «2 из 5» (the bar is decorative; the text carries the value). */
export function QuestProgress({ q, className }: { q: Pick<Quest, "progress" | "target" | "status">; className?: string }) {
  const { t } = questsI18n.useT();
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <span className={cn("block h-full rounded-full", q.status === "done" ? "bg-up" : q.status === "active" ? "bg-primary" : "bg-muted-foreground/50")} style={{ width: `${questPct(q)}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("row.progress", { progress: Math.min(q.progress, q.target), target: q.target })}</span>
    </span>
  );
}

/**
 * One quest: status, title, deadline / assigner / note, progress, reward and «Перейти» (the place to make progress).
 * `compact` — the dashboard strip (no description); `action` — e.g. the curator's «Отменить»; `links` — off for staff
 * (the trader's own pages).
 */
export function QuestRow({ q, today, compact = false, action, showStatus = false, links = true, highlight = false }: { q: Quest; today: string; compact?: boolean; action?: ReactNode; showStatus?: boolean; links?: boolean; highlight?: boolean }) {
  const { t } = questsI18n.useT();
  const isHere = useIsHere();
  const title = questTitle(q);
  const desc = compact ? "" : questDescription(q);
  const active = q.status === "active";
  const meta = [
    isOptionalStep(q) ? t("strip.optional") : null,
    q.assignedBy ? t("row.from", { name: personName(q.assignedBy) }) : null,
    showStatus && !active ? (q.cancelled ? t("status.cancelled") : t(`status.${q.status}`)) : null,
    q.status === "done" && q.completedAt ? t("row.doneOn", { date: fmtDayMonth(q.completedAt.slice(0, 10)) }) : null,
  ].filter(Boolean) as string[];
  return (
    <li id={`quest-${q.id}`} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl", compact ? "py-1.5" : "tile px-3 py-2.5", highlight && "ring-2 ring-primary")}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5"><QuestStatusIcon q={q} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-sm font-medium leading-snug", active || q.status === "done" ? "text-foreground" : "text-muted-foreground")}>{title}</span>
          {desc && <span className="text-xs leading-snug text-muted-foreground">{desc}</span>}
          {(meta.length > 0 || (active && q.endsOn)) && (
            <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {active && <Deadline q={q} today={today} />}
              {meta.map((m) => <span key={m}>{m}</span>)}
            </span>
          )}
          {q.note && (!compact || q.template === "curator_task") && <span className="border-l-2 border-[var(--glass-border)] pl-2 text-xs italic text-muted-foreground">{q.note}</span>}
        </div>
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", q.status === "done" ? "text-up" : "text-muted-foreground")}>{t("row.reward", { points: q.rewardPoints })}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-6">
        <QuestProgress q={q} className="flex-1" />
        {links && active && q.href && !isHere(q.href) && (
          <Link href={q.href} className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("row.go")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        {/* 2.13: the trader's own curator task — «Готово» tells the curator (staff views pass links={false}). */}
        {links && !compact && q.template === "curator_task" && <TaskDoneButton q={q} />}
        {action}
      </div>
    </li>
  );
}
