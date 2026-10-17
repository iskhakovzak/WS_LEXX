/**
 * «Академия» → когорты и наставничество: типы ответов (зеркало api-server/src/routes/academy-cohorts.ts и
 * lib/academyCohorts.ts) и raw-fetch хуки для /api/academy/* (orval-кодоген для новых эндпоинтов не запускается).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

/* ─── Справочники ─────────────────────────────────────────────────────────── */

export type CohortFormat = "office" | "remote" | "hybrid";
export type Stage = "trainee" | "junior" | "trader" | "senior";
export type EnrollmentStatus = "active" | "paused" | "graduated" | "dropped";
export type Recurrence = "none" | "daily" | "weekdays" | "weekly";
export type SessionMode = "office" | "online" | "hybrid";
export type SessionKind = "briefing" | "lecture" | "review" | "workshop" | "other";
export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export type ActionStatus = "open" | "done" | "dropped";
export type GoalStatus = "active" | "achieved" | "missed" | "cancelled";
export type MetricKey = "fee_share" | "loss_streak" | "win_rate" | "journal_days" | "net_pnl" | "trading_days" | "manual";
export type Comparator = "lt" | "lte" | "gte" | "gt";

export const STAGES: Stage[] = ["trainee", "junior", "trader", "senior"];
export const STAGE_LABELS: Record<Stage, string> = { trainee: "Стажёр", junior: "Джун", trader: "Трейдер", senior: "Сеньор" };
export const STATUS_LABELS: Record<EnrollmentStatus, string> = { active: "Учится", paused: "Пауза", graduated: "Выпущен", dropped: "Отчислен" };
export const FORMAT_LABELS: Record<CohortFormat, string> = { office: "Офис", remote: "Удалённо", hybrid: "Гибрид" };
export const MODE_LABELS: Record<SessionMode, string> = { office: "Офлайн", online: "Онлайн", hybrid: "Гибрид" };
export const KIND_LABELS: Record<SessionKind, string> = { briefing: "Брифинг", lecture: "Лекция", review: "Разбор", workshop: "Практикум", other: "Другое" };
export const RECURRENCE_LABELS: Record<Recurrence, string> = { none: "Разово", daily: "Ежедневно", weekdays: "По будням", weekly: "По дням недели" };
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = { present: "Был", late: "Опоздал", absent: "Пропуск", excused: "Уважит." };
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { active: "В работе", achieved: "Достигнута", missed: "Сорвана", cancelled: "Отменена" };
export const COMPARATOR_SIGNS: Record<Comparator, string> = { lt: "<", lte: "≤", gte: "≥", gt: ">" };
export const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/* ─── Типы ответов ────────────────────────────────────────────────────────── */

export type Cohort = {
  id: number; name: string; format: CohortFormat; mentor: string | null; startsOn: string | null; endsOn: string | null; timezone: string;
  description: string; room: string | null; meetingUrl: string | null; createdBy?: string | null; createdAt?: string; archivedAt?: string | null;
};
export type CohortListItem = Cohort & { counts: Record<EnrollmentStatus, number>; sessions: number };

export type Enrollment = {
  id: number; cohortId: number; userName: string; stage: Stage; stageLabel: string; status: EnrollmentStatus; statusLabel: string;
  joinedOn: string; note: string; createdAt: string; archivedAt: string | null;
};

export type AttendanceSummary = {
  total: number; present: number; late: number; absent: number; excused: number; unmarked: number;
  rate: number | null; punctuality: number | null; absentStreak: number;
};

export type Session = {
  id: number; cohortId: number; title: string; kind: SessionKind; recurrence: Recurrence; weekdays: number[]; startDate: string; endDate: string | null;
  startTime: string; durationMin: number; timezone: string; mode: SessionMode; room: string | null; meetingUrl: string | null; host: string | null;
  description: string; archivedAt: string | null; ruleText: string; next: { date: string; startUtc: string; endUtc: string } | null;
};

export type Occurrence = {
  sessionId: number; cohortId: number; cohortName: string; title: string; kind: SessionKind; mode: SessionMode; room: string | null; meetingUrl: string | null;
  host: string | null; description: string; date: string; startUtc: string; endUtc: string; timezone: string; startTimeLocal: string; ruleText: string;
};

export type AttMark = { status: AttendanceStatus; source: "mentor" | "self"; checkedInAt: string | null } | null;

export type MyOccurrence = Occurrence & {
  attendance: AttMark; checkinOpensAt: string; checkinClosesAt: string; selfCheckin: boolean; canCheckIn: boolean;
};

export type HistoryRow = {
  id: number; enrollmentId?: number; userName?: string; fromStage: Stage | null; toStage: Stage | null; fromStatus: EnrollmentStatus | null; toStatus: EnrollmentStatus | null;
  changedBy: string | null; note: string; changedAt: string;
};

export type GoalEval = {
  value: number | null; progress: number; met: boolean; achieved: boolean; sample: number; required: number | null;
  windowFrom: string | null; windowTo: string | null; detail: string;
};
export type Goal = {
  id: number; student: string; title: string; metric: MetricKey; metricLabel: string; unit: string; comparator: Comparator; target: number;
  window: number | null; startDate: string; dueOn: string | null; status: GoalStatus; manualProgress: number | null; note: string; formula: string;
  achievedAt: string | null; missedAt: string | null; createdBy: string | null; createdAt: string; eval: GoalEval;
};
export type MetricDef = {
  key: MetricKey; label: string; unit: string; comparator: Comparator; windowKind: "days" | "trades" | "since_start" | "none";
  defaultWindow: number | null; defaultTarget: number; lowerIsBetter: boolean; description: string; example: string;
};

export type ActionItem = {
  id: number; meetingId: number | null; student: string; owner: "student" | "mentor"; title: string; dueOn: string | null; status: ActionStatus;
  doneAt: string | null; createdBy: string | null; createdAt: string; overdue: boolean;
};

export type Meeting = {
  id: number; student: string; mentor: string; cohortId: number | null; metAt: string; durationMin: number | null; format: "office" | "online";
  agenda: string; notes: string; privateNotes?: string; createdBy: string | null; createdAt: string; actionItems?: ActionItem[];
};

export type CohortDetail = {
  cohort: Cohort;
  enrollments: (Enrollment & { attendance: AttendanceSummary | null; attendance30: AttendanceSummary | null })[];
  attendance: AttendanceSummary;
  sessions: Session[];
  history: HistoryRow[];
};

export type MyEnrollment = Enrollment & { cohort: Omit<Cohort, "createdBy" | "createdAt" | "archivedAt"> };
export type MyDashboard = {
  serverNow: string;
  checkin: { beforeMin: number; afterMin: number; graceMin: number };
  user: string | null;
  viewingOther?: boolean;
  enrollments: MyEnrollment[];
  upcoming: MyOccurrence[];
  recent: (Occurrence & { attendance: AttMark })[];
  attendance: { byCohort: { cohortId: number; cohortName: string; all: AttendanceSummary; last30: AttendanceSummary }[]; total: AttendanceSummary } | null;
  goals: Goal[];
  actionItems: ActionItem[];
  meetings: Meeting[];
  history?: HistoryRow[];
};

export type LagReason = { code: string; severity: "warn" | "critical"; text: string };
export type MentorStudent = {
  enrollment: Enrollment; cohortName: string; attendance: AttendanceSummary; attendance30: AttendanceSummary;
  goals: {
    active: number; achieved: number; missed: number; atRisk: number; avgProgress: number | null;
    list: { id: number; title: string; status: GoalStatus; formula: string; progress: number; value: number | null; unit: string; dueOn: string | null; detail: string }[];
  };
  openActions: number; overdueActions: number; lastTradeDate: string | null; lastJournalDate: string | null;
  reasons: LagReason[]; score: number; lastMeetingAt: string | null;
};
export type TodaySession = Occurrence & { expected: number; marked: number; byStatus: Partial<Record<AttendanceStatus, number>>; phase: "upcoming" | "live" | "done" };
export type MentorDashboard = {
  serverNow: string; scope: "mine" | "all"; hasOwnCohorts: boolean; cohorts: Cohort[]; students: MentorStudent[]; lagging: number;
  today: TodaySession[]; openActions: ActionItem[]; meetings: Meeting[];
};

export type RosterRow = { enrollment: Enrollment; status: AttendanceStatus | null; source: "mentor" | "self" | null; checkedInAt: string | null; markedBy: string | null; note: string };
export type Roster = { session: Session; occurrence: { date: string; startUtc: string; endUtc: string }; roster: RosterRow[] };

/* ─── fetch ───────────────────────────────────────────────────────────────── */

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: Record<string, unknown>;
  constructor(msg: string, status: number, body?: Record<string, unknown>) {
    super(msg);
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

async function req<T>(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j: Record<string, unknown> | null = null;
  try { j = (await r.json()) as Record<string, unknown>; } catch { /* no body */ }
  if (!r.ok) {
    const msg = r.status === 404 && !j?.error ? "Модуль «Академия» ещё не подключён на сервере" : (typeof j?.error === "string" ? j.error : `HTTP ${r.status}`);
    throw new ApiError(msg, r.status, j ?? undefined);
  }
  return j as T;
}

const enc = encodeURIComponent;

export const academyKeys = {
  all: ["academy-cohorts"] as const,
  cohorts: (archived: boolean) => ["academy-cohorts", "cohorts", archived] as const,
  cohort: (id: number) => ["academy-cohorts", "cohort", id] as const,
  my: (user: string) => ["academy-cohorts", "my", user] as const,
  mentor: (all: boolean) => ["academy-cohorts", "mentor", all] as const,
  idp: (student: string) => ["academy-cohorts", "idp", student] as const,
  metrics: ["academy-cohorts", "metrics"] as const,
  meetings: (student: string) => ["academy-cohorts", "meetings", student] as const,
  roster: (sessionId: number, date: string) => ["academy-cohorts", "roster", sessionId, date] as const,
  sessions: (cohortId: number | null, from: string, to: string) => ["academy-cohorts", "sessions", cohortId, from, to] as const,
  history: (enrollmentId: number) => ["academy-cohorts", "history", enrollmentId] as const,
};

export function useCohorts(archived = false) {
  return useQuery({ queryKey: academyKeys.cohorts(archived), queryFn: () => req<{ staff: boolean; cohorts: CohortListItem[] }>(`/api/academy/cohorts${archived ? "?archived=1" : ""}`), retry: false });
}
export function useCohort(id: number | null) {
  return useQuery({ queryKey: academyKeys.cohort(id ?? 0), enabled: !!id, queryFn: () => req<CohortDetail>(`/api/academy/cohorts/${id}`), retry: false });
}
export function useMyDashboard(user: string) {
  return useQuery({
    queryKey: academyKeys.my(user),
    queryFn: () => req<MyDashboard>(`/api/academy/my${user ? `?user=${enc(user)}` : ""}`),
    retry: false,
    refetchInterval: 60_000,
  });
}
export function useMentorDashboard(all: boolean) {
  return useQuery({ queryKey: academyKeys.mentor(all), queryFn: () => req<MentorDashboard>(`/api/academy/mentor${all ? "?all=1" : ""}`), retry: false, refetchInterval: 120_000 });
}
export function useIdp(student: string, enabled = true) {
  return useQuery({ queryKey: academyKeys.idp(student), enabled: enabled && !!student, queryFn: () => req<{ student: string; goals: Goal[] }>(`/api/academy/idp?student=${enc(student)}`), retry: false });
}
export function useMetrics() {
  return useQuery({ queryKey: academyKeys.metrics, staleTime: Infinity, queryFn: () => req<{ metrics: MetricDef[] }>("/api/academy/idp/metrics"), retry: false });
}
export function useMeetings(student: string, enabled = true) {
  return useQuery({ queryKey: academyKeys.meetings(student), enabled, queryFn: () => req<{ meetings: Meeting[] }>(`/api/academy/one-on-ones${student ? `?student=${enc(student)}` : ""}`), retry: false });
}
export function useRoster(sessionId: number | null, date: string) {
  return useQuery({ queryKey: academyKeys.roster(sessionId ?? 0, date), enabled: !!sessionId && !!date, queryFn: () => req<Roster>(`/api/academy/sessions/${sessionId}/roster?date=${date}`), retry: false });
}
export function useSchedule(cohortId: number | null, from: string, to: string) {
  return useQuery({
    queryKey: academyKeys.sessions(cohortId, from, to),
    queryFn: () => req<{ from: string; to: string; serverNow: string; sessions: Session[]; occurrences: Occurrence[] }>(
      `/api/academy/sessions?from=${from}&to=${to}${cohortId ? `&cohortId=${cohortId}` : ""}`),
    retry: false,
  });
}
export function useEnrollmentHistory(id: number | null) {
  return useQuery({ queryKey: academyKeys.history(id ?? 0), enabled: !!id, queryFn: () => req<{ history: HistoryRow[] }>(`/api/academy/enrollments/${id}/history`), retry: false });
}

/** Любая мутация «Академии»: после успеха инвалидирует все ключи модуля (данные связаны между собой). */
function useAcademyMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: academyKeys.all }) });
}

export type CohortInput = { name: string; format: CohortFormat; mentor?: string | null; startsOn?: string | null; endsOn?: string | null; timezone?: string; description?: string; room?: string | null; meetingUrl?: string | null };
export const useCreateCohort = () => useAcademyMutation((v: CohortInput) => req<Cohort>("/api/academy/cohorts", "POST", v));
export const useUpdateCohort = () => useAcademyMutation(({ id, ...v }: Partial<CohortInput> & { id: number }) => req<Cohort>(`/api/academy/cohorts/${id}`, "PATCH", v));
export const useArchiveCohort = () => useAcademyMutation(({ id, restore }: { id: number; restore?: boolean }) => req<Cohort>(`/api/academy/cohorts/${id}/${restore ? "restore" : "archive"}`, "POST"));
export const useSeedDemo = () => useAcademyMutation(() => req<{ ok: boolean; created: Record<string, number>; skippedUsers: string[] }>("/api/academy/cohorts/seed-demo", "POST"));

export type EnrollInput = { cohortId: number; userName: string; stage: Stage; status?: EnrollmentStatus; joinedOn?: string; note?: string };
export const useEnroll = () => useAcademyMutation((v: EnrollInput) => req<Enrollment>("/api/academy/enrollments", "POST", v));
export const useUpdateEnrollment = () => useAcademyMutation(({ id, ...v }: { id: number; stage?: Stage; status?: EnrollmentStatus; joinedOn?: string; note?: string; reason?: string }) =>
  req<Enrollment>(`/api/academy/enrollments/${id}`, "PATCH", v));
export const useArchiveEnrollment = () => useAcademyMutation((id: number) => req<Enrollment>(`/api/academy/enrollments/${id}/archive`, "POST"));

export type SessionInput = {
  cohortId: number; title: string; kind: SessionKind; recurrence: Recurrence; weekdays: number[]; startDate: string; endDate?: string | null; startTime: string;
  durationMin: number; timezone: string; mode: SessionMode; room?: string | null; meetingUrl?: string | null; host?: string | null; description?: string;
};
export const useCreateSession = () => useAcademyMutation((v: SessionInput) => req<Session>("/api/academy/sessions", "POST", v));
export const useUpdateSession = () => useAcademyMutation(({ id, cohortId: _c, ...v }: Partial<SessionInput> & { id: number }) => req<Session>(`/api/academy/sessions/${id}`, "PATCH", v));
export const useArchiveSession = () => useAcademyMutation((id: number) => req<Session>(`/api/academy/sessions/${id}/archive`, "POST"));

export const useMarkAttendance = () => useAcademyMutation((v: { sessionId: number; date: string; marks: { userName: string; status: AttendanceStatus; note?: string }[] }) =>
  req<{ saved: number; skipped: string[] }>("/api/academy/attendance", "POST", v));
export const useCheckin = () => useAcademyMutation((v: { sessionId: number; date: string }) =>
  req<{ already: boolean; status: AttendanceStatus; checkedInAt: string; minutesFromStart?: number }>("/api/academy/checkin", "POST", v));

export type MeetingInput = {
  student: string; mentor?: string; cohortId?: number | null; metAt: string; durationMin?: number | null; format: "office" | "online";
  agenda: string; notes: string; privateNotes: string; actionItems: { title: string; dueOn?: string | null; owner: "student" | "mentor" }[];
};
export const useCreateMeeting = () => useAcademyMutation((v: MeetingInput) => req<Meeting>("/api/academy/one-on-ones", "POST", v));
export const useArchiveMeeting = () => useAcademyMutation((id: number) => req<Meeting>(`/api/academy/one-on-ones/${id}/archive`, "POST"));

export const useCreateAction = () => useAcademyMutation((v: { student: string; title: string; dueOn?: string | null; owner: "student" | "mentor"; meetingId?: number | null }) =>
  req<ActionItem>("/api/academy/action-items", "POST", v));
export const useUpdateAction = () => useAcademyMutation(({ id, ...v }: { id: number; status?: ActionStatus; title?: string; dueOn?: string | null }) =>
  req<ActionItem>(`/api/academy/action-items/${id}`, "PATCH", v));

export type GoalInput = {
  student: string; title: string; metric: MetricKey; comparator?: Comparator; target?: number; window?: number | null; startDate?: string; dueOn?: string | null;
  manualProgress?: number | null; note?: string;
};
export const useCreateGoal = () => useAcademyMutation((v: GoalInput) => req<Goal>("/api/academy/idp", "POST", v));
export const useUpdateGoal = () => useAcademyMutation(({ id, ...v }: { id: number; manualProgress?: number; status?: "active" | "cancelled"; dueOn?: string | null; target?: number; title?: string }) =>
  req<Goal>(`/api/academy/idp/${id}`, "PATCH", v));
export const useArchiveGoal = () => useAcademyMutation((id: number) => req<{ id: number }>(`/api/academy/idp/${id}/archive`, "POST"));
