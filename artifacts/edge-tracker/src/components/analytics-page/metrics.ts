import type { CSSProperties } from "react";
import type { Trade } from "@workspace/api-client-react";
import { TIME_BUCKETS, timeBucketFor, dayOfWeek, tagsOf } from "@/lib/analytics-pro";
import {
  signedR, netPnl, grossPnl as grossOf, feesOf as feesOfTrade, isOpen, isClosed, resultOf, closeDate,
  horizonOf as horizonOfTrade, maxDrawdown as maxDrawdownOf, type Horizon,
} from "@/lib/trade-math";

/*
 * All R / P&L numbers on the analytics page come from @/lib/trade-math (signedR, netPnl …) — the one
 * definition shared with /stats, the dashboard and the API. Never re-derive R here.
 */

/* ───────────────────────── Global filters ───────────────────────── */

export type Period = "7d" | "30d" | "90d" | "ytd" | "all";
export type SideFilter = "" | "long" | "short";
export type { Horizon };
export type HorizonFilter = "" | Horizon;
/** "" = all · "manual" · "propreports" */
export type SourceFilter = "" | "manual" | "propreports";

export type AnalyticsFilters = {
  period: Period;
  trader: string;
  setup: string; // "" = all, "__none__" = no setup
  ticker: string;
  side: SideFilter;
  horizon: HorizonFilter;
  /** Broker account (PropReports `brokerAccount`); "" = all. */
  account: string;
  source: SourceFilter;
};

export const DEFAULT_FILTERS: AnalyticsFilters = {
  period: "all", trader: "", setup: "", ticker: "", side: "", horizon: "", account: "", source: "",
};

export const HORIZON_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };

/** Holding horizon; a missing value means intraday (legacy trades). */
export function horizonOf(t: Trade): Horizon {
  return horizonOfTrade(t);
}

/** Broker fields arrive only after the PropReports rebuild — read them defensively. */
export function accountOf(t: Trade): string {
  const a = (t as { brokerAccount?: string | null }).brokerAccount;
  return typeof a === "string" ? a.trim() : "";
}
export function sourceOf(t: Trade): "manual" | "propreports" {
  const s = (t as { source?: string | null }).source;
  return s === "propreports" ? "propreports" : "manual";
}

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 дн" },
  { value: "30d", label: "30 дн" },
  { value: "90d", label: "90 дн" },
  { value: "ytd", label: "С начала года" },
  { value: "all", label: "Всё время" },
];

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive [from, to] range for a period, plus the equal-length previous range for comparison. */
export function periodRange(period: Period, now = new Date()): { from: string; to: string; prevFrom: string; prevTo: string } | null {
  if (period === "all") return null;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  if (period === "ytd") start = new Date(end.getFullYear(), 0, 1);
  else start = new Date(end.getTime() - ((period === "7d" ? 7 : period === "30d" ? 30 : 90) - 1) * 86400000);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { from: isoDay(start), to: isoDay(end), prevFrom: isoDay(prevStart), prevTo: isoDay(prevEnd) };
}

/** Trading day a result belongs to: the close date (exit date for multi-day holds, else the trade date). */
export const day = (t: Trade) => (closeDate(t) ?? "").substring(0, 10);
export const sideOf = (t: Trade): "long" | "short" | "" => {
  const s = (t.side ?? "").trim().toLowerCase();
  return s.startsWith("l") ? "long" : s.startsWith("s") ? "short" : "";
};

/** Apply everything except the period. */
export function applyNonPeriodFilters(trades: Trade[], f: AnalyticsFilters): Trade[] {
  return trades.filter((t) => {
    if (f.trader && (t.trader ?? "") !== f.trader) return false;
    if (f.side && sideOf(t) !== f.side) return false;
    if (f.horizon && horizonOf(t) !== f.horizon) return false;
    if (f.ticker && (t.ticker ?? "").toUpperCase() !== f.ticker.toUpperCase()) return false;
    if (f.setup === "__none__" ? !!t.setup : f.setup && (t.setup ?? "") !== f.setup) return false;
    if (f.account && accountOf(t) !== f.account) return false;
    if (f.source && sourceOf(t) !== f.source) return false;
    return true;
  });
}

export function applyAnalyticsFilters(trades: Trade[], f: AnalyticsFilters): { current: Trade[]; previous: Trade[] | null } {
  const base = applyNonPeriodFilters(trades, f);
  const r = periodRange(f.period);
  if (!r) return { current: base, previous: null };
  return {
    current: base.filter((t) => day(t) >= r.from && day(t) <= r.to),
    previous: base.filter((t) => day(t) >= r.prevFrom && day(t) <= r.prevTo),
  };
}

export function activeFilterCount(f: AnalyticsFilters): number {
  return (f.period !== "all" ? 1 : 0) + (f.trader ? 1 : 0) + (f.setup ? 1 : 0) + (f.ticker ? 1 : 0) + (f.side ? 1 : 0)
    + (f.horizon ? 1 : 0) + (f.account ? 1 : 0) + (f.source ? 1 : 0);
}

/* ───────────────────────── Trade-level metrics (thin wrappers over @/lib/trade-math) ───────────────────────── */

export const isWin = (t: Trade) => resultOf(t) === "win";
export const isLoss = (t: Trade) => resultOf(t) === "loss";
export const isBe = (t: Trade) => resultOf(t) === "be";
export { isOpen, isClosed };

/** Signed realised R (shared definition: stored R signed by result → price R → pnl/risk; open ⇒ null). */
export function realizedR(t: Trade): number | null {
  return signedR(t);
}

/** P&L as entered (gross, before fees). */
export function grossPnl(t: Trade): number | null {
  return grossOf(t);
}

export function feesOf(t: Trade): number {
  return feesOfTrade(t);
}

/** Net P&L = gross − fees. This is what "$" means across the analytics page. Open trades ⇒ null. */
export function pnlValue(t: Trade): number | null {
  return isOpen(t) ? null : netPnl(t);
}

/** Calendar days held for multi-day trades (exitDate − date); null when unknown. */
export function holdDays(t: Trade): number | null {
  if (!t.exitDate) return null;
  const a = new Date(`${(t.date ?? "").substring(0, 10)}T00:00:00`);
  const b = new Date(`${t.exitDate.substring(0, 10)}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/** Free-text hold time ("47m", "2часа", "1h 30m", "1:15") → minutes. */
export function parseHoldMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(",", ".");
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const re = /(\d+(?:\.\d+)?)\s*([a-zа-яё]*)/g;
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = Number(m[1]);
    const u = m[2];
    let mult = 1;
    if (/^(d|д)/.test(u)) mult = 1440;
    else if (/^(h|ч)/.test(u)) mult = 60;
    else if (/^(s|с)/.test(u)) mult = 1 / 60;
    total += v * mult;
    found = true;
  }
  return found ? total : null;
}

/* ───────────────────────── Group stats ───────────────────────── */

export type Stats = {
  n: number;
  wins: number;
  losses: number;
  /** Break-even trades (reported separately, never in the win-rate denominator). */
  be: number;
  /** Still open (no result yet) — excluded from every ratio. */
  open: number;
  /** wins + losses — the win-rate denominator. */
  decided: number;
  winRate: number; // 0..1 (0 when nothing is decided)
  wrLow: number;
  wrHigh: number;
  rN: number;
  totalR: number;
  avgR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** ΣR⁺ / |ΣR⁻|; null when there are no losing R (never ∞). */
  pfR: number | null;
  pnlN: number;
  /** Net of fees. */
  totalPnl: number;
  avgPnl: number | null;
  avgWinPnl: number | null;
  avgLossPnl: number | null;
  pfPnl: number | null;
  /** Sum of entered P&L before fees (same trades as totalPnl). */
  grossPnl: number;
  totalFees: number;
  feesN: number;
};

/** Wilson 95% interval for a proportion. */
export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

export function computeStats(trades: Trade[]): Stats {
  let wins = 0, losses = 0, be = 0, open = 0;
  let rN = 0, totalR = 0, winRSum = 0, winRN = 0, lossRSum = 0, lossRN = 0;
  let pnlN = 0, totalPnl = 0, winPnlSum = 0, winPnlN = 0, lossPnlSum = 0, lossPnlN = 0, gross = 0, fees = 0, feesN = 0;
  for (const t of trades) {
    if (isOpen(t)) { open++; continue; }
    const res = resultOf(t);
    if (res === "win") wins++;
    else if (res === "loss") losses++;
    else if (res === "be") be++;
    const r = realizedR(t);
    if (r != null) {
      rN++; totalR += r;
      if (r > 0) { winRSum += r; winRN++; } else if (r < 0) { lossRSum += r; lossRN++; }
    }
    const p = pnlValue(t);
    if (p != null) {
      // Fees count only where a P&L exists — otherwise "net" would be understated against "gross".
      if (t.fees != null) { feesN++; fees += feesOf(t); }
      gross += grossPnl(t) ?? 0;
      pnlN++; totalPnl += p;
      if (p > 0) { winPnlSum += p; winPnlN++; } else if (p < 0) { lossPnlSum += p; lossPnlN++; }
    }
  }
  const n = trades.length;
  const decided = wins + losses;
  const [lo, hi] = wilson(wins, decided);
  return {
    n, wins, losses, be, open, decided,
    winRate: decided ? wins / decided : 0,
    wrLow: lo, wrHigh: hi,
    rN, totalR,
    avgR: rN ? totalR / rN : null,
    avgWinR: winRN ? winRSum / winRN : null,
    avgLossR: lossRN ? lossRSum / lossRN : null,
    pfR: lossRSum < 0 ? winRSum / Math.abs(lossRSum) : null,
    pnlN, totalPnl,
    avgPnl: pnlN ? totalPnl / pnlN : null,
    avgWinPnl: winPnlN ? winPnlSum / winPnlN : null,
    avgLossPnl: lossPnlN ? lossPnlSum / lossPnlN : null,
    pfPnl: lossPnlSum < 0 ? winPnlSum / Math.abs(lossPnlSum) : null,
    grossPnl: gross,
    totalFees: fees,
    feesN,
  };
}

export type Reliability = { level: "low" | "medium" | "high"; label: string; hint: string };

export function reliability(n: number): Reliability {
  if (n < 5) return { level: "low", label: "Мало данных", hint: `Всего ${n} сд. — вывод может быть случайностью` };
  if (n < 20) return { level: "medium", label: "Предварительно", hint: `${n} сд. — тенденция есть, но нужна проверка` };
  return { level: "high", label: "Надёжно", hint: `${n} сд. — достаточная выборка` };
}

/* ───────────────────────── Streaks / equity / drawdown ───────────────────────── */

/** Chronological by close date, then entry date, creation time and id (same-day ties are stable everywhere). */
export function sortChrono(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) =>
    day(a).localeCompare(day(b)) || (a.date ?? "").localeCompare(b.date ?? "")
    || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id - b.id);
}

export function streaks(trades: Trade[]): { maxWin: number; maxLoss: number; current: number } {
  let maxWin = 0, maxLoss = 0, cur = 0;
  for (const t of sortChrono(trades)) {
    if (isOpen(t)) continue;
    if (isWin(t)) cur = cur > 0 ? cur + 1 : 1;
    else if (isLoss(t)) cur = cur < 0 ? cur - 1 : -1;
    else cur = 0;
    maxWin = Math.max(maxWin, cur);
    maxLoss = Math.min(maxLoss, cur);
  }
  return { maxWin, maxLoss: Math.abs(maxLoss), current: cur };
}

export type Unit = "r" | "usd";

/** Per-trade value in the chosen unit (signed R or net $); null when unknown / open. */
export function valueIn(t: Trade, unit: Unit): number | null {
  return unit === "r" ? realizedR(t) : pnlValue(t);
}

export type EquityPoint = { i: number; date: string; ticker: string; value: number; cum: number; dd: number; cumGross: number };

export function equitySeries(trades: Trade[], unit: Unit): EquityPoint[] {
  let cum = 0, peak = 0, cumGross = 0;
  const out: EquityPoint[] = [];
  for (const t of sortChrono(trades)) {
    const v = valueIn(t, unit);
    if (v == null) continue;
    cum += v;
    cumGross += unit === "r" ? v : grossPnl(t) ?? 0;
    peak = Math.max(peak, cum);
    out.push({ i: out.length + 1, date: day(t), ticker: t.ticker, value: v, cum: round2(cum), dd: round2(cum - peak), cumGross: round2(cumGross) });
  }
  return out;
}

export function maxDrawdown(series: EquityPoint[]): number {
  return maxDrawdownOf(series.map((p) => p.value));
}

export type HistBin = { label: string; from: number; count: number; tone: "up" | "down" };

/** Histogram of realised R in 1R bins, tails clamped at ≤−3R and ≥6R. */
export function rHistogram(trades: Trade[]): HistBin[] {
  const MIN = -3, MAX = 6;
  const bins = new Map<number, number>();
  for (let b = MIN; b <= MAX; b++) bins.set(b, 0);
  for (const t of trades) {
    const r = realizedR(t);
    if (r == null) continue;
    const b = Math.max(MIN, Math.min(MAX, Math.floor(r)));
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  return [...bins.entries()].map(([b, count]) => ({
    from: b,
    count,
    tone: b < 0 ? "down" : "up",
    label: b === MIN ? `≤${fmtSigned(MIN + 1, 0)}` : b === MAX ? `≥+${MAX}` : `${fmtSigned(b, 0)}…${fmtSigned(b + 1, 0)}`,
  }));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ───────────────────────── Dimensions (edge breakdowns) ───────────────────────── */

export type DimensionKey =
  | "horizon" | "holdDays" | "setup" | "tag" | "time" | "session" | "weekday" | "hold" | "price" | "gap" | "event" | "side" | "ticker" | "trader"
  | "grade" | "conviction" | "cap" | "float" | "account" | "source";

type Dimension = {
  key: DimensionKey;
  label: string;
  /** Group keys for a trade (multi for tags). */
  keys: (t: Trade) => string[];
  /** Natural order for ordinal dimensions; undefined = sort by sample size. */
  order?: string[];
  /** Global filter this dimension can drill into. */
  drill?: "setup" | "ticker" | "side" | "trader" | "horizon" | "account" | "source";
  emptyHint?: string;
  /** Only these trades enter the breakdown (e.g. multi-day holds). */
  scope?: (t: Trade) => boolean;
  scopeLabel?: string;
};

const SESSION_LABEL: Record<string, string> = {
  premarket: "Премаркет", pre: "Премаркет", regular: "Основная сессия", rth: "Основная сессия",
  afterhours: "Постмаркет", "after-hours": "Постмаркет", after: "Постмаркет", postmarket: "Постмаркет",
};
const EVENT_LABEL: Record<string, string> = {
  earnings: "Отчётность", news: "Новости", other: "Другое", fda: "FDA", offering: "Размещение",
  guidance: "Прогноз", macro: "Макро", ipo: "IPO",
};
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const HOLD_ORDER = ["До 5 мин", "5–15 мин", "15–60 мин", "1–4 ч", "Больше 4 ч", "Не указано"];
const PRICE_ORDER = ["До $5", "$5–20", "$20–50", "$50–100", "$100–300", "Больше $300", "Нет цены"];
const GAP_ORDER = ["Гэп вверх", "Гэп вниз", "Другой гэп", "Без гэпа"];
const HOLD_DAYS_ORDER = ["1 день", "2–3 дня", "4–7 дней", "8–20 дней", "Больше 20 дней", "Дата выхода не указана"];

function holdDaysBucket(t: Trade): string {
  const d = holdDays(t);
  if (d == null) return "Дата выхода не указана";
  if (d <= 1) return "1 день";
  if (d <= 3) return "2–3 дня";
  if (d <= 7) return "4–7 дней";
  if (d <= 20) return "8–20 дней";
  return "Больше 20 дней";
}

function holdBucket(t: Trade): string {
  const m = parseHoldMinutes(t.holdTime);
  if (m == null) return "Не указано";
  if (m < 5) return "До 5 мин";
  if (m < 15) return "5–15 мин";
  if (m < 60) return "15–60 мин";
  if (m < 240) return "1–4 ч";
  return "Больше 4 ч";
}

function priceBucket(t: Trade): string {
  const p = Number(t.entry);
  if (t.entry == null || !Number.isFinite(p) || p <= 0) return "Нет цены";
  if (p < 5) return "До $5";
  if (p < 20) return "$5–20";
  if (p < 50) return "$20–50";
  if (p < 100) return "$50–100";
  if (p < 300) return "$100–300";
  return "Больше $300";
}

function gapBucket(t: Trade): string {
  const tags = tagsOf(t).map((s) => s.toLowerCase());
  if (tags.some((s) => s.includes("gap up") || s.includes("gap and go long"))) return "Гэп вверх";
  if (tags.some((s) => s.includes("gap down") || s.includes("gap and go short"))) return "Гэп вниз";
  if (tags.some((s) => s.includes("gap"))) return "Другой гэп";
  return "Без гэпа";
}

/** "652 M", "45,43B", "632m", "28.5" (bare ⇒ millions) → dollars; null when unparsable. */
export function parseMoneyText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "").replace(",", ".").toLowerCase();
  const m = s.match(/^\$?([0-9]+(?:\.[0-9]+)?)([kmbt])?$/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : m[2] === "t" ? 1e12 : v < 1e4 ? 1e6 : 1;
  return v * mult;
}

const CAP_ORDER = ["Нано < $50M", "Микро $50–300M", "Малая $300M–2B", "Средняя $2–10B", "Крупная > $10B", "Нет капитализации"];
export function capBucket(t: Trade): string {
  const v = parseMoneyText(t.marketCap);
  if (v == null) return "Нет капитализации";
  if (v < 50e6) return "Нано < $50M";
  if (v < 300e6) return "Микро $50–300M";
  if (v < 2e9) return "Малая $300M–2B";
  if (v < 10e9) return "Средняя $2–10B";
  return "Крупная > $10B";
}
const FLOAT_ORDER = ["Флоат < 10M", "10–50M", "50–200M", "200M–1B", "Больше 1B", "Нет флоата"];
export function floatBucket(t: Trade): string {
  const v = parseMoneyText(t.float);
  if (v == null) return "Нет флоата";
  if (v < 10e6) return "Флоат < 10M";
  if (v < 50e6) return "10–50M";
  if (v < 200e6) return "50–200M";
  if (v < 1e9) return "200M–1B";
  return "Больше 1B";
}
const GRADE_ORDER = ["A+", "A", "B", "C", "Без оценки"];
const CONVICTION_ORDER = ["5 — максимум", "4", "3", "2", "1 — минимум", "Не указана"];

export const DIMENSIONS: Dimension[] = [
  { key: "horizon", label: "Горизонт", keys: (t) => [HORIZON_LABEL[horizonOf(t)]],
    order: ["Интрадей", "Овернайт", "Свинг"], drill: "horizon" },
  { key: "holdDays", label: "Дни удержания", keys: (t) => [holdDaysBucket(t)], order: HOLD_DAYS_ORDER,
    scope: (t) => horizonOf(t) !== "intraday", scopeLabel: "только овернайт и свинг",
    emptyHint: "Нет переносимых сделок (овернайт / свинг) в выбранных фильтрах." },
  { key: "setup", label: "Сетап", keys: (t) => [t.setup?.trim() || "Без сетапа"], drill: "setup",
    emptyHint: "У сделок не указан сетап — заполняйте поле «Сетап», или смотрите разрез «Теги»." },
  { key: "tag", label: "Теги", keys: (t) => { const g = tagsOf(t); return g.length ? g : ["Без тегов"]; } },
  { key: "time", label: "Время дня", keys: (t) => [TIME_BUCKETS.find((b) => b.id === timeBucketFor(t))?.label ?? "без времени"],
    order: TIME_BUCKETS.map((b) => b.label),
    emptyHint: "В сделках нет времени входа — используйте разрез «Сессия»." },
  { key: "session", label: "Сессия", keys: (t) => [SESSION_LABEL[(t.session ?? "").toLowerCase()] ?? (t.session || "Не указана")],
    order: ["Премаркет", "Основная сессия", "Постмаркет"] },
  { key: "weekday", label: "День недели", keys: (t) => { const d = dayOfWeek(t); return [d >= 0 ? WEEKDAYS[d] : "—"]; },
    order: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] },
  { key: "hold", label: "Удержание (интрадей)", keys: (t) => [holdBucket(t)], order: HOLD_ORDER,
    scope: (t) => horizonOf(t) === "intraday", scopeLabel: "только интрадей" },
  { key: "price", label: "Цена входа", keys: (t) => [priceBucket(t)], order: PRICE_ORDER },
  { key: "gap", label: "Гэп", keys: (t) => [gapBucket(t)], order: GAP_ORDER },
  { key: "event", label: "Катализатор", keys: (t) => [EVENT_LABEL[(t.eventType ?? "").toLowerCase()] ?? (t.eventType || "Не указан")] },
  { key: "side", label: "Направление", keys: (t) => [sideOf(t) === "long" ? "Лонг" : sideOf(t) === "short" ? "Шорт" : "Не указано"],
    order: ["Лонг", "Шорт", "Не указано"], drill: "side" },
  { key: "grade", label: "Оценка сетапа", keys: (t) => [t.confidenceGrade?.trim() || "Без оценки"], order: GRADE_ORDER,
    emptyHint: "Ставьте оценку A+/A/B/C в карточке сделки — появится разрез по качеству сетапа." },
  { key: "conviction", label: "Уверенность", order: CONVICTION_ORDER,
    keys: (t) => [t.conviction == null ? "Не указана" : t.conviction >= 5 ? "5 — максимум" : t.conviction <= 1 ? "1 — минимум" : String(t.conviction)] },
  { key: "cap", label: "Капитализация", keys: (t) => [capBucket(t)], order: CAP_ORDER },
  { key: "float", label: "Флоат", keys: (t) => [floatBucket(t)], order: FLOAT_ORDER },
  { key: "ticker", label: "Тикер", keys: (t) => [(t.ticker ?? "—").toUpperCase()], drill: "ticker" },
  { key: "trader", label: "Трейдер", keys: (t) => [t.trader || "Не указан"], drill: "trader" },
  { key: "account", label: "Счёт", keys: (t) => [accountOf(t) || "Без счёта"], drill: "account",
    emptyHint: "Счёт появляется у сделок, загруженных от брокера." },
  { key: "source", label: "Источник", keys: (t) => [sourceOf(t) === "propreports" ? "PropReports" : "Вручную"], order: ["PropReports", "Вручную"], drill: "source" },
];

export type GroupRow = Stats & { key: string; share: number };

export function scopedTrades(trades: Trade[], dimKey: DimensionKey): Trade[] {
  const dim = DIMENSIONS.find((d) => d.key === dimKey)!;
  return dim.scope ? trades.filter(dim.scope) : trades;
}

export function breakdown(allTrades: Trade[], dimKey: DimensionKey): GroupRow[] {
  const dim = DIMENSIONS.find((d) => d.key === dimKey)!;
  const trades = scopedTrades(allTrades, dimKey);
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    for (const k of dim.keys(t)) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(t);
    }
  }
  const rows = [...groups.entries()].map(([key, g]) => ({ key, share: trades.length ? g.length / trades.length : 0, ...computeStats(g) }));
  if (dim.order) rows.sort((a, b) => idx(dim.order!, a.key) - idx(dim.order!, b.key));
  else rows.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return rows;
}

function idx(order: string[], k: string) {
  const i = order.indexOf(k);
  return i < 0 ? order.length : i;
}

/** The single key a drillable row maps to in the global filter. */
export function drillValue(dimKey: DimensionKey, rowKey: string): string | null {
  switch (dimKey) {
    case "setup": return rowKey === "Без сетапа" ? "__none__" : rowKey;
    case "ticker": return rowKey === "—" ? null : rowKey;
    case "trader": return rowKey === "Не указан" ? null : rowKey;
    case "side": return rowKey === "Лонг" ? "long" : rowKey === "Шорт" ? "short" : null;
    case "horizon": return (Object.keys(HORIZON_LABEL) as Horizon[]).find((h) => HORIZON_LABEL[h] === rowKey) ?? null;
    case "account": return rowKey === "Без счёта" ? null : rowKey;
    case "source": return rowKey === "PropReports" ? "propreports" : rowKey === "Вручную" ? "manual" : null;
    default: return null;
  }
}

/** Strongest and weakest groups across all dimensions (n ≥ minN), by avg R or win rate. */
export function edgeLeaders(trades: Trade[], useR: boolean, minN = 3) {
  const all: { dim: string; key: string; n: number; score: number; stats: Stats }[] = [];
  for (const d of DIMENSIONS) {
    if (d.key === "trader" || d.key === "ticker") continue;
    const scoped = scopedTrades(trades, d.key);
    for (const row of breakdown(trades, d.key)) {
      if (row.n < minN || row.n === scoped.length) continue;
      if (/^(Без|Не указан|Нет |без времени|Вручную)/.test(row.key)) continue;
      const score = useR ? row.avgR : row.winRate;
      if (score == null) continue;
      all.push({ dim: d.label, key: row.key, n: row.n, score, stats: row });
    }
  }
  const best = [...all].sort((a, b) => b.score - a.score || b.n - a.n).slice(0, 3);
  const worst = [...all].sort((a, b) => a.score - b.score || b.n - a.n).filter((w) => !best.includes(w)).slice(0, 3);
  return { best, worst };
}

/* ───────────────────────── Formatting ───────────────────────── */

export function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function fmtSigned(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function fmtR(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : `${fmtSigned(v, digits)}R`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${abs}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function fmtPf(v: number | null | undefined): string {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(2);
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const sdeal = (n: number) => `${n.toLocaleString("ru-RU")} ${pluralRu(n, "сделка", "сделки", "сделок")}`;
/** Dative, after «по»: «по 1 сделке», «по 5 сделкам». */
export const sdealDat = (n: number) => `${n.toLocaleString("ru-RU")} ${pluralRu(n, "сделке", "сделкам", "сделкам")}`;

/* ───────────────────────── CSV ───────────────────────── */

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───────────────────────── Chart styling ───────────────────────── */

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};
export const CHART_CURSOR = { fill: "hsl(var(--muted-foreground) / 0.08)" };
export const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;
export const GRID = "hsl(var(--border))";
