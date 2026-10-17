import type { MarketEvent } from "@workspace/api-client-react";
import type { Tone } from "@/components/ds";
import { nyDate, addDays as addNyDays } from "@/lib/trading-date";

/* ───────────── Event types ───────────── */

export const EVENT_TYPES = ["earnings", "momentum", "news", "ipo", "fed", "macro", "short_squeeze", "upg", "dwg", "other"] as const;

const TYPE_META: Record<string, { label: string; tone: Tone }> = {
  earnings: { label: "Отчёт", tone: "accent" },
  momentum: { label: "Моментум", tone: "purple" },
  news: { label: "Новость", tone: "warn" },
  ipo: { label: "IPO", tone: "purple" },
  fed: { label: "ФРС", tone: "accent" },
  macro: { label: "Макро", tone: "accent" },
  economic: { label: "Экономика", tone: "accent" },
  short_squeeze: { label: "Шорт-сквиз", tone: "warn" },
  upg: { label: "Апгрейд", tone: "up" },
  dwg: { label: "Даунгрейд", tone: "down" },
  other: { label: "Другое", tone: "neutral" },
};

/** Legacy rows store types in other casing ("News", "Earnings") — compare case-insensitively. */
export const normType = (t: string | null | undefined) => (t ?? "").trim().toLowerCase();

export function typeMeta(t: string | null | undefined): { label: string; tone: Tone } {
  const k = normType(t);
  return TYPE_META[k] ?? { label: (t ?? "").trim() || "Другое", tone: "neutral" };
}

/** Recharts fill for a tone (tokens only). */
export function toneFill(tone: Tone): string {
  switch (tone) {
    case "up": return "hsl(var(--up))";
    case "down": return "hsl(var(--down))";
    case "accent": return "hsl(var(--chart-1))";
    case "warn": return "hsl(var(--chart-3))";
    case "purple": return "hsl(var(--chart-5))";
    default: return "hsl(var(--muted-foreground))";
  }
}

/* ───────────── Reactions ───────────── */

export const REACTIONS = ["gap_up", "gap_down", "grind_up", "grind_down", "flat", "reversal"] as const;

const REACTION_META: Record<string, { label: string; tone: Tone }> = {
  gap_up: { label: "Гэп вверх", tone: "up" },
  gap_down: { label: "Гэп вниз", tone: "down" },
  grind_up: { label: "Рост в течение дня", tone: "up" },
  grind_down: { label: "Снижение в течение дня", tone: "down" },
  flat: { label: "Без движения", tone: "neutral" },
  reversal: { label: "Разворот", tone: "warn" },
  bullish: { label: "Бычья", tone: "up" },
  bearish: { label: "Медвежья", tone: "down" },
  mixed: { label: "Смешанная", tone: "neutral" },
};

export function reactionMeta(r: string | null | undefined): { label: string; tone: Tone } | null {
  if (!r) return null;
  const k = r.trim().toLowerCase();
  return REACTION_META[k] ?? { label: r, tone: "neutral" };
}

/** Direction of an event: sign of the logged move, else the reaction's tone. */
export function eventTone(e: MarketEvent): Tone {
  if (e.percentMove != null && e.percentMove !== 0) return e.percentMove > 0 ? "up" : "down";
  const r = reactionMeta(e.reaction);
  return r && (r.tone === "up" || r.tone === "down") ? r.tone : "neutral";
}

/* ───────────── Session (BMO / RTH / AMC) ─────────────
 * The API now stores the session in `market_events.session` (serialized as `session`).
 * Legacy rows kept it as a tag ("BMO" / "RTH" / "AMC") or a mention in the headline/summary. */

export type Session = "bmo" | "rth" | "amc";
export const SESSIONS: { value: Session; label: string; hint: string; tone: Tone }[] = [
  { value: "bmo", label: "BMO", hint: "До открытия", tone: "warn" },
  { value: "rth", label: "RTH", hint: "В сессию", tone: "accent" },
  { value: "amc", label: "AMC", hint: "После закрытия", tone: "purple" },
];
const SESSION_TAGS = new Set(["bmo", "rth", "amc"]);

export function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Tags without the session marker (session is shown as its own pill). */
export function displayTags(tags: string | null | undefined): string[] {
  return splitTags(tags).filter((t) => !SESSION_TAGS.has(t.toLowerCase()));
}

export function getSession(e: Pick<MarketEvent, "tags" | "headline" | "summary"> & { session?: string | null }): Session | null {
  const col = (e.session ?? "").trim().toLowerCase();
  if (SESSION_TAGS.has(col)) return col as Session;
  for (const t of splitTags(e.tags)) {
    const k = t.toLowerCase();
    if (SESSION_TAGS.has(k)) return k as Session;
  }
  const text = `${e.headline ?? ""} ${e.summary ?? ""}`;
  if (/\bBMO\b/i.test(text) || /до открытия|premarket|pre-market/i.test(text)) return "bmo";
  if (/\bAMC\b/i.test(text) || /после закрытия|after hours|after-hours/i.test(text)) return "amc";
  return null;
}

/** Merge a session marker into a tag string (replaces any previous marker). */
export function withSession(tags: string[], session: Session | null): string {
  const rest = tags.filter((t) => !SESSION_TAGS.has(t.toLowerCase()));
  return (session ? [session.toUpperCase(), ...rest] : rest).join(", ");
}

/* ───────────── Tickers ───────────── */

/** "XOM, CVX / BP" -> ["XOM","CVX","BP"] */
export function splitTickers(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[\s,;/]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
}

/* ───────────── Dates (YYYY-MM-DD strings; "today" = America/New_York trading date) ───────────── */

export const dayOf = (e: Pick<MarketEvent, "date">) => e.date.substring(0, 10);

export function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date(s);
}

export function addDays(ymd: string, n: number): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? addNyDays(ymd, n) : ymd;
}

/** Monday of the week containing ymd (pure calendar arithmetic, time-zone independent). */
export function weekStartOf(ymd: string): string {
  const d = parseYmd(ymd);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(ymd.substring(0, 10), -dow);
}

/** Trading "today" — the New York calendar date, not the browser's. */
export const today = () => nyDate();

export function fmtDay(ymd: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  const d = parseYmd(ymd);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("ru-RU", opts).replace(/\.$/, "");
}

export function fmtWeekday(ymd: string, style: "short" | "long" = "short") {
  const s = parseYmd(ymd).toLocaleDateString("ru-RU", { weekday: style });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtRange(fromYmd: string, toYmd: string) {
  const a = parseYmd(fromYmd), b = parseYmd(toYmd);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const left = sameMonth ? String(a.getDate()) : fmtDay(fromYmd);
  return `${left} – ${fmtDay(toYmd)} ${b.getFullYear()}`;
}

/* ───────────── Numbers / words ───────────── */

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const eventsWord = (n: number) => `${n} ${plural(n, "событие", "события", "событий")}`;

export function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}%` : n < 0 ? `−${s}%` : `${s}%`;
}

/** Past event with neither a logged move nor a reaction — needs a follow-up. */
export function needsOutcome(e: MarketEvent, todayYmd = today()): boolean {
  return dayOf(e) < todayYmd && e.percentMove == null && !e.reaction;
}

/* ───────────── Macro calendar (holiday_calendar rows) ───────────── */

const MACRO_LABEL: Record<string, string> = {
  fomc: "FOMC", cpi: "CPI", ppi: "PPI", nfp: "NFP", opex: "OPEX", quad_witching: "Квад. экспирация",
  holiday: "Выходной", month_end: "Конец месяца", gdp: "ВВП", pce: "PCE",
};

export function macroLabel(type: string) {
  return MACRO_LABEL[type?.toLowerCase()] ?? (type || "Событие").toUpperCase();
}

export function importanceTone(imp: string): Tone {
  return imp === "high" ? "down" : imp === "medium" ? "warn" : "neutral";
}

/** "8:30am ET — …" -> "8:30 ET" */
export function macroTime(desc: string | null | undefined): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*ET/i.exec(desc ?? "");
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3].toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3].toLowerCase() === "am" && h === 12) h = 0;
  return `${h}:${m[2] ?? "00"} ET`;
}

export function isMarketClosed(h: { type: string; description: string | null }) {
  return h.type === "holiday" && /closed/i.test(h.description ?? "");
}

/* ───────────── Local storage (safe) ───────────── */

export function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveLS(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
