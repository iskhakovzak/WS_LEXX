/**
 * «Статистика офиса» — office-wide performance maths. Pure (no DB, no Express); the route (routes/officeStats.ts)
 * loads trades, classifies them and asks this module for a role-shaped view.
 *
 * ─── Strategy classification (classifyStrategy) ─────────────────────────────────────────────────────────────
 * One derivation for the whole site: lib/tradeStrategy deriveTradeStrategy (also stored as trades.strategy, migration
 * 0237 / 0243). The office keeps its seven classes: «Print» (a pre-market position closed by the opening print) counts
 * as OPG — the pre-market class, «Swing» (2+ trading days) as Overnight — the multi-day class, and a broker «Adjust» as
 * Day. MOC = a regular-session entry with a fill in the IMX window (desk setting, default 15:50–16:00 NY); a pre-market
 * entry closed in the close auction is OPGtoDAY. See lib/tradeStrategy for the rules.
 *
 * ─── Units ──────────────────────────────────────────────────────────────────────────────────────────────────
 * Every aggregate is computed in one unit: "usd" (net P&L after fees) or "pct" (net ÷ that year's office capital
 * × 100, entered by the partners). A trade's value is converted first (toValued), so the same code builds both
 * views and a period that spans two years uses each year's own capital. Trades of a year without capital are
 * left out of the pct view (that year is flagged `capitalMissing`).
 *
 * ─── Privacy ────────────────────────────────────────────────────────────────────────────────────────────────
 * Members (trader / curator) get toMemberView(pct view): % and shares only — no $ anywhere, no absolute volume
 * (share counts hint at position size), no per-trader rows. Admins (partners) get both views plus traders.
 */

import { insightsT } from "../i18n/ns";
import { localeTagFor, type Lang } from "../i18n";
import {
  AFTER_CLOSE_EXIT_SEC, OPTION_SYMBOL_RE, PRINT_CLUSTER_UNTIL_SEC, PRINT_REPORT_LAG_SEC, RTH_CLOSE_SEC, RTH_OPEN_SEC,
  deriveTradeStrategy, isOptionSymbol, nyParts, type StrategyInput, type TradeStrategy,
} from "./tradeStrategy";
import { currentImxWindow } from "./imx";

// ─── Strategies ─────────────────────────────────────────────────────────────────────────────────────────────

export const STRATEGIES = ["OPG", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "OPT"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Strategy rule text in `lang` (insights namespace `rule.*`). */
export function strategyRule(key: TradeStrategy, lang: Lang = "ru"): string {
  return insightsT.tFor(lang)(`rule.${key}`);
}
/** RU rules (kept for older imports). */
export const STRATEGY_RULES_RU = Object.fromEntries(STRATEGIES.map((k) => [k, strategyRule(k)])) as Record<Strategy, string>;

const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

// Time / symbol rules live in lib/tradeStrategy (one derivation for the whole site); re-exported for older imports.
export { RTH_OPEN_SEC, RTH_CLOSE_SEC, AFTER_CLOSE_EXIT_SEC, PRINT_REPORT_LAG_SEC, PRINT_CLUSTER_UNTIL_SEC, OPTION_SYMBOL_RE, isOptionSymbol, nyParts };
/** Default IMX window start (the desk setting trades.imxWindowStart moves it) — the «Как считается» popover. */
export const MOC_IMBALANCE_FROM_SEC = hms(15, 50);
/** Closing-cross print plus the report lag (the end minute of the IMX window is inclusive). */
export const CLOSE_CROSS_FROM_SEC = hms(16, 0);
export const CLOSE_CROSS_TO_SEC = hms(16, 1);

/** lib/tradeStrategy input (kept under its old name). */
export type ClassifyInput = StrategyInput;

/** The office class of a site-wide strategy: Print → OPG, Swing → Overnight, Adjust → Day (see the header). */
export function officeClassOf(s: TradeStrategy): Strategy {
  return s === "Print" ? "OPG" : s === "Swing" ? "Overnight" : s === "Adjust" ? "Day" : s;
}

/**
 * The office's seven classes from the site-wide derivation (lib/tradeStrategy deriveTradeStrategy, current IMX window,
 * `closed` = full-day market holidays). The desk Print cluster needs the other traders' trades: the route passes
 * `isOpenPrintCluster` from the stored strategy (trades.strategy = 'Print').
 */
export function classifyStrategy(t: ClassifyInput, closed?: ReadonlySet<string>): Strategy {
  return officeClassOf(deriveTradeStrategy(t, currentImxWindow(), closed));
}

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Result = "win" | "loss" | "be";
export type Unit = "usd" | "pct";

/** One closed trade, already classified (built by the route). */
export interface OfficeTrade {
  id: number;
  trader: string;
  ticker: string;
  /** Close date (exit_date ?? date), YYYY-MM-DD — the day the result is realised. */
  day: string;
  /** Net P&L after fees, $. */
  net: number | null;
  result: Result | null;
  r: number | null;
  /** Shares / contracts traded (sum of fill qty). */
  volume: number;
  strategy: Strategy;
  /** Seconds since NY midnight of the first entry fill; null when unknown. */
  entrySec: number | null;
  session: string | null;
}

export interface YearSetting {
  year: number;
  /** Office capital for the year, $ (null = not set). */
  capital: number | null;
  /** Yearly goal, % of capital. */
  goalPct: number;
}

export const DEFAULT_GOAL_PCT = 40;

/** A trade with its value in the chosen unit. */
interface Valued extends OfficeTrade { v: number }

const yearOf = (day: string) => Number(day.slice(0, 4));
const round = (v: number, d = 6) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function toValued(trades: OfficeTrade[], unit: Unit, settings: Map<number, YearSetting>): Valued[] {
  const out: Valued[] = [];
  for (const t of trades) {
    if (t.net == null || !Number.isFinite(t.net)) continue;
    if (unit === "usd") { out.push({ ...t, v: t.net }); continue; }
    const cap = settings.get(yearOf(t.day))?.capital;
    if (!cap || !(cap > 0)) continue;
    out.push({ ...t, v: (t.net / cap) * 100 });
  }
  return out;
}

// ─── Small maths ────────────────────────────────────────────────────────────────────────────────────────────

/** Day of year, 1-based (Jan 1 = 1). */
export function dayOfYear(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** Same calendar date one year earlier (Feb 29 → Feb 28). */
export function shiftYear(day: string, by: number): string {
  const y = yearOf(day) + by;
  let md = day.slice(5, 10);
  if (md === "02-29" && daysInYear(y) === 365) md = "02-28";
  return `${y}-${md}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function profitFactor(grossWin: number, grossLoss: number): number | null {
  if (grossLoss < 0) return round(grossWin / -grossLoss, 4);
  return null;
}

export interface DrawdownInfo {
  /** Deepest close-to-peak fall (≤ 0, in the unit). */
  max: number;
  peakDate: string | null;
  troughDate: string | null;
  /** First day the curve made a new high after the trough; null = not recovered yet. */
  recoveredDate: string | null;
  /** Trading days from the trough to the recovery (null while not recovered). */
  recoveryDays: number | null;
  /** Trading days from the peak to the recovery (or to the last day while under water). */
  lengthDays: number | null;
  /** Current distance from the high-water mark (≤ 0). */
  current: number;
  /** Trading days spent under water right now. */
  currentDays: number;
}

/** Drawdown of a cumulative curve that starts at 0 (one point per trading day). */
export function drawdownOf(points: { date: string; cum: number }[]): DrawdownInfo {
  let peak = 0, peakIdx = -1, max = 0;
  let maxPeakIdx = -1, troughIdx = -1;
  let curUnder = 0;
  for (let i = 0; i < points.length; i++) {
    const c = points[i].cum;
    if (c >= peak - 1e-9) { peak = Math.max(peak, c); peakIdx = i; curUnder = 0; continue; }
    curUnder++;
    const dd = c - peak;
    if (dd < max) { max = dd; troughIdx = i; maxPeakIdx = peakIdx; }
  }
  let recoveredIdx = -1;
  if (troughIdx >= 0) {
    const level = maxPeakIdx >= 0 ? points[maxPeakIdx].cum : 0;
    for (let i = troughIdx + 1; i < points.length; i++) if (points[i].cum >= level - 1e-9) { recoveredIdx = i; break; }
  }
  const last = points.length ? points[points.length - 1].cum : 0;
  return {
    max: round(max),
    peakDate: troughIdx >= 0 && maxPeakIdx >= 0 ? points[maxPeakIdx].date : null,
    troughDate: troughIdx >= 0 ? points[troughIdx].date : null,
    recoveredDate: recoveredIdx >= 0 ? points[recoveredIdx].date : null,
    recoveryDays: recoveredIdx >= 0 ? recoveredIdx - troughIdx : null,
    lengthDays: troughIdx >= 0 ? (recoveredIdx >= 0 ? recoveredIdx : points.length - 1) - maxPeakIdx : null,
    current: round(Math.min(0, last - peak)),
    currentDays: curUnder,
  };
}

export interface Streaks { maxGreen: number; maxRed: number; /** >0 green days in a row now, <0 red. */ current: number }

export function streaksOf(values: number[]): Streaks {
  let maxGreen = 0, maxRed = 0, run = 0;
  for (const v of values) {
    if (v > 0) run = run > 0 ? run + 1 : 1;
    else if (v < 0) run = run < 0 ? run - 1 : -1;
    else run = 0;
    if (run > maxGreen) maxGreen = run;
    if (-run > maxRed) maxRed = -run;
  }
  return { maxGreen, maxRed, current: run };
}

// ─── Aggregates ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DayValue { date: string; v: number }

export interface Totals {
  net: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  /** Mean signed R over the trades that have one (stop / risk known) — see rTrades. */
  avgR: number | null;
  /** Trades behind avgR: R exists only where a stop / risk is known, so avgR and net can differ in sign. */
  rTrades: number;
  /** Shares traded (stripped for members). */
  volume?: number;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  avgDay: number | null;
  bestDay: DayValue | null;
  worstDay: DayValue | null;
}

export interface StrategyRow {
  key: Strategy;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  net: number;
  profitFactor: number | null;
  avgR: number | null;
  /** Trades behind avgR (OWNER-13: a losing strategy showed +0.02R from the few trades that have an R). */
  rTrades: number;
  /** net ÷ |office net| (signed; null when the office is flat). */
  netShare: number | null;
  /** Share of office volume, 0…1. */
  volumeShare: number | null;
  volume?: number;
}

export interface YearStrategyRow extends StrategyRow {
  /** Cumulative net, aligned with YearView.days. */
  cum: number[];
  /** Net per month (index 0 = January); null = no trades that month. */
  monthly: (number | null)[];
}

export interface DayPoint {
  date: string;
  doy: number;
  v: number;
  cum: number;
  trades: number;
  /** Net per strategy that day (only strategies that traded). */
  s: Partial<Record<Strategy, number>>;
}

export interface MonthRow { month: number; v: number | null; trades: number; days: number; green: number; red: number }

export interface Pace {
  goal: number;
  /** Where the curve should be today on a straight line to the goal. */
  expected: number;
  actual: number;
  /** actual − expected. */
  gap: number;
  /** Still needed per month to reach the goal by Dec 31 (0 when reached). */
  needPerMonth: number;
  monthsLeft: number;
  /** Year-end projection at the current run rate. */
  projected: number | null;
  /** Fraction of the calendar year elapsed (1 for past years). */
  elapsed: number;
  status: "done" | "ahead" | "behind";
}

export interface YearView {
  year: number;
  goalPct: number;
  /** Goal in the view's unit (null for usd without capital). */
  goal: number | null;
  /** pct view only: the partners have not entered the capital for this year. */
  capitalMissing: boolean;
  hasData: boolean;
  totals: Totals;
  days: DayPoint[];
  strategies: YearStrategyRow[];
  months: MonthRow[];
  drawdown: DrawdownInfo;
  streaks: Streaks;
  pace: Pace | null;
}

export interface TimeBucket { key: string; label: string; fromSec: number | null; v: number; trades: number; wins: number; losses: number; winRate: number | null }
export interface WeekdayRow { weekday: number; label: string; v: number; days: number; green: number; avg: number | null }
export interface TickerRow { ticker: string; trades: number; v: number; winRate: number | null; /** v ÷ office gross profit (top) or gross loss (bottom). */ share: number | null; strategy: Strategy }

export interface TraderRow {
  trader: string;
  trades: number;
  net: number;
  /** net ÷ office net (when the office is up). */
  share: number | null;
  winRate: number | null;
  profitFactor: number | null;
  volume: number;
  volumeShare: number | null;
  activeDays: number;
  greenDays: number;
  /** greenDays ÷ activeDays. */
  consistency: number | null;
  bestDay: DayValue | null;
  worstDay: DayValue | null;
  maxDrawdown: number;
  topStrategy: Strategy | null;
  /** Cumulative net on every office trading day of the period. */
  spark: number[];
}

export interface PeriodView {
  from: string;
  to: string;
  totals: Totals;
  strategies: StrategyRow[];
  timeOfDay: TimeBucket[];
  weekday: WeekdayRow[];
  tickers: { top: TickerRow[]; bottom: TickerRow[] };
  traders?: TraderRow[];
}

export interface PrevPeriod { from: string; to: string; totals: Totals; strategies: { key: Strategy; net: number }[] }

export interface Insight { key: string; tone: "up" | "down" | "warn" | "neutral"; text: string }

export interface OfficeView {
  unit: Unit;
  years: YearView[];
  period: PeriodView;
  prev: PrevPeriod | null;
  insights: Insight[];
}

function totalsOf(trades: Valued[], days: DayValue[], withVolume = true): Totals {
  let net = 0, wins = 0, losses = 0, gw = 0, gl = 0, rSum = 0, rN = 0, volume = 0;
  for (const t of trades) {
    net += t.v;
    if (t.result === "win") wins++;
    else if (t.result === "loss") losses++;
    if (t.v > 0) gw += t.v; else gl += t.v;
    if (t.r != null && Number.isFinite(t.r)) { rSum += t.r; rN++; }
    volume += t.volume || 0;
  }
  let green = 0, red = 0;
  let best: DayValue | null = null, worst: DayValue | null = null;
  for (const d of days) {
    if (d.v > 0) green++; else if (d.v < 0) red++;
    if (!best || d.v > best.v) best = d;
    if (!worst || d.v < worst.v) worst = d;
  }
  const out: Totals = {
    net: round(net),
    trades: trades.length,
    wins, losses,
    winRate: wins + losses ? round(wins / (wins + losses), 4) : null,
    profitFactor: profitFactor(gw, gl),
    avgR: rN ? round(rSum / rN, 3) : null,
    rTrades: rN,
    tradingDays: days.length,
    greenDays: green,
    redDays: red,
    avgDay: days.length ? round(net / days.length) : null,
    bestDay: best && best.v > 0 ? { date: best.date, v: round(best.v) } : null,
    worstDay: worst && worst.v < 0 ? { date: worst.date, v: round(worst.v) } : null,
  };
  if (withVolume) out.volume = round(volume, 2);
  return out;
}

function dailyValues(trades: Valued[]): DayValue[] {
  const m = new Map<string, number>();
  for (const t of trades) m.set(t.day, (m.get(t.day) ?? 0) + t.v);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, v: round(v) }));
}

function strategyRows(trades: Valued[], officeNet: number): StrategyRow[] {
  const totalVol = trades.reduce((a, t) => a + (t.volume || 0), 0);
  return STRATEGIES.map((key) => {
    const ts = trades.filter((t) => t.strategy === key);
    const tot = totalsOf(ts, [], true);
    return {
      key,
      trades: tot.trades,
      wins: tot.wins,
      losses: tot.losses,
      winRate: tot.winRate,
      net: tot.net,
      profitFactor: tot.profitFactor,
      avgR: tot.avgR,
      rTrades: tot.rTrades,
      netShare: Math.abs(officeNet) > 1e-9 ? round(tot.net / Math.abs(officeNet), 4) : null,
      volumeShare: totalVol > 0 ? round((tot.volume ?? 0) / totalVol, 4) : null,
      volume: tot.volume,
    };
  });
}

function paceOf(goal: number | null, actual: number, year: number, today: string): Pace | null {
  if (goal == null || !(goal > 0)) return null;
  const ty = yearOf(today);
  if (year > ty) return null;
  const diy = daysInYear(year);
  const elapsed = year < ty ? 1 : Math.min(1, dayOfYear(today) / diy);
  const expected = goal * elapsed;
  const monthsLeft = round(12 * (1 - elapsed), 2);
  const remaining = goal - actual;
  return {
    goal: round(goal),
    expected: round(expected),
    actual: round(actual),
    gap: round(actual - expected),
    needPerMonth: remaining > 0 && monthsLeft > 0 ? round(remaining / monthsLeft) : 0,
    monthsLeft,
    projected: elapsed > 0.02 ? round(actual / elapsed) : null,
    elapsed: round(elapsed, 4),
    status: actual >= goal ? "done" : actual >= expected ? "ahead" : "behind",
  };
}

export function buildYear(valued: Valued[], setting: YearSetting, unit: Unit, today: string): YearView {
  const year = setting.year;
  const trades = valued.filter((t) => yearOf(t.day) === year);
  const dv = dailyValues(trades);
  const idx = new Map(dv.map((d, i) => [d.date, i]));
  const days: DayPoint[] = [];
  let cum = 0;
  for (const d of dv) { cum += d.v; days.push({ date: d.date, doy: dayOfYear(d.date), v: d.v, cum: round(cum), trades: 0, s: {} }); }
  for (const t of trades) {
    const p = days[idx.get(t.day)!];
    p.trades++;
    p.s[t.strategy] = round((p.s[t.strategy] ?? 0) + t.v);
  }
  const totals = totalsOf(trades, dv);
  const rows = strategyRows(trades, totals.net);
  const strategies: YearStrategyRow[] = rows.map((r) => {
    const c: number[] = [];
    let run = 0;
    for (const d of days) { run += d.s[r.key] ?? 0; c.push(round(run)); }
    const monthly: (number | null)[] = Array.from({ length: 12 }, () => null);
    for (const t of trades) if (t.strategy === r.key) { const m = Number(t.day.slice(5, 7)) - 1; monthly[m] = round((monthly[m] ?? 0) + t.v); }
    return { ...r, cum: c, monthly };
  });
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, v: null, trades: 0, days: 0, green: 0, red: 0 }));
  for (const d of days) {
    const m = months[Number(d.date.slice(5, 7)) - 1];
    m.v = round((m.v ?? 0) + d.v); m.trades += d.trades; m.days++;
    if (d.v > 0) m.green++; else if (d.v < 0) m.red++;
  }
  const goal = unit === "pct" ? setting.goalPct : setting.capital ? (setting.capital * setting.goalPct) / 100 : null;
  const capitalMissing = unit === "pct" && !(setting.capital && setting.capital > 0);
  return {
    year,
    goalPct: setting.goalPct,
    goal: capitalMissing ? null : goal,
    capitalMissing,
    hasData: trades.length > 0,
    totals,
    days,
    strategies,
    months,
    drawdown: drawdownOf(days),
    streaks: streaksOf(days.map((d) => d.v)),
    pace: capitalMissing ? null : paceOf(goal, totals.net, year, today),
  };
}

/** Short weekday names Mon..Sun in `lang` (Intl). */
function weekdayLabels(lang: Lang): string[] {
  const f = new Intl.DateTimeFormat(localeTagFor(lang), { weekday: "short", timeZone: "UTC" });
  // 2026-10-12 is a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const s = f.format(new Date(Date.UTC(2026, 9, 12 + i, 12)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}
/** Entry-time buckets: pre-market, 30-minute slots of the regular session, post-market. */
export const TIME_BUCKETS: { key: string; label: string; fromSec: number | null }[] = (() => {
  const out: { key: string; label: string; fromSec: number | null }[] = [{ key: "pre", label: insightsT.tFor("ru")("bucket.pre"), fromSec: null }];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let s = RTH_OPEN_SEC; s < RTH_CLOSE_SEC; s += 1800) {
    const a = `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}`;
    const e = s + 1800;
    const b = `${Math.floor(e / 3600)}:${pad((e % 3600) / 60)}`;
    out.push({ key: `t${s}`, label: `${a}–${b}`, fromSec: s });
  }
  out.push({ key: "post", label: insightsT.tFor("ru")("bucket.post"), fromSec: null });
  return out;
})();

export function timeBucketKey(entrySec: number | null, session: string | null): string | null {
  if (entrySec == null) {
    const s = (session ?? "").toLowerCase();
    return s === "premarket" ? "pre" : s === "postmarket" ? "post" : null;
  }
  if (entrySec < RTH_OPEN_SEC) return "pre";
  if (entrySec >= RTH_CLOSE_SEC) return "post";
  return `t${RTH_OPEN_SEC + Math.floor((entrySec - RTH_OPEN_SEC) / 1800) * 1800}`;
}

function tickerRows(trades: Valued[]): { top: TickerRow[]; bottom: TickerRow[] } {
  const m = new Map<string, Valued[]>();
  for (const t of trades) { const k = t.ticker.toUpperCase(); const a = m.get(k); if (a) a.push(t); else m.set(k, [t]); }
  let gw = 0, gl = 0;
  const rows = [...m.entries()].map(([ticker, ts]) => {
    const tot = totalsOf(ts, [], false);
    const cnt = new Map<Strategy, number>();
    for (const t of ts) cnt.set(t.strategy, (cnt.get(t.strategy) ?? 0) + 1);
    const strategy = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (tot.net > 0) gw += tot.net; else gl += tot.net;
    return { ticker, trades: tot.trades, v: tot.net, winRate: tot.winRate, share: null as number | null, strategy };
  });
  const top = rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 8).map((r) => ({ ...r, share: gw > 0 ? round(r.v / gw, 4) : null }));
  const bottom = rows.filter((r) => r.v < 0).sort((a, b) => a.v - b.v).slice(0, 5).map((r) => ({ ...r, share: gl < 0 ? round(r.v / gl, 4) : null }));
  return { top, bottom };
}

function traderRows(trades: Valued[], officeDays: string[], officeNet: number): TraderRow[] {
  const m = new Map<string, Valued[]>();
  for (const t of trades) { const a = m.get(t.trader); if (a) a.push(t); else m.set(t.trader, [t]); }
  const totalVol = trades.reduce((a, t) => a + (t.volume || 0), 0);
  return [...m.entries()].map(([trader, ts]) => {
    const dv = dailyValues(ts);
    const tot = totalsOf(ts, dv);
    const byDay = new Map(dv.map((d) => [d.date, d.v]));
    const spark: number[] = [];
    let run = 0;
    const curve: { date: string; cum: number }[] = [];
    for (const d of officeDays) { run += byDay.get(d) ?? 0; spark.push(round(run)); }
    let run2 = 0;
    for (const d of dv) { run2 += d.v; curve.push({ date: d.date, cum: run2 }); }
    const cnt = new Map<Strategy, number>();
    for (const t of ts) cnt.set(t.strategy, (cnt.get(t.strategy) ?? 0) + t.v);
    const topS = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      trader,
      trades: tot.trades,
      net: tot.net,
      share: officeNet > 1e-9 ? round(tot.net / officeNet, 4) : null,
      winRate: tot.winRate,
      profitFactor: tot.profitFactor,
      volume: tot.volume ?? 0,
      volumeShare: totalVol > 0 ? round((tot.volume ?? 0) / totalVol, 4) : null,
      activeDays: dv.length,
      greenDays: tot.greenDays,
      consistency: dv.length ? round(tot.greenDays / dv.length, 4) : null,
      bestDay: tot.bestDay,
      worstDay: tot.worstDay,
      maxDrawdown: drawdownOf(curve).max,
      topStrategy: topS && topS[1] > 0 ? topS[0] : null,
      spark,
    };
  }).sort((a, b) => b.net - a.net || b.trades - a.trades);
}

export function buildPeriod(valued: Valued[], from: string, to: string, opts: { traders: boolean; lang?: Lang }): PeriodView {
  const lang: Lang = opts.lang ?? "ru";
  const bucketLabel = (b: { key: string; label: string }) => (b.key === "pre" || b.key === "post" ? insightsT.tFor(lang)(`bucket.${b.key}`) : b.label);
  const trades = valued.filter((t) => t.day >= from && t.day <= to);
  const dv = dailyValues(trades);
  const totals = totalsOf(trades, dv);
  const timeOfDay: TimeBucket[] = TIME_BUCKETS.map((b) => ({ ...b, label: bucketLabel(b), v: 0, trades: 0, wins: 0, losses: 0, winRate: null }));
  const tIdx = new Map(timeOfDay.map((b, i) => [b.key, i]));
  for (const t of trades) {
    const k = timeBucketKey(t.entrySec, t.session);
    if (k == null) continue;
    const b = timeOfDay[tIdx.get(k)!];
    b.v += t.v; b.trades++;
    if (t.result === "win") b.wins++; else if (t.result === "loss") b.losses++;
  }
  for (const b of timeOfDay) { b.v = round(b.v); b.winRate = b.wins + b.losses ? round(b.wins / (b.wins + b.losses), 4) : null; }
  const weekday: WeekdayRow[] = weekdayLabels(lang).slice(0, 5).map((label, i) => ({ weekday: i, label, v: 0, days: 0, green: 0, avg: null }));
  for (const d of dv) {
    const w = weekday[weekdayOf(d.date)];
    if (!w) continue;
    w.v += d.v; w.days++; if (d.v > 0) w.green++;
  }
  for (const w of weekday) { w.v = round(w.v); w.avg = w.days ? round(w.v / w.days) : null; }
  const out: PeriodView = {
    from, to, totals,
    strategies: strategyRows(trades, totals.net),
    timeOfDay: timeOfDay.filter((b) => b.trades > 0 || (b.fromSec != null)),
    weekday,
    tickers: tickerRows(trades),
  };
  if (opts.traders) out.traders = traderRows(trades, dv.map((d) => d.date), totals.net);
  return out;
}

export function buildPrev(valued: Valued[], from: string, to: string): PrevPeriod | null {
  const trades = valued.filter((t) => t.day >= from && t.day <= to);
  if (!trades.length) return null;
  const totals = totalsOf(trades, dailyValues(trades));
  return { from, to, totals, strategies: strategyRows(trades, totals.net).map((s) => ({ key: s.key, net: s.net })) };
}

// ─── Insights (deterministic, in the reader's language — never an AI call) ──────────────────────────────────

/** Stand-alone month name (1–12) in `lang` as written inside a sentence: «апрель» / «aprel», but «April» in English. */
export function monthName(month: number, lang: Lang): string {
  const s = new Intl.DateTimeFormat(localeTagFor(lang), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 15)));
  return lang === "en" ? s.charAt(0).toUpperCase() + s.slice(1) : s.toLowerCase();
}

export function fmtUnit(v: number, unit: Unit, signed = true): string {
  const sign = v > 0 ? (signed ? "+" : "") : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (unit === "pct") return `${sign}${a.toFixed(a >= 10 ? 1 : 2)}%`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

export function buildInsights(view: Omit<OfficeView, "insights">, today: string, lang: Lang = "ru"): Insight[] {
  const t = insightsT.tFor(lang);
  const out: Insight[] = [];
  const unit = view.unit;
  const p = view.period;
  const year = [...view.years].reverse().find((y) => y.hasData) ?? null;

  // 1. Efficiency: a strategy that brings a much bigger share of the result than of the volume.
  const eff = p.strategies
    .filter((s) => s.net > 0 && p.totals.net > 0 && s.netShare != null && s.netShare >= 0.15 && s.volumeShare != null && s.volumeShare > 0)
    .map((s) => ({ s, k: s.netShare! / s.volumeShare! }))
    .sort((a, b) => b.k - a.k)[0];
  if (eff && eff.k >= 1.5) {
    out.push({ key: `eff-${eff.s.key}`, tone: "up", text: t("insight.eff", { strategy: eff.s.key, net: pctOf(eff.s.netShare!), volume: pctOf(eff.s.volumeShare!) }) });
  }
  // 2. A strategy that eats volume and loses.
  const drag = p.strategies.filter((s) => s.net < 0 && (s.volumeShare ?? 0) >= 0.1).sort((a, b) => a.net - b.net)[0];
  if (drag) out.push({ key: `drag-${drag.key}`, tone: "down", text: t("insight.drag", { strategy: drag.key, value: fmtUnit(drag.net, unit), volume: pctOf(drag.volumeShare!) }) });

  // 3. Negative months in a row per strategy (latest year).
  if (year) {
    const lastMonth = year.months.reduce((m, r) => (r.trades > 0 ? r.month : m), 0);
    for (const s of year.strategies) {
      let n = 0;
      for (let m = lastMonth - 1; m >= 0; m--) { const v = s.monthly[m]; if (v != null && v < 0) n++; else break; }
      if (n >= 2) out.push({ key: `neg-${s.key}`, tone: "warn", text: t("insight.negMonths", { strategy: s.key, count: n }) });
    }
  }
  // 4. Goal pace.
  if (year?.pace && year.goal != null) {
    const pc = year.pace;
    const goalTxt = unit === "pct" ? `+${year.goalPct}%` : fmtUnit(year.goal, unit);
    if (pc.status === "done") out.push({ key: "pace", tone: "up", text: t("insight.goalDone", { year: year.year, goal: goalTxt, value: fmtUnit(pc.actual, unit) }) });
    else if (pc.status === "ahead") out.push({ key: "pace", tone: "up", text: t("insight.goalAhead", { goal: goalTxt, value: fmtUnit(Math.abs(pc.gap), unit, false) }) });
    else out.push({ key: "pace", tone: "warn", text: t("insight.goalBehind", { goal: goalTxt, need: fmtUnit(pc.needPerMonth, unit), gap: fmtUnit(Math.abs(pc.gap), unit, false) }) });
  }
  // 5. Current streak.
  if (year && year.year === yearOf(today) && Math.abs(year.streaks.current) >= 3) {
    const n = Math.abs(year.streaks.current);
    out.push(year.streaks.current > 0
      ? { key: "streak", tone: "up", text: t("insight.greenStreak", { count: n }) }
      : { key: "streak", tone: "down", text: t("insight.redStreak", { count: n }) });
  }
  // 6. Drawdown now.
  if (year && year.drawdown.current < 0 && year.drawdown.currentDays >= 3) {
    const d = year.drawdown;
    out.push({ key: "dd", tone: "warn", text: t("insight.drawdown", { value: fmtUnit(-d.current, unit, false), count: d.currentDays }) });
  }
  // 7. Best time of day.
  const pos = p.timeOfDay.filter((b) => b.v > 0);
  const posSum = pos.reduce((a, b) => a + b.v, 0);
  const bestT = [...pos].sort((a, b) => b.v - a.v)[0];
  if (bestT && posSum > 0 && bestT.v / posSum >= 0.25) out.push({ key: "time", tone: "neutral", text: t("insight.bestTime", { bucket: bestT.label, share: pctOf(bestT.v / posSum) }) });
  // 8. Ticker concentration.
  const tt = p.tickers.top[0];
  if (tt && tt.share != null && tt.share >= 0.2) out.push({ key: "ticker", tone: "neutral", text: t("insight.ticker", { ticker: tt.ticker, share: pctOf(tt.share) }) });
  // 9. YoY to the same day.
  if (year && view.years.length > 1) {
    const prevY = view.years.find((y) => y.year === year.year - 1 && y.hasData);
    const last = year.days[year.days.length - 1];
    if (prevY && last) {
      const ref = [...prevY.days].reverse().find((d) => d.doy <= last.doy);
      const was = ref ? ref.cum : 0;
      out.push({
        key: "yoy", tone: last.cum >= was ? "up" : "down",
        text: t("insight.yoy", { prevYear: prevY.year, was: fmtUnit(was, unit), year: year.year, now: fmtUnit(last.cum, unit) }),
      });
    }
  }
  // 10. Best month.
  if (year) {
    const best = [...year.months].filter((m) => m.v != null && m.v > 0).sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0];
    if (best) out.push({ key: "month", tone: "up", text: t("insight.bestMonth", { year: year.year, month: monthName(best.month, lang), value: fmtUnit(best.v!, unit) }) });
  }
  return out.slice(0, 8);
}

// ─── Views ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ViewOptions {
  years: number[];
  settings: Map<number, YearSetting>;
  unit: Unit;
  from: string;
  to: string;
  today: string;
  traders: boolean;
  /** Language of labels and insights (default RU). */
  lang?: Lang;
}

export function settingFor(settings: Map<number, YearSetting>, year: number): YearSetting {
  return settings.get(year) ?? { year, capital: null, goalPct: DEFAULT_GOAL_PCT };
}

export function buildOfficeView(trades: OfficeTrade[], o: ViewOptions): OfficeView {
  const valued = toValued(trades, o.unit, o.settings);
  const years = [...o.years].sort((a, b) => a - b).map((y) => buildYear(valued, settingFor(o.settings, y), o.unit, o.today));
  const period = buildPeriod(valued, o.from, o.to, { traders: o.traders, lang: o.lang });
  const prev = buildPrev(valued, shiftYear(o.from, -1), shiftYear(o.to, -1));
  const base = { unit: o.unit, years, period, prev };
  return { ...base, insights: buildInsights(base, o.today, o.lang ?? "ru") };
}

/** Keys that never reach a member: absolute volume (position size) and per-trader rows. */
export const MEMBER_STRIPPED_KEYS = ["volume", "traders"] as const;

function strip(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if ((MEMBER_STRIPPED_KEYS as readonly string[]).includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return x;
}

/** Member (trader / curator) view: must be built in pct; drops absolute volume and per-trader rows. */
export function toMemberView(view: OfficeView): OfficeView {
  if (view.unit !== "pct") throw new Error("member view must be in pct");
  return strip(view) as OfficeView;
}

// ─── Request parsing ────────────────────────────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseYears(raw: unknown, today: string): number[] {
  const ty = yearOf(today);
  const list = typeof raw === "string" && raw.trim()
    ? raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 2000 && n <= ty + 1)
    : [ty - 1, ty];
  const uniq = [...new Set(list)].sort((a, b) => a - b);
  return (uniq.length ? uniq : [ty - 1, ty]).slice(-4);
}

/** from / to of the breakdown period (default: YTD of the latest requested year). */
export function parsePeriod(from: unknown, to: unknown, years: number[], today: string): { from: string; to: string } {
  const last = years[years.length - 1];
  const defFrom = `${last}-01-01`;
  const defTo = `${last}-12-31` < today ? `${last}-12-31` : today;
  let f = typeof from === "string" && YMD.test(from) ? from : defFrom;
  let t = typeof to === "string" && YMD.test(to) ? to : defTo;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}
