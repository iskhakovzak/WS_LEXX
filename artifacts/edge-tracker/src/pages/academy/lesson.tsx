import { useEffect, useMemo, useRef } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Circle, Clock, Eye, Layers, Loader2, PencilRuler } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Page, PageHeader, Panel, Pill } from "@/components/ds";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import {
  ApiError, KIND_LABEL, api, useAcademyMeta, useAcademyMutation, useAssignment, useLesson, useQuiz,
  type ItemKind, type Nav,
} from "@/components/academy/content/api";
import { Markdown } from "@/components/academy/content/markdown";
import { outlineOf, parseMarkdown, readingMinutes } from "@/components/academy/content/markdown-parse";
import { AttachmentList, KindIcon, VideoPlayer } from "@/components/academy/content/bits";
import { QuizRunner } from "@/components/academy/content/quiz-runner";
import { AssignmentPanel } from "@/components/academy/content/assignment-panel";
import { academyLinks } from "@/components/academy/content/links";
import { DualTime } from "@/components/academy/content/time";

/**
 * /academy/lesson — один элемент программы: ?id=<урок> | ?quiz=<тест> | ?assignment=<задание>
 * (&submission=<сдача> подсвечивает сдачу из уведомления, &user=<ученик> — staff смотрит глазами ученика).
 * Слева — оглавление программы (nav.outline), снизу — «назад / дальше».
 */

function useTarget(): { kind: ItemKind; id: number } | null {
  const search = useSearch();
  return useMemo(() => {
    const p = new URLSearchParams(search);
    for (const [kind, key] of [["lesson", "id"], ["quiz", "quiz"], ["assignment", "assignment"]] as const) {
      const n = Number(p.get(key));
      if (Number.isInteger(n) && n > 0) return { kind, id: n };
    }
    return null;
  }, [search]);
}

export default function AcademyLesson() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const target = useTarget();
  const { isCurator } = useAuth();
  const meta = useAcademyMeta();
  const staff = isCurator || !!meta.data?.staff;
  const viewUser = staff ? params.get("user") ?? undefined : undefined;
  const submission = Number(params.get("submission")) || null;

  if (!target) {
    return (
      <Page>
        <Panel>
          <EmptyState icon={BookOpen} title="Материал не выбран" description="Откройте урок, тест или задание из программы." action={<Button asChild><Link href={academyLinks.learn()}>К курсам</Link></Button>} />
        </Panel>
      </Page>
    );
  }
  return (
    <Page>
      {target.kind === "lesson" && <LessonView id={target.id} user={viewUser} staff={staff} />}
      {target.kind === "quiz" && <QuizView id={target.id} user={viewUser} staff={staff} />}
      {target.kind === "assignment" && <AssignmentView id={target.id} user={viewUser} staff={staff} focus={submission} />}
    </Page>
  );
}

/* ─── shared chrome ─────────────────────────────────────────────────────── */

function LoadState({ error }: { error: unknown }) {
  if (!error) return <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-[28rem] rounded-2xl" /></div>;
  const status = error instanceof ApiError ? error.status : 0;
  return (
    <Panel>
      <EmptyState
        icon={BookOpen}
        title={status === 404 ? "Материал не найден" : "Не удалось загрузить материал"}
        description={status === 404 ? "Он мог быть перемещён в архив или ещё не опубликован." : (error as Error).message}
        action={<Button asChild><Link href={academyLinks.learn()}>К курсам</Link></Button>}
      />
    </Panel>
  );
}

function OutlineNav({ nav, current, user }: { nav: Nav; current: { kind: ItemKind; id: number }; user?: string }) {
  return (
    <nav aria-label="Содержание программы" className="glass-panel sticky top-[var(--sticky-top)] hidden max-h-[calc(100dvh-var(--header-h)-0.75rem-2*var(--sticky-top))] overflow-y-auto rounded-2xl p-3 lg:block">
      <Link href={academyLinks.learn({ program: nav.program.id, user })} className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{nav.program.title}
      </Link>
      <ol className="flex flex-col gap-3">
        {nav.outline.map((m, mi) => (
          <li key={m.id}>
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{mi + 1}. {m.title}</p>
            <ol className="mt-1 flex flex-col">
              {m.items.map((i) => {
                const active = i.kind === current.kind && i.id === current.id;
                return (
                  <li key={`${i.kind}-${i.id}`}>
                    <Link
                      href={academyLinks.item(i.kind, i.id, { user })}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-[var(--glass-bg)]",
                        active ? "bg-primary/10 font-medium text-primary" : "text-foreground/85",
                      )}
                    >
                      <KindIcon kind={i.kind} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      {i.draft && <Pill tone="warn">черн.</Pill>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PrevNext({ nav, user }: { nav: Nav; user?: string }) {
  if (!nav.prev && !nav.next) return null;
  return (
    <nav aria-label="Соседние материалы" className="grid gap-3 sm:grid-cols-2">
      {nav.prev ? (
        <Link href={academyLinks.item(nav.prev.kind, nav.prev.id, { user })} className="glass-panel group flex items-center gap-3 rounded-2xl p-4 hover:bg-[var(--glass-hover-bg)]">
          <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
          <span className="min-w-0"><span className="block text-xs text-muted-foreground">Назад · {KIND_LABEL[nav.prev.kind]}</span><span className="block truncate font-medium">{nav.prev.title}</span></span>
        </Link>
      ) : <span />}
      {nav.next && (
        <Link href={academyLinks.item(nav.next.kind, nav.next.id, { user })} className="glass-panel group flex items-center justify-end gap-3 rounded-2xl p-4 text-right hover:bg-[var(--glass-hover-bg)]">
          <span className="min-w-0"><span className="block text-xs text-muted-foreground">Дальше · {KIND_LABEL[nav.next.kind]}</span><span className="block truncate font-medium">{nav.next.title}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}

function Shell({ nav, current, user, staff, title, kind, meta, actions, children }: {
  nav: Nav; current: { kind: ItemKind; id: number }; user?: string; staff: boolean;
  title: string; kind: ItemKind; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <OutlineNav nav={nav} current={current} user={user} />
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          title={title}
          icon={kind === "lesson" ? BookOpen : kind === "quiz" ? Layers : PencilRuler}
          description={<>{nav.program.title} · {KIND_LABEL[kind]}</>}
          meta={meta}
          actions={
            <>
              {actions}
              {staff && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={academyLinks.admin({ program: nav.program.id })}><PencilRuler aria-hidden="true" />В редакторе</Link>
                </Button>
              )}
            </>
          }
        />
        {user && (
          <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <Eye className="h-4 w-4 text-primary" aria-hidden="true" />Вы смотрите материал глазами ученика <b>{user}</b> — отправка ответов отключена.
          </p>
        )}
        {children}
        <PrevNext nav={nav} user={user} />
      </div>
    </div>
  );
}

/* ─── lesson ────────────────────────────────────────────────────────────── */

function LessonView({ id, user, staff }: { id: number; user?: string; staff: boolean }) {
  const q = useLesson(id, user);
  const { toast } = useToast();
  const toggle = useAcademyMutation((completed: boolean) => api.lessonProgress(id, completed));
  const pinged = useRef<number | null>(null);
  const data = q.data;

  // Auto «started» ping once per lesson open (own progress only; not when staff previews a student).
  useEffect(() => {
    if (!data || user || data.lesson.draft || pinged.current === id || data.progress.startedAt) return;
    pinged.current = id;
    api.lessonProgress(id).catch(() => { /* non-critical */ });
  }, [data, id, user]);

  const blocks = useMemo(() => parseMarkdown(data?.lesson.bodyMd ?? ""), [data?.lesson.bodyMd]);
  const toc = useMemo(() => outlineOf(blocks), [blocks]);

  if (!data) return <LoadState error={q.error} />;
  const { lesson, progress, setups, nav } = data;
  const minutes = lesson.durationMin ?? readingMinutes(lesson.bodyMd);
  const done = progress.completed;

  const onToggle = () =>
    toggle.mutate(!done, {
      onSuccess: () => toast({ title: done ? "Отметка снята" : "Урок пройден", description: !done && nav.next ? `Дальше: ${nav.next.title}` : undefined }),
      onError: (e) => toast({ title: "Не удалось сохранить", description: (e as Error).message, variant: "destructive" }),
    });

  return (
    <Shell
      nav={nav}
      current={{ kind: "lesson", id }}
      user={user}
      staff={staff}
      title={lesson.title}
      kind="lesson"
      meta={
        <>
          <span className="inline-flex items-center gap-1 tabular-nums"><Clock className="h-3 w-3" aria-hidden="true" />≈{minutes} мин</span>
          {lesson.draft && <Pill tone="warn">Черновик — ученики не видят</Pill>}
          {done ? <Pill tone="up" dot>Пройден</Pill> : progress.startedAt ? <Pill tone="accent">Начат</Pill> : null}
          {progress.completedAt && <span>отмечен <DualTime iso={progress.completedAt} /></span>}
        </>
      }
      actions={!user && !lesson.draft ? (
        <Button variant={done ? "outline" : "default"} size="sm" onClick={onToggle} disabled={toggle.isPending} aria-pressed={done}>
          {toggle.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : done ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
          {done ? "Пройден" : "Отметить пройденным"}
        </Button>
      ) : undefined}
    >
      {lesson.summary && <p className="text-sm text-muted-foreground">{lesson.summary}</p>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col gap-4">
          {lesson.video && <VideoPlayer video={lesson.video} title={lesson.title} />}
          <Panel>
            <Markdown blocks={blocks} />
          </Panel>
          {lesson.attachments.length > 0 && (
            <Panel title="Материалы">
              <AttachmentList items={lesson.attachments} />
            </Panel>
          )}
          {(setups.length > 0 || lesson.setupNames.length > 0) && (
            <Panel title="Сетапы плейбука" description="Урок разбирает эти сетапы — откройте карточку, чтобы сверить правила со своими сделками.">
              <ul className="flex flex-wrap gap-2">
                {setups.map((s) => (
                  <li key={s.id}>
                    <Link href={links.setup(s.id)} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-sm hover:border-primary/60 hover:text-primary">
                      {s.name}{s.trader && <span className="text-xs text-muted-foreground">· {s.trader}</span>}
                    </Link>
                  </li>
                ))}
                {lesson.setupNames.filter((n) => !setups.some((s) => s.name.toLowerCase() === n.toLowerCase())).map((n) => (
                  <li key={n}>
                    <Link href={links.trades({ setup: n })} className="inline-flex items-center rounded-full border border-dashed border-border/60 px-3 py-1 text-sm text-muted-foreground hover:text-primary" title="Сделки с этим сетапом">
                      {n}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        {toc.length > 1 && (
          <nav aria-label="Оглавление урока" className="glass-panel sticky top-[var(--sticky-top)] hidden rounded-2xl p-3 xl:block">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">В уроке</p>
            <ol className="mt-1 flex flex-col">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className={cn("block truncate rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-[var(--glass-bg)] hover:text-primary", h.level === 3 && "pl-5 text-xs")}>{h.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
    </Shell>
  );
}

/* ─── quiz ──────────────────────────────────────────────────────────────── */

function QuizView({ id, user, staff }: { id: number; user?: string; staff: boolean }) {
  const q = useQuiz(id, user);
  if (!q.data) return <LoadState error={q.error} />;
  const d = q.data;
  return (
    <Shell
      nav={d.nav}
      current={{ kind: "quiz", id }}
      user={user}
      staff={staff}
      title={d.quiz.title}
      kind="quiz"
      meta={
        <>
          <span className="tabular-nums">{d.quiz.questions.length} вопр. · зачёт от {d.quiz.passPct}% · {d.quiz.maxAttempts ? `попыток: ${d.quiz.maxAttempts}` : "попытки без ограничений"}</span>
          {d.quiz.draft && <Pill tone="warn">Черновик</Pill>}
          {d.state.passed && <Pill tone="up" dot>Сдан</Pill>}
        </>
      }
    >
      {d.quiz.description && <Panel><Markdown source={d.quiz.description} /></Panel>}
      <QuizRunner data={d} canAnswer={!user && !d.quiz.draft} />
    </Shell>
  );
}

/* ─── assignment ────────────────────────────────────────────────────────── */

function AssignmentView({ id, user, staff, focus }: { id: number; user?: string; staff: boolean; focus: number | null }) {
  // Staff opening from the review queue / a notification (no ?user) sees every student's submissions.
  const all = staff && !user;
  const q = useAssignment(id, user, all);
  if (!q.data) return <LoadState error={q.error} />;
  const d = q.data;
  return (
    <Shell
      nav={d.nav}
      current={{ kind: "assignment", id }}
      user={user}
      staff={staff}
      title={d.assignment.title}
      kind="assignment"
      meta={
        <>
          <span className="tabular-nums">зачёт от {d.assignment.passPct}%{d.assignment.minTrades ? ` · минимум сделок: ${d.assignment.minTrades}` : ""}</span>
          {d.assignment.draft && <Pill tone="warn">Черновик</Pill>}
        </>
      }
    >
      <AssignmentPanel data={d} canSubmit={!user && !d.assignment.draft} staff={staff} focusSubmission={focus} />
    </Shell>
  );
}
