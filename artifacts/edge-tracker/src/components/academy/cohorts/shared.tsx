/**
 * Общие куски UI «Академии» (когорты / наставничество): время (локальное + Нью-Йорк), пилюли ступени / статуса /
 * посещаемости, карточка цели ИПР, сводка посещаемости, выбор пользователя.
 */
import { useEffect, useState } from "react";
import { ExternalLink, MapPin, Video } from "lucide-react";
import { Pill, ProgressRing, StatRow, type Tone } from "@/components/ds";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  ATTENDANCE_LABELS, type AttendanceStatus, type AttendanceSummary, type EnrollmentStatus, GOAL_STATUS_LABELS, type Goal, type GoalStatus,
  MODE_LABELS, type SessionMode, STAGE_LABELS, STATUS_LABELS, type Stage,
} from "./api";

export const NY_TZ = "America/New_York";
export const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || NY_TZ; } catch { return NY_TZ; } })();
export const SAME_TZ = LOCAL_TZ === NY_TZ;

function fmt(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions): string {
  try { return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, ...opts }).format(new Date(iso)); } catch { return ""; }
}
export const timeIn = (iso: string | Date, tz: string) => fmt(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const dayIn = (iso: string | Date, tz: string) => fmt(iso, tz, { weekday: "short", day: "numeric", month: "short" });
export const dateTimeLocal = (iso: string | Date | null | undefined) => (iso ? fmt(iso, LOCAL_TZ, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—");
export function fmtYmd(ymd: string | null | undefined, withYear = false): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}
export const pct = (x: number | null | undefined, digits = 0) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)} %`);

/** Время занятия: локальное время зрителя + Нью-Йорк (если зоны различаются). */
export function DualTime({ start, end, showDay = false, className }: { start: string; end?: string; showDay?: boolean; className?: string }) {
  const local = `${timeIn(start, LOCAL_TZ)}${end ? `–${timeIn(end, LOCAL_TZ)}` : ""}`;
  const ny = `${timeIn(start, NY_TZ)}${end ? `–${timeIn(end, NY_TZ)}` : ""}`;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 tabular-nums", className)}>
      {showDay && <span className="text-muted-foreground">{dayIn(start, LOCAL_TZ)}</span>}
      <span className="font-medium text-foreground" title={`Ваше время (${LOCAL_TZ})`}>{local}</span>
      {!SAME_TZ && <span className="text-xs text-muted-foreground" title="Нью-Йорк (America/New_York)">NY {ny}</span>}
    </span>
  );
}

/** Обратный отсчёт до момента (с поправкой на часы сервера). */
export function useNow(serverNow?: string, tickMs = 15_000): number {
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (serverNow) setSkew(new Date(serverNow).getTime() - Date.now()); }, [serverNow]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), tickMs); return () => clearInterval(t); }, [tickMs]);
  return now + skew;
}
export function relMinutes(targetMs: number, nowMs: number): string {
  const m = Math.round((targetMs - nowMs) / 60000);
  const abs = Math.abs(m);
  const s = abs < 60 ? `${abs} мин` : abs < 1440 ? `${Math.floor(abs / 60)} ч ${abs % 60 ? `${abs % 60} мин` : ""}`.trim() : `${Math.round(abs / 1440)} дн.`;
  return m >= 0 ? `через ${s}` : `${s} назад`;
}

const STAGE_TONE: Record<Stage, Tone> = { trainee: "neutral", junior: "accent", trader: "purple", senior: "up" };
export function StagePill({ stage }: { stage: Stage }) {
  return <Pill tone={STAGE_TONE[stage] ?? "neutral"}>{STAGE_LABELS[stage] ?? stage}</Pill>;
}
const STATUS_TONE: Record<EnrollmentStatus, Tone> = { active: "up", paused: "warn", graduated: "accent", dropped: "down" };
export function StatusPill({ status }: { status: EnrollmentStatus }) {
  return <Pill tone={STATUS_TONE[status] ?? "neutral"} dot>{STATUS_LABELS[status] ?? status}</Pill>;
}
export const ATT_TONE: Record<AttendanceStatus, Tone> = { present: "up", late: "warn", absent: "down", excused: "neutral" };
export function AttendancePill({ status, self }: { status: AttendanceStatus | null | undefined; self?: boolean }) {
  if (!status) return <Pill tone="neutral">не отмечен</Pill>;
  return <Pill tone={ATT_TONE[status]} title={self ? "Самоотметка" : "Отметил наставник"}>{ATTENDANCE_LABELS[status]}{self ? " · сам" : ""}</Pill>;
}
const GOAL_TONE: Record<GoalStatus, Tone> = { active: "accent", achieved: "up", missed: "down", cancelled: "neutral" };
export function GoalStatusPill({ status }: { status: GoalStatus }) {
  return <Pill tone={GOAL_TONE[status] ?? "neutral"}>{GOAL_STATUS_LABELS[status] ?? status}</Pill>;
}

/** Место / ссылка занятия. Ссылка открывается в новой вкладке (rel=noopener). */
export function WhereLine({ mode, room, meetingUrl }: { mode: SessionMode | string; room: string | null; meetingUrl: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{MODE_LABELS[mode as SessionMode] ?? mode}</span>
      {room && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{room}</span>}
      {meetingUrl && (
        <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          <Video className="h-3 w-3" aria-hidden="true" />ссылка<ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(откроется в новой вкладке)</span>
        </a>
      )}
    </span>
  );
}

export function fmtGoalValue(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "%") return `${v.toFixed(1)} %`;
  if (unit === "$") return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`;
  return `${Math.round(v * 10) / 10}${unit ? ` ${unit}` : ""}`;
}

/** Карточка цели ИПР: кольцо прогресса, формула, текущее значение, окно, срок. */
export function GoalCard({ goal, actions, compact }: { goal: Goal; actions?: React.ReactNode; compact?: boolean }) {
  const p = Math.round(goal.eval.progress * 100);
  const tone: Tone = goal.status === "achieved" ? "up" : goal.status === "missed" ? "down" : goal.eval.met ? "up" : p >= 70 ? "accent" : "warn";
  return (
    <article className="glass-field flex gap-3 rounded-xl p-3" aria-label={`Цель: ${goal.title}`}>
      <ProgressRing value={p} max={100} size={compact ? 40 : 48} tone={tone} ariaLabel={`Прогресс ${p} %`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{goal.title}</h3>
          <GoalStatusPill status={goal.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{goal.formula}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
          {goal.metric !== "manual" && (
            <span>Сейчас: <b className={cn("font-semibold", goal.eval.met ? "text-up" : "text-foreground")}>{fmtGoalValue(goal.eval.value, goal.unit)}</b></span>
          )}
          {goal.eval.required != null && goal.metric !== "manual" && (
            <span className="text-muted-foreground">выборка {goal.eval.sample}/{goal.eval.required}</span>
          )}
          {goal.dueOn && <span className="text-muted-foreground">срок {fmtYmd(goal.dueOn)}</span>}
        </div>
        {!compact && goal.eval.detail && <p className="mt-1 text-xs text-muted-foreground">{goal.eval.detail}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-col items-end gap-1">{actions}</div>}
    </article>
  );
}

/** Сводка посещаемости. */
export function AttendanceSummaryView({ s, title }: { s: AttendanceSummary | null | undefined; title?: string }) {
  if (!s || s.total === 0) return <p className="text-sm text-muted-foreground">{title ? `${title}: ` : ""}прошедших занятий пока нет.</p>;
  const tone: Tone = s.rate == null ? "neutral" : s.rate >= 0.9 ? "up" : s.rate >= 0.75 ? "warn" : "down";
  return (
    <div>
      {title && <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>}
      <StatRow label="Посещаемость" value={pct(s.rate)} tone={tone} />
      <StatRow label="Пунктуальность" value={pct(s.punctuality)} />
      <StatRow label="Был / опоздал / пропуск" value={`${s.present} / ${s.late} / ${s.absent}`} />
      <StatRow label="Уважит. / не отмечено" value={`${s.excused} / ${s.unmarked}`} />
      {s.absentStreak > 1 && <StatRow label="Пропусков подряд" value={s.absentStreak} tone="down" />}
    </div>
  );
}

/** Выбор существующего пользователя (таблица users только читается). */
export function UserSelect({
  id, label, value, onChange, exclude = [], allowNone, noneLabel = "— не выбран —", disabled,
}: {
  id: string; label: string; value: string | null; onChange: (v: string | null) => void; exclude?: string[]; allowNone?: boolean; noneLabel?: string; disabled?: boolean;
}) {
  const { dbUsers } = useAuth();
  const NONE = "__none__";
  const users = dbUsers.filter((u) => u.active !== false && !u.banned && !exclude.includes(u.name));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
        <SelectTrigger id={id}><SelectValue placeholder="Выберите пользователя" /></SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {users.map((u) => <SelectItem key={u.name} value={u.name}>{u.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Подпись + поле. */
export function Field({ id, label, hint, children, className }: { id?: string; label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p role="alert" className="rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{msg}</p>;
}
