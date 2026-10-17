import { apiUrl } from "@/lib/api";
import { nyDate } from "@/lib/trading-date";
import type { Tone } from "@/components/ds";

export type MarketBias = "bull" | "bear" | "neutral" | "mixed";
export type TickerBias = "bull" | "bear" | "neutral";
export type Horizon = "intraday" | "overnight" | "swing";
export type RiskMode = "normal" | "reduced" | "aggressive";
export type Grade = "A+" | "A" | "B";
export type Impact = "high" | "medium" | "low";

export type LevelSet = { support: number[]; resistance: number[]; note?: string };

/** Screenshot attached to a plan (bytes live in /api/plan-media/:id). */
export type MediaRef = { id: number; caption: string };

export type InPlayItem = {
  ticker: string;
  catalyst: string;
  bias: TickerBias;
  grade?: Grade | null;
  levels: { support: number[]; resistance: number[] };
  plan: string;
  horizon: Horizon;
  risk_note: string;
  // Added in the media/scenarios pass — older plans don't have them, read defensively.
  scenarioA?: string;
  scenarioB?: string;
  trigger?: string;
  invalidation?: string;
  tvLink?: string;
  media?: MediaRef[];
};

export type MacroItem = { time: string; title: string; impact: Impact };

export type GamePlan = {
  id: number;
  date: string;
  author: string;
  updatedBy: string | null;
  marketView: string;
  bias: MarketBias;
  riskMode: RiskMode;
  keyLevels: { SPY?: LevelSet; QQQ?: LevelSet };
  inPlay: InPlayItem[];
  riskNotes: string;
  macro: MacroItem[];
  focus?: string;
  maxLossUsd?: number | null;
  maxTrades?: number | null;
  media?: MediaRef[];
  tvLinks?: string[];
  createdAt: string;
  updatedAt: string;
  readCount: number;
};

/** The writable part of a plan — same shape for the desk plan and a personal plan. */
export type PlanDoc = {
  marketView: string;
  bias: MarketBias;
  riskMode: RiskMode;
  keyLevels: { SPY?: LevelSet; QQQ?: LevelSet };
  inPlay: InPlayItem[];
  riskNotes: string;
  macro: MacroItem[];
  focus: string;
  maxLossUsd: number | null;
  maxTrades: number | null;
  media: MediaRef[];
  tvLinks: string[];
};

export type PlanStatus = "draft" | "ready";
export type TraderPlan = {
  id: number;
  trader: string;
  date: string;
  status: PlanStatus;
  doc: Partial<PlanDoc>;
  createdAt: string;
  updatedAt: string;
};
export type MyPlanResponse = { date: string; plan: TraderPlan | null; prevDate: string | null };
export type TraderPlansResponse = { date: string; team: boolean; plans: TraderPlan[]; missing: string[] };

export type PlanTemplate = {
  id: number;
  author: string;
  kind: "desk" | "personal";
  name: string;
  doc: Partial<PlanDoc>;
  shared: boolean;
  createdAt: string;
};

export type GamePlanResponse = {
  date: string;
  today: string;
  plan: GamePlan | null;
  myReadAt: string | null;
  prevDate: string | null;
  nextDate: string | null;
};

export type GamePlanSummary = {
  id: number;
  date: string;
  author: string;
  bias: MarketBias;
  riskMode: RiskMode;
  marketView: string;
  tickers: string[];
  inPlayCount: number;
  macroCount: number;
  mediaCount?: number;
  readCount: number;
  updatedAt: string;
};

export type ReadsResponse = {
  planId: number;
  total: number;
  readCount: number;
  read: { trader: string; role: string; readAt: string; stale: boolean }[];
  unread: { trader: string; role: string }[];
};

export type PlanPayload = PlanDoc;

// ── API ───────────────────────────────────────────────────────────────────────
async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") msg = body.error;
    } catch {
      if (res.status === 404) msg = "Раздел «План дня» ещё не подключён на сервере";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const gpKeys = {
  day: (date: string) => ["game-plan", "day", date] as const,
  history: ["game-plan", "history"] as const,
  reads: (id: number) => ["game-plan", "reads", id] as const,
  my: (date: string) => ["game-plan", "my", date] as const,
  traders: (date: string) => ["game-plan", "traders", date] as const,
  templates: (kind: "desk" | "personal") => ["game-plan", "templates", kind] as const,
};

export const gpApi = {
  day: (date: string) => fetch(apiUrl(`/api/game-plan?date=${encodeURIComponent(date)}`)).then((r) => asJson<GamePlanResponse>(r)),
  history: (limit = 90) => fetch(apiUrl(`/api/game-plan/history?limit=${limit}`)).then((r) => asJson<GamePlanSummary[]>(r)),
  reads: (id: number) => fetch(apiUrl(`/api/game-plan/${id}/reads`)).then((r) => asJson<ReadsResponse>(r)),
  save: (date: string, body: PlanPayload) =>
    fetch(apiUrl(`/api/game-plan/${encodeURIComponent(date)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => asJson<GamePlan>(r)),
  remove: (date: string) =>
    fetch(apiUrl(`/api/game-plan/${encodeURIComponent(date)}`), { method: "DELETE" }).then((r) => asJson<{ ok: true }>(r)),
  markRead: (id: number) =>
    fetch(apiUrl(`/api/game-plan/${id}/read`), { method: "POST" }).then((r) => asJson<{ readAt: string }>(r)),
  my: (date: string) => fetch(apiUrl(`/api/game-plan/my?date=${encodeURIComponent(date)}`)).then((r) => asJson<MyPlanResponse>(r)),
  saveMy: (date: string, body: PlanDoc & { status: PlanStatus }, signal?: AbortSignal) =>
    fetch(apiUrl(`/api/game-plan/my/${encodeURIComponent(date)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) => asJson<TraderPlan>(r)),
  traders: (date: string) =>
    fetch(apiUrl(`/api/game-plan/traders?date=${encodeURIComponent(date)}`)).then((r) => asJson<TraderPlansResponse>(r)),
  templates: (kind: "desk" | "personal") =>
    fetch(apiUrl(`/api/game-plan/templates?kind=${kind}`)).then((r) => asJson<PlanTemplate[]>(r)),
  saveTemplate: (body: { name: string; kind: "desk" | "personal"; shared?: boolean; doc: PlanDoc }) =>
    fetch(apiUrl(`/api/game-plan/templates`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => asJson<PlanTemplate>(r)),
  removeTemplate: (id: number) =>
    fetch(apiUrl(`/api/game-plan/templates/${id}`), { method: "DELETE" }).then((r) => asJson<{ ok: true }>(r)),
};

// ── Dates (desk calendar = New York) ──────────────────────────────────────────
/** Today on the desk calendar (America/New_York). */
export function nyToday(): string {
  return nyDate();
}

export function isIsoDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
}

/** Shift by trading days (skips Sat/Sun). */
export function shiftTradingDay(date: string, dir: 1 | -1): string {
  const d = new Date(date + "T12:00:00Z");
  do {
    d.setUTCDate(d.getUTCDate() + dir);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Local Date at noon for display formatting (avoids TZ off-by-one). */
export function dateObj(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ── Labels / tones ────────────────────────────────────────────────────────────
export const MARKET_BIAS: Record<MarketBias, { label: string; tone: Tone }> = {
  bull: { label: "Бычий", tone: "up" },
  bear: { label: "Медвежий", tone: "down" },
  neutral: { label: "Нейтральный", tone: "neutral" },
  mixed: { label: "Смешанный", tone: "warn" },
};
export const TICKER_BIAS: Record<TickerBias, { label: string; tone: Tone }> = {
  bull: { label: "Лонг", tone: "up" },
  bear: { label: "Шорт", tone: "down" },
  neutral: { label: "Оба направления", tone: "neutral" },
};
export const HORIZON: Record<Horizon, { label: string; tone: Tone; hint: string }> = {
  intraday: { label: "Интрадей", tone: "accent", hint: "Закрыть до конца сессии" },
  overnight: { label: "Овернайт", tone: "warn", hint: "Перенос через ночь — гэп-риск" },
  swing: { label: "Свинг", tone: "purple", hint: "Удержание дни–недели" },
};
export const RISK_MODE: Record<RiskMode, { label: string; tone: Tone; hint: string }> = {
  normal: { label: "Обычный размер", tone: "neutral", hint: "Стандартный риск на сделку" },
  reduced: { label: "Сниженный размер", tone: "warn", hint: "Size down: риск на сделку ×0.5, только A+ сетапы" },
  aggressive: { label: "Повышенный размер", tone: "up", hint: "Size up на A+ сетапах в рамках лимитов" },
};
export const IMPACT: Record<Impact, { label: string; tone: Tone }> = {
  high: { label: "Высокое", tone: "down" },
  medium: { label: "Среднее", tone: "warn" },
  low: { label: "Низкое", tone: "neutral" },
};

export function fmtLevel(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
