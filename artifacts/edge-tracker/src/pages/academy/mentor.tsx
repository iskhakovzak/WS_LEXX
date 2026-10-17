import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { AlertTriangle, CalendarClock, ClipboardCheck, ListChecks, MessagesSquare, Plus, Target, UserCog, Users, X } from "lucide-react";
import {
  DataTable, EmptyState, ErrorState, Page, PageHeader, Panel, PanelSkeleton, Pill, Segmented, SortableTh, StatCard, StatGrid, StatGridSkeleton, useTableSort, type Tone,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import {
  type ActionItem, type MentorDashboard, type MentorStudent, type TodaySession, ATTENDANCE_LABELS, type AttendanceStatus, KIND_LABELS,
  useArchiveGoal, useIdp, useMeetings, useMentorDashboard, useUpdateAction, useUpdateGoal,
} from "@/components/academy/cohorts/api";
import { ActionDialog, EnrollmentEditDialog, GoalDialog, MeetingDialog, RosterDialog } from "@/components/academy/cohorts/dialogs";
import {
  ATT_TONE, DualTime, GoalCard, StagePill, WhereLine, dateTimeLocal, fmtYmd,
} from "@/components/academy/cohorts/shared";
import { fmtRate } from "@/lib/format";

/**
 * /academy/mentor — дашборд наставника: мои студенты и кто отстаёт (с причинами), сегодняшние занятия с отметкой,
 * открытые договорённости и журнал 1:1. Только staff. ?student=Имя — открыть карточку студента (ссылки из уведомлений).
 */
export default function AcademyMentorPage() {
  const { isCurator, user } = useAuth();
  const search = useSearch();
  const [all, setAll] = useState(false);
  const q = useMentorDashboard(all);
  const d = q.data;
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(search).get("student"));
  useEffect(() => { const s = new URLSearchParams(search).get("student"); if (s) setSelected(s); }, [search]);
  const [meetingFor, setMeetingFor] = useState<string | null | undefined>(undefined);

  if (!isCurator) {
    return (
      <Page>
        <PageHeader icon={UserCog} title="Наставник" />
        <Panel><EmptyState icon={UserCog} title="Раздел для наставников и кураторов" description={<>Своё обучение смотрите в <Link className="text-primary hover:underline" href="/academy/my">«Моём обучении»</Link>.</>} /></Panel>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        icon={UserCog}
        title="Наставник"
        description="Студенты, отставание и его причины, занятия сегодня, договорённости и встречи 1:1"
        actions={<>
          {d?.hasOwnCohorts && (
            <Segmented ariaLabel="Какие когорты" value={all ? "all" : "mine"} onChange={(v) => setAll(v === "all")}
              options={[{ value: "mine", label: "Мои когорты" }, { value: "all", label: "Все" }]} />
          )}
          <Button onClick={() => setMeetingFor(selected)} disabled={!d?.students.length}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Встреча 1:1</Button>
        </>}
      />
      {q.isLoading && <><StatGridSkeleton count={4} /><PanelSkeleton height={280} /></>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="Не удалось загрузить дашборд наставника" />}
      {d && d.cohorts.length === 0 && (
        <Panel><EmptyState icon={Users} title="Когорт пока нет" description="Создайте когорту и зачислите студентов." action={<Button asChild><Link href="/academy/cohorts">К когортам</Link></Button>} /></Panel>
      )}
      {d && d.cohorts.length > 0 && (
        <>
          {!d.hasOwnCohorts && <p className="text-xs text-muted-foreground">Вы не назначены наставником ни одной когорты — показаны все когорты деска.</p>}
          <Kpis d={d} />
          {/* Side-by-side only on wide screens: at 1280–1440 px the students table needs the full width («Почему отстаёт»). */}
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <Students d={d} selected={selected} onSelect={setSelected} onMeeting={(s) => setMeetingFor(s)} />
            <Today sessions={d.today} />
          </div>
          {selected && d.students.some((s) => s.enrollment.userName === selected) && (
            <StudentDetail student={d.students.find((s) => s.enrollment.userName === selected)!} onClose={() => setSelected(null)} onMeeting={() => setMeetingFor(selected)} />
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <OpenActions items={d.openActions} />
            <MeetingLog d={d} />
          </div>
          <MeetingDialog open={meetingFor !== undefined} onOpenChange={(v) => { if (!v) setMeetingFor(undefined); }}
            students={d.students.map((s) => ({ name: s.enrollment.userName, cohortId: s.enrollment.cohortId }))} defaultStudent={meetingFor ?? null} mentor={user?.traderName ?? null} />
        </>
      )}
    </Page>
  );
}

function Kpis({ d }: { d: MentorDashboard }) {
  const overdue = d.openActions.filter((a) => a.overdue).length;
  const rates = d.students.map((s) => s.attendance30).filter((a) => a.rate != null);
  const avg = rates.length ? rates.reduce((x, a) => x + (a.rate ?? 0), 0) / rates.length : null;
  return (
    <StatGrid>
      <StatCard label="Студентов" icon={Users} value={new Set(d.students.map((s) => s.enrollment.userName)).size} hint={`когорт: ${d.cohorts.length}`} />
      <StatCard label="Отстают" icon={AlertTriangle} value={d.lagging} tone={d.lagging ? "warn" : "up"} hint={d.lagging ? "см. причины в таблице" : "все в графике"} />
      <StatCard label="Посещаемость, 30 дн." icon={ClipboardCheck} value={fmtRate(avg)} tone={avg == null ? "neutral" : avg >= 0.9 ? "up" : avg >= 0.75 ? "warn" : "down"} hint="среднее по студентам" />
      <StatCard label="Открытые договорённости" icon={ListChecks} value={d.openActions.length} tone={overdue ? "down" : "neutral"} hint={overdue ? `просрочено: ${overdue}` : "без просрочек"} />
    </StatGrid>
  );
}

const sevTone = (s: "warn" | "critical"): Tone => (s === "critical" ? "down" : "warn");

type StudentRow = MentorDashboard["students"][number];
const STAGE_ORDER: Record<string, number> = { trainee: 0, junior: 1, trader: 2, senior: 3 };
const STUDENT_ACCESSORS = {
  name: (s: StudentRow) => s.enrollment.userName,
  stage: (s: StudentRow) => STAGE_ORDER[s.enrollment.stage] ?? 9,
  att: (s: StudentRow) => s.attendance30.rate,
  goals: (s: StudentRow) => {
    const n = s.goals.active + s.goals.achieved + s.goals.missed;
    return n ? s.goals.achieved / n : null;
  },
  actions: (s: StudentRow) => s.overdueActions * 1000 + s.openActions,
  last: (s: StudentRow) => s.lastTradeDate ?? s.lastJournalDate ?? null,
  score: (s: StudentRow) => s.score,
};

function Students({ d, selected, onSelect, onMeeting }: { d: MentorDashboard; selected: string | null; onSelect: (s: string | null) => void; onMeeting: (s: string) => void }) {
  const [filter, setFilter] = useState<"all" | "lagging">("all");
  const filtered = useMemo(() => (filter === "lagging" ? d.students.filter((s) => s.score > 0) : d.students), [d.students, filter]);
  const { rows, thProps } = useTableSort(filtered, STUDENT_ACCESSORS, "score");
  return (
    <Panel title="Мои студенты" icon={Users} description="По умолчанию сначала отстающие; столбцы сортируются. Нажмите на строку, чтобы открыть цели и встречи."
      actions={<Segmented ariaLabel="Фильтр студентов" size="sm" value={filter} onChange={setFilter}
        options={[{ value: "all", label: "Все", count: d.students.length }, { value: "lagging", label: "Отстают", count: d.lagging }]} />}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{filter === "lagging" ? "Отстающих нет." : "В когортах нет активных студентов."}</p> : (
        <DataTable ariaLabel="Студенты" maxHeight="60vh">
          <table>
            <thead>
              <tr>
                <SortableTh {...thProps("name")}>Студент</SortableTh>
                <SortableTh {...thProps("stage")}>Ступень</SortableTh>
                <SortableTh {...thProps("att")}>Посещ. 30 дн.</SortableTh>
                <SortableTh {...thProps("goals")}>ИПР</SortableTh>
                <SortableTh {...thProps("actions")}>Договор.</SortableTh>
                <SortableTh {...thProps("last")}>Сделка / дневник</SortableTh>
                <SortableTh {...thProps("score")}>Почему отстаёт</SortableTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const u = s.enrollment.userName;
                const a = s.attendance30;
                return (
                  <tr key={s.enrollment.id} aria-selected={selected === u} className={cn("cursor-pointer", selected === u && "bg-[var(--glass-bg)]")}
                    onClick={() => onSelect(selected === u ? null : u)}>
                    <td>
                      <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); onSelect(u); }}>{u}</button>
                      <div className="text-xs text-muted-foreground">{s.cohortName}{s.enrollment.status === "paused" ? " · пауза" : ""}</div>
                    </td>
                    <td><StagePill stage={s.enrollment.stage} /></td>
                    <td>
                      <span className={cn(a.rate == null ? "text-muted-foreground" : a.rate >= 0.9 ? "text-up" : a.rate >= 0.75 ? "text-warn" : "text-down")}>{fmtRate(a.rate)}</span>
                      {a.total > 0 && <div className="text-xs text-muted-foreground" title="был / опоздал / пропуск · не отмечено">{a.present}/{a.late}/{a.absent}{a.unmarked ? ` · ? ${a.unmarked}` : ""}</div>}
                    </td>
                    <td>
                      {s.goals.active + s.goals.achieved + s.goals.missed === 0 ? <span className="text-muted-foreground">—</span> : (
                        <>
                          <span>{s.goals.achieved}/{s.goals.active + s.goals.achieved + s.goals.missed}</span>
                          {s.goals.avgProgress != null && <div className="text-xs text-muted-foreground">в работе ~{Math.round(s.goals.avgProgress * 100)} %</div>}
                        </>
                      )}
                    </td>
                    <td>
                      {s.openActions}
                      {s.overdueActions > 0 && <span className="ml-1 text-xs text-down">({s.overdueActions} просроч.)</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      <div>{s.lastTradeDate ? <Link href={links.trades({ date: s.lastTradeDate })} className="hover:underline" onClick={(e) => e.stopPropagation()}>{fmtYmd(s.lastTradeDate)}</Link> : "—"}</div>
                      <div className="text-muted-foreground">{s.lastJournalDate ? <Link href={links.journalDay(s.lastJournalDate, u)} className="hover:underline" onClick={(e) => e.stopPropagation()}>{fmtYmd(s.lastJournalDate)}</Link> : "дневника нет"}</div>
                    </td>
                    <td>
                      {s.reasons.length === 0 ? <Pill tone="up">в графике</Pill> : (
                        <div className="flex max-w-[22rem] flex-wrap gap-1">
                          {s.reasons.map((r) => <Pill key={r.code} tone={sevTone(r.severity)} className="whitespace-normal rounded-lg" title={r.text}>{r.text}</Pill>)}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        1:1: {s.lastMeetingAt ? dateTimeLocal(s.lastMeetingAt) : "не было"}{" "}
                        <button type="button" className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onMeeting(u); }}>записать</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

const PHASE: Record<TodaySession["phase"], { label: string; tone: Tone }> = {
  upcoming: { label: "впереди", tone: "neutral" }, live: { label: "идёт", tone: "accent" }, done: { label: "прошло", tone: "neutral" },
};

function Today({ sessions }: { sessions: TodaySession[] }) {
  const [roster, setRoster] = useState<TodaySession | null>(null);
  return (
    <Panel title="Сегодня" icon={CalendarClock} description="Занятия по дате Нью-Йорка">
      {sessions.length === 0 && <p className="text-sm text-muted-foreground">Сегодня занятий нет.</p>}
      <ul className="flex flex-col gap-2">
        {sessions.map((o) => {
          const missing = Math.max(0, o.expected - o.marked);
          return (
            <li key={`${o.sessionId}-${o.date}`} className={cn("glass-field rounded-xl px-3 py-2", o.phase === "live" && "ring-1 ring-primary/60")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{o.title}</span>
                <Pill tone={PHASE[o.phase].tone} dot={o.phase === "live"}>{PHASE[o.phase].label}</Pill>
                <span className="text-xs text-muted-foreground">{KIND_LABELS[o.kind] ?? o.kind} · {o.cohortName}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm"><DualTime start={o.startUtc} end={o.endUtc} /><WhereLine mode={o.mode} room={o.room} meetingUrl={o.meetingUrl} /></div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1 text-xs">
                  {(Object.keys(o.byStatus) as AttendanceStatus[]).map((k) => <Pill key={k} tone={ATT_TONE[k]}>{ATTENDANCE_LABELS[k]} {o.byStatus[k]}</Pill>)}
                  {o.phase !== "upcoming" && missing > 0 && <Pill tone="warn">не отмечено {missing}</Pill>}
                  {o.expected === 0 && <span className="text-muted-foreground">нет студентов</span>}
                </div>
                <Button size="sm" variant={o.phase === "upcoming" ? "outline" : "default"} onClick={() => setRoster(o)} disabled={o.expected === 0}>Отметить</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <RosterDialog open={!!roster} onOpenChange={(v) => { if (!v) setRoster(null); }} sessionId={roster?.sessionId ?? null} date={roster?.date ?? ""} title={roster?.title} />
    </Panel>
  );
}

function StudentDetail({ student, onClose, onMeeting }: { student: MentorStudent; onClose: () => void; onMeeting: () => void }) {
  const u = student.enrollment.userName;
  const idp = useIdp(u);
  const meetings = useMeetings(u);
  const [allMeetings, setAllMeetings] = useState(false);
  const archive = useArchiveGoal();
  const updGoal = useUpdateGoal();
  const { toast } = useToast();
  const [goalOpen, setGoalOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const err = (e: Error) => toast({ title: "Не сохранено", description: e.message, variant: "destructive" });
  // The card opens under the (long) students table — bring it into view when a student is picked.
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    boxRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [u]);
  const archiveGoal = (id: number, title: string) => {
    if (!window.confirm(`Убрать цель «${title}» в архив?`)) return;
    archive.mutate(id, { onSuccess: () => toast({ title: "Цель в архиве" }), onError: err });
  };
  return (
    <div ref={boxRef} className="scroll-mt-[var(--sticky-top)]">
    <Panel title={`${u} · ${student.cohortName}`} icon={Target}
      description={`С ${fmtYmd(student.enrollment.joinedOn, true)} · посещаемость всего ${fmtRate(student.attendance.rate)}`}
      actions={<>
        <StagePill stage={student.enrollment.stage} />
        <Button size="sm" variant="outline" onClick={() => setStageOpen(true)}>Ступень / статус</Button>
        <Button size="sm" variant="outline" onClick={() => setGoalOpen(true)}><Target className="mr-1 h-4 w-4" aria-hidden="true" />Цель</Button>
        <Button size="sm" variant="outline" onClick={() => setActionOpen(true)}><ListChecks className="mr-1 h-4 w-4" aria-hidden="true" />Договорённость</Button>
        <Button size="sm" variant="outline" onClick={onMeeting}><MessagesSquare className="mr-1 h-4 w-4" aria-hidden="true" />1:1</Button>
        <Button size="sm" variant="ghost" asChild><Link href={`/academy/my?user=${encodeURIComponent(u)}`}>Глазами студента</Link></Button>
        <Button size="icon" variant="ghost" aria-label="Закрыть карточку" onClick={onClose}><X className="h-4 w-4" /></Button>
      </>}>
      {student.reasons.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1" aria-label="Причины отставания">
          {student.reasons.map((r) => <Pill key={r.code} tone={sevTone(r.severity)}>{r.text}</Pill>)}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Цели ИПР">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">ИПР</h3>
          {idp.isLoading && <p className="text-sm text-muted-foreground">Пересчёт по сделкам…</p>}
          {idp.data && idp.data.goals.length === 0 && <p className="text-sm text-muted-foreground">Целей нет. Добавьте, например, «доля комиссий &lt; 50 % за 10 дней».</p>}
          <div className="flex flex-col gap-2">
            {idp.data?.goals.map((g) => (
              <GoalCard key={g.id} goal={g} compact actions={<>
                {g.status === "active" && <Button size="sm" variant="ghost" onClick={() => updGoal.mutate({ id: g.id, status: "cancelled" }, { onError: err })}>Отменить</Button>}
                {(g.status === "cancelled" || g.status === "missed") && <Button size="sm" variant="ghost" onClick={() => updGoal.mutate({ id: g.id, status: "active" }, { onError: err })}>Вернуть</Button>}
                <Button size="sm" variant="ghost" onClick={() => archiveGoal(g.id, g.title)} disabled={archive.isPending}>В архив</Button>
              </>} />
            ))}
          </div>
        </section>
        <section aria-label="Встречи 1:1">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Встречи 1:1</h3>
          {meetings.data && meetings.data.meetings.length === 0 && <p className="text-sm text-muted-foreground">Встреч не было.</p>}
          <ul className="flex flex-col gap-2">
            {meetings.data?.meetings.slice(0, allMeetings ? undefined : 6).map((m) => (
              <li key={m.id} className="glass-field rounded-xl px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-2"><b className="tabular-nums">{dateTimeLocal(m.metAt)}</b><span className="text-muted-foreground">{m.mentor}{m.durationMin ? ` · ${m.durationMin} мин` : ""}</span></div>
                {m.agenda && <p className="mt-1">{m.agenda}</p>}
                {m.notes && <p className="mt-1 whitespace-pre-line text-muted-foreground">{m.notes}</p>}
                {m.privateNotes && <p className="mt-1 whitespace-pre-line text-xs text-warn">Приватно: {m.privateNotes}</p>}
                {m.actionItems && m.actionItems.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {m.actionItems.map((a) => <li key={a.id} className={cn(a.status === "done" && "line-through", a.overdue && "text-down")}>• {a.title}{a.dueOn ? ` — ${fmtYmd(a.dueOn)}` : ""}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {(meetings.data?.meetings.length ?? 0) > 6 && (
            <button type="button" onClick={() => setAllMeetings((v) => !v)} className="mt-2 text-xs text-primary hover:underline">
              {allMeetings ? "Свернуть" : `Показать все (${meetings.data!.meetings.length})`}
            </button>
          )}
        </section>
      </div>
      <GoalDialog open={goalOpen} onOpenChange={setGoalOpen} student={u} />
      <ActionDialog open={actionOpen} onOpenChange={setActionOpen} student={u} />
      <EnrollmentEditDialog open={stageOpen} onOpenChange={setStageOpen} enrollment={student.enrollment} />
    </Panel>
    </div>
  );
}

function OpenActions({ items }: { items: ActionItem[] }) {
  const upd = useUpdateAction();
  const { toast } = useToast();
  const sorted = useMemo(() => [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999")), [items]);
  return (
    <Panel title="Открытые договорённости" icon={ListChecks}>
      {sorted.length === 0 && <p className="text-sm text-muted-foreground">Всё выполнено.</p>}
      <ul className="flex flex-col divide-y divide-border/50">
        {sorted.slice(0, 40).map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-2">
            <Checkbox id={`ma-${a.id}`} checked={a.status === "done"} aria-label={`Выполнено: ${a.title}`} className="mt-0.5"
              onCheckedChange={(c) => upd.mutate({ id: a.id, status: c ? "done" : "open" }, { onError: (e) => toast({ title: "Не сохранено", description: e.message, variant: "destructive" }) })} />
            <label htmlFor={`ma-${a.id}`} className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{a.student}</span>: {a.title}
              <span className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {a.owner === "mentor" && <span>за наставником</span>}
                {a.dueOn && <span className={cn(a.overdue && "font-medium text-down")}>срок {fmtYmd(a.dueOn)}{a.overdue ? " · просрочено" : ""}</span>}
              </span>
            </label>
            <Button size="sm" variant="ghost" disabled={upd.isPending} aria-label={`Снять договорённость: ${a.title}`}
              onClick={() => upd.mutate({ id: a.id, status: "dropped" }, {
                onSuccess: () => toast({ title: "Договорённость снята", description: a.title }),
                onError: (e) => toast({ title: "Не сохранено", description: e.message, variant: "destructive" }),
              })}>Снять</Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MeetingLog({ d }: { d: MentorDashboard }) {
  const [all, setAll] = useState(false);
  return (
    <Panel title="Журнал 1:1" icon={MessagesSquare} description="Последние 30 встреч со студентами">
      {d.meetings.length === 0 && <p className="text-sm text-muted-foreground">Встреч пока нет.</p>}
      <ul className="flex flex-col gap-2">
        {d.meetings.slice(0, all ? undefined : 12).map((m) => (
          <li key={m.id} className="glass-field rounded-xl px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b className="tabular-nums">{dateTimeLocal(m.metAt)}</b>
              <span className="font-medium">{m.student}</span>
              <span className="text-xs text-muted-foreground">с {m.mentor} · {m.format === "online" ? "онлайн" : "офис"}</span>
            </div>
            {m.agenda && <p className="mt-1 text-muted-foreground">{m.agenda}</p>}
          </li>
        ))}
      </ul>
      {d.meetings.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-primary hover:underline">
          {all ? "Свернуть" : `Показать все (${d.meetings.length})`}
        </button>
      )}
    </Panel>
  );
}
