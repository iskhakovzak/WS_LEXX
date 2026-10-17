import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { Archive, CalendarDays, History as HistoryIcon, Pencil, Plus, RotateCcw, Sparkles, UserCheck, UserPlus, Users } from "lucide-react";
import {
  DataTable, EmptyState, ErrorState, ListSkeleton, Page, PageHeader, Panel, PanelSkeleton, Pill, SectionTabs, Segmented, SortableTh, StatCard, StatGrid, useTableSort,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import {
  type CohortDetail, type CohortListItem, type Enrollment, type Session, FORMAT_LABELS, KIND_LABELS, STAGE_LABELS, STATUS_LABELS,
  useArchiveCohort, useArchiveEnrollment, useArchiveSession, useCohort, useCohorts, useSchedule, useSeedDemo,
} from "@/components/academy/cohorts/api";
import { CohortDialog, EnrollDialog, EnrollmentEditDialog, RosterDialog, SessionDialog } from "@/components/academy/cohorts/dialogs";
import {
  AttendanceSummaryView, DualTime, StagePill, StatusPill, WhereLine, dateTimeLocal, fmtYmd,
} from "@/components/academy/cohorts/shared";
import { fmtRate } from "@/lib/format";

/**
 * /academy/cohorts — управление когортами деска (офис / удалённо / гибрид): состав и ступени
 * (Стажёр → Джун → Трейдер → Сеньор), расписание занятий, посещаемость, история изменений. Правки — только staff;
 * студент видит свои когорты в режиме чтения. ?id=N — открыть когорту.
 */
export default function AcademyCohortsPage() {
  const search = useSearch();
  const [archived, setArchived] = useState(false);
  const list = useCohorts(archived);
  const staff = !!list.data?.staff;
  const cohorts = list.data?.cohorts ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(new URLSearchParams(search).get("id")) || null);
  useEffect(() => {
    if (!cohorts.length) return;
    if (!selectedId || !cohorts.some((c) => c.id === selectedId)) setSelectedId(cohorts[0].id);
  }, [cohorts, selectedId]);
  const [createOpen, setCreateOpen] = useState(false);
  const seed = useSeedDemo();
  const { toast } = useToast();

  const runSeed = () => seed.mutate(undefined, {
    onSuccess: (r) => {
      const c = r.created ?? {};
      const total = Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
      toast({
        title: total ? "Демо-когорты созданы" : "Демо-данные уже есть",
        description: total ? `Когорт: ${c.cohorts ?? 0}, зачислений: ${c.enrollments ?? 0}, занятий: ${c.sessions ?? 0}, целей: ${c.goals ?? 0}` : "Повторный запуск ничего не дублирует.",
      });
    },
    onError: (e) => toast({ title: "Не удалось создать демо", description: e.message, variant: "destructive" }),
  });

  return (
    <Page>
      <PageHeader
        icon={Users}
        title="Когорты"
        description="Группы деска: состав и ступени, расписание занятий, посещаемость"
        actions={<>
          <Segmented ariaLabel="Показать" value={archived ? "arch" : "live"} onChange={(v) => setArchived(v === "arch")}
            options={[{ value: "live", label: "Действующие" }, { value: "arch", label: "Архив" }]} />
          {staff && <Button variant="outline" onClick={runSeed} disabled={seed.isPending}><Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />Демо-когорты</Button>}
          {staff && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Когорта</Button>}
        </>}
      />
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} title="Не удалось загрузить когорты" />}
      {list.isLoading && <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]"><Panel><ListSkeleton rows={4} /></Panel><PanelSkeleton height={320} /></div>}
      {list.data && cohorts.length === 0 && (
        <Panel>
          <EmptyState icon={Users} title={archived ? "Архив пуст" : "Когорт пока нет"}
            description={staff ? "Создайте когорту или запустите «Демо-когорты» (офис и удалённо, осень 2026 — на существующих пользователях)." : "Вас ещё не зачислили в когорту."}
            action={staff && !archived ? <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Создать когорту</Button> : undefined} />
        </Panel>
      )}
      {cohorts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Список когорт" className="flex flex-col gap-2">
            {cohorts.map((c) => <CohortCard key={c.id} c={c} active={c.id === selectedId} onClick={() => setSelectedId(c.id)} />)}
          </nav>
          {selectedId && <Detail id={selectedId} staff={staff} />}
        </div>
      )}
      <CohortDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Page>
  );
}

function CohortCard({ c, active, onClick }: { c: CohortListItem; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "true" : undefined}
      className={cn("glass-panel lift rounded-2xl p-3 text-left", active && "ring-2 ring-primary")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground" title={c.name}>{c.name}</span>
        <Pill tone={c.format === "office" ? "accent" : c.format === "remote" ? "purple" : "neutral"}>{FORMAT_LABELS[c.format]}</Pill>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {c.mentor ? `наставник ${c.mentor}` : "без наставника"} · {fmtYmd(c.startsOn)}{c.endsOn ? ` – ${fmtYmd(c.endsOn)}` : ""}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1 text-xs tabular-nums">
        <Pill tone="up">учатся {c.counts.active}</Pill>
        {c.counts.paused > 0 && <Pill tone="warn">пауза {c.counts.paused}</Pill>}
        {c.counts.graduated > 0 && <Pill tone="accent">выпущены {c.counts.graduated}</Pill>}
        <Pill tone="neutral">занятий {c.sessions}</Pill>
      </div>
    </button>
  );
}

type Tab = "members" | "schedule" | "attendance" | "history";

function Detail({ id, staff }: { id: number; staff: boolean }) {
  const q = useCohort(id);
  const [tab, setTab] = useState<Tab>("members");
  const [editOpen, setEditOpen] = useState(false);
  const archive = useArchiveCohort();
  const { toast } = useToast();
  if (q.isLoading) return <PanelSkeleton height={320} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Не удалось открыть когорту" />;
  const d = q.data;
  const c = d.cohort;
  const isArchived = !!c.archivedAt;
  const toggleArchive = () => {
    if (!isArchived && !window.confirm(`Отправить «${c.name}» в архив? Данные сохранятся, когорту можно будет восстановить.`)) return;
    archive.mutate({ id: c.id, restore: isArchived }, {
      onSuccess: () => toast({ title: isArchived ? "Когорта восстановлена" : "Когорта в архиве", description: c.name }),
      onError: (e) => toast({ title: "Не получилось", description: e.message, variant: "destructive" }),
    });
  };
  const active = d.enrollments.filter((e) => e.status === "active").length;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel title={c.name} icon={Users}
        description={<>
          {FORMAT_LABELS[c.format]} · {c.mentor ? `наставник ${c.mentor}` : "без наставника"} · {fmtYmd(c.startsOn, true)}{c.endsOn ? ` – ${fmtYmd(c.endsOn, true)}` : ""} · {c.timezone}
          {isArchived && <> · <b>в архиве</b></>}
        </>}
        actions={staff ? <>
          {!isArchived && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-1 h-4 w-4" aria-hidden="true" />Изменить</Button>}
          <Button size="sm" variant="ghost" onClick={toggleArchive} disabled={archive.isPending}>
            {isArchived ? <><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Восстановить</> : <><Archive className="mr-1 h-4 w-4" aria-hidden="true" />В архив</>}
          </Button>
        </> : undefined}>
        {(c.description || c.room || c.meetingUrl) && (
          <div className="flex flex-col gap-1">
            {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
            <WhereLine mode={c.format === "remote" ? "online" : c.format === "office" ? "office" : "hybrid"} room={c.room} meetingUrl={c.meetingUrl} />
          </div>
        )}
        <StatGrid className="mt-3">
          <StatCard label="Учатся" value={active} hint={`всего в составе: ${d.enrollments.length}`} />
          <StatCard label="Посещаемость" value={fmtRate(d.attendance.rate)} tone={d.attendance.rate == null ? "neutral" : d.attendance.rate >= 0.9 ? "up" : d.attendance.rate >= 0.75 ? "warn" : "down"}
            hint={staff ? "по всем студентам" : "ваша"} />
          <StatCard label="Пунктуальность" value={fmtRate(d.attendance.punctuality)} hint="пришли вовремя" />
          <StatCard label="Занятий в расписании" value={d.sessions.length} />
        </StatGrid>
      </Panel>
      <SectionTabs ariaLabel="Разделы когорты" value={tab} onChange={setTab} tabs={[
        { value: "members", label: "Состав", icon: Users, count: d.enrollments.length },
        { value: "schedule", label: "Расписание", icon: CalendarDays, count: d.sessions.length },
        { value: "attendance", label: "Посещаемость", icon: UserCheck },
        ...(staff ? [{ value: "history" as const, label: "История", icon: HistoryIcon, count: d.history.length }] : []),
      ]} />
      {tab === "members" && <Members d={d} staff={staff && !isArchived} />}
      {tab === "schedule" && <Schedule d={d} staff={staff && !isArchived} />}
      {tab === "attendance" && <AttendanceTab d={d} />}
      {tab === "history" && staff && <HistoryTab d={d} />}
      {staff && <CohortDialog open={editOpen} onOpenChange={setEditOpen} cohort={c} />}
    </div>
  );
}

type MemberRow = CohortDetail["enrollments"][number];
const STAGE_ORDER: Record<string, number> = { trainee: 0, junior: 1, trader: 2, senior: 3 };
const MEMBER_ACCESSORS = {
  name: (e: MemberRow) => e.userName,
  stage: (e: MemberRow) => STAGE_ORDER[e.stage] ?? 9,
  status: (e: MemberRow) => e.statusLabel,
  joined: (e: MemberRow) => e.joinedOn,
  att: (e: MemberRow) => e.attendance?.rate ?? null,
  att30: (e: MemberRow) => e.attendance30?.rate ?? null,
};
const ATT_ACCESSORS = {
  name: (e: MemberRow) => e.userName,
  total: (e: MemberRow) => e.attendance?.total ?? null,
  present: (e: MemberRow) => e.attendance?.present ?? null,
  late: (e: MemberRow) => e.attendance?.late ?? null,
  absent: (e: MemberRow) => e.attendance?.absent ?? null,
  excused: (e: MemberRow) => e.attendance?.excused ?? null,
  unmarked: (e: MemberRow) => e.attendance?.unmarked ?? null,
  rate: (e: MemberRow) => e.attendance?.rate ?? null,
  rate30: (e: MemberRow) => e.attendance30?.rate ?? null,
  streak: (e: MemberRow) => e.attendance?.absentStreak ?? null,
};

function Members({ d, staff }: { d: CohortDetail; staff: boolean }) {
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [edit, setEdit] = useState<Enrollment | null>(null);
  const archive = useArchiveEnrollment();
  const { toast } = useToast();
  const { rows: members, thProps } = useTableSort(d.enrollments, MEMBER_ACCESSORS, "name", "asc");
  const remove = (e: Enrollment) => {
    if (!window.confirm(`Убрать ${e.userName} из когорты? Запись уйдёт в архив (история и посещаемость сохранятся). Для выпуска/отчисления лучше сменить статус.`)) return;
    archive.mutate(e.id, {
      onSuccess: () => toast({ title: "Убран из когорты", description: e.userName }),
      onError: (err) => toast({ title: "Не получилось", description: err.message, variant: "destructive" }),
    });
  };
  return (
    <Panel title="Состав" icon={Users} description="Ступени: Стажёр → Джун → Трейдер → Сеньор. Изменения ступени и статуса пишутся в историю."
      actions={staff ? <Button size="sm" onClick={() => setEnrollOpen(true)}><UserPlus className="mr-1 h-4 w-4" aria-hidden="true" />Зачислить</Button> : undefined}>
      {d.enrollments.length === 0 ? <p className="text-sm text-muted-foreground">В когорте пока никого нет.</p> : (
        <DataTable ariaLabel="Состав когорты">
          <table>
            <thead><tr>
              <SortableTh {...thProps("name")}>Студент</SortableTh>
              <SortableTh {...thProps("stage")}>Ступень</SortableTh>
              <SortableTh {...thProps("status")}>Статус</SortableTh>
              <SortableTh {...thProps("joined")}>С</SortableTh>
              <SortableTh {...thProps("att")} align="right">Посещ. всего</SortableTh>
              <SortableTh {...thProps("att30")} align="right">30 дн.</SortableTh>
              {staff && <th scope="col"><span className="sr-only">Действия</span></th>}
            </tr></thead>
            <tbody>
              {members.map((e) => (
                <tr key={e.id}>
                  <td>
                    {staff ? <Link href={`/academy/mentor?student=${encodeURIComponent(e.userName)}`} className="font-medium text-foreground hover:underline">{e.userName}</Link>
                      : <span className="font-medium">{e.userName}</span>}
                    {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
                  </td>
                  <td><StagePill stage={e.stage} /></td>
                  <td><StatusPill status={e.status} /></td>
                  <td className="whitespace-nowrap">{fmtYmd(e.joinedOn)}</td>
                  <td className="text-right">{e.attendance ? fmtRate(e.attendance.rate) : "—"}</td>
                  <td className="text-right">{e.attendance30 ? fmtRate(e.attendance30.rate) : "—"}</td>
                  {staff && (
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Ступень / статус</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(e)} aria-label={`Убрать ${e.userName}`} title="Убрать из когорты"><Archive className="h-4 w-4" /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
      {staff && <EnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} cohort={d.cohort} existing={d.enrollments.map((e) => e.userName)} />}
      <EnrollmentEditDialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }} enrollment={edit} />
    </Panel>
  );
}

function Schedule({ d, staff }: { d: CohortDetail; staff: boolean }) {
  const [edit, setEdit] = useState<Session | null | undefined>(undefined);
  const [roster, setRoster] = useState<{ sessionId: number; date: string; title: string } | null>(null);
  const archive = useArchiveSession();
  const { toast } = useToast();
  const today = nyDate();
  const [weekOffset, setWeekOffset] = useState(0);
  const from = addDays(today, weekOffset * 7 - 7);
  const to = addDays(from, 20);
  const sched = useSchedule(d.cohort.id, from, to);
  const occ = sched.data?.occurrences ?? [];
  const now = Date.now();
  const removeSession = (s: Session) => {
    if (!window.confirm(`Убрать занятие «${s.title}» из расписания? Прошедшие отметки сохранятся.`)) return;
    archive.mutate(s.id, {
      onSuccess: () => toast({ title: "Занятие убрано из расписания", description: s.title }),
      onError: (e) => toast({ title: "Не получилось", description: e.message, variant: "destructive" }),
    });
  };
  const byDay = useMemo(() => {
    const m = new Map<string, typeof occ>();
    for (const o of occ) m.set(o.date, [...(m.get(o.date) ?? []), o]);
    return [...m.entries()];
  }, [occ]);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Занятия" icon={CalendarDays} description="Повторяющиеся и разовые. Время показывается по вашему часовому поясу и по Нью-Йорку."
        actions={staff ? <Button size="sm" onClick={() => setEdit(null)}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Занятие</Button> : undefined}>
        {d.sessions.length === 0 && <p className="text-sm text-muted-foreground">Расписание пустое.</p>}
        <ul className="flex flex-col gap-2">
          {d.sessions.map((s) => (
            <li key={s.id} className="glass-field flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{s.title}</span>
                  <Pill tone="neutral">{KIND_LABELS[s.kind] ?? s.kind}</Pill>
                  {s.host && <span className="text-xs text-muted-foreground">ведёт {s.host}</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.ruleText} · {s.durationMin} мин{s.endDate ? ` · до ${fmtYmd(s.endDate)}` : ""}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
                  {s.next ? <span>Следующее: <DualTime start={s.next.startUtc} end={s.next.endUtc} showDay /></span> : <span className="text-xs text-muted-foreground">больше не повторяется</span>}
                  <WhereLine mode={s.mode} room={s.room} meetingUrl={s.meetingUrl} />
                </div>
              </div>
              {staff && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(s)} aria-label={`Изменить «${s.title}»`} title="Изменить"><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSession(s)} aria-label={`Убрать «${s.title}»`} title="Убрать из расписания"><Archive className="h-4 w-4" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Календарь" icon={CalendarDays} description={`${fmtYmd(from)} – ${fmtYmd(to)} (даты по Нью-Йорку)`}
        actions={<div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Неделей раньше">←</Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>Сегодня</Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Неделей позже">→</Button>
        </div>}>
        {sched.isLoading && <ListSkeleton rows={4} dense />}
        {sched.isError && <ErrorState error={sched.error} compact />}
        {sched.data && byDay.length === 0 && <p className="text-sm text-muted-foreground">В этом диапазоне занятий нет.</p>}
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {byDay.map(([day, list]) => (
            <section key={day} aria-label={fmtYmd(day)} className={cn("glass-field rounded-xl p-2", day === today && "ring-1 ring-primary/60")}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{fmtYmd(day)}{day === today ? " · сегодня" : ""}</h3>
              <ul className="flex flex-col gap-1">
                {list.map((o) => {
                  const started = now >= new Date(o.startUtc).getTime() - 10 * 60000;
                  return (
                    <li key={`${o.sessionId}-${o.date}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate"><DualTime start={o.startUtc} /> <span className="text-muted-foreground">{o.title}</span></span>
                      {staff && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setRoster({ sessionId: o.sessionId, date: o.date, title: o.title })}>
                          {started ? "Отметки" : "Уважит."}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Panel>
      {staff && <SessionDialog open={edit !== undefined} onOpenChange={(v) => { if (!v) setEdit(undefined); }} cohort={d.cohort} session={edit ?? null} />}
      <RosterDialog open={!!roster} onOpenChange={(v) => { if (!v) setRoster(null); }} sessionId={roster?.sessionId ?? null} date={roster?.date ?? ""} title={roster?.title} />
    </div>
  );
}

function AttendanceTab({ d }: { d: CohortDetail }) {
  const withStats = useMemo(() => d.enrollments.filter((e) => e.attendance), [d.enrollments]);
  const { rows: sorted, thProps } = useTableSort(withStats, ATT_ACCESSORS, "rate", "asc");
  return (
    <Panel title="Посещаемость" icon={UserCheck} description="Считаются прошедшие занятия с даты зачисления. Процент = (был + опоздал) / (был + опоздал + пропуск).">
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <AttendanceSummaryView s={d.attendance} title="Когорта целиком" />
        {withStats.length === 0 ? <p className="text-sm text-muted-foreground">Данных пока нет.</p> : (
          <DataTable ariaLabel="Посещаемость по студентам">
            <table>
              <thead><tr>
                <SortableTh {...thProps("name")}>Студент</SortableTh>
                <SortableTh {...thProps("total")}>Занятий</SortableTh>
                <SortableTh {...thProps("present")}>Был</SortableTh>
                <SortableTh {...thProps("late")}>Опоздал</SortableTh>
                <SortableTh {...thProps("absent")}>Пропуск</SortableTh>
                <SortableTh {...thProps("excused")}>Уважит.</SortableTh>
                <SortableTh {...thProps("unmarked")}>Не отмечено</SortableTh>
                <SortableTh {...thProps("rate")}>Всего</SortableTh>
                <SortableTh {...thProps("rate30")}>30 дн.</SortableTh>
                <SortableTh {...thProps("streak")}>Подряд пропусков</SortableTh>
              </tr></thead>
              <tbody>
                {sorted.map((e) => {
                  const a = e.attendance!;
                  return (
                    <tr key={e.id}>
                      <td className="font-medium">{e.userName}</td><td>{a.total}</td><td>{a.present}</td><td>{a.late}</td><td>{a.absent}</td><td>{a.excused}</td><td>{a.unmarked}</td>
                      <td className={cn(a.rate != null && (a.rate >= 0.9 ? "text-up" : a.rate >= 0.75 ? "text-warn" : "text-down"))}>{fmtRate(a.rate)}</td>
                      <td>{fmtRate(e.attendance30?.rate ?? null)}</td>
                      <td className={cn(a.absentStreak > 1 && "text-down")}>{a.absentStreak || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTable>
        )}
      </div>
    </Panel>
  );
}

function HistoryTab({ d }: { d: CohortDetail }) {
  return (
    <Panel title="История ступеней и статусов" icon={HistoryIcon} description="Последние 50 изменений">
      {d.history.length === 0 && <p className="text-sm text-muted-foreground">Изменений пока не было.</p>}
      <ol className="flex flex-col divide-y divide-border/50">
        {d.history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            <span className="tabular-nums text-muted-foreground">{dateTimeLocal(h.changedAt)}</span>
            <span className="font-medium">{h.userName}</span>
            {h.fromStage !== h.toStage && h.toStage && <span>{h.fromStage ? STAGE_LABELS[h.fromStage] : "—"} → <b>{STAGE_LABELS[h.toStage]}</b></span>}
            {h.fromStatus !== h.toStatus && h.toStatus && <span>{h.fromStatus ? STATUS_LABELS[h.fromStatus] : "—"} → <b>{STATUS_LABELS[h.toStatus]}</b></span>}
            {h.changedBy && <span className="text-xs text-muted-foreground">({h.changedBy})</span>}
            {h.note && <span className="w-full text-xs text-muted-foreground">{h.note}</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
