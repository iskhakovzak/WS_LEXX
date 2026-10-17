/**
 * Pure notification model — no DB, no Express — shared by lib/notifyUtils.ts (producers) and
 * routes/notifications.ts (inbox API). Kept dependency-free so it can be exercised by an offline
 * node script (scratchpad check) and by unit tests.
 *
 * Normalized notification (DB `notifications` after ensureNotificationSchema):
 *   type        canonical type key (see NOTIFICATION_TYPES; legacy values are mapped on read via LEGACY_TYPE_ALIASES)
 *   severity    "info" | "warn" | "critical"
 *   title       short headline (nullable for legacy rows → derived from the type label)
 *   message     body text (the historical column name; exposed as `body` in the API)
 *   link        in-app path built like the frontend `@/lib/links` (e.g. "/discussions?thread=12")
 *   entity_type / entity_id   what the notification is about ("thread" / "12")
 *   actor       who caused it (user name) — null for system events
 *   idea_id     legacy FK kept for the ideas sheet ("read-idea" endpoint)
 *   read_at / archived_at / created_at
 */

export type Severity = "info" | "warn" | "critical";

export type NotificationGroup = "team" | "ideas" | "review" | "risk" | "scaling" | "academy" | "sync" | "system";

export type NotificationTypeMeta = {
  type: string;
  label: string;
  group: NotificationGroup;
  severity: Severity;
  /** One-line explanation shown in the preferences panel. */
  description: string;
};

export const SEVERITIES: readonly Severity[] = ["info", "warn", "critical"];

/** Canonical registry: every producer should use one of these keys. Order = order in the UI. */
export const NOTIFICATION_TYPES: readonly NotificationTypeMeta[] = [
  // team
  { type: "mention", label: "Упоминание", group: "team", severity: "info", description: "Кто-то упомянул вас через @имя в обсуждении, идее или заметке" },
  { type: "reply", label: "Ответ", group: "team", severity: "info", description: "Ответ на ваш пост или в вашем обсуждении, отметка «решение»" },
  { type: "review_request", label: "Запрос разбора", group: "team", severity: "info", description: "Трейдер просит куратора разобрать сделку или тему" },
  { type: "thread_new", label: "Новая тема", group: "team", severity: "info", description: "В «Обсуждениях» появилась тема для вас (для всех, вашей ступени, кураторов или вашей когорты)" },
  // ideas
  { type: "idea_submitted", label: "Новая идея", group: "ideas", severity: "info", description: "Трейдер опубликовал идею на ревью" },
  { type: "idea_review", label: "Решение по идее", group: "ideas", severity: "info", description: "Куратор одобрил, отклонил или вернул идею на доработку" },
  { type: "idea_comment", label: "Комментарий к идее", group: "ideas", severity: "info", description: "Публичный комментарий или личный ответ к идее" },
  // review loop
  { type: "eod_review_request", label: "День закрыт — ждёт разбора", group: "review", severity: "info", description: "Трейдер закрыл торговый день, он попал в очередь куратора" },
  { type: "eod_overdue", label: "Разбор дня просрочен", group: "review", severity: "warn", description: "Закрытый день ждёт разбора дольше SLA (24 ч)" },
  { type: "eod_reviewed", label: "Разбор дня готов", group: "review", severity: "info", description: "Куратор оставил комментарий и оценку за день" },
  { type: "weekly_review", label: "Отчёт недели", group: "review", severity: "info", description: "Самооценка отправлена / куратор завершил разбор недели / цели обновлены" },
  { type: "rating", label: "Оценка куратора", group: "review", severity: "info", description: "Новая или изменённая недельная оценка" },
  { type: "rating_ack", label: "Оценка подтверждена", group: "review", severity: "info", description: "Трейдер прочитал и подтвердил вашу оценку" },
  // risk
  { type: "risk_warn", label: "Близко к лимиту", group: "risk", severity: "warn", description: "Использовано ≥ 70 % дневного / недельного лимита или просадки" },
  { type: "risk_breach", label: "Лимит превышен", group: "risk", severity: "critical", description: "Дневной / недельный лимит или максимальная просадка пробиты — стоп торговли" },
  { type: "risk_repeat_breach", label: "Повторное нарушение", group: "risk", severity: "critical", description: "Трейдер второй раз за неделю пробил лимит — нужен разбор куратора" },
  { type: "risk_breach_review", label: "Разбор нарушения", group: "risk", severity: "info", description: "Куратор записал разбор вашего нарушения лимита" },
  { type: "limit_change", label: "Изменение лимитов", group: "risk", severity: "info", description: "Куратор изменил ваши лимиты риска или тир" },
  { type: "rule_violation", label: "Нарушение правила", group: "risk", severity: "warn", description: "Сканер нашёл нарушение правила дисциплины или куратор вынес по нему решение" },
  // scaling
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
  // sync
  { type: "sync", label: "Синхронизация PropReports", group: "sync", severity: "info", description: "Итог синхронизации или импорта: добавлено / обновлено / ошибки" },
  { type: "sync_unmatched", label: "Несопоставленные счета", group: "sync", severity: "warn", description: "В выписке есть счета, не привязанные к трейдерам" },
  // system
  { type: "system", label: "Системное", group: "system", severity: "info", description: "Служебные сообщения" },
];

export const GROUP_LABELS: Record<NotificationGroup, string> = {
  team: "Команда",
  ideas: "Идеи",
  review: "Разбор",
  risk: "Риск",
  scaling: "Масштабирование",
  academy: "Академия",
  sync: "Синхронизация",
  system: "Система",
};

/** Legacy `notifications.type` values written by older code → canonical type. */
export const LEGACY_TYPE_ALIASES: Readonly<Record<string, string>> = {
  comment_public: "idea_comment",
  reply_private: "idea_comment",
  risk_stop: "risk_breach",
  breach: "risk_breach",
  review: "eod_reviewed",
};

const TYPE_INDEX: ReadonlyMap<string, NotificationTypeMeta> = new Map(NOTIFICATION_TYPES.map((t) => [t.type, t]));

/** "*" = all types (used by notification_prefs for a global mute). */
export const ALL_TYPES_KEY = "*";

export function isKnownType(type: string): boolean {
  return TYPE_INDEX.has(type);
}

export function normalizeType(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "system";
  return LEGACY_TYPE_ALIASES[t] ?? t;
}

export function typeMeta(raw: string | null | undefined): NotificationTypeMeta {
  const type = normalizeType(raw);
  return TYPE_INDEX.get(type) ?? { type, label: type, group: "system", severity: "info", description: "" };
}

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

export function defaultSeverity(raw: string | null | undefined): Severity {
  return typeMeta(raw).severity;
}

/**
 * A type filter from the API (`?type=risk_breach,mention`) must also match rows stored under
 * legacy spellings, so expand every canonical key to itself + all aliases pointing at it.
 */
export function expandTypeFilter(types: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of types) {
    const t = normalizeType(raw);
    out.add(t);
    for (const [legacy, canonical] of Object.entries(LEGACY_TYPE_ALIASES)) if (canonical === t) out.add(legacy);
  }
  return [...out];
}

/** Parse a comma-separated list query param into trimmed, de-duplicated, non-empty values (max 40). */
export function parseList(raw: unknown, max = 40): string[] {
  const s = Array.isArray(raw) ? raw.map(String).join(",") : typeof raw === "string" ? raw : "";
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, max);
}

// ─── preferences ────────────────────────────────────────────────────────────

export type PrefRow = {
  /** canonical type or ALL_TYPES_KEY */
  type: string;
  inApp: boolean;
  /** ISO string / Date / null */
  muteUntil: string | Date | null | undefined;
};

export type DeliveryVerdict = { deliver: true } | { deliver: false; reason: "disabled" | "muted" | "muted_all" | "disabled_all" };

function toMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Should an in-app notification of `type` be delivered to a user with `prefs`?
 * Rules: restrictions only stack — a per-type row with `inApp=false` or a future `muteUntil` blocks that
 * type; the "*" row («не беспокоить») blocks every type while it is off/muted, regardless of per-type rows.
 * No rows → deliver (opt-out model: every type is on by default).
 */
export function deliveryVerdict(rawType: string, prefs: readonly PrefRow[], now: Date = new Date()): DeliveryVerdict {
  const type = normalizeType(rawType);
  const nowMs = now.getTime();
  const own = prefs.find((p) => normalizeType(p.type) === type);
  const all = prefs.find((p) => p.type === ALL_TYPES_KEY);
  if (own) {
    if (!own.inApp) return { deliver: false, reason: "disabled" };
    const mu = toMs(own.muteUntil);
    if (mu !== null && mu > nowMs) return { deliver: false, reason: "muted" };
  }
  if (all) {
    if (!all.inApp) return { deliver: false, reason: "disabled_all" };
    const mu = toMs(all.muteUntil);
    if (mu !== null && mu > nowMs) return { deliver: false, reason: "muted_all" };
  }
  return { deliver: true };
}

/** Validate/clean a prefs payload from the client. Unknown types are dropped; "*" allowed. */
export function sanitizePrefs(input: unknown): PrefRow[] {
  if (!Array.isArray(input)) return [];
  const out: PrefRow[] = [];
  const seen = new Set<string>();
  for (const row of input.slice(0, 100)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rawType = typeof r.type === "string" ? r.type.trim() : "";
    if (!rawType) continue;
    const type = rawType === ALL_TYPES_KEY ? ALL_TYPES_KEY : normalizeType(rawType);
    if (type !== ALL_TYPES_KEY && !isKnownType(type)) continue;
    if (seen.has(type)) continue;
    seen.add(type);
    const inApp = r.inApp === undefined ? true : Boolean(r.inApp);
    let muteUntil: string | null = null;
    if (typeof r.muteUntil === "string" && r.muteUntil.trim()) {
      const ms = Date.parse(r.muteUntil);
      if (Number.isFinite(ms)) muteUntil = new Date(ms).toISOString();
    }
    out.push({ type, inApp, muteUntil });
  }
  return out;
}

// ─── keyset pagination ──────────────────────────────────────────────────────

export type Cursor = { createdAt: string; id: number };

/** Opaque cursor = base64url("<ISO created_at>|<id>"). Stable under inserts (newer rows never shift older pages). */
export function encodeCursor(createdAt: string | Date, id: number): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const s = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const i = s.lastIndexOf("|");
    if (i <= 0) return null;
    const createdAt = s.slice(0, i);
    const id = Number(s.slice(i + 1));
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    return null;
  }
}

/** Row ordering used everywhere: created_at DESC, id DESC. */
export function compareDesc(a: { createdAt: string | Date; id: number }, b: { createdAt: string | Date; id: number }): number {
  const ta = toMs(a.createdAt) ?? 0;
  const tb = toMs(b.createdAt) ?? 0;
  if (ta !== tb) return tb - ta;
  return b.id - a.id;
}

/** True when `row` comes strictly after `cursor` in DESC order — i.e. (created_at, id) < (cursor.createdAt, cursor.id). */
export function isAfterCursor(row: { createdAt: string | Date; id: number }, cursor: Cursor): boolean {
  const t = toMs(row.createdAt) ?? 0;
  const c = toMs(cursor.createdAt) ?? 0;
  return t < c || (t === c && row.id < cursor.id);
}

/**
 * Reference implementation of one page (used by the offline check to pin the SQL semantics):
 * sort DESC, skip up to the cursor, take `limit`, and hand back the cursor of the last item when more remain.
 */
export function paginate<T extends { createdAt: string | Date; id: number }>(
  rows: readonly T[],
  opts: { cursor?: Cursor | null; limit: number },
): { items: T[]; nextCursor: string | null } {
  const sorted = [...rows].sort(compareDesc);
  const after = opts.cursor ? sorted.filter((r) => isAfterCursor(r, opts.cursor!)) : sorted;
  const items = after.slice(0, opts.limit);
  const hasMore = after.length > opts.limit;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

export function clampLimit(raw: unknown, def = 30, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// ─── links (server-side mirror of the frontend `@/lib/links`) ───────────────

function href(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const notifLinks = {
  idea: (id: number) => href("/trade-ideas", { idea: id }),
  thread: (id: number) => href("/discussions", { thread: id }),
  trade: (id: number) => href("/trades", { highlight: id }),
  journalDay: (date: string, trader?: string | null) => href("/journal", { date, trader }),
  risk: (trader?: string | null) => href("/risk", { trader }),
  scaling: (trader?: string | null) => href("/scaling", { trader }),
  weeklyReview: (p: { trader?: string | null; week?: string | null } = {}) => href("/weekly-review", p),
  ratings: (trader?: string | null) => href("/ratings", { trader }),
  integrations: () => "/integrations",
  notifications: () => "/notifications",
} as const;

const INLINE_PATH_RE = /(?:https?:\/\/[^\s/]+)?(\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events)(?:\?[^\s»"')]*)?)/;

/**
 * Link for a row: the stored `link`, else the idea FK, else a path embedded in a legacy message
 * ("… https://site/discussions?thread=12" / "… /discussions?thread=12").
 */
export function deriveLink(row: { link?: string | null; idea_id?: number | null; message?: string | null }): string | null {
  if (row.link && row.link.startsWith("/")) return row.link;
  if (row.idea_id != null && Number.isInteger(Number(row.idea_id))) return notifLinks.idea(Number(row.idea_id));
  const m = row.message ? INLINE_PATH_RE.exec(row.message) : null;
  return m ? m[1] : null;
}

/** Strip an inline absolute/relative link from a legacy message body (it is shown as a button instead). */
export function stripInlineLink(message: string): string {
  return message.replace(/\s*(?:https?:\/\/[^\s/]+)?\/(?:discussions|trade-ideas|trades|journal|risk|scaling|weekly-review|ratings|integrations|playbook|watchlist|events)(?:\?[^\s»"')]*)?\s*$/u, "").trim();
}

/** Validate a client/producer supplied link: same-origin absolute path only (no scheme, no //host). */
export function safeLink(link: string | null | undefined): string | null {
  if (!link || typeof link !== "string") return null;
  const l = link.trim();
  if (!l.startsWith("/") || l.startsWith("//") || /[\s<>]/.test(l) || l.length > 500) return null;
  return l;
}
