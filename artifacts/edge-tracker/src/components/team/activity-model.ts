import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookMarked,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Clock,
  Eye,
  Lightbulb,
  List,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  ShieldAlert,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";
import type { Tone } from "@/components/ds";
import { links } from "@/lib/links";

export type FeedItem = {
  uid: string;
  action: string;
  section: string;
  entityId: string | null;
  entityTitle: string | null;
  trader: string | null;
  details: string | null;
  rating: string | null;
  createdAt: string;
};

/** `scope` — "team" | "<trader>" (staff filter) | "me"; absent on legacy API builds. */
export type FeedPage = { items: FeedItem[]; nextCursor: string | null; scope?: string };

export type ActivitySummary = {
  range: { from: string; to: string; date: string };
  scope?: string;
  total: number;
  bySection: { section: string; action: string; count: number }[];
  topTraders: { trader: string; count: number }[];
  trades: {
    count: number;
    wins: number;
    losses: number;
    be?: number;
    sumR: number | null;
    avgR: number | null;
    /** P&L нетто (брутто − комиссии) по закрытым сделкам дня; null, пока P&L не заполнен. */
    net?: number | null;
    traders: number;
    best: { id: number; ticker: string; trader: string | null; rMultiple: number | null; side: string | null } | null;
  };
  facets: { sections30d: { section: string; count: number }[]; traders: string[] };
};

/**
 * Sections of the feed. `path` is the landing page; `highlight` means the entity id can be deep-linked
 * (`?highlight=`). Sections without a path (digest) are informational only.
 */
export const SECTION_META: Record<string, { label: string; icon: LucideIcon; path?: string; highlight?: boolean }> = {
  trades: { label: "Сделки", icon: List, path: "/trades", highlight: true },
  "trade-ideas": { label: "Идеи", icon: Lightbulb, path: "/trade-ideas" },
  playbook: { label: "Плейбук", icon: BookMarked, path: "/playbook", highlight: true },
  discussions: { label: "Обсуждения", icon: MessageSquare, path: "/discussions" },
  research: { label: "Архив исследований", icon: BookOpen, path: "/research" },
  dailyfeed: { label: "Дневной фид", icon: Clock, path: "/dailyfeed" },
  events: { label: "Катализаторы", icon: Zap, path: "/events" },
  watchlist: { label: "Вотчлист", icon: Eye, path: "/watchlist" },
  digest: { label: "Дайджест", icon: Mail },
  journal: { label: "Журнал дня", icon: NotebookPen, path: "/journal" },
  eod: { label: "Закрытие дня", icon: CalendarCheck, path: "/journal" },
  risk: { label: "Риск", icon: ShieldAlert, path: "/risk" },
  "game-plan": { label: "Game plan", icon: ClipboardCheck, path: "/game-plan" },
  ratings: { label: "Оценки", icon: Star, path: "/ratings" },
  sync: { label: "Синхронизация", icon: RefreshCw, path: "/integrations" },
  scaling: { label: "Масштабирование", icon: TrendingUp, path: "/scaling" },
  "weekly-review": { label: "Недельный 1:1", icon: CalendarCheck, path: "/weekly-review" },
  offerings: { label: "Офферинги", icon: Megaphone, path: "/offerings" },
};

export function sectionMeta(section: string) {
  return SECTION_META[section] ?? { label: section, icon: Activity };
}

/** Action groups used by the "Тип" filter (sent to the API as an `actions` list). */
export const ACTION_GROUPS = {
  all: { label: "Все", actions: [] as string[] },
  new: { label: "Новое", actions: ["created", "published", "converted", "synced"] },
  edit: { label: "Изменения", actions: ["updated", "resubmitted", "reopened", "reconciled"] },
  social: { label: "Ревью и реакции", actions: ["reviewed", "liked", "reacted", "commented", "rated", "acknowledged"] },
  desk: { label: "Деск и риск", actions: ["closed", "violation", "halted", "limit_warning", "approved", "rejected", "conflict"] },
  removed: { label: "Удаления", actions: ["deleted"] },
} as const;
export type ActionGroup = keyof typeof ACTION_GROUPS;

export function actionTone(action: string): Tone {
  switch (action) {
    case "created":
    case "published":
    case "converted":
    case "synced":
    case "approved":
    case "closed":
      return "up";
    case "deleted":
    case "violation":
    case "halted":
    case "rejected":
    case "conflict":
      return "down";
    case "reviewed":
    case "rated":
      return "purple";
    case "liked":
    case "reacted":
    case "commented":
    case "acknowledged":
    case "limit_warning":
      return "warn";
    case "updated":
    case "resubmitted":
    case "reopened":
    case "reconciled":
      return "accent";
    default:
      return "neutral";
  }
}

type Forms = [string, string, string];
const NOUNS: Record<string, { one: string; forms: Forms }> = {
  trades: { one: "сделку", forms: ["сделку", "сделки", "сделок"] },
  "trade-ideas": { one: "идею", forms: ["идею", "идеи", "идей"] },
  playbook: { one: "сетап", forms: ["сетап", "сетапа", "сетапов"] },
  discussions: { one: "обсуждение", forms: ["обсуждение", "обсуждения", "обсуждений"] },
  research: { one: "исследование", forms: ["исследование", "исследования", "исследований"] },
  events: { one: "событие", forms: ["событие", "события", "событий"] },
  watchlist: { one: "тикер", forms: ["тикер", "тикера", "тикеров"] },
  dailyfeed: { one: "запись", forms: ["запись", "записи", "записей"] },
  journal: { one: "запись журнала", forms: ["запись журнала", "записи журнала", "записей журнала"] },
  eod: { one: "торговый день", forms: ["торговый день", "торговых дня", "торговых дней"] },
  risk: { one: "лимит", forms: ["лимит", "лимита", "лимитов"] },
  "game-plan": { one: "game plan", forms: ["game plan", "game plan", "game plan"] },
  ratings: { one: "оценку", forms: ["оценку", "оценки", "оценок"] },
  sync: { one: "синхронизацию", forms: ["синхронизацию", "синхронизации", "синхронизаций"] },
  scaling: { one: "шаг масштабирования", forms: ["шаг масштабирования", "шага масштабирования", "шагов масштабирования"] },
  "weekly-review": { one: "недельный разбор", forms: ["недельный разбор", "недельных разбора", "недельных разборов"] },
  offerings: { one: "офферинг", forms: ["офферинг", "офферинга", "офферингов"] },
};

export function plural(n: number, forms: Forms): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

const VERBS: Record<string, string> = {
  created: "добавил",
  updated: "обновил",
  deleted: "удалил",
  published: "опубликовал",
  converted: "перевёл в сделку",
  resubmitted: "пересдал",
  acknowledged: "подтвердил",
  rated: "оценил",
  synced: "синхронизировал",
  reconciled: "сверил",
  conflict: "обнаружил расхождение",
  closed: "закрыл",
  reopened: "переоткрыл",
  reviewed: "разобрал",
  approved: "утвердил",
  rejected: "отклонил",
  violation: "нарушил правило",
  halted: "остановлен по лимиту",
  limit_warning: "приблизился к лимиту",
};

/** Human sentence (without the actor) for a single feed item, e.g. "добавил сделку". */
export function describe(item: FeedItem): string {
  const noun = NOUNS[item.section]?.one ?? "запись";
  const s = item.section;
  switch (item.action) {
    case "reviewed":
      if (s === "trades") return "оставил ревью на сделку";
      if (s === "eod" || s === "journal") return "разобрал торговый день";
      if (s === "weekly-review") return "провёл недельный разбор";
      return `разобрал ${noun}`;
    case "liked": return "отреагировал на сделку";
    case "reacted": return "отреагировал на идею";
    case "commented": return "прокомментировал обсуждение";
    case "converted": return "перевёл идею в сделку";
    case "digest_evening_sent": return "отправлен вечерний дайджест";
    case "digest_morning_sent": return "отправлен утренний дайджест";
    case "created":
      if (s === "discussions") return "открыл обсуждение";
      if (s === "game-plan") return "написал game plan";
      if (s === "journal") return "заполнил журнал дня";
      return `${VERBS.created} ${noun}`;
    case "closed":
      if (s === "eod" || s === "journal") return "закрыл торговый день";
      if (s === "trades") return "закрыл сделку";
      return `закрыл ${noun}`;
    case "reopened":
      if (s === "eod" || s === "journal") return "переоткрыл торговый день";
      return `переоткрыл ${noun}`;
    case "acknowledged":
      if (s === "game-plan") return "прочитал game plan";
      if (s === "risk") return "подтвердил нарушение";
      return `подтвердил ${noun}`;
    case "rated":
      return s === "ratings" || s === "trades" ? "поставил оценку" : `оценил ${noun}`;
    case "synced":
      return s === "sync" ? "синхронизировал сделки из PropReports" : `синхронизировал ${noun}`;
    case "reconciled": return "сверил сделки с брокером";
    case "conflict": return "найдено расхождение с брокером";
    case "violation": return "нарушил правило";
    case "halted": return "остановлен: дневной лимит";
    case "limit_warning": return "приблизился к лимиту";
    case "approved":
      if (s === "scaling") return "утвердил масштабирование";
      return `утвердил ${noun}`;
    case "rejected":
      if (s === "scaling") return "отклонил масштабирование";
      return `отклонил ${noun}`;
    case "resubmitted": return `пересдал ${noun}`;
    default:
      return VERBS[item.action] ? `${VERBS[item.action]} ${noun}` : item.action;
  }
}

/** Sentence for a collapsed burst of N identical actions. */
export function describeBurst(action: string, section: string, n: number): string {
  const forms = NOUNS[section]?.forms ?? (["запись", "записи", "записей"] as Forms);
  switch (action) {
    case "reviewed": return `оставил ${n} ${plural(n, ["ревью", "ревью", "ревью"])}`;
    case "rated": return `поставил ${n} ${plural(n, ["оценку", "оценки", "оценок"])}`;
    case "liked":
    case "reacted": return `поставил ${n} ${plural(n, ["реакцию", "реакции", "реакций"])}`;
    case "commented": return `оставил ${n} ${plural(n, ["комментарий", "комментария", "комментариев"])}`;
    case "synced": return `синхронизировал ${n} ${plural(n, ["сделку", "сделки", "сделок"])}`;
    case "violation": return `${n} ${plural(n, ["нарушение правил", "нарушения правил", "нарушений правил"])}`;
    default: return `${VERBS[action] ?? action} ${n} ${plural(n, forms)}`;
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** In-app link for an item, or null if the entity is gone / has no page. Built with @/lib/links. */
export function itemHref(item: FeedItem): string | null {
  const meta = SECTION_META[item.section];
  if (!meta?.path) return null;
  if (item.action === "deleted") return null;
  const id = item.entityId?.trim() ?? "";
  const numId = /^\d+$/.test(id) ? Number(id) : null;
  switch (item.section) {
    case "trades":
      if (numId != null) return links.trade(numId);
      if (/^\d+(,\d+)+$/.test(id)) return links.trades({ ids: id.split(",").map(Number) });
      return links.trades();
    case "playbook":
      return numId != null ? links.setup(numId) : meta.path;
    case "trade-ideas":
      return numId != null ? links.idea(numId) : meta.path;
    case "discussions":
      return numId != null ? links.thread(numId) : meta.path;
    case "journal":
    case "eod":
      return YMD.test(id) ? links.journalDay(id, item.trader ?? undefined) : meta.path;
    case "game-plan":
      return YMD.test(id) ? links.gamePlan(id) : links.gamePlan();
    case "risk":
      return links.risk(item.trader ?? undefined);
    case "scaling":
      return links.scaling(item.trader ?? undefined);
    case "weekly-review":
      return links.weeklyReview({ trader: item.trader ?? undefined, week: YMD.test(id) ? id : undefined });
    case "ratings":
      return item.trader ? `/ratings?trader=${encodeURIComponent(item.trader)}` : meta.path;
    case "events":
      return id && !numId ? links.events(id) : meta.path;
    case "watchlist":
      return id && !numId ? links.watchlist(id) : meta.path;
    case "offerings":
      return id && !numId ? links.offerings(id) : meta.path;
    default:
      if (meta.highlight && numId != null) return `${meta.path}?highlight=${numId}`;
      return meta.path;
  }
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Сегодня";
  if (isYesterday(d)) return "Вчера";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "d MMMM, EEEE" : "d MMMM yyyy, EEEE", { locale: ru });
}

export function capFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "HH:mm");
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return format(d, "d MMM, HH:mm", { locale: ru });
}

export type Burst = { key: string; items: FeedItem[] };
export type DayGroup = { key: string; label: string; bursts: Burst[] };

const BURST_WINDOW_MS = 15 * 60 * 1000;

/** Group items by local day; inside a day collapse runs of the same actor+action+section within 15 minutes. */
export function groupFeed(items: FeedItem[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const it of items) {
    const k = dayKey(it.createdAt);
    let day = days[days.length - 1];
    if (!day || day.key !== k) {
      day = { key: k, label: dayLabel(it.createdAt), bursts: [] };
      days.push(day);
    }
    const last = day.bursts[day.bursts.length - 1];
    const prev = last?.items[last.items.length - 1];
    const sameRun =
      prev &&
      prev.trader === it.trader &&
      prev.action === it.action &&
      prev.section === it.section &&
      !it.section.startsWith("digest") &&
      Math.abs(new Date(prev.createdAt).getTime() - new Date(it.createdAt).getTime()) <= BURST_WINDOW_MS;
    if (sameRun) last.items.push(it);
    else day.bursts.push({ key: it.uid, items: [it] });
  }
  return days;
}
