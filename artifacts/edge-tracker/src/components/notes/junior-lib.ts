import type { CSSProperties } from "react";
import { BASE } from "@/lib/api";

/* ───────────────────────── Types ───────────────────────── */

export const SECTION_KEYS = ["free", "plan", "intraday", "overnight", "swing", "mistakes", "lessons", "focus"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type Sections = Partial<Record<SectionKey, string>>;

export type JuniorNote = {
  id: number;
  trader: string;
  note_date: string;
  raw_text: string;
  refined_text: string | null;
  mood: string | null;
  sections?: Sections | null;
  curator_feedback?: string | null;
  curator_score?: number | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  feedback_seen_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ScoreTrend = {
  scores: { date: string; score: number }[];
  avg: number | null;
  recent: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | null;
};

export type RepeatedMistake = { key: string; label: string; count: number; last: string };

export type AttentionFlag = {
  kind: "unanswered" | "missed" | "low_score" | "falling" | "repeat";
  label: string;
  tone: "down" | "warn" | "accent";
};

export type OverviewRow = {
  trader: string;
  /** The reviewer's own junior (assigned curator / mentor). */
  mine?: boolean;
  note: {
    id: number;
    mood: string | null;
    words: number;
    preview: string;
    curator_score: number | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    updated_at: string;
  } | null;
  streak: number;
  last_note_date: string | null;
  notes_30d: number;
  unreviewed_14d: number;
  avg_score: number | null;
  reminder: { id: number; curator: string; created_at: string } | null;
  missed_run?: number;
  trend?: ScoreTrend;
  repeated?: RepeatedMistake[];
  attention?: AttentionFlag[];
  priority?: number;
};

/** GET /junior-notes/reviewer — who the caller may review. */
export type ReviewerInfo = {
  kind: "desk" | "scoped" | "none";
  via: "desk" | "assigned" | "mentor" | null;
  /** Scoped reviewers: the only juniors they review. */
  traders: string[] | null;
  /** «Мои джуны»: assigned curator / mentor of these. */
  mine: string[];
  /** Sees juniors' $ (staff). Mentors who are traders see R only. */
  money: boolean;
};

export function canReviewTrader(r: ReviewerInfo | null | undefined, trader: string, me: string): boolean {
  if (!r || r.kind === "none" || !trader || trader === me) return false;
  return r.kind === "desk" || (r.traders ?? []).includes(trader);
}

export type ContextTrade = {
  id: number;
  ticker: string;
  side: string | null;
  setup: string | null;
  horizon: string;
  result: string | null;
  date: string;
  exit_date: string | null;
  r: number | null;
  pnl_net: number | null;
};

/** GET /junior-notes/:id/context — what the reviewer sees next to the note. */
export type ReviewContext = {
  note_id: number;
  trader: string;
  date: string;
  trades: {
    opened: ContextTrade[];
    carried: ContextTrade[];
    totals: { count: number; wins: number; losses: number; r: number | null; pnl_net: number | null };
    money_visible: boolean;
  };
  prev: {
    id: number;
    note_date: string;
    focus: string | null;
    mistakes: string | null;
    lessons: string | null;
    curator_feedback: string | null;
    curator_score: number | null;
    reviewed_by: string | null;
  } | null;
  recent_feedback: { note_date: string; score: number | null; feedback: string | null; reviewed_by: string | null }[];
  trend: ScoreTrend;
  repeated: RepeatedMistake[];
  streak: number;
};

export type Reminder = { id: number; trader: string; note_date: string; curator: string; message: string | null; created_at: string };

/* ───────────────────────── Sections ───────────────────────── */

export const SECTION_META: Record<SectionKey, { title: string; hint: string; placeholder: string }> = {
  free: { title: "Заметки", hint: "Свободный текст", placeholder: "Всё, что не легло в разделы ниже…" },
  plan: {
    title: "План",
    hint: "Что планировал до открытия",
    placeholder: "Имена в игре, катализаторы, уровни. Какой A+ сетап ждал? Риск на день?",
  },
  intraday: {
    title: "Интрадей",
    hint: "Закрыто до закрытия сессии",
    placeholder: "AAPL лонг от VWAP после гэпа, +1.2R. Вход по плану? Что с размером?",
  },
  overnight: {
    title: "Овернайт",
    hint: "Перенос через ночь — гэп-риск",
    placeholder: "Что держишь на ночь и почему. Где стоп на гэп, какой размер позиции?",
  },
  swing: {
    title: "Свинг",
    hint: "Позиции на дни–недели",
    placeholder: "Тезис позиции, уровни выхода, что изменилось сегодня.",
  },
  mistakes: {
    title: "Ошибки",
    hint: "Где отошёл от плана",
    placeholder: "Ранний вход, двинул стоп, FOMO, переторговка, размер больше лимита…",
  },
  lessons: {
    title: "Уроки",
    hint: "Что забираешь с собой",
    placeholder: "Один-два вывода, которые изменят твою торговлю завтра.",
  },
  focus: {
    title: "Фокус на завтра",
    hint: "Одна конкретная цель",
    placeholder: "Например: только A+ сетапы, не больше 3 сделок, стоп на красный день −$300.",
  },
};

export const TRADE_SECTIONS: SectionKey[] = ["intraday", "overnight", "swing"];

export function emptySections(): Sections {
  return {};
}

/** Sections for a loaded note. Legacy notes (free text only) land in the untitled `free` block. */
export function sectionsOf(note: JuniorNote | null | undefined): Sections {
  if (!note) return {};
  if (note.sections && typeof note.sections === "object") return { ...note.sections };
  return note.raw_text?.trim() ? { free: note.raw_text } : {};
}

/** Flat text for AI/search — mirrors composeSections() on the server. */
export function composeSections(s: Sections): string {
  return SECTION_KEYS.filter((k) => s[k]?.trim())
    .map((k) => {
      const title =
        k === "free" ? "" : TRADE_SECTIONS.includes(k) ? `Сделки — ${SECTION_META[k].title.toLowerCase()}` : SECTION_META[k].title;
      return title ? `${title}:\n${s[k]!.trim()}` : s[k]!.trim();
    })
    .join("\n\n");
}

export function filledKeys(s: Sections): SectionKey[] {
  return SECTION_KEYS.filter((k) => s[k]?.trim());
}

export function wordCount(s: Sections): number {
  return SECTION_KEYS.reduce((n, k) => n + (s[k]?.trim() ? s[k]!.trim().split(/\s+/).length : 0), 0);
}

/* ───────────────────────── Templates ───────────────────────── */

export type Template = { id: string; label: string; sections: Sections };

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "regular",
    label: "Обычный день",
    sections: {
      plan: "В игре: \nКатализаторы: \nКлючевые уровни: \nРиск на день: ",
      intraday: "Тикер · сетап · вход/выход · R\n",
      mistakes: "1. ",
      lessons: "1. ",
      focus: "",
    },
  },
  {
    id: "red",
    label: "Красный день",
    sections: {
      plan: "Что было в плане: ",
      intraday: "Сделки, которые дали минус: \n",
      mistakes: "Где сработал / не сработал стоп на день: \nЭмоции после первого лосса: \n",
      lessons: "Что сделаю иначе: ",
      focus: "Завтра: уменьшить размер до первой плюсовой сделки.",
    },
  },
  {
    id: "carry",
    label: "Перенос позиций",
    sections: {
      overnight: "Тикер · размер · средняя · стоп на гэп · причина переноса\n",
      swing: "Тикер · тезис · цель · уровень отмены тезиса\n",
      focus: "Утром: проверить премаркет по переносам до открытия.",
    },
  },
  {
    id: "flat",
    label: "Без сделок",
    sections: {
      plan: "Что смотрел: ",
      mistakes: "Пропущенные сетапы и почему не вошёл: ",
      lessons: "",
    },
  },
];

const MY_TEMPLATE_KEY = "ws_lexx_junior_template";

export function loadMyTemplate(): Template | null {
  try {
    const raw = localStorage.getItem(MY_TEMPLATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Sections;
    return s && typeof s === "object" ? { id: "mine", label: "Мой шаблон", sections: s } : null;
  } catch {
    return null;
  }
}

export function saveMyTemplate(s: Sections): boolean {
  try {
    localStorage.setItem(MY_TEMPLATE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Fills only empty sections so a template never overwrites what the trader already wrote. */
export function applyTemplate(current: Sections, t: Template): Sections {
  const next = { ...current };
  for (const k of SECTION_KEYS) {
    const v = t.sections[k];
    if (v != null && !next[k]?.trim()) next[k] = v;
  }
  return next;
}

/* ───────────────────────── Mood ───────────────────────── */

export const MOODS = [
  { value: "focused", label: "Сосредоточен", score: 5 },
  { value: "confident", label: "Уверен", score: 4 },
  { value: "neutral", label: "Нейтрально", score: 3 },
  { value: "stressed", label: "Напряжён", score: 2 },
  { value: "frustrated", label: "Раздражён", score: 1 },
] as const;

export function moodMeta(v: string | null | undefined) {
  return MOODS.find((m) => m.value === v) ?? null;
}

export function moodTone(v: string | null | undefined): "up" | "accent" | "neutral" | "warn" | "down" {
  const s = moodMeta(v)?.score;
  if (s == null) return "neutral";
  return s >= 5 ? "up" : s === 4 ? "accent" : s === 3 ? "neutral" : s === 2 ? "warn" : "down";
}

/* ───────────────────────── Dates ───────────────────────── */

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isWeekend(iso: string): boolean {
  const wd = new Date(iso + "T12:00:00").getDay();
  return wd === 0 || wd === 6;
}

export function prevTradingDay(iso: string): string {
  let d = addDays(iso, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

export function nextTradingDay(iso: string): string {
  let d = addDays(iso, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Last `n` trading days ending at `end` (inclusive if it is a weekday), oldest first. */
export function lastTradingDays(end: string, n: number): string[] {
  const out: string[] = [];
  let d = end;
  while (isWeekend(d)) d = addDays(d, -1);
  while (out.length < n) {
    out.push(d);
    d = prevTradingDay(d);
  }
  return out.reverse();
}

/** Consecutive trading days with a note, counting back from today (today may still be unwritten). */
export function streakOf(dates: Set<string>, today = localToday()): number {
  let d = today;
  while (isWeekend(d)) d = addDays(d, -1);
  if (!dates.has(d)) d = prevTradingDay(d);
  let n = 0;
  while (dates.has(d) && n < 400) {
    n++;
    d = prevTradingDay(d);
  }
  return n;
}

export function fmtDayLong(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return iso;
  }
}

export function fmtDayShort(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

export function fmtWeekday(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "short" });
  } catch {
    return "";
  }
}

export function relTime(ts: string | number | null | undefined, now = Date.now()): string {
  if (ts == null) return "";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "только что";
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export function hasFeedback(n: Pick<JuniorNote, "reviewed_at">): boolean {
  return !!n.reviewed_at;
}

export function isUnread(n: Pick<JuniorNote, "reviewed_at" | "feedback_seen_at">): boolean {
  return !!n.reviewed_at && !n.feedback_seen_at;
}

/* ───────────────────────── API ───────────────────────── */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(res.status, data.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const qk = {
  all: ["junior-notes"] as const,
  day: (trader: string, date: string) => ["junior-notes", "day", trader, date] as const,
  history: (trader: string) => ["junior-notes", "history", trader] as const,
  team: (date: string) => ["junior-notes", "team", date] as const,
  overview: (date: string, scope: ReviewScopeFilter = "all") => ["junior-notes", "overview", date, scope] as const,
  reminders: ["junior-notes", "reminders", "me"] as const,
  /** Prefix — touch every scope with setQueriesData / invalidateQueries. */
  queue: ["junior-notes", "queue"] as const,
  queueOf: (scope: ReviewScopeFilter) => ["junior-notes", "queue", scope] as const,
  reviewer: ["junior-notes", "reviewer"] as const,
  context: (id: number) => ["junior-notes", "context", id] as const,
};

export type ReviewScopeFilter = "all" | "mine";

/* ───────────────────────── Review flow (senior) ───────────────────────── */

/** Built-in quick replies — short, concrete, in the desk's voice. */
export const BUILTIN_SNIPPETS: readonly string[] = [
  "Хороший разбор — так держать.",
  "Опиши конкретнее: вход, стоп, выход и почему именно там.",
  "Где был стоп? Укажи уровень и риск в R до входа.",
  "Ошибку видишь — теперь сформулируй правило, которое её предотвратит.",
  "Фокус на завтра слишком общий — одно измеримое правило.",
  "Сверь сделки с планом: какие были вне плана и почему?",
  "Вчерашний фокус не выполнен — разберём на 1:1.",
];

const SNIPPETS_KEY = "ws_lexx_junior_snippets";
const MAX_SNIPPETS = 10;

export function loadMySnippets(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SNIPPETS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, MAX_SNIPPETS) : [];
  } catch {
    return [];
  }
}

export function saveMySnippets(list: string[]): boolean {
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list.slice(0, MAX_SNIPPETS)));
    return true;
  } catch {
    return false;
  }
}

/** Adds a personal snippet on top (deduplicated, trimmed, capped). */
export function addSnippet(list: readonly string[], text: string): string[] {
  const t = text.trim().slice(0, 300);
  if (!t) return [...list];
  return [t, ...list.filter((x) => x !== t)].slice(0, MAX_SNIPPETS);
}

/** Appends a quick reply on its own line; a snippet already in the text is not added twice. */
export function appendSnippet(text: string, snippet: string): string {
  const s = snippet.trim();
  if (!s || text.includes(s)) return text;
  if (!text.trim()) return s;
  return /\n\s*$/.test(text) ? `${text}${s}` : `${text.replace(/\s+$/, "")}\n${s}`;
}

/* Feedback drafts survive closing the sheet / switching notes (per note, this browser only). */
const DRAFT_PREFIX = "ws_lexx_junior_draft:";
export type ReviewDraft = { feedback: string; score: number | null };

export function loadDraft(id: number): ReviewDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ReviewDraft>;
    return { feedback: typeof d.feedback === "string" ? d.feedback : "", score: typeof d.score === "number" ? d.score : null };
  } catch {
    return null;
  }
}

export function saveDraft(id: number, d: ReviewDraft): void {
  try { localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(d)); } catch { /* ignore */ }
}

export function clearDraft(id: number): void {
  try { localStorage.removeItem(DRAFT_PREFIX + id); } catch { /* ignore */ }
}

export function hasDraft(id: number): boolean {
  try { return localStorage.getItem(DRAFT_PREFIX + id) != null; } catch { return false; }
}

/** A draft is worth keeping only when it differs from what is already saved on the note. */
export function draftDiffers(d: ReviewDraft, saved: { curator_feedback?: string | null; curator_score?: number | null }): boolean {
  return d.feedback.trim() !== (saved.curator_feedback ?? "").trim() || (d.score ?? null) !== (saved.curator_score ?? null);
}

export type ReviewKeyAction =
  | { type: "next" } | { type: "prev" } | { type: "send" } | { type: "focus" } | { type: "score"; value: number | null };

/**
 * Keyboard map of the review sheet. Outside text fields: J/→ next, K/← prev, 1–5 score, 0 clear, R focus the answer.
 * Anywhere: Ctrl/⌘+Enter send, Alt+1–5 score. Russian-layout letters (О, Л, К) work too.
 */
export function reviewKeyAction(
  e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  inField: boolean,
): ReviewKeyAction | null {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return { type: "send" };
  const digit = /^Digit([0-5])$/.exec(e.code ?? "")?.[1] ?? (/^[0-5]$/.test(e.key) ? e.key : null);
  if (e.altKey && !e.ctrlKey && !e.metaKey && digit != null) return { type: "score", value: digit === "0" ? null : Number(digit) };
  if (inField || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (digit != null && !e.shiftKey) return { type: "score", value: digit === "0" ? null : Number(digit) };
  const k = e.key.toLowerCase();
  if (k === "j" || k === "о" || e.key === "ArrowRight") return { type: "next" };
  if (k === "k" || k === "л" || e.key === "ArrowLeft") return { type: "prev" };
  if (k === "r" || k === "к") return { type: "focus" };
  return null;
}

/**
 * Where «send and next» goes: the next item after `currentId` that still needs an answer (wrapping around),
 * or null when everything else in the list is answered.
 */
export function nextUnanswered<T extends { id: number; reviewed_at?: string | null }>(list: readonly T[], currentId: number): T | null {
  const i = Math.max(0, list.findIndex((n) => n.id === currentId));
  for (let k = 1; k <= list.length; k++) {
    const n = list[(i + k) % list.length]!;
    if (n.id !== currentId && !n.reviewed_at) return n;
  }
  return null;
}

/** Roster order for the senior: attention priority first, then name. */
export function byAttention<T extends { trader: string; priority?: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.trader.localeCompare(b.trader, "ru"));
}

/** Whole calendar days between a note date and today (for «ждёт 3 дн.»). */
export function daysSince(iso: string, today = localToday()): number {
  const a = Date.parse(iso + "T12:00:00");
  const b = Date.parse(today + "T12:00:00");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

/* ───────────────────────── Chart styling ───────────────────────── */

export const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};
