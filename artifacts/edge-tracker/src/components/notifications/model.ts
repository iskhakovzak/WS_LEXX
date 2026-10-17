/**
 * Notification center model: API shapes, type registry (mirrors api-server lib/notificationCore.ts),
 * tones/icons per type & severity, day grouping and the raw-fetch API client.
 * Only the inbox/bell/page/prefs components import from here.
 */
import type { LucideIcon } from "lucide-react";
import {
  AtSign, MessageSquareReply, HelpCircle, Lightbulb, ClipboardCheck, MessageSquare, CalendarCheck, AlarmClock,
  CheckCircle2, CalendarRange, Star, BadgeCheck, TriangleAlert, OctagonAlert, SlidersHorizontal, TrendingUp,
  Gavel, RefreshCw, Link2Off, Info, Bell, GraduationCap, Target, Trophy, ShieldAlert,
} from "lucide-react";
import { BASE } from "@/lib/api";
import type { Tone } from "@/components/ds";

export type Severity = "info" | "warn" | "critical";
export type NotificationGroup = "team" | "ideas" | "review" | "risk" | "scaling" | "academy" | "sync" | "system";

export type Notification = {
  id: number;
  type: string;
  typeLabel: string;
  group: NotificationGroup;
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  actor: string | null;
  ideaId: number | null;
  isRead: boolean;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type NotificationPage = { items: Notification[]; nextCursor: string | null };
export type UnreadCount = { unread: number; critical: number; warn: number };
export type TypeMeta = { type: string; label: string; group: NotificationGroup; severity: Severity; description: string };
export type Pref = { type: string; inApp: boolean; muteUntil: string | null };
export type Prefs = { prefs: Pref[]; muteAllUntil: string | null };

export const ALL_TYPES_KEY = "*";

export const GROUP_LABELS: Record<NotificationGroup, string> = {
  team: "Команда", ideas: "Идеи", review: "Разбор", risk: "Риск", scaling: "Масштабирование", academy: "Академия", sync: "Синхронизация", system: "Система",
};
export const GROUP_ORDER: NotificationGroup[] = ["team", "ideas", "review", "risk", "scaling", "academy", "sync", "system"];

/** Local copy of the registry so filters/prefs render before (or without) GET /notifications/types. */
export const TYPES: TypeMeta[] = [
  { type: "mention", label: "Упоминание", group: "team", severity: "info", description: "Кто-то упомянул вас через @имя в обсуждении, идее или заметке" },
  { type: "reply", label: "Ответ", group: "team", severity: "info", description: "Ответ на ваш пост или в вашем обсуждении, отметка «решение»" },
  { type: "review_request", label: "Запрос разбора", group: "team", severity: "info", description: "Трейдер просит куратора разобрать сделку или тему" },
  { type: "idea_submitted", label: "Новая идея", group: "ideas", severity: "info", description: "Трейдер опубликовал идею на ревью" },
  { type: "idea_review", label: "Решение по идее", group: "ideas", severity: "info", description: "Куратор одобрил, отклонил или вернул идею на доработку" },
  { type: "idea_comment", label: "Комментарий к идее", group: "ideas", severity: "info", description: "Публичный комментарий или личный ответ к идее" },
  { type: "eod_review_request", label: "День закрыт — ждёт разбора", group: "review", severity: "info", description: "Трейдер закрыл торговый день, он попал в очередь куратора" },
  { type: "eod_overdue", label: "Разбор дня просрочен", group: "review", severity: "warn", description: "Закрытый день ждёт разбора дольше SLA (24 ч)" },
  { type: "eod_reviewed", label: "Разбор дня готов", group: "review", severity: "info", description: "Куратор оставил комментарий и оценку за день" },
  { type: "weekly_review", label: "Отчёт недели", group: "review", severity: "info", description: "Самооценка отправлена / куратор завершил разбор недели / цели обновлены" },
  { type: "rating", label: "Оценка куратора", group: "review", severity: "info", description: "Новая или изменённая недельная оценка" },
  { type: "rating_ack", label: "Оценка подтверждена", group: "review", severity: "info", description: "Трейдер прочитал и подтвердил вашу оценку" },
  { type: "risk_warn", label: "Близко к лимиту", group: "risk", severity: "warn", description: "Использовано ≥ 70 % дневного / недельного лимита или просадки" },
  { type: "risk_breach", label: "Лимит превышен", group: "risk", severity: "critical", description: "Дневной / недельный лимит или максимальная просадка пробиты — стоп торговли" },
  { type: "risk_repeat_breach", label: "Повторное нарушение", group: "risk", severity: "critical", description: "Трейдер второй раз за неделю пробил лимит — нужен разбор куратора" },
  { type: "risk_breach_review", label: "Разбор нарушения", group: "risk", severity: "info", description: "Куратор записал разбор вашего нарушения лимита" },
  { type: "limit_change", label: "Изменение лимитов", group: "risk", severity: "info", description: "Куратор изменил ваши лимиты риска или тир" },
  { type: "rule_violation", label: "Нарушение правила", group: "risk", severity: "warn", description: "Сканер нашёл нарушение правила дисциплины или куратор вынес по нему решение" },
  { type: "scaling_proposal", label: "Предложение по масштабированию", group: "scaling", severity: "info", description: "Создано предложение повысить / понизить тир" },
  { type: "scaling_decision", label: "Решение по масштабированию", group: "scaling", severity: "info", description: "Предложение одобрено или отклонено" },
  // academy
  { type: "academy_promotion_ready", label: "Готов к переводу", group: "academy", severity: "info", description: "Выполнены критерии перевода на следующую ступень" },
  { type: "academy_promotion_request", label: "Заявка на перевод", group: "academy", severity: "info", description: "Ученик подал заявку на перевод на следующую ступень" },
  { type: "academy_promotion_decision", label: "Решение по переводу", group: "academy", severity: "info", description: "Заявка на перевод одобрена или отклонена" },
  { type: "academy_challenge_assigned", label: "Назначен экзамен", group: "academy", severity: "info", description: "Вам назначен экзамен с правилами и сроками" },
  { type: "academy_challenge_passed", label: "Экзамен сдан", group: "academy", severity: "info", description: "Все правила экзамена выполнены" },
  { type: "academy_challenge_failed", label: "Экзамен провален", group: "academy", severity: "warn", description: "Нарушено правило экзамена или истекло время" },
  { type: "academy_enrolled", label: "Зачисление", group: "academy", severity: "info", description: "Вас зачислили в когорту Академии" },
  { type: "academy_stage_change", label: "Смена ступени", group: "academy", severity: "info", description: "Изменилась ступень или статус обучения" },
  { type: "academy_goal_assigned", label: "Новая цель ИПР", group: "academy", severity: "info", description: "Наставник поставил цель в индивидуальном плане" },
  { type: "academy_goal_achieved", label: "Цель ИПР достигнута", group: "academy", severity: "info", description: "Цель индивидуального плана выполнена" },
  { type: "academy_goal_missed", label: "Цель ИПР не достигнута", group: "academy", severity: "warn", description: "Срок цели прошёл, а метрика не выполнена" },
  { type: "academy_action_assigned", label: "Новая договорённость", group: "academy", severity: "info", description: "По итогам встречи 1:1 появилась договорённость" },
  { type: "academy_action_overdue", label: "Договорённость просрочена", group: "academy", severity: "warn", description: "Срок договорённости прошёл" },
  { type: "academy_submitted", label: "Задание на проверку", group: "academy", severity: "info", description: "Ученик сдал задание курса на проверку" },
  { type: "academy_graded", label: "Задание проверено", group: "academy", severity: "info", description: "Наставник проверил ваше задание" },
  { type: "sync", label: "Синхронизация PropReports", group: "sync", severity: "info", description: "Итог синхронизации или импорта: добавлено / обновлено / ошибки" },
  { type: "sync_unmatched", label: "Несопоставленные счета", group: "sync", severity: "warn", description: "В выписке есть счета, не привязанные к трейдерам" },
  { type: "system", label: "Системное", group: "system", severity: "info", description: "Служебные сообщения" },
];

const TYPE_INDEX = new Map(TYPES.map((t) => [t.type, t]));
const LEGACY: Record<string, string> = { comment_public: "idea_comment", reply_private: "idea_comment", risk_stop: "risk_breach", breach: "risk_breach", review: "eod_reviewed" };

export function typeMeta(type: string | null | undefined): TypeMeta {
  const t = LEGACY[type ?? ""] ?? (type ?? "system");
  return TYPE_INDEX.get(t) ?? { type: t, label: t, group: "system", severity: "info", description: "" };
}

export const TYPE_ICONS: Record<string, LucideIcon> = {
  mention: AtSign, reply: MessageSquareReply, review_request: HelpCircle,
  idea_submitted: Lightbulb, idea_review: ClipboardCheck, idea_comment: MessageSquare,
  eod_review_request: CalendarCheck, eod_overdue: AlarmClock, eod_reviewed: CheckCircle2, weekly_review: CalendarRange,
  rating: Star, rating_ack: BadgeCheck,
  risk_warn: TriangleAlert, risk_breach: OctagonAlert, risk_repeat_breach: OctagonAlert, risk_breach_review: ClipboardCheck, limit_change: SlidersHorizontal, rule_violation: ShieldAlert,
  scaling_proposal: TrendingUp, scaling_decision: Gavel,
  academy_promotion_ready: GraduationCap, academy_promotion_request: GraduationCap, academy_promotion_decision: Gavel,
  academy_challenge_assigned: Target, academy_challenge_passed: Trophy, academy_challenge_failed: OctagonAlert,
  academy_enrolled: GraduationCap, academy_stage_change: GraduationCap, academy_goal_assigned: Target, academy_goal_achieved: Trophy,
  academy_goal_missed: TriangleAlert, academy_action_assigned: ClipboardCheck, academy_action_overdue: AlarmClock,
  academy_submitted: ClipboardCheck, academy_graded: BadgeCheck,
  sync: RefreshCw, sync_unmatched: Link2Off, system: Info,
};

export function iconFor(type: string): LucideIcon {
  return TYPE_ICONS[typeMeta(type).type] ?? Bell;
}

export const SEVERITY_LABEL: Record<Severity, string> = { info: "Инфо", warn: "Внимание", critical: "Критично" };
export const SEVERITY_TONE: Record<Severity, Tone> = { info: "accent", warn: "warn", critical: "down" };
export const SEVERITY_ORDER: Severity[] = ["critical", "warn", "info"];

/** Icon tile classes per severity (unread) — read items fall back to a neutral tile. */
export const SEVERITY_TILE: Record<Severity, string> = {
  info: "bg-primary/15 text-primary",
  warn: "bg-[hsl(var(--chart-3)/0.18)] text-[hsl(var(--chart-3))]",
  critical: "bg-down/15 text-down",
};

const INLINE_PATH_RE = /\s*(?:https?:\/\/[^\s/]+)?\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events|curator|rules|game-plan|day-report|academy(?:\/[a-z-]+)?)(?:\?[^\s»"')]*)?\s*$/u;
const LINK_RE = /(?:https?:\/\/[^\s/]+)?(\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events)(?:\?[^\s»"')]*)?)/;

/** Accepts both the new camelCase payload and the pre-Wave-C snake_case rows (older API build). */
export function normalizeNotification(raw: unknown): Notification | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isInteger(id)) return null;
  const meta = typeMeta(typeof r.type === "string" ? r.type : "system");
  const legacyMessage = typeof r.message === "string" ? r.message : "";
  const body = typeof r.body === "string" ? r.body : legacyMessage.replace(INLINE_PATH_RE, "").trim();
  const ideaIdRaw = r.ideaId ?? r.idea_id;
  const ideaId = ideaIdRaw == null ? null : Number(ideaIdRaw);
  const linkRaw = typeof r.link === "string" ? r.link : null;
  const link = linkRaw ?? (ideaId != null && Number.isInteger(ideaId) ? `/trade-ideas?idea=${ideaId}` : (LINK_RE.exec(legacyMessage)?.[1] ?? null));
  const severity = (typeof r.severity === "string" && ["info", "warn", "critical"].includes(r.severity) ? r.severity : meta.severity) as Severity;
  const readAt = typeof r.readAt === "string" ? r.readAt : null;
  const isRead = typeof r.isRead === "boolean" ? r.isRead : typeof r.is_read === "boolean" ? r.is_read : readAt != null;
  return {
    id,
    type: meta.type,
    typeLabel: typeof r.typeLabel === "string" ? r.typeLabel : meta.label,
    group: (typeof r.group === "string" ? r.group : meta.group) as NotificationGroup,
    severity,
    title: typeof r.title === "string" && r.title ? r.title : meta.label,
    body,
    link,
    entityType: typeof r.entityType === "string" ? r.entityType : null,
    entityId: r.entityId == null ? null : String(r.entityId),
    actor: typeof r.actor === "string" ? r.actor : null,
    ideaId: ideaId != null && Number.isInteger(ideaId) ? ideaId : null,
    isRead,
    readAt,
    archivedAt: typeof r.archivedAt === "string" ? r.archivedAt : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
  };
}

export function normalizePage(raw: unknown): NotificationPage {
  if (Array.isArray(raw)) return { items: raw.map(normalizeNotification).filter((n): n is Notification => !!n), nextCursor: null };
  const r = (raw ?? {}) as { items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(r.items) ? r.items.map(normalizeNotification).filter((n): n is Notification => !!n) : [];
  return { items, nextCursor: typeof r.nextCursor === "string" ? r.nextCursor : null };
}

// ─── time helpers ───────────────────────────────────────────────────────────

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} дн`;
  return new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

const TIME_FMT = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME_FMT.format(d);
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** «Сегодня» / «Вчера» / «12 марта» for the day-group header (local calendar day of the viewer). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const key = localYmd(d);
  if (key === localYmd(now)) return "Сегодня";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === localYmd(y)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export type DayGroup = { key: string; label: string; items: Notification[] };

export function groupByDay(items: readonly Notification[], now = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const n of items) {
    const d = new Date(n.createdAt);
    const key = Number.isNaN(d.getTime()) ? "unknown" : localYmd(d);
    let g = index.get(key);
    if (!g) {
      g = { key, label: dayLabel(n.createdAt, now), items: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push(n);
  }
  return groups;
}

// ─── API ────────────────────────────────────────────────────────────────────

export const NOTIF_KEYS = {
  count: (me: string | null) => ["notifications-count", me] as const,
  list: (me: string | null, params = "") => ["notifications", me, params] as const,
  prefs: (me: string | null) => ["notification-prefs", me] as const,
};

export type ListFilters = {
  unread?: boolean;
  types?: string[];
  severities?: Severity[];
  archived?: "0" | "1" | "all";
  since?: string;
  limit?: number;
};

export function filterParams(f: ListFilters): string {
  const p = new URLSearchParams();
  if (f.unread) p.set("unread", "1");
  if (f.types?.length) p.set("type", f.types.join(","));
  if (f.severities?.length) p.set("severity", f.severities.join(","));
  if (f.archived && f.archived !== "0") p.set("archived", f.archived);
  if (f.since) p.set("since", f.since);
  p.set("limit", String(f.limit ?? 30));
  return p.toString();
}

async function readError(r: Response, fallback: string): Promise<Error> {
  const data = (await r.json().catch(() => null)) as { error?: string } | null;
  const e = new Error(data?.error || `${fallback} (HTTP ${r.status})`) as Error & { status?: number };
  e.status = r.status;
  return e;
}

async function sendJson(path: string, method: "POST" | "PATCH" | "PUT", body?: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw await readError(r, "Не удалось выполнить действие");
  return r.json().catch(() => ({}));
}

export const notificationsApi = {
  async count(): Promise<UnreadCount> {
    const r = await fetch(`${BASE}/api/notifications/count`);
    if (!r.ok) throw await readError(r, "Не удалось загрузить счётчик");
    const d = (await r.json()) as Partial<UnreadCount>;
    return { unread: Number(d.unread ?? 0), critical: Number(d.critical ?? 0), warn: Number(d.warn ?? 0) };
  },
  async list(params: string, cursor?: string | null): Promise<NotificationPage> {
    const r = await fetch(`${BASE}/api/notifications?${params}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!r.ok) throw await readError(r, "Не удалось загрузить уведомления");
    return normalizePage(await r.json());
  },
  async prefs(): Promise<Prefs> {
    const r = await fetch(`${BASE}/api/notifications/prefs`);
    if (!r.ok) throw await readError(r, "Не удалось загрузить настройки");
    const d = (await r.json()) as Partial<Prefs>;
    return { prefs: Array.isArray(d.prefs) ? d.prefs : [], muteAllUntil: typeof d.muteAllUntil === "string" ? d.muteAllUntil : null };
  },
  savePrefs: (p: Prefs) => sendJson(`/api/notifications/prefs`, "PUT", p) as Promise<Prefs>,
  readAll: (type?: string) => sendJson(`/api/notifications/read-all`, "PATCH", type ? { type } : {}),
  readMany: (ids: number[]) => sendJson(`/api/notifications/read-many`, "POST", { ids }),
  unreadMany: (ids: number[]) => sendJson(`/api/notifications/unread-many`, "POST", { ids }),
  archive: (ids: number[]) => sendJson(`/api/notifications/archive`, "POST", { ids }),
  archiveRead: () => sendJson(`/api/notifications/archive`, "POST", { read: true }),
  unarchive: (ids: number[]) => sendJson(`/api/notifications/unarchive`, "POST", { ids }),
  readOne: (id: number) => sendJson(`/api/notifications/${id}/read`, "PATCH"),
};
