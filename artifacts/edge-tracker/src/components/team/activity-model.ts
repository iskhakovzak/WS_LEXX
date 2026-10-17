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
import { isToday, isYesterday } from "date-fns";
import { fmtDate, fmtWeekday, pluralRu } from "@/lib/format";
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
type Gender = "m" | "f" | "n";
/**
 * Nouns of the feed: nominative singular + gender (for the passive participle) and nominative plural forms (bursts).
 * The feed never conjugates a verb by the actor — we don't know anyone's gender, so phrases read
 * «Ольга Н.: добавлена сделка», «Закир: закрыт торговый день».
 */
const NOUNS: Record<string, { nom: string; g: Gender; forms: Forms }> = {
  trades: { nom: "сделка", g: "f", forms: ["сделка", "сделки", "сделок"] },
  "trade-ideas": { nom: "идея", g: "f", forms: ["идея", "идеи", "идей"] },
  playbook: { nom: "сетап", g: "m", forms: ["сетап", "сетапа", "сетапов"] },
  discussions: { nom: "обсуждение", g: "n", forms: ["обсуждение", "обсуждения", "обсуждений"] },
  research: { nom: "исследование", g: "n", forms: ["исследование", "исследования", "исследований"] },
  events: { nom: "событие", g: "n", forms: ["событие", "события", "событий"] },
  watchlist: { nom: "тикер", g: "m", forms: ["тикер", "тикера", "тикеров"] },
  dailyfeed: { nom: "запись", g: "f", forms: ["запись", "записи", "записей"] },
  journal: { nom: "запись журнала", g: "f", forms: ["запись журнала", "записи журнала", "записей журнала"] },
  eod: { nom: "торговый день", g: "m", forms: ["торговый день", "торговых дня", "торговых дней"] },
  risk: { nom: "лимит", g: "m", forms: ["лимит", "лимита", "лимитов"] },
  "game-plan": { nom: "game plan", g: "m", forms: ["game plan", "game plan", "game plan"] },
  ratings: { nom: "оценка", g: "f", forms: ["оценка", "оценки", "оценок"] },
  sync: { nom: "синхронизация", g: "f", forms: ["синхронизация", "синхронизации", "синхронизаций"] },
  scaling: { nom: "шаг масштабирования", g: "m", forms: ["шаг масштабирования", "шага масштабирования", "шагов масштабирования"] },
  "weekly-review": { nom: "недельный разбор", g: "m", forms: ["недельный разбор", "недельных разбора", "недельных разборов"] },
  offerings: { nom: "офферинг", g: "m", forms: ["офферинг", "офферинга", "офферингов"] },
};
const NOUN_FALLBACK: { nom: string; g: Gender; forms: Forms } = { nom: "запись", g: "f", forms: ["запись", "записи", "записей"] };

/** Short passive participles [м, ж, ср]; the neuter form also serves counts («добавлено 12 сделок»). */
const PARTICIPLES: Record<string, [string, string, string]> = {
  created: ["добавлен", "добавлена", "добавлено"],
  updated: ["обновлён", "обновлена", "обновлено"],
  deleted: ["удалён", "удалена", "удалено"],
  published: ["опубликован", "опубликована", "опубликовано"],
  resubmitted: ["пересдан", "пересдана", "пересдано"],
  acknowledged: ["подтверждён", "подтверждена", "подтверждено"],
  rated: ["оценён", "оценена", "оценено"],
  synced: ["синхронизирован", "синхронизирована", "синхронизировано"],
  reconciled: ["сверен", "сверена", "сверено"],
  closed: ["закрыт", "закрыта", "закрыто"],
  reopened: ["переоткрыт", "переоткрыта", "переоткрыто"],
  reviewed: ["разобран", "разобрана", "разобрано"],
  approved: ["утверждён", "утверждена", "утверждено"],
  rejected: ["отклонён", "отклонена", "отклонено"],
};
const G_IDX: Record<Gender, 0 | 1 | 2> = { m: 0, f: 1, n: 2 };

/** «добавлена сделка» — the participle agrees with the noun, never with the actor. */
function passive(action: string, section: string): string {
  const noun = NOUNS[section] ?? NOUN_FALLBACK;
  const v = PARTICIPLES[action]?.[G_IDX[noun.g]];
  return v ? `${v} ${noun.nom}` : `${action}: ${noun.nom}`;
}

/** Playbook rows that are really about a setup's examples («Эталоны (Tier 1): +2», «Эталон убран …»), not the setup. */
export function isExampleChange(item: Pick<FeedItem, "section" | "details">): boolean {
  return item.section === "playbook" && /^Эталон/.test(item.details ?? "");
}

const RATING_LABEL: Record<string, string> = { excellent: "отлично", good: "хорошо", needs_work: "есть над чем работать", poor: "плохо" };
/** Curator rating key → Russian (unknown values pass through). */
export function ratingLabel(r: string): string {
  return RATING_LABEL[r] ?? r;
}

const REACTION_LABEL: Record<string, string> = { thumbs_up: "👍 За", thumbs_down: "👎 Против", warning: "⚠️ Осторожно" };
/** Idea reactions are logged as «thumbs_down: comment» — show the reaction in Russian. */
export function detailsText(item: Pick<FeedItem, "action" | "details">): string | null {
  const d = item.details;
  if (!d || item.action !== "reacted") return d;
  const m = /^(thumbs_up|thumbs_down|warning)(?::\s*(.*))?$/s.exec(d);
  if (!m) return d;
  return m[2] ? `${REACTION_LABEL[m[1]!]}: ${m[2]}` : REACTION_LABEL[m[1]!]!;
}

/**
 * Phrase shown after «Имя:» for a single feed item, e.g. «добавлена сделка».
 * Gender-neutral by construction: passive participles agree with the noun, never with the actor.
 */
export function describe(item: FeedItem): string {
  const s = item.section;
  if (isExampleChange(item)) {
    if (item.action === "created") return "добавлен эталон в сетап";
    if (item.action === "deleted") return "убран эталон из сетапа";
    if (item.action === "updated") return "изменён эталон в сетапе";
  }
  switch (item.action) {
    case "reviewed":
      if (s === "trades") return "ревью на сделку";
      if (s === "eod" || s === "journal") return "разобран торговый день";
      if (s === "weekly-review") return "проведён недельный разбор";
      return passive("reviewed", s);
    case "liked": return "реакция на сделку";
    case "reacted": return "реакция на идею";
    case "commented": return "комментарий в обсуждении";
    case "converted": return "идея переведена в сделку";
    case "digest_evening_sent": return "отправлен вечерний дайджест";
    case "digest_morning_sent": return "отправлен утренний дайджест";
    case "created":
      if (s === "discussions") return "открыто обсуждение";
      if (s === "game-plan") return "написан game plan";
      if (s === "journal") return "заполнен журнал дня";
      return passive("created", s);
    case "closed":
      if (s === "eod" || s === "journal") return "закрыт торговый день";
      return passive("closed", s);
    case "reopened":
      if (s === "eod" || s === "journal") return "переоткрыт торговый день";
      return passive("reopened", s);
    case "acknowledged":
      if (s === "game-plan") return "прочитан game plan";
      if (s === "risk") return "подтверждено нарушение";
      return passive("acknowledged", s);
    case "rated":
      return s === "ratings" || s === "trades" ? "поставлена оценка" : passive("rated", s);
    case "synced":
      return s === "sync" ? "сделки синхронизированы из PropReports" : passive("synced", s);
    case "reconciled": return "сделки сверены с брокером";
    case "conflict": return "найдено расхождение с брокером";
    case "violation": return "нарушение правила";
    case "halted": return "остановка: дневной лимит";
    case "limit_warning": return "близко к лимиту";
    case "approved":
      if (s === "scaling") return "утверждено масштабирование";
      return passive("approved", s);
    case "rejected":
      if (s === "scaling") return "отклонено масштабирование";
      return passive("rejected", s);
    default:
      return PARTICIPLES[item.action] ? passive(item.action, s) : item.action;
  }
}

/** Phrase for a collapsed burst of N identical actions («добавлено 12 сделок»). */
export function describeBurst(action: string, section: string, n: number, examples = false): string {
  const forms = (NOUNS[section] ?? NOUN_FALLBACK).forms;
  if (examples && action === "created") return `добавлено эталонов: ${n}`;
  if (examples && action === "deleted") return `убрано эталонов: ${n}`;
  switch (action) {
    case "reviewed": return section === "trades" ? `${n} ревью на сделки` : `разобрано: ${n} ${pluralRu(n, ...forms)}`;
    case "rated": return `поставлено оценок: ${n}`;
    case "liked":
    case "reacted": return `${n} ${pluralRu(n, "реакция", "реакции", "реакций")}`;
    case "commented": return `${n} ${pluralRu(n, "комментарий", "комментария", "комментариев")}`;
    case "synced": return `синхронизировано сделок: ${n}`;
    case "violation": return `${n} ${pluralRu(n, "нарушение правил", "нарушения правил", "нарушений правил")}`;
    default: {
      const v = PARTICIPLES[action]?.[2];
      return v ? `${v}: ${n} ${pluralRu(n, ...forms)}` : `${action}: ${n} ${pluralRu(n, ...forms)}`;
    }
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
    case "eod": {
      // A curator's review is logged as «YYYY-MM-DD|трейдер»: the actor is the curator, the day is the trader's.
      const [day = "", owner = ""] = id.split("|");
      return YMD.test(day) ? links.journalDay(day, owner || (item.trader ?? undefined)) : meta.path;
    }
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
  return `${fmtDate(d, sameYear ? "dayMonthLong" : "long")}, ${fmtWeekday(d, "long")}`;
}

export function capFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtDate(d, "time");
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return fmtDate(d, "dateTime");
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
      isExampleChange(prev) === isExampleChange(it) &&
      !it.section.startsWith("digest") &&
      Math.abs(new Date(prev.createdAt).getTime() - new Date(it.createdAt).getTime()) <= BURST_WINDOW_MS;
    if (sameRun) last.items.push(it);
    else day.bursts.push({ key: it.uid, items: [it] });
  }
  return days;
}
