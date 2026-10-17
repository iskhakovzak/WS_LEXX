/**
 * Mentor editors for «Редактор курсов»: program / module / lesson / quiz / assignment forms.
 * Lessons and assignments get a live markdown preview (same safe renderer students see); lesson video is
 * validated against the YouTube / Vimeo / Loom allow-list client-side and again on the server.
 */
import { memo, useDeferredValue, useMemo, useState } from "react";
import { Link } from "wouter";
import { Archive, ArchiveRestore, ExternalLink, Eye, Loader2, Plus, Save, Search, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, Pill, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import {
  KIND_ARCHIVE, STAGES, STAGE_LABELS, api, useAcademyMutation, useSetups,
  type AdminItem, type AdminModule, type AdminQuiz, type Assignment, type Attachment, type ItemKind, type Lesson, type Program,
  type QuizOption, type QuizQuestion, type RubricCriterion, type Stage,
} from "./api";
import { Markdown } from "./markdown";
import { readingMinutes } from "./markdown-parse";
import { PROVIDER_LABEL, videoEmbed } from "./video";
import { VideoPlayer } from "./bits";
import { academyLinks } from "./links";
import { pluralRu } from "@/lib/format";
import { ApiError } from "@/lib/api/http";

/* ─── helpers ───────────────────────────────────────────────────────────── */

function errText(e: unknown): string {
  const errors = e instanceof ApiError ? e.field<string[]>("errors") : undefined;
  if (e instanceof ApiError && errors?.length) return `${e.message}: ${errors.join("; ")}`;
  return (e as Error)?.message ?? "Ошибка";
}

function useSaver() {
  const { toast } = useToast();
  return {
    ok: (title: string): void => { toast({ title }); },
    fail: (e: unknown): void => { toast({ title: "Не сохранено", description: errText(e), variant: "destructive" }); },
  };
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchField({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm">{label}</Label>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const numOrNull = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** Preview re-renders only when its (deferred) text changes, not on every keystroke of the parent form. */
const MarkdownPreview = memo(function MarkdownPreview({ source }: { source: string }) {
  return <Markdown source={source} />;
});

/** Markdown textarea with Редактор / Предпросмотр / Рядом modes. */
function MarkdownField({ id, label, value, onChange, rows = 18 }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const [mode, setMode] = useState<"edit" | "split" | "preview">("split");
  // Typing stays instant on long lessons: the preview and reading time follow at low priority.
  const deferred = useDeferredValue(value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">≈{readingMinutes(deferred)} мин чтения</span>
          <Segmented size="sm" ariaLabel="Режим редактора" value={mode} onChange={setMode} options={[{ value: "edit", label: "Текст" }, { value: "split", label: "Рядом" }, { value: "preview", label: "Предпросмотр" }]} />
        </div>
      </div>
      <div className={cn("grid gap-3", mode === "split" && "xl:grid-cols-2")}>
        {mode !== "preview" && (
          <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} spellCheck className="font-mono text-[13px] leading-relaxed" placeholder={"## Заголовок\n\nТекст, **жирный**, *курсив*, `код`, списки, > цитаты, | таблицы |, [ссылка](https://…)"} />
        )}
        {mode !== "edit" && (
          <div className="glass-field max-h-[36rem] min-h-[10rem] overflow-y-auto rounded-xl p-4" aria-label="Предпросмотр текста">
            <MarkdownPreview source={deferred} />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Поддерживается Markdown: заголовки, списки, таблицы, цитаты, код, ссылки (http/https). HTML не выполняется.</p>
    </div>
  );
}

function FormActions({ saving, onSave, dirty, extra }: { saving: boolean; onSave: () => void; dirty: boolean; extra?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-sticky -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-[var(--sticky-bg)] px-1 pt-3">
      {dirty && <span className="mr-auto text-xs text-[hsl(var(--chart-3))]">Есть несохранённые изменения</span>}
      {extra}
      <Button onClick={onSave} disabled={saving || !dirty}>{saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить</Button>
    </div>
  );
}

function ArchiveButton({ kind, id, archived, label }: { kind: "programs" | "modules" | "lessons" | "quizzes" | "assignments"; id: number; archived: boolean; label: string }) {
  const s = useSaver();
  const m = useAcademyMutation(() => api.archive(kind, id, archived));
  return (
    <Button
      variant="ghost"
      onClick={() => {
        if (!archived && !window.confirm(`Убрать «${label}» в архив? Прогресс и сдачи учеников сохранятся, восстановить можно в режиме «Показать архив».`)) return;
        m.mutate(undefined, { onSuccess: () => s.ok(archived ? "Восстановлено" : "Перемещено в архив"), onError: s.fail });
      }}
      disabled={m.isPending}
    >
      {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}{archived ? "Восстановить" : "В архив"}
    </Button>
  );
}

/* ─── program ───────────────────────────────────────────────────────────── */

export function ProgramForm({ program, onCreated }: { program: Program | null; onCreated?: (id: number) => void }) {
  const s = useSaver();
  const init = {
    title: program?.title ?? "", description: program?.description ?? "", level: program?.level ?? "",
    stage: (program?.stage ?? "") as Stage | "", published: program?.published ?? false,
  };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const m = useAcademyMutation(async () => {
    const body = { title: f.title.trim(), description: f.description.trim() || null, level: f.level.trim() || null, stage: f.stage || null, published: f.published };
    return program ? api.updateProgram(program.id, body) : api.createProgram(body);
  });
  const save = (): void => {
    if (!f.title.trim()) return s.fail(new Error("Введите название программы"));
    m.mutate(undefined, { onSuccess: (r) => { s.ok(program ? "Программа сохранена" : "Программа создана"); if (!program) onCreated?.(r.program.id); }, onError: s.fail });
  };
  const idp = `prog-${program?.id ?? "new"}`;
  return (
    <Panel title={program ? "Настройки программы" : "Новая программа"} description="Программа = курс для одной ступени лестницы (Стажёр → Джун → Трейдер → Сеньор).">
      <div className="flex flex-col gap-4">
        <Field label="Название" htmlFor={`${idp}-title`}><Input id={`${idp}-title`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Описание" htmlFor={`${idp}-desc`}><Textarea id={`${idp}-desc`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} maxLength={4000} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ступень" hint="Для какой ступени этот курс">
            <Select value={f.stage || "none"} onValueChange={(v) => setF({ ...f, stage: v === "none" ? "" : (v as Stage) })}>
              <SelectTrigger aria-label="Ступень"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без ступени</SelectItem>
                {STAGES.map((st) => <SelectItem key={st} value={st}>{STAGE_LABELS[st]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Подпись уровня" htmlFor={`${idp}-level`} hint="Свободный текст на карточке, напр. «Базовый»"><Input id={`${idp}-level`} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} maxLength={60} /></Field>
        </div>
        <SwitchField id={`${idp}-pub`} label="Опубликована" checked={f.published} onChange={(v) => setF({ ...f, published: v })} hint={f.published ? "видна ученикам" : "видят только наставники"} />
        <FormActions
          saving={m.isPending}
          onSave={save}
          dirty={dirty || !program}
          extra={program && (
            <>
              <Button variant="outline" asChild><Link href={academyLinks.learn({ program: program.id })}><Eye aria-hidden="true" />Как видит ученик</Link></Button>
              <ArchiveButton kind="programs" id={program.id} archived={!!program.archivedAt} label={program.title} />
            </>
          )}
        />
      </div>
    </Panel>
  );
}

/* ─── module ────────────────────────────────────────────────────────────── */

export function ModuleForm({ module, programId, onCreated }: { module: AdminModule | null; programId: number; onCreated?: (id: number) => void }) {
  const s = useSaver();
  const init = { title: module?.title ?? "", description: module?.description ?? "" };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const m = useAcademyMutation(async () => {
    const body = { title: f.title.trim(), description: f.description.trim() || null };
    return module ? api.updateModule(module.id, body) : api.createModule({ programId, ...body });
  });
  const save = (): void => {
    if (!f.title.trim()) return s.fail(new Error("Введите название модуля"));
    m.mutate(undefined, { onSuccess: (r) => { s.ok(module ? "Модуль сохранён" : "Модуль создан"); if (!module) onCreated?.(r.module.id); }, onError: s.fail });
  };
  const idp = `mod-${module?.id ?? "new"}`;
  return (
    <Panel title={module ? "Модуль" : "Новый модуль"}>
      <div className="flex flex-col gap-4">
        <Field label="Название" htmlFor={`${idp}-title`}><Input id={`${idp}-title`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Описание" htmlFor={`${idp}-desc`}><Textarea id={`${idp}-desc`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} maxLength={2000} /></Field>
        <FormActions saving={m.isPending} onSave={save} dirty={dirty || !module} extra={module && <ArchiveButton kind="modules" id={module.id} archived={!!module.archivedAt} label={module.title} />} />
      </div>
    </Panel>
  );
}

/* ─── common item header: move between modules, preview link, archive ──── */

function ItemFooterExtra({ kind, id, archived, title, modules, moduleId }: { kind: ItemKind; id: number; archived: boolean; title: string; modules: AdminModule[]; moduleId: number }) {
  const s = useSaver();
  const move = useAcademyMutation((target: number) => api.moveItem(kind, id, target));
  return (
    <>
      {modules.length > 1 && (
        <Select value={String(moduleId)} onValueChange={(v) => move.mutate(Number(v), { onSuccess: () => s.ok("Перенесено в другой модуль"), onError: s.fail })}>
          <SelectTrigger className="h-9 w-[200px]" aria-label="Перенести в модуль"><SelectValue /></SelectTrigger>
          <SelectContent>{modules.map((m, i) => <SelectItem key={m.id} value={String(m.id)}>Модуль {i + 1}: {m.title}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <Button variant="outline" asChild>
        <Link href={academyLinks.item(kind, id)}><ExternalLink aria-hidden="true" />Открыть как ученик</Link>
      </Button>
      <ArchiveButton kind={KIND_ARCHIVE[kind]} id={id} archived={archived} label={title} />
    </>
  );
}

/* ─── lesson ────────────────────────────────────────────────────────────── */

type LessonForm = {
  title: string; summary: string; bodyMd: string; videoUrl: string; durationMin: string;
  attachments: Attachment[]; playbookIds: number[]; setupNames: string; draft: boolean;
};

export function LessonEditor({ lesson, moduleId, modules, onCreated }: { lesson: (Lesson & { kind: "lesson" }) | null; moduleId: number; modules: AdminModule[]; onCreated?: (kind: ItemKind, id: number) => void }) {
  const s = useSaver();
  const init: LessonForm = {
    title: lesson?.title ?? "", summary: lesson?.summary ?? "", bodyMd: lesson?.bodyMd ?? "", videoUrl: lesson?.videoUrl ?? "",
    durationMin: lesson?.durationMin != null ? String(lesson.durationMin) : "", attachments: lesson?.attachments ?? [],
    playbookIds: lesson?.playbookIds ?? [], setupNames: (lesson?.setupNames ?? []).join(", "), draft: lesson?.draft ?? true,
  };
  const [f, setF] = useState<LessonForm>(init);
  const set = <K extends keyof LessonForm>(k: K, v: LessonForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const video = videoEmbed(f.videoUrl);
  const videoBad = f.videoUrl.trim() !== "" && !video;
  const badAttachment = f.attachments.some((a) => a.url.trim() && !/^https?:\/\//i.test(a.url.trim()));

  const m = useAcademyMutation(async () => {
    const body = {
      title: f.title.trim(), summary: f.summary.trim() || null, bodyMd: f.bodyMd, videoUrl: f.videoUrl.trim() || null,
      durationMin: numOrNull(f.durationMin) != null ? Math.round(numOrNull(f.durationMin)!) : null,
      attachments: f.attachments.filter((a) => a.url.trim()).map((a) => ({ title: a.title.trim(), url: a.url.trim() })),
      playbookIds: f.playbookIds,
      setupNames: f.setupNames.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
      draft: f.draft,
    };
    return lesson ? api.updateLesson(lesson.id, body) : api.createLesson({ moduleId, ...body });
  });
  const save = (): void => {
    if (!f.title.trim()) return s.fail(new Error("Введите название урока"));
    if (videoBad) return s.fail(new Error("Видео: поддерживаются только ссылки YouTube, Vimeo и Loom"));
    if (badAttachment) return s.fail(new Error("Материалы: ссылки должны начинаться с http:// или https://"));
    m.mutate(undefined, { onSuccess: (r) => { s.ok(lesson ? "Урок сохранён" : "Урок создан"); if (!lesson) onCreated?.("lesson", r.lesson.id); }, onError: s.fail });
  };
  const idp = `lesson-${lesson?.id ?? "new"}`;

  return (
    <Panel title={lesson ? "Урок" : "Новый урок"} actions={f.draft ? <Pill tone="warn">Черновик</Pill> : <Pill tone="up">Опубликован</Pill>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Название" htmlFor={`${idp}-title`}><Input id={`${idp}-title`} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} /></Field>
          <Field label="Длительность, мин" htmlFor={`${idp}-dur`} hint={`пусто = по тексту (≈${readingMinutes(f.bodyMd)})`}>
            <Input id={`${idp}-dur`} inputMode="numeric" value={f.durationMin} onChange={(e) => set("durationMin", e.target.value.replace(/[^\d]/g, ""))} className="tabular-nums" />
          </Field>
        </div>
        <Field label="Кратко (одна строка в программе)" htmlFor={`${idp}-sum`}><Input id={`${idp}-sum`} value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={1000} /></Field>

        <MarkdownField id={`${idp}-body`} label="Текст урока" value={f.bodyMd} onChange={(v) => set("bodyMd", v)} />

        <Field
          label="Видео"
          htmlFor={`${idp}-video`}
          hint={videoBad ? <span className="text-down">Ссылка не поддерживается — только YouTube, Vimeo или Loom.</span> : video ? `${PROVIDER_LABEL[video.provider]} · ${video.id}` : "YouTube (можно с ?t=90), Vimeo или Loom"}
        >
          <Input id={`${idp}-video`} value={f.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="https://youtu.be/…" aria-invalid={videoBad || undefined} />
        </Field>
        {video && <div className="max-w-xl"><VideoPlayer video={video} title={f.title || "Видео урока"} /></div>}

        <AttachmentsEditor items={f.attachments} onChange={(v) => set("attachments", v)} />

        <SetupPicker selected={f.playbookIds} onChange={(v) => set("playbookIds", v)} />
        <Field label="Названия сетапов (через запятую)" htmlFor={`${idp}-setups`} hint="Связь по названию — урок найдётся из сделки, даже если у трейдера своя карточка сетапа.">
          <Input id={`${idp}-setups`} value={f.setupNames} onChange={(e) => set("setupNames", e.target.value)} placeholder="PDH, VWAP, ложный пробой" />
        </Field>

        <SwitchField id={`${idp}-draft`} label="Черновик" checked={f.draft} onChange={(v) => set("draft", v)} hint="черновики видят только наставники" />
        <FormActions saving={m.isPending} onSave={save} dirty={dirty || !lesson} extra={lesson && <ItemFooterExtra kind="lesson" id={lesson.id} archived={!!lesson.archivedAt} title={lesson.title} modules={modules} moduleId={lesson.moduleId} />} />
      </div>
    </Panel>
  );
}

function AttachmentsEditor({ items, onChange }: { items: Attachment[]; onChange: (v: Attachment[]) => void }) {
  const upd = (i: number, patch: Partial<Attachment>) => onChange(items.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Материалы (ссылки)</legend>
      {items.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input value={a.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="Название" className="w-48" aria-label={`Название материала ${i + 1}`} maxLength={200} />
          <Input value={a.url} onChange={(e) => upd(i, { url: e.target.value })} placeholder="https://…" className="min-w-[16rem] flex-1" aria-label={`Ссылка материала ${i + 1}`} aria-invalid={(a.url.trim() !== "" && !/^https?:\/\//i.test(a.url.trim())) || undefined} />
          <Button variant="ghost" size="icon" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={`Удалить материал ${i + 1}`}><X aria-hidden="true" /></Button>
        </div>
      ))}
      {items.length < 20 && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...items, { title: "", url: "" }])}><Plus aria-hidden="true" />Добавить ссылку</Button>
      )}
      <p className="text-xs text-muted-foreground">Файлы загрузите в Google Drive / Notion и вставьте ссылку (до 20).</p>
    </fieldset>
  );
}

function SetupPicker({ selected, onChange }: { selected: number[]; onChange: (v: number[]) => void }) {
  const q = useSetups();
  const [filter, setFilter] = useState("");
  const all = q.data?.setups ?? [];
  const sel = new Set(selected);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return all.filter((s) => !f || s.name.toLowerCase().includes(f) || (s.folder ?? "").toLowerCase().includes(f) || (s.trader ?? "").toLowerCase().includes(f)).slice(0, 60);
  }, [all, filter]);
  const toggle = (id: number) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Карточки плейбука ({selected.length} выбрано)</legend>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const s = all.find((x) => x.id === id);
            return (
              <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs" aria-label={`Убрать сетап ${s?.name ?? id}`}>
                {s?.name ?? `#${id}`}<X className="h-3 w-3" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти сетап" className="pl-8" aria-label="Поиск сетапа" />
      </div>
      {q.isLoading ? <p className="text-xs text-muted-foreground">Загрузка…</p> : !all.length ? <p className="text-xs text-muted-foreground">В плейбуке пока нет карточек.</p> : (
        <ul className="grid max-h-[40vh] gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
          {shown.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--glass-bg)]">
                <Checkbox checked={sel.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {(s.folder || s.trader) && <span className="truncate text-xs text-muted-foreground">{[s.folder, s.trader].filter(Boolean).join(" · ")}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/* ─── quiz ──────────────────────────────────────────────────────────────── */

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function blankQuestion(kind: QuizQuestion["kind"]): QuizQuestion {
  if (kind === "numeric") return { id: newId("q"), kind, prompt: "", answer: 0, tolerance: 0, tolerancePct: false, unit: "", points: 1 };
  const options: QuizOption[] = [{ id: "a", text: "" }, { id: "b", text: "" }];
  return kind === "single"
    ? { id: newId("q"), kind, prompt: "", options, correct: [], points: 1 }
    : { id: newId("q"), kind, prompt: "", options, correct: [], points: 1, partial: true };
}

function convertQuestion(q: QuizQuestion, kind: QuizQuestion["kind"]): QuizQuestion {
  if (q.kind === kind) return q;
  const base = { id: q.id, prompt: q.prompt, points: q.points, explanation: q.explanation };
  if (kind === "numeric") return { ...base, kind, answer: 0, tolerance: 0, tolerancePct: false, unit: "" };
  const options = q.kind === "numeric" ? [{ id: "a", text: "" }, { id: "b", text: "" }] : q.options;
  const correct = q.kind === "numeric" ? [] : kind === "single" ? q.correct.slice(0, 1) : q.correct;
  return kind === "single" ? { ...base, kind, options, correct } : { ...base, kind, options, correct, partial: true };
}

function nextOptionId(opts: QuizOption[]): string {
  const used = new Set(opts.map((o) => o.id));
  for (const c of "abcdefghijklmnopqrstuvwxyz") if (!used.has(c)) return c;
  return newId("o");
}

/** Client-side checks mirroring normalizeQuestions on the server (the server is authoritative). */
function questionProblems(qs: QuizQuestion[]): string[] {
  const out: string[] = [];
  qs.forEach((q, i) => {
    const n = `Вопрос ${i + 1}`;
    if (!q.prompt.trim()) out.push(`${n}: нет формулировки`);
    if (q.kind !== "numeric") {
      if (q.options.filter((o) => o.text.trim()).length < 2) out.push(`${n}: нужно минимум 2 варианта`);
      if (!q.correct.length) out.push(`${n}: отметьте правильный ответ`);
    } else if (!Number.isFinite(q.answer)) out.push(`${n}: нет числового ответа`);
  });
  return out;
}

export function QuizEditor({ quiz, moduleId, modules, onCreated }: { quiz: AdminQuiz | null; moduleId: number; modules: AdminModule[]; onCreated?: (kind: ItemKind, id: number) => void }) {
  const s = useSaver();
  const init = {
    title: quiz?.title ?? "", description: quiz?.description ?? "", passPct: String(quiz?.passPct ?? 80),
    maxAttempts: quiz?.maxAttempts != null ? String(quiz.maxAttempts) : "", draft: quiz?.draft ?? true, questions: quiz?.questions ?? [blankQuestion("single")],
  };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const problems = questionProblems(f.questions);
  const totalPoints = f.questions.reduce((a, q) => a + (Number(q.points) || 0), 0);

  const setQ = (i: number, q: QuizQuestion) => setF((p) => ({ ...p, questions: p.questions.map((x, k) => (k === i ? q : x)) }));
  const moveQ = (i: number, d: -1 | 1) => setF((p) => {
    const j = i + d;
    if (j < 0 || j >= p.questions.length) return p;
    const qs = [...p.questions];
    [qs[i], qs[j]] = [qs[j], qs[i]];
    return { ...p, questions: qs };
  });

  const m = useAcademyMutation(async () => {
    const body = {
      title: f.title.trim(), description: f.description.trim() || null, passPct: Math.min(100, Math.max(0, numOrNull(f.passPct) ?? 80)),
      maxAttempts: numOrNull(f.maxAttempts) ? Math.round(numOrNull(f.maxAttempts)!) : null, draft: f.draft,
      questions: f.questions.map((q) => (q.kind === "numeric" ? q : { ...q, options: q.options.filter((o) => o.text.trim()) })),
    };
    return quiz ? api.updateQuiz(quiz.id, body) : api.createQuiz({ moduleId, ...body });
  });
  const save = (): void => {
    if (!f.title.trim()) return s.fail(new Error("Введите название теста"));
    if (problems.length) return s.fail(new Error(problems.slice(0, 3).join("; ")));
    m.mutate(undefined, { onSuccess: (r) => { s.ok(quiz ? "Тест сохранён" : "Тест создан"); if (!quiz) onCreated?.("quiz", r.quiz.id); }, onError: s.fail });
  };
  const idp = `quiz-${quiz?.id ?? "new"}`;

  return (
    <Panel title={quiz ? "Тест" : "Новый тест"} actions={f.draft ? <Pill tone="warn">Черновик</Pill> : <Pill tone="up">Опубликован</Pill>}>
      <div className="flex flex-col gap-5">
        <Field label="Название" htmlFor={`${idp}-title`}><Input id={`${idp}-title`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Вступление (Markdown, необязательно)" htmlFor={`${idp}-desc`}><Textarea id={`${idp}-desc`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} maxLength={4000} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Порог зачёта, %" htmlFor={`${idp}-pass`}><Input id={`${idp}-pass`} inputMode="numeric" value={f.passPct} onChange={(e) => setF({ ...f, passPct: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
          <Field label="Попыток" htmlFor={`${idp}-att`} hint="пусто = без ограничений"><Input id={`${idp}-att`} inputMode="numeric" value={f.maxAttempts} onChange={(e) => setF({ ...f, maxAttempts: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
          <div className="flex flex-col justify-end text-sm text-muted-foreground tabular-nums">{f.questions.length} {pluralRu(f.questions.length, "вопрос", "вопроса", "вопросов")} · {totalPoints} {pluralRu(totalPoints, "балл", "балла", "баллов")}</div>
        </div>

        <ol className="flex flex-col gap-3">
          {f.questions.map((q, i) => (
            <li key={q.id}>
              <QuestionCard
                q={q}
                index={i}
                count={f.questions.length}
                onChange={(nq) => setQ(i, nq)}
                onMove={(d) => moveQ(i, d)}
                onRemove={() => setF((p) => ({ ...p, questions: p.questions.filter((_, k) => k !== i) }))}
              />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setF((p) => ({ ...p, questions: [...p.questions, blankQuestion("single")] }))}><Plus aria-hidden="true" />Один ответ</Button>
          <Button variant="outline" size="sm" onClick={() => setF((p) => ({ ...p, questions: [...p.questions, blankQuestion("multiple")] }))}><Plus aria-hidden="true" />Несколько ответов</Button>
          <Button variant="outline" size="sm" onClick={() => setF((p) => ({ ...p, questions: [...p.questions, blankQuestion("numeric")] }))}><Plus aria-hidden="true" />Числовой (посчитай R)</Button>
        </div>
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-[hsl(var(--chart-3))]" aria-live="polite">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        {quiz && quiz.questions.length > 0 && dirty && (
          <p className="text-xs text-muted-foreground">Изменение ответов не пересчитывает уже сданные попытки.</p>
        )}

        <SwitchField id={`${idp}-draft`} label="Черновик" checked={f.draft} onChange={(v) => setF({ ...f, draft: v })} hint="черновики видят только наставники" />
        <FormActions saving={m.isPending} onSave={save} dirty={dirty || !quiz} extra={quiz && <ItemFooterExtra kind="quiz" id={quiz.id} archived={!!quiz.archivedAt} title={quiz.title} modules={modules} moduleId={quiz.moduleId} />} />
      </div>
    </Panel>
  );
}

function QuestionCard({ q, index, count, onChange, onMove, onRemove }: {
  q: QuizQuestion; index: number; count: number; onChange: (q: QuizQuestion) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const idp = `qq-${q.id}`;
  return (
    <fieldset className="glass-field flex flex-col gap-3 rounded-xl p-3">
      <legend className="sr-only">Вопрос {index + 1}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">#{index + 1}</span>
        <Select value={q.kind} onValueChange={(v) => onChange(convertQuestion(q, v as QuizQuestion["kind"]))}>
          <SelectTrigger className="h-8 w-[190px]" aria-label="Тип вопроса"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Один ответ</SelectItem>
            <SelectItem value="multiple">Несколько ответов</SelectItem>
            <SelectItem value="numeric">Числовой ответ</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor={`${idp}-pts`} className="ml-2 text-xs text-muted-foreground">Баллы</Label>
        <Input id={`${idp}-pts`} inputMode="decimal" value={String(q.points)} onChange={(e) => onChange({ ...q, points: numOrNull(e.target.value) ?? 0 })} className="h-8 w-16 tabular-nums" />
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Поднять вопрос ${index + 1}`}>↑</Button>
          <Button variant="ghost" size="sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Опустить вопрос ${index + 1}`}>↓</Button>
          <Button variant="ghost" size="icon" onClick={onRemove} disabled={count <= 1} aria-label={`Удалить вопрос ${index + 1}`}><Trash2 aria-hidden="true" /></Button>
        </span>
      </div>
      <Textarea value={q.prompt} onChange={(e) => onChange({ ...q, prompt: e.target.value })} rows={2} placeholder="Формулировка вопроса" aria-label={`Формулировка вопроса ${index + 1}`} />

      {q.kind === "numeric" ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Правильный ответ" htmlFor={`${idp}-ans`}>
            <Input id={`${idp}-ans`} inputMode="decimal" defaultValue={String(q.answer)} onBlur={(e) => onChange({ ...q, answer: numOrNull(e.target.value) ?? 0 })} className="tabular-nums" />
          </Field>
          <Field label={q.tolerancePct ? "Допуск, %" : "Допуск, ±"} htmlFor={`${idp}-tol`}>
            <Input id={`${idp}-tol`} inputMode="decimal" defaultValue={String(q.tolerance)} onBlur={(e) => onChange({ ...q, tolerance: Math.abs(numOrNull(e.target.value) ?? 0) })} className="tabular-nums" />
          </Field>
          <Field label="Единица" htmlFor={`${idp}-unit`}><Input id={`${idp}-unit`} value={q.unit ?? ""} onChange={(e) => onChange({ ...q, unit: e.target.value })} placeholder="R, $, акций" maxLength={20} /></Field>
          <div className="flex items-end pb-2"><SwitchField id={`${idp}-tp`} label="Допуск в %" checked={q.tolerancePct} onChange={(v) => onChange({ ...q, tolerancePct: v })} /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">{q.kind === "single" ? "Отметьте один правильный вариант" : "Отметьте все правильные варианты"}</p>
          {q.options.map((o, k) => {
            const correct = q.correct.includes(o.id);
            const setCorrect = (v: boolean) => onChange({ ...q, correct: q.kind === "single" ? (v ? [o.id] : []) : v ? [...q.correct, o.id] : q.correct.filter((c) => c !== o.id) });
            return (
              <div key={o.id} className="flex items-center gap-2">
                <Checkbox checked={correct} onCheckedChange={(v) => setCorrect(v === true)} aria-label={`Вариант ${k + 1} правильный`} className={q.kind === "single" ? "rounded-full" : undefined} />
                <Input value={o.text} onChange={(e) => onChange({ ...q, options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} placeholder={`Вариант ${k + 1}`} aria-label={`Текст варианта ${k + 1}`} className={cn("h-8", correct && "border-up/50")} />
                <Button variant="ghost" size="icon" onClick={() => onChange({ ...q, options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((c) => c !== o.id) })} disabled={q.options.length <= 2} aria-label={`Удалить вариант ${k + 1}`}><X aria-hidden="true" /></Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            {q.options.length < 10 && <Button variant="ghost" size="sm" onClick={() => onChange({ ...q, options: [...q.options, { id: nextOptionId(q.options), text: "" }] })}><Plus aria-hidden="true" />Вариант</Button>}
            {q.kind === "multiple" && <SwitchField id={`${idp}-partial`} label="Частичный балл" checked={q.partial} onChange={(v) => onChange({ ...q, partial: v })} hint="(верные − ошибочные) / все верные" />}
          </div>
        </div>
      )}
      <Input value={q.explanation ?? ""} onChange={(e) => onChange({ ...q, explanation: e.target.value })} placeholder="Пояснение — показывается после ответа (необязательно)" aria-label={`Пояснение к вопросу ${index + 1}`} />
    </fieldset>
  );
}

/* ─── assignment ────────────────────────────────────────────────────────── */

const rubricKey = (label: string, used: Set<string>) => {
  const base = label.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 24) || "c";
  let k = base;
  let n = 2;
  while (used.has(k)) k = `${base}-${n++}`;
  return k;
};

export function AssignmentEditor({ assignment, moduleId, modules, onCreated }: { assignment: (Assignment & { kind: "assignment" }) | null; moduleId: number; modules: AdminModule[]; onCreated?: (kind: ItemKind, id: number) => void }) {
  const s = useSaver();
  const init = {
    title: assignment?.title ?? "", bodyMd: assignment?.bodyMd ?? "", passPct: String(assignment?.passPct ?? 70),
    minTrades: String(assignment?.minTrades ?? 0), draft: assignment?.draft ?? true,
    rubric: assignment?.rubric ?? ([{ key: "quality", label: "Качество разбора", maxPoints: 10 }] as RubricCriterion[]),
  };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const maxTotal = f.rubric.reduce((a, c) => a + (Number(c.maxPoints) || 0), 0);
  const updC = (i: number, patch: Partial<RubricCriterion>) => setF((p) => ({ ...p, rubric: p.rubric.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));

  const m = useAcademyMutation(async () => {
    const body = {
      title: f.title.trim(), bodyMd: f.bodyMd, passPct: Math.min(100, Math.max(0, numOrNull(f.passPct) ?? 70)),
      minTrades: Math.min(50, Math.max(0, Math.round(numOrNull(f.minTrades) ?? 0))), draft: f.draft,
      rubric: f.rubric.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim(), description: c.description?.trim() || undefined })),
    };
    return assignment ? api.updateAssignment(assignment.id, body) : api.createAssignment({ moduleId, ...body });
  });
  const save = (): void => {
    if (!f.title.trim()) return s.fail(new Error("Введите название задания"));
    if (!f.rubric.some((c) => c.label.trim() && c.maxPoints > 0)) return s.fail(new Error("Нужен хотя бы один критерий рубрики с баллами"));
    m.mutate(undefined, { onSuccess: (r) => { s.ok(assignment ? "Задание сохранено" : "Задание создано"); if (!assignment) onCreated?.("assignment", r.assignment.id); }, onError: s.fail });
  };
  const idp = `asg-${assignment?.id ?? "new"}`;

  return (
    <Panel title={assignment ? "Задание" : "Новое задание"} actions={f.draft ? <Pill tone="warn">Черновик</Pill> : <Pill tone="up">Опубликовано</Pill>}>
      <div className="flex flex-col gap-5">
        <Field label="Название" htmlFor={`${idp}-title`}><Input id={`${idp}-title`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <MarkdownField id={`${idp}-body`} label="Условие задания" value={f.bodyMd} onChange={(v) => setF({ ...f, bodyMd: v })} rows={12} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Порог зачёта, %" htmlFor={`${idp}-pass`}><Input id={`${idp}-pass`} inputMode="numeric" value={f.passPct} onChange={(e) => setF({ ...f, passPct: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
          <Field label="Минимум своих сделок" htmlFor={`${idp}-min`} hint="0 — сделки не обязательны"><Input id={`${idp}-min`} inputMode="numeric" value={f.minTrades} onChange={(e) => setF({ ...f, minTrades: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
          <div className="flex flex-col justify-end text-sm text-muted-foreground tabular-nums">Максимум: {maxTotal} {pluralRu(maxTotal, "балл", "балла", "баллов")}</div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Рубрика наставника</legend>
          {f.rubric.map((c, i) => (
            <div key={c.key} className="grid items-start gap-2 md:grid-cols-[minmax(0,14rem)_5rem_minmax(0,1fr)_auto]">
              <Input value={c.label} onChange={(e) => updC(i, { label: e.target.value })} placeholder="Критерий" aria-label={`Критерий ${i + 1}`} maxLength={120} />
              <Input inputMode="numeric" value={String(c.maxPoints)} onChange={(e) => updC(i, { maxPoints: Math.min(100, Number(e.target.value.replace(/[^\d]/g, "")) || 0) })} aria-label={`Максимум баллов, критерий ${i + 1}`} className="tabular-nums" />
              <Input value={c.description ?? ""} onChange={(e) => updC(i, { description: e.target.value })} placeholder="Что значит «хорошо» (подсказка ученику и наставнику)" aria-label={`Описание критерия ${i + 1}`} maxLength={500} />
              <Button variant="ghost" size="icon" onClick={() => setF((p) => ({ ...p, rubric: p.rubric.filter((_, k) => k !== i) }))} disabled={f.rubric.length <= 1} aria-label={`Удалить критерий ${i + 1}`}><X aria-hidden="true" /></Button>
            </div>
          ))}
          {f.rubric.length < 20 && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setF((p) => ({ ...p, rubric: [...p.rubric, { key: rubricKey(`c${p.rubric.length + 1}`, new Set(p.rubric.map((c) => c.key))), label: "", maxPoints: 5 }] }))}>
              <Plus aria-hidden="true" />Критерий
            </Button>
          )}
        </fieldset>

        <SwitchField id={`${idp}-draft`} label="Черновик" checked={f.draft} onChange={(v) => setF({ ...f, draft: v })} hint="черновики видят только наставники" />
        <FormActions saving={m.isPending} onSave={save} dirty={dirty || !assignment} extra={assignment && <ItemFooterExtra kind="assignment" id={assignment.id} archived={!!assignment.archivedAt} title={assignment.title} modules={modules} moduleId={assignment.moduleId} />} />
      </div>
    </Panel>
  );
}

/* ─── dispatcher ────────────────────────────────────────────────────────── */

export function ItemEditor({ item, newKind, moduleId, modules, onCreated }: {
  item: AdminItem | null; newKind?: ItemKind; moduleId: number; modules: AdminModule[]; onCreated: (kind: ItemKind, id: number) => void;
}) {
  const kind = item?.kind ?? newKind ?? "lesson";
  if (kind === "lesson") return <LessonEditor lesson={item?.kind === "lesson" ? item : null} moduleId={moduleId} modules={modules} onCreated={onCreated} />;
  if (kind === "quiz") return <QuizEditor quiz={item?.kind === "quiz" ? item : null} moduleId={moduleId} modules={modules} onCreated={onCreated} />;
  return <AssignmentEditor assignment={item?.kind === "assignment" ? item : null} moduleId={moduleId} modules={modules} onCreated={onCreated} />;
}

