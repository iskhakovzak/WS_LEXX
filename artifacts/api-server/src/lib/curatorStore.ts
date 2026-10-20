/**
 * Кабинет куратора — таблицы (идемпотентно, лениво из роутов curator.ts / risk.ts).
 *
 *   curator_notes        приватные заметки персонала о трейдере (трейдер их не видит); мягкое удаление archived_at;
 *                        day — торговый день (NY), к которому заметка относится (заметка из строки очереди закрывает
 *                        только этот день, lib/daily/costQueue); NULL — общая заметка из профиля
 *   risk_breach_reviews  «Разбор нарушения»: причина, договорённости, последствие по записи risk_alert_log (1:1)
 *   curator_queue_acks   мягкий архив элементов очереди разборов («архивировать старые»): исходные записи не трогаются,
 *                        элемент просто скрывается из очереди; отметка с revoked_at ≠ NULL не действует (элемент вернётся)
 */
import { pool } from "@workspace/db";

export type CuratorNote = {
  id: number;
  trader: string;
  author: string;
  body: string;
  kind: string;
  pinned: boolean;
  /** NY trading day the note is about (YYYY-MM-DD), null = a general note. */
  day: string | null;
  createdAt: string;
  updatedAt: string;
};

export function rowToNote(r: any): CuratorNote {
  return {
    id: Number(r.id),
    trader: String(r.trader),
    author: String(r.author),
    body: String(r.body),
    kind: String(r.kind ?? "note"),
    pinned: r.pinned === true,
    day: typeof r.day === "string" && r.day ? r.day : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export type BreachReviewRow = {
  id: number;
  alertId: number;
  trader: string;
  date: string;
  kind: string;
  reason: string;
  comment: string | null;
  actions: { id: string; title: string; dueOn: string | null; status: string }[];
  consequence: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};

export function rowToBreachReview(r: any): BreachReviewRow {
  return {
    id: Number(r.id),
    alertId: Number(r.alert_id),
    trader: String(r.trader),
    date: String(r.date),
    kind: String(r.kind),
    reason: String(r.reason),
    comment: r.comment ?? null,
    actions: Array.isArray(r.actions) ? r.actions : [],
    consequence: String(r.consequence ?? "none"),
    createdBy: String(r.created_by),
    createdAt: new Date(r.created_at).toISOString(),
    updatedBy: r.updated_by ?? null,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Full-day market holidays («Market closed…» in holiday_calendar, the rule of lib/daily/service) in the last `days`
 * days up to `today` (NY) — for the review SLA clock (lib/eodLogic tradingHoursBetween). One read per NY day.
 */
let closedCache: { key: string; days: Set<string> } | null = null;
export async function marketClosedDays(today: string, days = 400): Promise<Set<string>> {
  const key = `${today}|${days}`;
  if (closedCache?.key === key) return closedCache.days;
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const { rows } = await pool
    .query<{ d: string }>(
      `SELECT date::text AS d FROM holiday_calendar
        WHERE type = 'holiday' AND description ILIKE 'market closed%' AND date::text >= $1 AND date::text <= $2`,
      [from, today],
    )
    .catch(() => ({ rows: [] as { d: string }[] }));
  const out = new Set(rows.map((r) => String(r.d).slice(0, 10)));
  closedCache = { key, days: out };
  return out;
}
