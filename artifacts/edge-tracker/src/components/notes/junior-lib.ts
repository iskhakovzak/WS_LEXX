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

export type OverviewRow = {
  trader: string;
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
  overview: (date: string) => ["junior-notes", "overview", date] as const,
  reminders: ["junior-notes", "reminders", "me"] as const,
  queue: ["junior-notes", "queue"] as const,
};

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
