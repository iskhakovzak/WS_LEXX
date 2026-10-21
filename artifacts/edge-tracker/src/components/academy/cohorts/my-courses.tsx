/**
 * /academy/my — the learning part of «Моё обучение»: the courses card next to the cohort, and the not-enrolled state
 * (wave 1, item 1.6). A trader without a cohort is not a dead end: the focal point is «Следующий урок» from the same
 * progress model as /academy/learn (my-model.ts nextStepOf); the cohort note is secondary.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { BookOpenCheck, PlayCircle, Users } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { usePrograms } from "@/components/academy/content/api";
import { PctBar, RuContentPill } from "@/components/academy/content/bits";
import { academyLinks } from "@/components/academy/content/links";
import { academyCohortsI18n } from "@/i18n/ns/academyCohorts";
import { personName } from "@/i18n";
import { nextStepOf } from "./my-model";

const Skeleton = () => (
  <div className="flex flex-col gap-2" aria-busy="true"><span className="skeleton block h-4 w-2/3" /><span className="skeleton block h-1.5 w-full" /><span className="skeleton block h-8 w-48" /></div>
);

/** Курсы рядом с когортой: прогресс программы и «Продолжить» — без похода в «Обучение» за следующим уроком. */
export function CoursesCard({ user }: { user?: string }) {
  const { t } = academyCohortsI18n.useT();
  const q = usePrograms(user);
  const step = nextStepOf(q.data?.programs ?? []);
  const p = step?.program;
  return (
    <Panel title={t("myPage.courses.title")} icon={BookOpenCheck}
      actions={<Link href={academyLinks.learn({ program: p?.id, user })} className="text-xs font-medium text-primary hover:underline">{t("myPage.courses.all")}</Link>}>
      {q.isLoading ? <Skeleton /> : q.isError ? (
        <p className="text-sm text-muted-foreground">{t("myPage.courses.failed")}</p>
      ) : !step || !p ? (
        <p className="text-sm text-muted-foreground">{t("myPage.courses.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground" title={p.title}>{p.title}</span>
              <RuContentPill scope="course" />
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("myPage.courses.progress", { done: p.progress.done, total: p.progress.total, pct: Math.round(p.progress.pct) })}</span>
          </div>
          <PctBar pct={p.progress.pct} label={t("myPage.courses.progressAria", { title: p.title })} />
          {step.next ? (
            <Button size="sm" className="mt-1 self-start" asChild>
              <Link href={academyLinks.item(step.next.kind, step.next.id, { user })}>
                <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                {(() => {
                  const label = step.mode === "continue" ? t("myPage.courses.continue", { title: step.next.title }) : t("myPage.courses.start", { title: step.next.title });
                  return <span className="max-w-[22rem] truncate" title={label}>{label}</span>;
                })()}
              </Link>
            </Button>
          ) : (
            <Pill tone="up" dot>{t("myPage.courses.completed")}</Pill>
          )}
        </div>
      )}
    </Panel>
  );
}

/** «Следующий урок» — one big action: the next item of the first unfinished course. */
function NextLessonCard({ user }: { user?: string }) {
  const { t } = academyCohortsI18n.useT();
  const q = usePrograms(user);
  const step = nextStepOf(q.data?.programs ?? []);
  return (
    <Panel title={t("myPage.nextLesson.title")} icon={PlayCircle}
      actions={step && step.others > 0 ? (
        <Link href={academyLinks.learn({ user })} className="text-xs font-medium text-primary hover:underline">{t("myPage.nextLesson.allCourses", { count: step.others + 1 })}</Link>
      ) : undefined}>
      {q.isLoading ? <Skeleton /> : q.isError ? (
        <p className="text-sm text-muted-foreground">{t("myPage.courses.failed")}</p>
      ) : !step ? (
        <p className="text-sm text-muted-foreground">{t("myPage.courses.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {step.next ? (
            <p className="text-lg font-semibold leading-snug text-foreground">{step.next.title}</p>
          ) : (
            <Pill tone="up" dot>{t("myPage.courses.completed")}</Pill>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate" title={step.program.title}>
                {t("myPage.nextLesson.course", { title: step.program.title, done: step.program.progress.done, total: step.program.progress.total })}
              </span>
              <RuContentPill />
            </span>
            <PctBar pct={step.program.progress.pct} label={t("myPage.courses.progressAria", { title: step.program.title })} />
          </div>
          {step.next && (
            <Button className="self-start" asChild>
              <Link href={academyLinks.item(step.next.kind, step.next.id, { user })}>
                <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                {step.mode === "continue" ? t("myPage.nextLesson.continue") : t("myPage.nextLesson.start")}
              </Link>
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Not in a cohort yet: «Следующий урок» first (lessons are open without a cohort), the cohort note second.
 * `children` — extra actions under the note (e.g. a request to join a group).
 */
export function NotEnrolledPanel({ user, viewingOther, children }: { user: string; viewingOther: boolean; children?: ReactNode }) {
  const { t } = academyCohortsI18n.useT();
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <NextLessonCard user={viewingOther ? user : undefined} />
      <Panel title={viewingOther ? t("myPage.notEnrolledOther", { name: personName(user) }) : t("myPage.notEnrolled")} icon={Users}>
        <p className="text-sm text-muted-foreground">{t("myPage.notEnrolledDesc")}</p>
        {children}
      </Panel>
    </div>
  );
}
