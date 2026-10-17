import type { Tone } from "@/components/ds";
import type { NextActionKind, Phase, QueueKind, TraderSignal } from "./api";

/** Signed compact USD: +$1,240 / −$85 / «—» for null. */
export function usd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.round(Math.abs(v)).toLocaleString("en-US");
  if (!signed) return `$${abs}`;
  return v > 0 ? `+$${abs}` : v < 0 ? `−$${abs}` : "$0";
}

export function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`;
}

/** «2 ч», «1 д 4 ч» — waiting time in the queue. */
export function waitLabel(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 1) return "<1 ч";
  if (hours < 24) return `${Math.round(hours)} ч`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d} д ${h} ч` : `${d} д`;
}

/** «16 окт» from YYYY-MM-DD (no timezone shift). */
export function shortDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return "—";
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}

/** Date + time for ISO timestamps in the viewer's locale. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const PHASE_LABEL: Record<Phase, string> = {
  premarket: "Премаркет",
  session: "Сессия",
  afterclose: "После закрытия",
  weekend: "Выходной",
};

/** What the curator should be doing in this phase (one line under the header). */
export const PHASE_HINT: Record<Phase, string> = {
  premarket: "Проверьте планы на день, стопы и тех, кто вчера не закрыл день",
  session: "Следите за теми, кто близко к стопу; остановленным — связаться",
  afterclose: "Разберите закрытые дни и нарушения, напомните, кто не закрыл день",
  weekend: "Недельные отчёты, 1:1 и цели на следующую неделю",
};

export const QUEUE_LABEL: Record<QueueKind, string> = { eod: "День", weekly: "Неделя", academy: "Академия", breach: "Нарушение" };
export const QUEUE_TONE: Record<QueueKind, Tone> = { eod: "accent", weekly: "purple", academy: "neutral", breach: "down" };

export function riskTone(state: string): Tone {
  if (state === "stop" || state === "weekly" || state === "drawdown") return "down";
  if (state === "warn") return "warn";
  if (state === "ok") return "up";
  return "neutral";
}

export function actionTone(kind: NextActionKind): Tone {
  switch (kind) {
    case "breach_review": case "stopped": return "down";
    case "near_stop": case "overdue_action": case "missing_eod": case "no_limits": return "warn";
    case "eod_review": case "weekly_review": return "accent";
    case "none": return "up";
    default: return "neutral";
  }
}

/** Discipline 0–10 → tone. */
export function disciplineTone(v: number | null): Tone {
  if (v == null) return "neutral";
  return v >= 7 ? "up" : v >= 5 ? "warn" : "down";
}

/** Largest limit usage today (day / week / drawdown), null when no limits. */
export function worstUsage(s: Pick<TraderSignal, "risk">): number | null {
  const vals = [s.risk.dailyPct, s.risk.weeklyPct, s.risk.drawdownPct].filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
}

export type TraderSort = "attention" | "name" | "pnl" | "discipline";

/** Attention first: priority of the next action, then the worst limit usage, then name. */
export function sortTraders(list: readonly TraderSignal[], by: TraderSort): TraderSignal[] {
  const arr = [...list];
  const name = (a: TraderSignal, b: TraderSignal) => a.trader.localeCompare(b.trader, "ru");
  if (by === "name") return arr.sort(name);
  if (by === "pnl") return arr.sort((a, b) => (a.risk.weekPnl ?? 0) - (b.risk.weekPnl ?? 0) || name(a, b));
  if (by === "discipline") return arr.sort((a, b) => (a.discipline.value ?? 99) - (b.discipline.value ?? 99) || name(a, b));
  return arr.sort((a, b) => b.nextAction.priority - a.nextAction.priority || (worstUsage(b) ?? -1) - (worstUsage(a) ?? -1) || name(a, b));
}

/** Free-text filter over trader name, stage, tier and next action. */
export function matchesQuery(s: TraderSignal, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.trader, s.stage.label, s.tierName, s.nextAction.label].some((x) => (x ?? "").toLowerCase().includes(t));
}

export const NOTE_KIND_LABEL = { note: "Заметка", call: "Разговор", concern: "Тревога", praise: "Успех" } as const;
export const NOTE_KIND_TONE: Record<keyof typeof NOTE_KIND_LABEL, Tone> = { note: "neutral", call: "accent", concern: "warn", praise: "up" };

/** Profile deep link inside the cabinet. */
export function profileHref(trader: string, tab?: string): string {
  const q = new URLSearchParams({ trader });
  if (tab && tab !== "overview") q.set("tab", tab);
  return `/curator?${q.toString()}`;
}

/** Cross-section links the cabinet uses (proposed for lib/links.ts). */
export const curatorLinks = {
  risk: (trader: string) => `/risk?trader=${encodeURIComponent(trader)}`,
  riskLimits: (trader: string) => `/risk?trader=${encodeURIComponent(trader)}&tab=limits`,
  journalQueue: () => "/journal?view=queue",
  journalDay: (trader: string, date?: string) => `/journal?trader=${encodeURIComponent(trader)}${date ? `&date=${date}` : ""}`,
  weeklyCurator: (trader: string, week?: string) => `/weekly-review?view=curator&trader=${encodeURIComponent(trader)}${week ? `&week=${encodeURIComponent(week)}` : ""}`,
  academyMentor: () => "/academy/mentor",
  scaling: (trader: string) => `/scaling?trader=${encodeURIComponent(trader)}`,
  behavior: (trader: string) => `/behavior?trader=${encodeURIComponent(trader)}`,
};
