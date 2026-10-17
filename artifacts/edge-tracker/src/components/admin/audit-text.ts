/**
 * Human-readable audit entries: «Ориф синхронизировал PropReports: файл …, обновлено 536» instead of
 * `propreports.sync {"runId":3,…}`. Pure functions — unit-tested in audit-text.test.ts.
 */
import type { Tone } from "@/components/ds";

export interface AuditLike {
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: string | null;
}

export interface AuditText {
  /** One sentence without the actor, e.g. «заморозил учётку Умид». */
  text: string;
  /** Secondary line: reason / counters / file. */
  detail?: string;
  tone: Tone;
  /** Short category label for the pill. */
  label: string;
}

const ROLE: Record<string, string> = { admin: "админ", curator: "куратор", trader: "трейдер", guest: "гость" };
const TIER_FALLBACK: Record<string, string> = { trainee: "Стажёр", junior: "Джун", trader: "Трейдер", senior: "Сеньор", lead: "Лид" };

export const ACTOR_LABEL: Record<string, string> = { "import-script": "Скрипт импорта", system: "Система", cron: "Планировщик" };

export function actorName(a: string): string {
  return ACTOR_LABEL[a] ?? a;
}

function parse(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { value: v };
  } catch {
    return { value: raw };
  }
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const reasonOf = (d: Record<string, any>) => s(d.reason || d.comment || d.resolution).trim() || undefined;

function plural(count: number, one: string, few: string, many: string) {
  const m10 = count % 10, m100 = count % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function syncCounters(d: Record<string, any>): string {
  const parts: string[] = [];
  parts.push(`добавлено ${n(d.inserted)}`);
  parts.push(`обновлено ${n(d.updated)}`);
  if (d.unchanged != null) parts.push(`без изменений ${n(d.unchanged)}`);
  if (n(d.skipped)) parts.push(`пропущено ${n(d.skipped)}`);
  if (n(d.conflicts)) parts.push(`на сверку ${n(d.conflicts)}`);
  if (n(d.errors)) parts.push(`ошибок ${n(d.errors)}`);
  return parts.join(", ");
}

/** Object the entry is about, for the «Объект» column / filter. */
export function objectLabel(targetType: string | null, targetId: string | null, d?: Record<string, any>): string {
  if (!targetType) return "";
  const id = targetId ?? "";
  switch (targetType) {
    case "user": return d?.name ? `Пользователь ${d.name}` : `Пользователь #${id}`;
    case "trader_risk_limits": return `Трейдер ${id}`;
    case "propreports_sync_runs": return id ? `Синк #${id}` : "Синк PropReports";
    case "propreports_accounts": return id ? `Счёт ${id}` : "Счета PropReports";
    case "propreports_performance_report": return `Отчёт Trade Performance #${id}`;
    case "discussion": return `Обсуждение #${id}`;
    case "comment": return `Комментарий #${id}`;
    case "report": return `Жалоба #${id}`;
    case "db": return "База данных";
    case "backup": return id ? `Бэкап ${id}` : "Бэкап";
    case "permissions": return "Матрица прав";
    case "risk_alert_log": return `Нарушение #${id}`;
    case "risk_breach_reviews": return `Разбор нарушения #${id}`;
    case "curator_notes": return `Заметка #${id}`;
    case "curator_queue_acks": return "Очередь разборов";
    case "office_capital": return `Капитал офиса ${id}`;
    case "scaling_proposal": return `Предложение по тиру #${id}`;
    case "academy_trader_stage": return `Ступень: ${id}`;
    case "academy_challenge":
    case "academy_challenges": return id ? `Челлендж #${id}` : "Челленджи";
    default: return id ? `${OBJECT_TYPE_LABEL[targetType] ?? targetType} #${id}` : OBJECT_TYPE_LABEL[targetType] ?? targetType;
  }
}

export const OBJECT_TYPE_LABEL: Record<string, string> = {
  user: "Пользователи",
  trader_risk_limits: "Тиры и лимиты",
  propreports_sync_runs: "Синки PropReports",
  propreports_accounts: "Счета PropReports",
  propreports_performance_report: "Отчёты Trade Performance",
  discussion: "Обсуждения",
  comment: "Комментарии",
  report: "Жалобы",
  db: "База данных",
  permissions: "Права доступа",
  scaling_proposal: "Предложения по тирам",
  academy_challenges: "Академия",
  academy_challenge: "Академия",
  academy_trader_stage: "Ступени Академии",
  risk_alert_log: "Нарушения лимитов",
  risk_breach_reviews: "Разборы нарушений",
  curator_notes: "Заметки куратора",
  curator_queue_acks: "Очередь разборов",
  office_capital: "Капитал офиса",
  backup: "Бэкапы",
};

/** Russian names for detail keys in the generic fallback; technical ids are hidden. */
const DETAIL_KEY: Record<string, string> = {
  trader: "трейдер", user: "трейдер", name: "имя", tier: "тир", tierKey: "тир", fromTier: "был тир", toTier: "тир",
  from: "было", to: "стало", status: "статус", kind: "тип", count: "кол-во", archived: "в архив", created: "создано",
  account: "счёт", template: "шаблон", startsOn: "старт", capital: "капитал", goalPct: "цель, %", sizeKb: "размер, КБ",
  comment: "комментарий", consequence: "последствие", actions: "договорённостей", olderThanDays: "старше, дн.", scope: "охват",
};
const HIDDEN_KEYS = new Set(["historyId", "runId", "id", "reportId", "objectName", "closedReports", "changes", "summary", "byKind", "reason", "resync"]);

const QUEUE_KIND: Record<string, string> = { eod: "дни", weekly: "недели", academy: "задания", breach: "нарушения" };
const CONSEQUENCE: Record<string, string> = { none: "без последствий", warning: "предупреждение", reduced: "лимиты урезаны", pause: "пауза в торговле", demote: "понижение тира" };
const VERB: Record<string, string> = {
  create: "создал", add: "добавил", update: "изменил", set: "задал", delete: "удалил", remove: "удалил", archive: "архивировал",
  restore: "восстановил", approve: "одобрил", reject: "отклонил", assign: "назначил", import: "импортировал", export: "выгрузил", reset: "сбросил",
};

export function describeAudit(e: AuditLike, tierNames?: Record<string, string>): AuditText {
  const d = parse(e.details);
  const reason = reasonOf(d);
  const who = s(d.name) || (e.targetType === "user" ? `#${s(e.targetId)}` : s(e.targetId));
  const tier = (k: unknown) => (k ? tierNames?.[s(k)] ?? TIER_FALLBACK[s(k)] ?? s(k) : "без тира");
  const bulk = d.bulk ? " (массово)" : "";

  switch (e.action) {
    case "user.ban": return { label: "Бан", tone: "down", text: `забанил ${who}`, detail: reason };
    case "user.unban": return { label: "Разбан", tone: "up", text: `разбанил ${who}`, detail: reason };
    case "user.freeze": return { label: "Заморозка", tone: "down", text: `заморозил учётку ${who}${bulk}`, detail: reason };
    case "user.unfreeze": return { label: "Разморозка", tone: "up", text: `разморозил учётку ${who}${bulk}`, detail: reason };
    case "user.archive": return { label: "Архив", tone: "warn", text: `отправил в архив ${who}${bulk}`, detail: reason };
    case "user.restore": return { label: "Из архива", tone: "up", text: `вернул из архива ${who}${bulk}`, detail: reason };
    case "user.sessions.reset": return { label: "Сессии", tone: "neutral", text: `сбросил сессии ${who}${bulk}`, detail: reason };
    case "user.create": return { label: "Новая учётка", tone: "accent", text: `создал учётку ${who} (${ROLE[s(d.role)] ?? s(d.role) ?? "трейдер"})`, detail: [d.curator ? `куратор ${d.curator}` : "", reason ?? ""].filter(Boolean).join(" · ") || undefined };
    case "user.role.change": return { label: "Роль", tone: "purple", text: `сменил роль ${who}: ${d.from ? `${ROLE[s(d.from)] ?? d.from} → ` : ""}${ROLE[s(d.role)] ?? s(d.role)}`, detail: reason };
    case "user.curator.assign":
      return d.to
        ? { label: "Куратор", tone: "accent", text: `назначил куратора ${d.to} для ${who}${bulk}`, detail: [d.from ? `было: ${d.from}` : "", reason ?? ""].filter(Boolean).join(" · ") || undefined }
        : { label: "Куратор", tone: "neutral", text: `снял куратора у ${who}${bulk}`, detail: reason };

    case "report.resolve": return { label: "Жалоба", tone: "up", text: `решил жалобу${d.reportId ? ` #${d.reportId}` : e.targetId ? ` #${e.targetId}` : ""}`, detail: reason };
    case "report.dismiss": return { label: "Жалоба", tone: "neutral", text: `отклонил жалобу${e.targetId ? ` #${e.targetId}` : ""}`, detail: reason };
    case "report.ban_author": return { label: "Бан по жалобе", tone: "down", text: `забанил автора${d.author ? ` ${d.author}` : ""} по жалобе`, detail: reason };
    case "discussion.delete": return { label: "Модерация", tone: "down", text: `удалил обсуждение${d.topic ? ` «${d.topic}»` : ""}${d.author ? ` (автор ${d.author})` : ""}` };
    case "comment.delete": return { label: "Модерация", tone: "down", text: `удалил комментарий${d.author ? ` ${d.author}` : ""}` };

    case "propreports.sync": {
      const src = d.source === "file" ? `из файла${d.fileName ? ` ${d.fileName}` : ""}` : d.source === "api" ? "через API" : "";
      return { label: "PropReports", tone: n(d.errors) ? "down" : "accent", text: `синхронизировал PropReports ${src}`.trim(), detail: syncCounters(d) + (d.errorText ? ` · ${d.errorText}` : "") };
    }
    case "propreports.import": return { label: "PropReports", tone: "accent", text: "импортировал отчёт PropReports", detail: syncCounters(d) };
    case "propreports.account.map": return { label: "Счета", tone: "accent", text: `привязал счёт ${s(d.account) || s(e.targetId)} к ${s(d.trader)}`, detail: [d.from ? `было: ${d.from}` : "", reason ?? ""].filter(Boolean).join(" · ") || undefined };
    case "propreports.accounts.update": {
      const list: string[] = Array.isArray(d.accounts) ? d.accounts.map(String) : [];
      return { label: "Счета", tone: "accent", text: `обновил привязку ${list.length} ${plural(list.length, "счёта", "счетов", "счетов")}`, detail: list.slice(0, 6).join(", ") || undefined };
    }
    case "propreports.accounts.delete": return { label: "Счета", tone: "warn", text: `удалил привязку счёта #${s(e.targetId)}` };
    case "propreports.accounts.refresh": return { label: "Счета", tone: "neutral", text: "обновил список счетов PropReports" };
    case "propreports.settings.update": return { label: "PropReports", tone: "neutral", text: "изменил настройки PropReports" };
    case "propreports.check": return { label: "PropReports", tone: "neutral", text: "проверил подключение к PropReports" };
    case "propreports.merge": return { label: "Сверка", tone: "accent", text: "объединил сделку брокера с ручной" };
    case "propreports.keep_separate": return { label: "Сверка", tone: "neutral", text: "оставил сделку брокера отдельной" };
    case "propreports.dismiss": return { label: "Сверка", tone: "neutral", text: "отклонил сделку из сверки" };
    case "propreports.performance.replace":
    case "propreports.performance.import":
    case "propreports.performance.upload": {
      const sum = d.summary ?? {};
      return {
        label: "Отчёт", tone: "accent",
        text: `загрузил отчёт Trade Performance${d.trader ? ` (${d.trader})` : ""}${d.periodFrom ? ` за ${d.periodFrom} — ${d.periodTo}` : ""}`,
        detail: sum.trades != null ? `${sum.trades} сделок${sum.net != null ? `, net ${Number(sum.net).toFixed(2)}` : ""}` : undefined,
      };
    }
    case "propreports.performance.delete": return { label: "Отчёт", tone: "warn", text: `удалил отчёт Trade Performance #${s(e.targetId)}` };

    case "db.export": {
      const t = Array.isArray(d.tables) ? d.tables.length : 0;
      return { label: "Экспорт", tone: "accent", text: `выгрузил базу${t ? ` (${t} ${plural(t, "таблица", "таблицы", "таблиц")})` : ""}`, detail: d.partial ? "частичный экспорт" : undefined };
    }
    case "db.backup": return { label: "Бэкап", tone: "accent", text: e.actor === "system" ? "создана резервная копия базы" : "запустил резервную копию базы", detail: d.sizeKb ? `${n(d.sizeKb).toLocaleString("ru-RU")} КБ` : undefined };

    case "scaling.assign": return { label: "Тир", tone: "purple", text: `назначил тир ${tier(d.toTier)} трейдеру ${s(e.targetId)}`, detail: [d.fromTier ? `был: ${tier(d.fromTier)}` : "", reason ?? ""].filter(Boolean).join(" · ") || undefined };
    case "scaling.proposal.create": return { label: "Тир", tone: "neutral", text: `предложил смену тира${d.trader ? ` для ${d.trader}` : ""}`, detail: d.toTier ? `→ ${tier(d.toTier)}` : undefined };
    case "scaling.proposal.auto": return { label: "Тир", tone: "neutral", text: `автопредложение тира${d.trader ? ` для ${d.trader}` : ""}`, detail: d.toTier ? `→ ${tier(d.toTier)}` : undefined };
    case "scaling.proposal.approve": return { label: "Тир", tone: "up", text: `одобрил смену тира${d.trader ? ` для ${d.trader}` : ""}`, detail: d.toTier ? `→ ${tier(d.toTier)}` : reason };
    case "scaling.proposal.reject": return { label: "Тир", tone: "neutral", text: `отклонил смену тира${d.trader ? ` для ${d.trader}` : ""}`, detail: reason };
    case "scaling.tiers.update": return { label: "Тиры", tone: "neutral", text: "изменил лестницу тиров" };
    case "scaling.rules.update": return { label: "Тиры", tone: "neutral", text: "изменил правила масштабирования" };

    case "permissions.matrix.update": return { label: "Права", tone: "purple", text: "изменил матрицу прав доступа", detail: reason };

    case "academy.path.seed_demo": {
      const c = Array.isArray(d.created) ? d.created.length : 0;
      return { label: "Академия", tone: "neutral", text: `создал демо-челленджи академии${c ? ` (${c})` : ""}` };
    }
    case "academy.challenge.create": return { label: "Академия", tone: "neutral", text: `создал челлендж академии${d.user ? ` для ${d.user}` : ""}`, detail: d.startsOn ? `старт ${d.startsOn}` : undefined };
    case "academy.challenge.archive": return { label: "Академия", tone: "neutral", text: "архивировал челлендж академии" };
    case "academy.promotion.request": return { label: "Академия", tone: "neutral", text: "запросил повышение уровня" };
    case "academy.promotion.approve": return { label: "Академия", tone: "up", text: "одобрил повышение уровня", detail: reason };
    case "academy.promotion.reject": return { label: "Академия", tone: "neutral", text: "отклонил повышение уровня", detail: reason };
    case "academy.stages.update": return { label: "Академия", tone: "neutral", text: "изменил ступени академии" };
    case "academy.criteria.update": return { label: "Академия", tone: "neutral", text: "изменил критерии академии" };

    case "risk.limits.template": {
      const changes: string[] = Array.isArray(d.changes) ? d.changes.map(String) : [];
      const target = s(e.targetId) || s(d.trader);
      return {
        label: "Лимиты", tone: "purple",
        text: d.resync
          ? `сверил лимиты ${target} с шаблоном тира ${tier(d.tierKey)}`
          : `применил шаблон лимитов тира ${tier(d.tierKey)} к ${target}`,
        detail: [
          d.fromTier && d.fromTier !== d.tierKey ? `был тир: ${tier(d.fromTier)}` : "",
          changes.length ? changes.join(", ") : d.resync ? "лимиты уже совпадали" : "",
          reason ?? "",
        ].filter(Boolean).join(" · ") || undefined,
      };
    }
    case "risk.breach.review":
    case "risk.breach.review.update":
      return {
        label: "Разбор нарушения", tone: "accent",
        text: `${e.action === "risk.breach.review" ? "разобрал" : "обновил разбор"} нарушения${d.trader ? ` ${d.trader}` : ""}`,
        detail: [d.consequence ? CONSEQUENCE[s(d.consequence)] ?? s(d.consequence) : "", n(d.actions) ? `договорённостей: ${n(d.actions)}` : ""].filter(Boolean).join(" · ") || undefined,
      };
    case "risk.breach.review.archive": return { label: "Разбор нарушения", tone: "neutral", text: `архивировал разбор нарушения${d.trader ? ` ${d.trader}` : ""}` };
    case "curator.note.archive": return { label: "Заметка", tone: "neutral", text: `архивировал заметку${d.trader ? ` о ${d.trader}` : ""}`, detail: d.author ? `автор ${d.author}` : undefined };
    case "curator.queue.archive_old": {
      const by = d.byKind && typeof d.byKind === "object" ? Object.entries(d.byKind as Record<string, unknown>).map(([k, v]) => `${QUEUE_KIND[k] ?? k} ${n(v)}`) : [];
      return {
        label: "Очередь", tone: "neutral",
        text: `убрал из очереди разборов ${n(d.archived)} ${plural(n(d.archived), "старый элемент", "старых элемента", "старых элементов")}`,
        detail: [d.olderThanDays ? `старше ${n(d.olderThanDays)} дн.` : "", by.join(", ")].filter(Boolean).join(" · ") || undefined,
      };
    }
    case "office_capital.set": return { label: "Капитал", tone: "neutral", text: `задал капитал офиса на ${s(e.targetId)}`, detail: [d.capital != null ? `капитал ${n(d.capital).toLocaleString("ru-RU")} $` : "", d.goalPct != null ? `цель ${n(d.goalPct)}%` : ""].filter(Boolean).join(" · ") || undefined };
    case "academy.stage.assign":
    case "academy.stage.promote":
    case "academy.stage.demote": {
      const verb = e.action.endsWith("promote") ? "повысил" : e.action.endsWith("demote") ? "понизил" : "назначил ступень";
      return {
        label: "Ступень", tone: e.action.endsWith("demote") ? "warn" : e.action.endsWith("promote") ? "up" : "accent",
        text: `${verb} ${s(e.targetId)}${e.action.endsWith("assign") ? "" : " до ступени"} ${tier(d.to)}`.replace(/\s+/g, " "),
        detail: d.from ? `была: ${tier(d.from)}` : undefined,
      };
    }

    case "daily_quote.regenerate": return { label: "Цитата дня", tone: "neutral", text: "обновил цитату дня" };
    case "daily_quote.cron": return { label: "Цитата дня", tone: "neutral", text: "цитата дня обновлена по расписанию" };
  }

  // Unknown action: readable fallback — object in Russian + up to three details with Russian keys, technical ids hidden.
  const label = (e.targetType && OBJECT_TYPE_LABEL[e.targetType]) || e.action.split(".")[0] || e.action;
  const extras = Object.entries(d)
    .filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && !HIDDEN_KEYS.has(k))
    .slice(0, 3)
    .map(([k, v]) => `${DETAIL_KEY[k] ?? k}: ${typeof v === "boolean" ? (v ? "да" : "нет") : /tier/i.test(k) ? tier(v) : v}`);
  const obj = e.targetType ? objectLabel(e.targetType, e.targetId, d) : "";
  const parts = e.action.split(".");
  const verb = VERB[parts[parts.length - 1]];
  const subject = obj || parts.slice(0, -1).join(" ").replace(/_/g, " ");
  return {
    label,
    tone: /delete|ban|fail|error/.test(e.action) ? "down" : "neutral",
    text: verb ? `${verb}: ${subject}` : `${parts.join(" ").replace(/_/g, " ")}${obj ? ` · ${obj}` : ""}`,
    detail: [reason ?? "", ...extras].filter(Boolean).join(" · ") || undefined,
  };
}

/** Full sentence with the actor, used for CSV and screen readers. */
export function auditSentence(e: AuditLike, tierNames?: Record<string, string>): string {
  const t = describeAudit(e, tierNames);
  return `${actorName(e.actor)} ${t.text}${t.detail ? ` (${t.detail})` : ""}`;
}
