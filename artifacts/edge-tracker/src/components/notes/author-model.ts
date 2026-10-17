/**
 * Author notes ("Сводка автора") — shared types, note-section model, templates and API helpers.
 * Sections are stored inside `raw_text` as `## Heading` blocks, so the DB schema and the
 * AI-improve endpoint stay unchanged and old free-form notes keep working.
 */
import type { CSSProperties } from "react";
import { BASE } from "@/lib/api";

export type AuthorNote = {
  id: number;
  trader: string;
  note_date: string;
  raw_text: string;
  refined_text: string | null;
  mood: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteRead = { reader: string; read_at: string };

export type FeedNote = AuthorNote & {
  reads: NoteRead[];
  read_by_me: boolean;
  /** true when served by the old /team endpoint (server without read receipts yet). */
  legacy?: boolean;
};

export type WeeklySummary = {
  id: number;
  trader: string;
  week_start: string;
  week_end: string;
  summary: string;
  quote_of_week: string | null;
  created_at: string;
};

export type Horizon = "intraday" | "overnight" | "swing";

export type DayTrade = {
  id: number;
  ticker: string;
  date: string;
  side: string | null;
  setup: string | null;
  result: string;
  pnl: number | null;
  pnlNet: number | null;
  rMultiple: number | null;
  fees: number | null;
  horizon: Horizon;
  exitDate: string | null;
};

export type DayContext = {
  date: string;
  trader: string;
  trades: DayTrade[];
  held: DayTrade[];
  summary: {
    count: number;
    wins: number;
    losses: number;
    pnlNet: number | null;
    rSum: number | null;
    byHorizon: Record<Horizon, number>;
  };
};

/* ───────────────────────── Mood ───────────────────────── */

export const MOODS = [
  { value: "focused", emoji: "🎯", label: "Сосредоточен", score: 1 },
  { value: "confident", emoji: "💪", label: "Уверен", score: 2 },
  { value: "neutral", emoji: "😐", label: "Нейтральный", score: 0 },
  { value: "stressed", emoji: "😰", label: "Напряжён", score: -1 },
  { value: "frustrated", emoji: "😤", label: "Раздражён", score: -2 },
] as const;

export type MoodValue = (typeof MOODS)[number]["value"];

export function moodOf(v: string | null | undefined) {
  return MOODS.find((m) => m.value === v) ?? null;
}

/* ───────────────────────── Sections ───────────────────────── */

export type SectionKey = "market" | "intraday" | "overnight" | "swing" | "lessons" | "hold" | "open";

export type SectionDef = {
  key: SectionKey;
  heading: string;
  group: "market" | "trades" | "lessons" | "plan";
  label: string;
  placeholder: string;
};

export const SECTION_GROUPS: { id: SectionDef["group"]; title: string; hint: string }[] = [
  { id: "market", title: "Рынок", hint: "Фон дня, кто в игре, катализаторы" },
  { id: "trades", title: "Мои сделки", hint: "По горизонтам: интрадей, овернайт, свинг" },
  { id: "lessons", title: "Уроки", hint: "Что забираю в плейбук, где ошибся" },
  { id: "plan", title: "План на завтра", hint: "Что несу через ночь и что делать на открытии" },
];

export const SECTIONS: SectionDef[] = [
  { key: "market", heading: "Рынок", group: "market", label: "Рынок",
    placeholder: "SPY / QQQ, сектора, кто в игре, катализаторы, что было необычного…" },
  { key: "intraday", heading: "Сделки · интрадей", group: "trades", label: "Интрадей",
    placeholder: "Лучшая и худшая сделка, A+ сетапы, исполнение, где отдал деньги…" },
  { key: "overnight", heading: "Сделки · овернайт", group: "trades", label: "Овернайт",
    placeholder: "Что перенёс через ночь и почему, гэп-риск, размер…" },
  { key: "swing", heading: "Сделки · свинг", group: "trades", label: "Свинг",
    placeholder: "Свинг-позиции: тезис жив? уровни, стопы, что меняю…" },
  { key: "lessons", heading: "Уроки", group: "lessons", label: "Уроки",
    placeholder: "1–3 урока дня. Что повторять, что прекратить…" },
  { key: "hold", heading: "План · держу на ночь", group: "plan", label: "Держу на ночь",
    placeholder: "Тикер · размер · стоп · катализатор · что делаю при гэпе против…" },
  { key: "open", heading: "План · на открытии", group: "plan", label: "На открытии",
    placeholder: "Премаркет: имена в игре, уровни, первый трейд, условие red day stop…" },
];

export type Sections = Record<SectionKey, string>;
export type ParsedNote = { sections: Sections; free: string; structured: boolean };

export function emptySections(): Sections {
  return { market: "", intraday: "", overnight: "", swing: "", lessons: "", hold: "", open: "" };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HEADING_RE = new RegExp(`^## (${SECTIONS.map((s) => escapeRe(s.heading)).join("|")})[ \\t]*$`, "gm");

/** Splits raw_text into known sections. Round-trips with serializeNote (incl. trailing newlines while typing). */
export function parseNote(raw: string): ParsedNote {
  const sections = emptySections();
  const text = raw ?? "";
  const matches = Array.from(text.matchAll(HEADING_RE));
  if (matches.length === 0) return { sections, free: text, structured: false };
  const stripSep = (s: string, hasNext: boolean) => (hasNext && s.endsWith("\n\n") ? s.slice(0, -2) : s);
  const firstIdx = matches[0]!.index ?? 0;
  const free = stripSep(text.slice(0, firstIdx), true);
  matches.forEach((m, i) => {
    const def = SECTIONS.find((s) => s.heading === m[1]);
    if (!def) return;
    const start = (m.index ?? 0) + m[0].length + 1; // skip heading line + its newline
    const next = matches[i + 1];
    const end = next ? next.index ?? text.length : text.length;
    const body = stripSep(text.slice(Math.min(start, end), end), !!next);
    sections[def.key] = sections[def.key] ? `${sections[def.key]}\n${body}` : body;
  });
  return { sections, free, structured: true };
}

export function serializeNote(sections: Sections, free: string): string {
  const blocks: string[] = [];
  if (free.length > 0) blocks.push(free);
  for (const s of SECTIONS) {
    const body = sections[s.key];
    if (body.length > 0) blocks.push(`## ${s.heading}\n${body}`);
  }
  return blocks.join("\n\n");
}

export function filledSections(raw: string): SectionKey[] {
  const p = parseNote(raw);
  return SECTIONS.filter((s) => p.sections[s.key].trim()).map((s) => s.key);
}

/** Plain-text preview without headings, for list rows. */
export function notePreview(raw: string, max = 180): string {
  const p = parseNote(raw);
  const parts = p.structured
    ? [p.free, ...SECTIONS.map((s) => p.sections[s.key])].filter((x) => x.trim())
    : [p.free];
  const flat = parts.join(" · ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function appendText(base: string, add: string): string {
  if (!base.trim()) return add;
  return base.endsWith("\n") ? base + add : `${base}\n${add}`;
}

/* ───────────────────────── Templates ───────────────────────── */

export type NoteTemplate = { id: string; name: string; description: string; sections: Partial<Sections>; custom?: boolean };

export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: "standard",
    name: "Обычный день",
    description: "Полный разбор по всем блокам",
    sections: {
      market: "SPY / QQQ: \nСильные / слабые сектора: \nВ игре: ",
      intraday: "Лучшая сделка: \nХудшая сделка: \nОшибки исполнения: ",
      overnight: "Что перенёс и почему: \nГэп-риск: ",
      swing: "Позиции и уровни: ",
      lessons: "1. \n2. ",
      hold: "Тикер · размер · стоп · катализатор: ",
      open: "Премаркет-список: \nКлючевые уровни: \nЕсли гэп против позиции — ",
    },
  },
  {
    id: "red",
    name: "Красный день",
    description: "Разбор убытка и правила на завтра",
    sections: {
      intraday: "Где потерял основную часть: \nНарушенные правила: ",
      lessons: "Сработал ли red day stop: \nЧто было вне плана: \nЧто меняю завтра (размер, сетапы): ",
      open: "Первый час — половинный размер до +1R.\nТоргую только A+ сетапы: ",
    },
  },
  {
    id: "earnings",
    name: "Отчёты и катализаторы",
    description: "Сезон отчётов, гэпы, держим ли через событие",
    sections: {
      market: "Отчёты вчера / сегодня: \nРеакции на гэпы: ",
      overnight: "Держу через отчёт? Размер и максимальный риск гэпа: ",
      hold: "Имя · отчёт до/после рынка · план на гэп вверх / вниз: ",
      open: "Гэпперы с катализатором: \nУровни премаркета: ",
    },
  },
  {
    id: "friday",
    name: "Конец недели",
    description: "Итоги недели и что несём на выходные",
    sections: {
      lessons: "Итоги недели (R, дисциплина): \nЛучший паттерн недели: \nГлавная ошибка недели: ",
      swing: "Свинги на выходные — тезис и стопы: ",
      hold: "Держу на выходные: ",
      open: "Фокус на следующую неделю: ",
    },
  },
];

const CUSTOM_TPL_KEY = "ws_author_notes_templates";

export function loadCustomTemplates(): NoteTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TPL_KEY);
    const arr = raw ? (JSON.parse(raw) as NoteTemplate[]) : [];
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.name === "string").map((t) => ({ ...t, custom: true })) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(list: NoteTemplate[]) {
  try {
    localStorage.setItem(CUSTOM_TPL_KEY, JSON.stringify(list.slice(0, 12)));
  } catch { /* storage unavailable */ }
}

/** Fills only empty sections, so a template never overwrites what was already written. */
export function applyTemplate(raw: string, tpl: NoteTemplate): string {
  const p = parseNote(raw);
  const next = { ...p.sections };
  for (const s of SECTIONS) {
    const add = tpl.sections[s.key];
    if (add && !next[s.key].trim()) next[s.key] = add;
  }
  return serializeNote(next, p.free);
}

/* ───────────────────────── Dates ───────────────────────── */

export function localToday(): string {
  const d = new Date();
  return isoLocal(d);
}

export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isIsoDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T12:00:00"));
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return isoLocal(d);
}

export function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return isoLocal(d);
}

export function fmtDayLong(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
}

export function fmtDayShort(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function fmtWeekday(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ru-RU", { weekday: "short" });
}

export function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "только что";
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  return `${h} ч назад`;
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00").getDay();
  return d === 0 || d === 6;
}

/** Consecutive weekdays (skipping weekends) ending today/yesterday that have a note. */
export function writingStreak(dates: Set<string>, today: string): number {
  let d = today;
  if (!dates.has(d)) d = addDays(d, -1);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    if (isWeekend(d)) { d = addDays(d, -1); continue; }
    if (!dates.has(d)) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/* ───────────────────────── Formatting ───────────────────────── */

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}R`;
}

export const HORIZON_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };

export const CHART_TOOLTIP: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};

/* ───────────────────────── API ───────────────────────── */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(res.status, body?.error ?? `Ошибка сервера (${res.status})`);
  }
  return (await res.json()) as T;
}

export const AN_KEYS = {
  all: ["author-notes"] as const,
  note: (trader: string, date: string) => ["author-notes", "note", trader, date] as const,
  history: (trader: string) => ["author-notes", "history", trader] as const,
  feed: (from: string, to: string) => ["author-notes", "feed", from, to] as const,
  day: (date: string) => ["author-notes", "day-context", date] as const,
  weekly: (trader: string, week: string) => ["author-notes", "weekly", trader, week] as const,
  reads: (id: number) => ["author-notes", "reads", id] as const,
};

/** Team feed with read receipts; falls back to the per-day /team list on servers without /feed. */
export async function fetchFeed(from: string, to: string): Promise<FeedNote[]> {
  try {
    return await api<FeedNote[]>(`/author-notes/feed?from=${from}&to=${to}`);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    const rows = await api<AuthorNote[]>(`/author-notes/team?date=${to}`);
    return rows
      .filter((n) => n.raw_text?.trim() || n.refined_text)
      .map((n) => ({ ...n, reads: [], read_by_me: true, legacy: true }));
  }
}
