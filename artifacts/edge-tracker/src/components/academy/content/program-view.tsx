/** Catalog cards and the module/item outline of one program (with per-item status for the viewed student). */
import { Link } from "wouter";
import { ArrowRight, Clock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, Pill, ProgressRing } from "@/components/ds";
import { cn } from "@/lib/utils";
import { pluralRu } from "@/components/rules/constants";
import { KIND_LABEL, STAGE_LABELS, type CatalogProgram, type ProgramTree, type TreeItem } from "./api";
import { KindIcon, PctBar, StatusIcon, SubmissionPill } from "./bits";
import { academyLinks } from "./links";

export function ProgramCard({ p, active, onSelect }: { p: CatalogProgram; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "glass-panel flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-[var(--glass-hover-bg)]",
        active && "ring-1 ring-primary/60",
      )}
    >
      <ProgressRing value={p.progress.pct} size={48} stroke={5} tone={p.progress.pct >= 100 ? "up" : "accent"} ariaLabel={`Прогресс: ${Math.round(p.progress.pct)}%`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{p.title}</span>
          {p.stage && <Pill tone="purple">{STAGE_LABELS[p.stage]}</Pill>}
          {!p.published && <Pill tone="warn">Черновик</Pill>}
        </span>
        {p.description && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{p.description}</span>}
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>{p.counts.lessons} {pluralRu(p.counts.lessons, "урок", "урока", "уроков")}</span>
          <span>{p.counts.quizzes} {pluralRu(p.counts.quizzes, "тест", "теста", "тестов")}</span>
          <span>{p.counts.assignments} {pluralRu(p.counts.assignments, "задание", "задания", "заданий")}</span>
          {p.durationMin > 0 && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />≈{p.durationMin} мин</span>}
          <span>{p.progress.done}/{p.progress.total} пройдено</span>
        </span>
      </span>
    </button>
  );
}

function itemMeta(i: TreeItem): string {
  const parts: string[] = [KIND_LABEL[i.kind]];
  if (i.kind === "lesson" && i.durationMin) parts.push(`${i.durationMin} мин`);
  if (i.kind === "lesson" && i.hasVideo) parts.push("видео");
  if (i.kind === "quiz") { if (i.questionCount) parts.push(`${i.questionCount} ${pluralRu(i.questionCount, "вопрос", "вопроса", "вопросов")}`); if (i.passPct != null) parts.push(`зачёт ${i.passPct}%`); }
  if (i.kind === "assignment" && i.minTrades) parts.push(`от ${i.minTrades} ${pluralRu(i.minTrades, "сделки", "сделок", "сделок")}`);
  return parts.join(" · ");
}

export function ProgramOutline({ tree, user, viewingOther }: { tree: ProgramTree; user?: string; viewingOther: boolean }) {
  const next = tree.progress.next;
  const linkUser = viewingOther ? user : undefined;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing value={tree.progress.pct} size={64} stroke={6} tone={tree.progress.pct >= 100 ? "up" : "accent"} ariaLabel="Прогресс программы" />
          {/* Keeps the text readable: the «Начать: …» button wraps under it instead of squeezing it into a narrow column. */}
          <div className="min-w-[min(100%,20rem)] flex-1">
            <h2 className="text-lg font-semibold text-foreground">{tree.program.title}</h2>
            {tree.program.description && <p className="mt-0.5 text-sm text-muted-foreground">{tree.program.description}</p>}
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {viewingOther && <>Ученик: <b className="text-foreground">{tree.user}</b> · </>}
              Уроки {tree.progress.byKind.lesson.done}/{tree.progress.byKind.lesson.total} · тесты {tree.progress.byKind.quiz.done}/{tree.progress.byKind.quiz.total} · задания {tree.progress.byKind.assignment.done}/{tree.progress.byKind.assignment.total}
            </p>
          </div>
          {next ? (
            <Button asChild>
              <Link href={academyLinks.item(next.kind, next.id, { user: linkUser })}>
                <PlayCircle aria-hidden="true" />{tree.progress.done ? "Продолжить" : "Начать"}: {next.title.length > 36 ? `${next.title.slice(0, 36)}…` : next.title}
              </Link>
            </Button>
          ) : tree.progress.total > 0 ? (
            <Pill tone="up" dot>Программа пройдена</Pill>
          ) : null}
        </div>
      </Panel>

      {tree.modules.map((m, mi) => (
        <Panel
          key={m.id}
          title={<span>Модуль {mi + 1}. {m.title}</span>}
          description={m.description ?? undefined}
          actions={m.progress && m.progress.total > 0 ? (
            <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              <PctBar pct={m.progress.pct} className="w-24" label={`Прогресс модуля ${m.title}`} />{m.progress.done}/{m.progress.total}
            </span>
          ) : undefined}
        >
          {!m.items.length ? (
            <p className="text-sm text-muted-foreground">В модуле пока нет материалов.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border/50">
              {m.items.map((i) => (
                <li key={`${i.kind}-${i.id}`}>
                  <Link
                    href={academyLinks.item(i.kind, i.id, { user: linkUser })}
                    className="group flex items-center gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-[var(--glass-bg)]"
                  >
                    <StatusIcon status={i.status} />
                    <KindIcon kind={i.kind} className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground group-hover:text-primary">{i.title}</span>
                        {i.draft && <Pill tone="warn">Черновик</Pill>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{itemMeta(i)}{i.kind === "lesson" && i.summary ? ` — ${i.summary}` : ""}</span>
                    </span>
                    {i.kind === "quiz" && i.bestPct != null && <Pill tone={i.status === "completed" ? "up" : "down"}>{Math.round(i.bestPct)}%</Pill>}
                    {i.kind === "assignment" && i.submission && <SubmissionPill status={i.submission.status} passed={i.submission.passed} />}
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      ))}
    </div>
  );
}
