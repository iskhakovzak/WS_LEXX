/**
 * Диалоги «Академии» → когорты и наставничество: когорта, зачисление, ступень/статус, занятие, отметка посещаемости,
 * встреча 1:1 с договорённостями, цель ИПР, договорённость. Все формы — только существующие пользователи.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Segmented, Pill } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import {
  ATTENDANCE_LABELS, type AttendanceStatus, type Cohort, type CohortFormat, COMPARATOR_SIGNS, type Comparator, type Enrollment, type EnrollmentStatus,
  FORMAT_LABELS, KIND_LABELS, type MetricDef, type MetricKey, MODE_LABELS, RECURRENCE_LABELS, type Recurrence, type Session, type SessionKind,
  type SessionMode, STAGE_LABELS, STAGES, STATUS_LABELS, type Stage, WEEKDAYS_SHORT,
  useCreateAction, useCreateCohort, useCreateGoal, useCreateMeeting, useCreateSession, useEnroll, useMarkAttendance, useMetrics, useRoster,
  useUpdateCohort, useUpdateEnrollment, useUpdateSession,
} from "./api";
import { AttendancePill, DualTime, ErrorNote, Field, LOCAL_TZ, NY_TZ, UserSelect, fmtYmd } from "./shared";

const TZ_OPTIONS = Array.from(new Set([NY_TZ, "Asia/Tashkent", "Asia/Almaty", "Asia/Bishkek", "Europe/Moscow", "UTC", LOCAL_TZ]));

function TzSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>{TZ_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t === NY_TZ ? `${t} (NY)` : t}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function useSuccess() {
  const { toast } = useToast();
  return (title: string, description?: string) => toast({ title, description });
}

/* ─── Когорта ─────────────────────────────────────────────────────────────── */

export function CohortDialog({ open, onOpenChange, cohort }: { open: boolean; onOpenChange: (v: boolean) => void; cohort?: Cohort | null }) {
  const create = useCreateCohort();
  const update = useUpdateCohort();
  const ok = useSuccess();
  const [f, setF] = useState({ name: "", format: "office" as CohortFormat, mentor: null as string | null, startsOn: "", endsOn: "", timezone: NY_TZ, description: "", room: "", meetingUrl: "" });
  useEffect(() => {
    if (!open) return;
    create.reset(); update.reset();
    setF(cohort
      ? { name: cohort.name, format: cohort.format, mentor: cohort.mentor, startsOn: cohort.startsOn ?? "", endsOn: cohort.endsOn ?? "", timezone: cohort.timezone, description: cohort.description, room: cohort.room ?? "", meetingUrl: cohort.meetingUrl ?? "" }
      : { name: "", format: "office", mentor: null, startsOn: nyDate(), endsOn: "", timezone: NY_TZ, description: "", room: "", meetingUrl: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cohort?.id]);
  const busy = create.isPending || update.isPending;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(), format: f.format, mentor: f.mentor, startsOn: f.startsOn || null, endsOn: f.endsOn || null, timezone: f.timezone,
      description: f.description, room: f.room.trim() || null, meetingUrl: f.meetingUrl.trim() || null,
    };
    const done = () => { ok(cohort ? "Когорта сохранена" : "Когорта создана", body.name); onOpenChange(false); };
    if (cohort) update.mutate({ id: cohort.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{cohort ? "Редактировать когорту" : "Новая когорта"}</DialogTitle>
            <DialogDescription>Группа трейдеров деска с общим расписанием и наставником.</DialogDescription>
          </DialogHeader>
          <Field id="c-name" label="Название">
            <Input id="c-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={120} placeholder="Офис — осень 2026" />
          </Field>
          <Field label="Формат">
            <Segmented ariaLabel="Формат когорты" value={f.format} onChange={(v) => setF({ ...f, format: v })}
              options={(Object.keys(FORMAT_LABELS) as CohortFormat[]).map((k) => ({ value: k, label: FORMAT_LABELS[k] }))} />
          </Field>
          <UserSelect id="c-mentor" label="Наставник" value={f.mentor} onChange={(v) => setF({ ...f, mentor: v })} allowNone />
          <div className="grid grid-cols-2 gap-3">
            <Field id="c-start" label="Начало"><Input id="c-start" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
            <Field id="c-end" label="Окончание"><Input id="c-end" type="date" value={f.endsOn} min={f.startsOn || undefined} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
          </div>
          <Field id="c-tz" label="Часовой пояс по умолчанию"><TzSelect id="c-tz" value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} /></Field>
          {f.format !== "remote" && (
            <Field id="c-room" label="Аудитория / место"><Input id="c-room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} maxLength={200} placeholder="Переговорная «Уолл-стрит»" /></Field>
          )}
          {f.format !== "office" && (
            <Field id="c-url" label="Ссылка на созвон" hint="Обычная ссылка Zoom / Meet — платформа ничего не отправляет и не создаёт встреч.">
              <Input id="c-url" type="url" value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} placeholder="https://…" />
            </Field>
          )}
          <Field id="c-desc" label="Описание"><Textarea id="c-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} /></Field>
          <ErrorNote error={create.error ?? update.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={busy || f.name.trim().length < 2}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Зачисление ──────────────────────────────────────────────────────────── */

export function EnrollDialog({ open, onOpenChange, cohort, existing }: { open: boolean; onOpenChange: (v: boolean) => void; cohort: Cohort; existing: string[] }) {
  const enroll = useEnroll();
  const ok = useSuccess();
  const [user, setUser] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("trainee");
  const [joinedOn, setJoinedOn] = useState(nyDate());
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { enroll.reset(); setUser(null); setStage("trainee"); setJoinedOn(nyDate()); setNote(""); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    enroll.mutate({ cohortId: cohort.id, userName: user, stage, joinedOn, note }, { onSuccess: () => { ok("Зачислен", `${user} → ${cohort.name}`); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Зачислить в «{cohort.name}»</DialogTitle>
            <DialogDescription>Только существующие пользователи платформы — новые аккаунты здесь не создаются.</DialogDescription>
          </DialogHeader>
          <UserSelect id="en-user" label="Пользователь" value={user} onChange={setUser} exclude={existing} />
          <Field label="Ступень">
            <Segmented ariaLabel="Ступень" value={stage} onChange={setStage} options={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />
          </Field>
          <Field id="en-date" label="Дата зачисления" hint="С этой даты считаются посещаемость и «отставание».">
            <Input id="en-date" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} required />
          </Field>
          <Field id="en-note" label="Заметка"><Input id="en-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          <ErrorNote error={enroll.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!user || enroll.isPending}>{enroll.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}Зачислить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Смена ступени / статуса (пишется в историю, студент получает уведомление). */
export function EnrollmentEditDialog({ open, onOpenChange, enrollment }: { open: boolean; onOpenChange: (v: boolean) => void; enrollment: Enrollment | null }) {
  const upd = useUpdateEnrollment();
  const ok = useSuccess();
  const [stage, setStage] = useState<Stage>("trainee");
  const [status, setStatus] = useState<EnrollmentStatus>("active");
  const [reason, setReason] = useState("");
  useEffect(() => { if (open && enrollment) { upd.reset(); setStage(enrollment.stage); setStatus(enrollment.status); setReason(""); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, enrollment?.id]);
  if (!enrollment) return null;
  const changed = stage !== enrollment.stage || status !== enrollment.status;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    upd.mutate({ id: enrollment.id, stage, status, reason: reason.trim() || undefined }, { onSuccess: () => { ok("Изменения сохранены", enrollment.userName); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{enrollment.userName}: ступень и статус</DialogTitle>
            <DialogDescription>Изменение попадёт в историю ступеней; студент получит уведомление.</DialogDescription>
          </DialogHeader>
          <Field label="Ступень">
            <Segmented ariaLabel="Ступень" value={stage} onChange={setStage} options={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />
          </Field>
          <Field label="Статус">
            <Segmented ariaLabel="Статус" value={status} onChange={setStatus} size="sm"
              options={(Object.keys(STATUS_LABELS) as EnrollmentStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
          </Field>
          <Field id="ee-reason" label="Причина / комментарий">
            <Textarea id="ee-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Например: 100 сделок с винрейтом 55 %, комиссии под контролем" />
          </Field>
          <ErrorNote error={upd.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!changed || upd.isPending}>Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Занятие ─────────────────────────────────────────────────────────────── */

export function SessionDialog({ open, onOpenChange, cohort, session }: { open: boolean; onOpenChange: (v: boolean) => void; cohort: Cohort; session?: Session | null }) {
  const create = useCreateSession();
  const update = useUpdateSession();
  const ok = useSuccess();
  const blank = () => ({
    title: "", kind: "briefing" as SessionKind, recurrence: "weekdays" as Recurrence, weekdays: [5] as number[], startDate: nyDate(), endDate: cohort.endsOn ?? "",
    startTime: "09:00", durationMin: 30, timezone: cohort.timezone || NY_TZ,
    mode: (cohort.format === "office" ? "office" : cohort.format === "remote" ? "online" : "hybrid") as SessionMode,
    room: cohort.room ?? "", meetingUrl: cohort.meetingUrl ?? "", host: cohort.mentor, description: "",
  });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    create.reset(); update.reset();
    setF(session
      ? { title: session.title, kind: session.kind, recurrence: session.recurrence, weekdays: session.weekdays.length ? session.weekdays : [5], startDate: session.startDate,
          endDate: session.endDate ?? "", startTime: session.startTime, durationMin: session.durationMin, timezone: session.timezone, mode: session.mode,
          room: session.room ?? "", meetingUrl: session.meetingUrl ?? "", host: session.host, description: session.description }
      : blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);
  const busy = create.isPending || update.isPending;
  const toggleDay = (d: number) => setF((x) => ({ ...x, weekdays: x.weekdays.includes(d) ? x.weekdays.filter((y) => y !== d) : [...x.weekdays, d].sort() }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      cohortId: cohort.id, title: f.title.trim(), kind: f.kind, recurrence: f.recurrence, weekdays: f.recurrence === "weekly" ? f.weekdays : [],
      startDate: f.startDate, endDate: f.recurrence === "none" ? null : f.endDate || null, startTime: f.startTime, durationMin: Number(f.durationMin) || 60,
      timezone: f.timezone, mode: f.mode, room: f.mode === "online" ? null : f.room.trim() || null, meetingUrl: f.mode === "office" ? null : f.meetingUrl.trim() || null,
      host: f.host, description: f.description,
    };
    const done = () => { ok(session ? "Занятие сохранено" : "Занятие добавлено", body.title); onOpenChange(false); };
    if (session) update.mutate({ id: session.id, ...body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };
  const weeklyEmpty = f.recurrence === "weekly" && f.weekdays.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{session ? "Редактировать занятие" : "Новое занятие"} · {cohort.name}</DialogTitle>
            <DialogDescription>Время задаётся в выбранном часовом поясе; студентам показывается их локальное время и Нью-Йорк.</DialogDescription>
          </DialogHeader>
          <Field id="s-title" label="Название">
            <Input id="s-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={160} placeholder="Премаркет-брифинг" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="s-kind" label="Тип">
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as SessionKind })}>
                <SelectTrigger id="s-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(KIND_LABELS) as SessionKind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <UserSelect id="s-host" label="Ведущий" value={f.host} onChange={(v) => setF({ ...f, host: v })} allowNone />
          </div>
          <Field label="Повтор">
            <Segmented ariaLabel="Повтор" value={f.recurrence} onChange={(v) => setF({ ...f, recurrence: v })} size="sm"
              options={(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((k) => ({ value: k, label: RECURRENCE_LABELS[k] }))} />
          </Field>
          {f.recurrence === "weekly" && (
            <div role="group" aria-label="Дни недели" className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" aria-pressed={f.weekdays.includes(d)} onClick={() => toggleDay(d)} className="chip min-h-8 px-3 text-sm font-medium">
                  {WEEKDAYS_SHORT[d]}
                </button>
              ))}
              {weeklyEmpty && <p className="w-full text-xs text-down">Выберите хотя бы один день.</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field id="s-start" label={f.recurrence === "none" ? "Дата" : "Первое занятие"}>
              <Input id="s-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required />
            </Field>
            {f.recurrence !== "none" && (
              <Field id="s-end" label="Повторять до (необязательно)">
                <Input id="s-end" type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field id="s-time" label="Начало"><Input id="s-time" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required /></Field>
            <Field id="s-dur" label="Длительность, мин">
              <Input id="s-dur" type="number" min={5} max={600} step={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />
            </Field>
            <Field id="s-tz" label="Пояс"><TzSelect id="s-tz" value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} /></Field>
          </div>
          <Field label="Где">
            <Segmented ariaLabel="Формат занятия" value={f.mode} onChange={(v) => setF({ ...f, mode: v })}
              options={(Object.keys(MODE_LABELS) as SessionMode[]).map((k) => ({ value: k, label: MODE_LABELS[k] }))} />
          </Field>
          {f.mode !== "online" && (
            <Field id="s-room" label="Аудитория / место"><Input id="s-room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} required maxLength={200} /></Field>
          )}
          {f.mode !== "office" && (
            <Field id="s-url" label="Ссылка (Zoom / Meet)" hint="Самоотметка удалённых студентов открывается за 10 мин до начала и закрывается через 15 мин после.">
              <Input id="s-url" type="url" value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} required placeholder="https://…" />
            </Field>
          )}
          <Field id="s-desc" label="Описание"><Textarea id="s-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} /></Field>
          <ErrorNote error={create.error ?? update.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={busy || weeklyEmpty || f.title.trim().length < 2}>Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Отметка посещаемости ────────────────────────────────────────────────── */

const ATT_ORDER: AttendanceStatus[] = ["present", "late", "absent", "excused"];

export function RosterDialog({ open, onOpenChange, sessionId, date, title }: { open: boolean; onOpenChange: (v: boolean) => void; sessionId: number | null; date: string; title?: string }) {
  const roster = useRoster(open ? sessionId : null, date);
  const mark = useMarkAttendance();
  const ok = useSuccess();
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  useEffect(() => { if (open) { setDraft({}); mark.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, sessionId, date]);
  const rows = roster.data?.roster ?? [];
  const changes = Object.entries(draft).filter(([u, s]) => rows.find((r) => r.enrollment.userName === u)?.status !== s);
  const started = roster.data ? Date.now() >= new Date(roster.data.occurrence.startUtc).getTime() - 10 * 60000 : true;
  const setAll = (s: AttendanceStatus) => setDraft(Object.fromEntries(rows.filter((r) => !r.status).map((r) => [r.enrollment.userName, s])));
  const save = () => {
    if (!sessionId || !changes.length) return;
    mark.mutate({ sessionId, date, marks: changes.map(([userName, status]) => ({ userName, status })) }, {
      onSuccess: (r) => { ok("Посещаемость сохранена", `Отмечено: ${r.saved}${r.skipped.length ? `, пропущено: ${r.skipped.join(", ")}` : ""}`); onOpenChange(false); },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Посещаемость: {title ?? roster.data?.session.title ?? "занятие"}</DialogTitle>
          <DialogDescription>
            {fmtYmd(date, true)}{roster.data && <> · <DualTime start={roster.data.occurrence.startUtc} end={roster.data.occurrence.endUtc} /></>}
            {!started && " · занятие ещё не началось: заранее можно отметить только уважительную причину"}
          </DialogDescription>
        </DialogHeader>
        {roster.isLoading && <p className="text-sm text-muted-foreground">Загрузка списка…</p>}
        <ErrorNote error={roster.error} />
        {rows.length > 0 && (
          <>
            {started && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Всем неотмеченным:
                <Button type="button" size="sm" variant="outline" onClick={() => setAll("present")}>Был</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setAll("absent")}>Пропуск</Button>
              </div>
            )}
            <ul className="flex flex-col divide-y divide-border/50" aria-label="Список студентов">
              {rows.map((r) => {
                const u = r.enrollment.userName;
                const cur = draft[u] ?? r.status;
                return (
                  <li key={u} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">{u}</span>{" "}
                      <span className="text-xs text-muted-foreground">{STAGE_LABELS[r.enrollment.stage]}{r.enrollment.status === "paused" ? " · пауза" : ""}</span>
                      {r.source === "self" && <span className="ml-2"><AttendancePill status={r.status} self /></span>}
                    </div>
                    <div role="radiogroup" aria-label={`Отметка: ${u}`} className="flex gap-1">
                      {ATT_ORDER.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={cur === s} disabled={!started && s !== "excused"}
                          onClick={() => setDraft((d) => ({ ...d, [u]: s }))}
                          className={cn("chip min-h-7 px-2.5 text-xs font-medium disabled:opacity-40")} aria-pressed={cur === s}>
                          {ATTENDANCE_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {roster.data && rows.length === 0 && <p className="text-sm text-muted-foreground">В когорте нет активных студентов на эту дату.</p>}
        <ErrorNote error={mark.error} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Закрыть</Button>
          <Button type="button" onClick={save} disabled={!changes.length || mark.isPending}>Сохранить{changes.length ? ` (${changes.length})` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── 1:1 ─────────────────────────────────────────────────────────────────── */

type ActionDraft = { title: string; dueOn: string; owner: "student" | "mentor" };

function localDateTimeInput(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MeetingDialog({ open, onOpenChange, students, defaultStudent, mentor }: {
  open: boolean; onOpenChange: (v: boolean) => void; students: { name: string; cohortId: number }[]; defaultStudent?: string | null; mentor: string | null;
}) {
  const create = useCreateMeeting();
  const ok = useSuccess();
  const [student, setStudent] = useState<string | null>(null);
  const [metAt, setMetAt] = useState(localDateTimeInput());
  const [duration, setDuration] = useState(30);
  const [format, setFormat] = useState<"office" | "online">("office");
  const [agenda, setAgenda] = useState("");
  const [notes, setNotes] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [items, setItems] = useState<ActionDraft[]>([]);
  useEffect(() => {
    if (!open) return;
    create.reset();
    setStudent(defaultStudent ?? null); setMetAt(localDateTimeInput()); setDuration(30); setFormat("office");
    setAgenda(""); setNotes(""); setPrivateNotes(""); setItems([{ title: "", dueOn: addDays(nyDate(), 7), owner: "student" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStudent]);
  const names = useMemo(() => [...new Set(students.map((s) => s.name))].sort((a, b) => a.localeCompare(b, "ru")), [students]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;
    const cohortId = students.find((s) => s.name === student)?.cohortId ?? null;
    create.mutate({
      student, mentor: mentor ?? undefined, cohortId, metAt: new Date(metAt).toISOString(), durationMin: duration || null, format, agenda, notes, privateNotes,
      actionItems: items.filter((i) => i.title.trim()).map((i) => ({ title: i.title.trim(), dueOn: i.dueOn || null, owner: i.owner })),
    }, { onSuccess: () => { ok("Встреча 1:1 записана", student); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Встреча 1:1</DialogTitle>
            <DialogDescription>Повестка и заметки видны студенту; «приватные заметки» — только наставникам.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field id="m-student" label="Студент">
              <Select value={student ?? undefined} onValueChange={setStudent}>
                <SelectTrigger id="m-student"><SelectValue placeholder="Выберите студента" /></SelectTrigger>
                <SelectContent>{names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="m-at" label="Когда (ваше время)"><Input id="m-at" type="datetime-local" value={metAt} onChange={(e) => setMetAt(e.target.value)} required /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="m-dur" label="Длительность, мин"><Input id="m-dur" type="number" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
            <Field label="Формат">
              <Segmented ariaLabel="Формат встречи" value={format} onChange={setFormat} options={[{ value: "office", label: "Офис" }, { value: "online", label: "Онлайн" }]} />
            </Field>
          </div>
          <Field id="m-agenda" label="Повестка"><Textarea id="m-agenda" rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={4000} placeholder="Разбор недели, комиссии, план на следующую неделю" /></Field>
          <Field id="m-notes" label="Заметки (видит студент)"><Textarea id="m-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={8000} /></Field>
          <Field id="m-private" label="Приватные заметки (только наставники)"><Textarea id="m-private" rows={2} value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} maxLength={8000} /></Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Договорённости</legend>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:grid-cols-[1fr_9.5rem_8.5rem_auto]">
                <Input className="col-span-3 sm:col-span-1" aria-label={`Договорённость ${i + 1}`} value={it.title} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Что сделать" maxLength={300} />
                <Input aria-label="Срок" type="date" value={it.dueOn} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))} />
                <Select value={it.owner} onValueChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, owner: v as "student" | "mentor" } : x)))}>
                  <SelectTrigger aria-label="Кто делает"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="student">Студент</SelectItem><SelectItem value="mentor">Наставник</SelectItem></SelectContent>
                </Select>
                <Button type="button" size="icon" variant="ghost" aria-label="Убрать договорённость" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setItems([...items, { title: "", dueOn: addDays(nyDate(), 7), owner: "student" }])}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Добавить
            </Button>
          </fieldset>
          <ErrorNote error={create.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!student || create.isPending}>Записать встречу</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Договорённость ──────────────────────────────────────────────────────── */

export function ActionDialog({ open, onOpenChange, student }: { open: boolean; onOpenChange: (v: boolean) => void; student: string }) {
  const create = useCreateAction();
  const ok = useSuccess();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState(addDays(nyDate(), 7));
  const [owner, setOwner] = useState<"student" | "mentor">("student");
  useEffect(() => { if (open) { create.reset(); setTitle(""); setDueOn(addDays(nyDate(), 7)); setOwner("student"); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ student, title: title.trim(), dueOn: dueOn || null, owner }, { onSuccess: () => { ok("Договорённость добавлена", student); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Договорённость · {student}</DialogTitle><DialogDescription>Студент увидит её в «Моём обучении» и сможет отметить выполненной.</DialogDescription></DialogHeader>
          <Field id="a-title" label="Что сделать"><Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="a-due" label="Срок"><Input id="a-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
            <Field label="Кто делает">
              <Segmented ariaLabel="Кто делает" value={owner} onChange={setOwner} size="sm" options={[{ value: "student", label: "Студент" }, { value: "mentor", label: "Наставник" }]} />
            </Field>
          </div>
          <ErrorNote error={create.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>Добавить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Цель ИПР ────────────────────────────────────────────────────────────── */

function windowLabel(m: MetricDef): string | null {
  if (m.windowKind === "days") return "Окно, торговых дней";
  if (m.windowKind === "trades") return "Окно, сделок";
  return null;
}

export function GoalDialog({ open, onOpenChange, student }: { open: boolean; onOpenChange: (v: boolean) => void; student: string }) {
  const metrics = useMetrics();
  const create = useCreateGoal();
  const ok = useSuccess();
  const list = metrics.data?.metrics ?? [];
  const [metric, setMetric] = useState<MetricKey>("fee_share");
  const def = list.find((m) => m.key === metric);
  const [title, setTitle] = useState("");
  const [comparator, setComparator] = useState<Comparator>("lt");
  const [target, setTarget] = useState(50);
  const [win, setWin] = useState<number | "">(10);
  const [startDate, setStartDate] = useState(nyDate());
  const [dueOn, setDueOn] = useState(addDays(nyDate(), 30));
  const [note, setNote] = useState("");
  const applyDefaults = (m: MetricDef | undefined) => {
    if (!m) return;
    setComparator(m.comparator); setTarget(m.defaultTarget); setWin(m.defaultWindow ?? ""); setTitle(m.key === "manual" ? "" : m.label);
  };
  useEffect(() => { if (open) { create.reset(); setMetric("fee_share"); setStartDate(nyDate()); setDueOn(addDays(nyDate(), 30)); setNote(""); applyDefaults(list.find((m) => m.key === "fee_share")); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, list.length]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      student, title: title.trim() || def?.label || "Цель", metric, comparator: metric === "manual" ? undefined : comparator, target,
      window: def && windowLabel(def) ? (win === "" ? null : Number(win)) : null, startDate, dueOn: dueOn || null, note,
      manualProgress: metric === "manual" ? 0 : undefined,
    }, { onSuccess: () => { ok("Цель добавлена в ИПР", student); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Цель ИПР · {student}</DialogTitle>
            <DialogDescription>Прогресс считается автоматически по реальным сделкам и дневнику (кроме ручных целей). При достижении или срыве срока студент и наставник получат уведомление.</DialogDescription>
          </DialogHeader>
          <Field label="Метрика">
            <div role="radiogroup" aria-label="Метрика" className="grid grid-cols-2 gap-1.5">
              {list.map((m) => (
                <button key={m.key} type="button" role="radio" aria-checked={metric === m.key} onClick={() => { setMetric(m.key); applyDefaults(m); }}
                  className={cn("glass-field rounded-lg px-3 py-2 text-left text-sm transition-colors", metric === m.key ? "ring-2 ring-primary" : "hover:bg-[var(--glass-hover-bg)]")}>
                  <span className="block font-medium text-foreground">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">{m.example}</span>
                </button>
              ))}
            </div>
          </Field>
          {def && <p className="text-xs text-muted-foreground">{def.description}</p>}
          <Field id="g-title" label="Название"><Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required /></Field>
          {metric !== "manual" && def && (
            <div className="grid grid-cols-3 gap-3">
              <Field id="g-cmp" label="Условие">
                <Select value={comparator} onValueChange={(v) => setComparator(v as Comparator)}>
                  <SelectTrigger id="g-cmp"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(COMPARATOR_SIGNS) as Comparator[]).map((c) => <SelectItem key={c} value={c}>{COMPARATOR_SIGNS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="g-target" label={`Цель${def.unit ? `, ${def.unit}` : ""}`}><Input id="g-target" type="number" step="any" value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
              {windowLabel(def) && (
                <Field id="g-win" label={windowLabel(def)!}><Input id="g-win" type="number" min={1} max={1000} value={win} onChange={(e) => setWin(e.target.value === "" ? "" : Number(e.target.value))} /></Field>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field id="g-start" label="Считать с"><Input id="g-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field id="g-due" label="Срок"><Input id="g-due" type="date" value={dueOn} min={startDate} onChange={(e) => setDueOn(e.target.value)} /></Field>
          </div>
          <Field id="g-note" label="Комментарий"><Input id="g-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          {def && metric !== "manual" && (
            <p className="text-xs text-muted-foreground">Итог: <Pill tone="accent">{def.label} {COMPARATOR_SIGNS[comparator]} {target}{def.unit ? ` ${def.unit}` : ""}{windowLabel(def) && win !== "" ? ` · окно ${win}` : ""}</Pill></p>
          )}
          <ErrorNote error={metrics.error ?? create.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={create.isPending || !list.length}>Добавить цель</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
