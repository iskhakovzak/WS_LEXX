/**
 * Big 7 board — shared types, constants and localStorage-backed day state.
 * Storage keys are unchanged from the legacy page so traders keep their plans.
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, Landmark, DollarSign, Rocket, TrendingUp, Newspaper,
} from "lucide-react";
import type { Tone } from "@/components/ds";
import { nyDate } from "@/lib/trading-date";
import { fmtWeekday } from "@/lib/format";

// ─── dates ──────────────────────────────────────────────────────────────────
/** Local YYYY-MM-DD (toISOString is UTC and jumps a day in the evening). */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/**
 * Trading date (New York) — the desk convention; the browser's local date jumps a day for Asian time zones.
 * Read at call time (not once at module load): a tab left open overnight must roll over to the new day.
 * Components re-render on the NY date change through useBig7Today() (use-big7.ts).
 */
export function big7Today(): string {
  return nyDate();
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function isWeekend(d: Date) {
  const w = d.getDay();
  return w === 0 || w === 6;
}
/** Today + n trading days (weekends skipped, holidays ignored). n=0 → today (or next weekday). */
export function addTradingDays(from: string, n: number): string {
  const d = parseLocalDate(from);
  while (isWeekend(d)) d.setDate(d.getDate() + 1);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) left--;
  }
  return localDateStr(d);
}
/** Trading days from `from` to `to` (0 = same day, negative if past). */
export function tradingDaysUntil(to: string, from = big7Today()): number {
  if (to === from) return 0;
  const sign = to > from ? 1 : -1;
  const d = parseLocalDate(from);
  let count = 0;
  const target = to;
  for (let guard = 0; guard < 400; guard++) {
    d.setDate(d.getDate() + sign);
    if (!isWeekend(d)) count += sign;
    const s = localDateStr(d);
    if ((sign > 0 && s >= target) || (sign < 0 && s <= target)) break;
  }
  return count;
}
export function mondayOf(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const w = d.getDay();
  const diff = w === 0 ? -6 : 1 - w;
  d.setDate(d.getDate() + diff);
  return localDateStr(d);
}
export function addDays(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
/** «Пн», «Вт»… in the UI language, capitalised for column heads. */
export function weekdayShort(dateStr: string) {
  const s = fmtWeekday(parseLocalDate(dateStr), "short");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function relDayLabel(dateStr: string): string {
  const today = big7Today();
  if (dateStr === today) return "сегодня";
  const n = tradingDaysUntil(dateStr, today);
  if (dateStr === addTradingDays(today, 1)) return "завтра";
  if (n > 0) return `через ${n} т.д.`;
  return `${Math.abs(n)} т.д. назад`;
}

// ─── numbers ────────────────────────────────────────────────────────────────
/** Parse user-entered number; returns null for empty/invalid (no NaN/Infinity leaks). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".").replace(/[$%\s]/g, "");
  if (s === "" || s === "+" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ─── localStorage ───────────────────────────────────────────────────────────
export function ls<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}
export function lsRaw(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsRawSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

export const DAY_CHANGE_EVENT = "big7-day-change";
export function notifyDayChange() {
  try { window.dispatchEvent(new Event(DAY_CHANGE_EVENT)); } catch { /* noop */ }
}

export type Bias = "" | "bullish" | "bearish" | "neutral" | "watching";
export type TickerDay = {
  bias: Bias;
  notes: string;
  inPlay: boolean;
  rs: number;
  gapPct: string;
  atr: string;
  sessionScore: number;
  sessionNotes: string;
  openPrice: string;
  prevClose: string;
};
export const DEFAULT_DAY: TickerDay = {
  bias: "", notes: "", inPlay: false, rs: 0, gapPct: "", atr: "",
  sessionScore: 0, sessionNotes: "", openPrice: "", prevClose: "",
};
export function getTickerDay(ticker: string): TickerDay {
  return { ...DEFAULT_DAY, ...ls<Partial<TickerDay>>(`big7_day_${ticker}_${big7Today()}`, {}) };
}
export function updateTickerDayField<K extends keyof TickerDay>(ticker: string, key: K, val: TickerDay[K]): TickerDay {
  const next = { ...getTickerDay(ticker), [key]: val };
  lsSet(`big7_day_${ticker}_${big7Today()}`, next);
  notifyDayChange();
  return next;
}

export type TickerStats = { atr: string; avgVol: string; float: string; shortInt: string; sector: string };
export function getTickerStats(ticker: string): TickerStats {
  return { atr: "", avgVol: "", float: "", shortInt: "", sector: "", ...ls<Partial<TickerStats>>(`big7_stats_${ticker}`, {}) };
}
export function saveTickerStats(ticker: string, stats: TickerStats) {
  lsSet(`big7_stats_${ticker}`, stats);
  notifyDayChange();
}

export type MarketCtx = { spyBias: Bias; qqBias: Bias; vixLevel: string; marketNotes: string; gapDirection: string };
export function getMarketContext(): MarketCtx {
  return { spyBias: "", qqBias: "", vixLevel: "", marketNotes: "", gapDirection: "", ...ls<Partial<MarketCtx>>(`big7_market_${big7Today()}`, {}) };
}
export function saveMarketContext(ctx: MarketCtx) {
  lsSet(`big7_market_${big7Today()}`, ctx);
  notifyDayChange();
}

export function parseTickerSymbols(raw: string): string[] {
  return Array.from(new Set(
    raw
      .split(/[\s,;\n\r\t|]+/)
      .map((s) => s.trim().toUpperCase().replace(/^\$/, ""))
      .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
  ));
}

// ─── domain constants ───────────────────────────────────────────────────────
export const DEFAULT_BIG7: Array<{ symbol: string; name: string; exchange: string }> = [
  { symbol: "AAPL", name: "Apple", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ" },
  { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ" },
  { symbol: "AMZN", name: "Amazon", exchange: "NASDAQ" },
  { symbol: "META", name: "Meta Platforms", exchange: "NASDAQ" },
  { symbol: "GOOGL", name: "Alphabet", exchange: "NASDAQ" },
  { symbol: "TSLA", name: "Tesla", exchange: "NASDAQ" },
];

export const BIAS_OPTIONS: Array<{ value: Exclude<Bias, "">; label: string; short: string; tone: Tone }> = [
  { value: "bullish", label: "Лонг", short: "▲ Bull", tone: "up" },
  { value: "bearish", label: "Шорт", short: "▼ Bear", tone: "down" },
  { value: "neutral", label: "Флэт", short: "● Flat", tone: "neutral" },
  { value: "watching", label: "Наблюдаю", short: "◎ Watch", tone: "warn" },
];
export const biasMeta = (b: string) => BIAS_OPTIONS.find((o) => o.value === b) ?? null;

export const CATALYST_TYPES: Array<{ value: string; label: string; icon: LucideIcon; tone: Tone }> = [
  { value: "earnings", label: "Отчёт", icon: BarChart3, tone: "warn" },
  { value: "fomc", label: "FOMC/ФРС", icon: Landmark, tone: "accent" },
  { value: "ex-div", label: "Экс-дивиденд", icon: DollarSign, tone: "up" },
  { value: "product", label: "Презентация", icon: Rocket, tone: "purple" },
  { value: "sector", label: "Сектор", icon: TrendingUp, tone: "accent" },
  { value: "news", label: "Новость", icon: Newspaper, tone: "neutral" },
];
export const catalystMeta = (t: string) => CATALYST_TYPES.find((c) => c.value === t) ?? CATALYST_TYPES[CATALYST_TYPES.length - 1];

/** Catalysts on these pseudo-tickers (or of type FOMC) affect every name on the board. */
export const MARKET_WIDE = new Set(["SPY", "QQQ", "ALL", "MKT", "MARKET", "ES", "NQ"]);
export const isMarketWide = (c: { ticker: string; type: string }) => MARKET_WIDE.has(c.ticker) || c.type === "fomc";

export const RS_LABELS: Record<number, { label: string; tone: Tone }> = {
  1: { label: "Очень слабый", tone: "down" },
  2: { label: "Слабый", tone: "down" },
  3: { label: "Нейтральный", tone: "neutral" },
  4: { label: "Сильный", tone: "up" },
  5: { label: "Очень сильный", tone: "up" },
};

export const LEVEL_LABELS = [
  "support", "resistance", "pivot", "vwap", "pre-market high", "pre-market low", "ath",
  "gap fill", "open", "yesterday close", "yesterday high", "yesterday low",
];
export const LEVEL_LABEL_RU: Record<string, string> = {
  support: "Поддержка",
  resistance: "Сопротивление",
  pivot: "Пивот",
  vwap: "VWAP",
  "pre-market high": "PM high",
  "pre-market low": "PM low",
  ath: "ATH",
  atl: "ATL",
  "gap fill": "Закрытие гэпа",
  open: "Открытие",
  "yesterday close": "PDC",
  "yesterday high": "PDH",
  "yesterday low": "PDL",
  "52w high": "52w high",
  "52w low": "52w low",
};
export const levelLabel = (l: string) => LEVEL_LABEL_RU[l.toLowerCase()] ?? l;
export const ACTION_OPTIONS = ["buy", "sell", "watch", "add size", "trim", "breakout long", "breakdown short", "fade"];
export const ACTION_RU: Record<string, string> = {
  buy: "покупка", sell: "продажа", watch: "наблюдать", "add size": "добор", trim: "сокращать",
  "breakout long": "пробой лонг", "breakdown short": "пробой шорт", fade: "фейд",
};
export function actionTone(a: string): Tone {
  if (a === "buy" || a === "breakout long" || a === "add size") return "up";
  if (a === "sell" || a === "breakdown short" || a === "trim") return "down";
  if (a === "fade") return "warn";
  return "accent";
}
/** Level notes carry the action as a "[action] note" prefix (legacy format, kept). */
export function splitLevelNotes(notes: string | null | undefined): { action: string; note: string } {
  const s = notes ?? "";
  const m = s.match(/^\[([^\]]+)\]\s*/);
  return m ? { action: m[1], note: s.replace(m[0], "") } : { action: "", note: s };
}

// ─── chart settings ─────────────────────────────────────────────────────────
export type Timeframe = "5" | "15" | "60" | "D";
export type ChartStyle = "1" | "0" | "2";
export type GridCols = 1 | 2 | 3;
export const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "5", label: "5м" },
  { value: "15", label: "15м" },
  { value: "60", label: "1ч" },
  { value: "D", label: "1д" },
];
export const CHART_STYLES: Array<{ value: ChartStyle; label: string }> = [
  { value: "1", label: "Свечи" },
  { value: "0", label: "Бары" },
  { value: "2", label: "Линия" },
];
export type StudyDef = string | { id: string; inputs: Record<string, number> };
const MA_PERIODS = [9, 21, 50, 100, 200];
export const CHART_INDICATORS: Array<{ key: string; label: string; desc: string; studies: StudyDef[] }> = [
  { key: "sma", label: "SMA", desc: "9 / 21 / 50 / 100 / 200", studies: MA_PERIODS.map((len) => ({ id: "MASimple@tv-basicstudies", inputs: { length: len } })) },
  { key: "ema", label: "EMA", desc: "9 / 21 / 50 / 100 / 200", studies: MA_PERIODS.map((len) => ({ id: "MAExp@tv-basicstudies", inputs: { length: len } })) },
  { key: "vwap", label: "VWAP", desc: "± отклонения", studies: ["VWAP@tv-basicstudies"] },
  { key: "rsi", label: "RSI", desc: "", studies: ["RSI@tv-basicstudies"] },
  { key: "macd", label: "MACD", desc: "", studies: ["MACD@tv-basicstudies"] },
  { key: "bb", label: "Bollinger Bands", desc: "", studies: ["BB@tv-basicstudies"] },
  { key: "vol", label: "Объём", desc: "", studies: ["Volume@tv-basicstudies"] },
  { key: "srsi", label: "Stoch RSI", desc: "", studies: ["StochasticRSI@tv-basicstudies"] },
  { key: "atr", label: "ATR", desc: "", studies: ["ATR@tv-basicstudies"] },
];
export function buildStudies(keys: string[]): StudyDef[] {
  const out: StudyDef[] = [];
  for (const k of keys) {
    const ind = CHART_INDICATORS.find((i) => i.key === k);
    if (ind) out.push(...ind.studies);
  }
  return out;
}

// ─── API shapes ─────────────────────────────────────────────────────────────
export type Catalyst = {
  id: number;
  ticker: string;
  date: string;
  type: string;
  description: string | null;
  impact: string;
  /** Author (server created_by). null = legacy → staff-only edit/delete. */
  createdBy?: string | null;
};
/** Earnings found in the shared earnings calendar (not stored in big7_catalysts). */
export type AutoEarning = { ticker: string; date: string; callType: string; epsEstimate: number | null };

export type StockQuote = {
  price: number | null;
  change: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  avgVolume: number | null;
  relativeVolume: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  name: string;
  gapPct: number | null;
  atr: number | null;
  spark?: number[];
  marketTime?: number | null;
};

export type GapStats = {
  lastClose: number;
  atr: number | null;
  atrPct: number | null;
  avgGapPct20: number | null;
  avgGapPct60: number | null;
  p90GapPct60: number | null;
  maxGap60: { pct: number; date: string } | null;
  gapsOver1Pct: number | null;
  todayGapPct: number | null;
  ret5: number | null;
  ret20: number | null;
  sma20: number | null;
  sma50: number | null;
  trend: "up" | "down" | "mixed";
  spark: number[];
  rs5Spy?: number | null;
  rs20Spy?: number | null;
  rs5Qqq?: number | null;
  rs20Qqq?: number | null;
};
export type GapRiskResponse = {
  asOf: string;
  benchmarks: { SPY: GapStats | null; QQQ: GapStats | null };
  symbols: Record<string, GapStats>;
  missing: string[];
};

export type RiskLimitsLite = {
  accountSize: number | null;
  maxRiskPerTrade: number | null;
  maxPositionUsd: number | null;
  maxOvernightExposure: number | null;
  allowOvernight: boolean;
  allowSwing: boolean;
  tier: string | null;
};
export type RiskMeLite = {
  limits: RiskLimitsLite | null;
  today?: { overnightExposureUsd?: number; openRiskUsd?: number; dailyRemainingUsd?: number | null };
};

/** One board row with everything the tiles need. */
export type BoardTicker = {
  symbol: string;
  name: string;
  exchange: string;
  group: "core" | "hot";
  id: number;
  position: number;
};

/** Next upcoming catalyst for a ticker (own or market-wide), merged with auto earnings. */
export type MergedCatalyst = {
  key: string;
  ticker: string;
  date: string;
  type: string;
  description: string | null;
  impact: string;
  auto: boolean;
  marketWide: boolean;
  id?: number;
  createdBy?: string | null;
};
export function mergeCatalysts(catalysts: Catalyst[], auto: AutoEarning[]): MergedCatalyst[] {
  const out: MergedCatalyst[] = catalysts.map((c) => ({
    key: `c${c.id}`, ticker: c.ticker, date: c.date, type: c.type, description: c.description,
    impact: c.impact, auto: false, marketWide: isMarketWide(c), id: c.id, createdBy: c.createdBy ?? null,
  }));
  const manualEarnings = new Set(catalysts.filter((c) => c.type === "earnings").map((c) => `${c.ticker}|${c.date}`));
  for (const a of auto) {
    if (manualEarnings.has(`${a.ticker}|${a.date}`)) continue;
    out.push({
      key: `a${a.ticker}${a.date}`, ticker: a.ticker, date: a.date, type: "earnings",
      description: `${a.callType === "BMO" ? "до открытия" : a.callType === "AMC" ? "после закрытия" : "время не указано"}${a.epsEstimate != null ? ` · EPS est ${a.epsEstimate}` : ""}`,
      impact: "high", auto: true, marketWide: false,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}
export function catalystsFor(symbol: string, merged: MergedCatalyst[]) {
  return merged.filter((c) => c.ticker === symbol || c.marketWide);
}
