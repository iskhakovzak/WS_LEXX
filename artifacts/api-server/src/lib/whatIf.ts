/**
 * «Что-если» engine — a pure, I/O-free rule simulator over a trader's real trades, plus the commission optimizer.
 *
 * Input: SimTrade[] (one row per closed round trip, money in $: gross = broker P&L before fees, fees ≥ 0,
 * net = gross − fees — the shared lib/tradeMath convention) and a list of rules.
 * Output: baseline vs scenario metrics, per-day equity curves for both, the list of excluded/changed trades with
 * the reason, a paired day-bootstrap (seeded, deterministic) for the difference and a fee breakdown by price / size /
 * hold / hour / ticker with a break-even estimate.
 *
 * Split (size ratchet): types and helpers live in whatIfTypes (re-exported here), the rule passes in whatIfPasses, the
 * suggestion grid in whatIfGrid and the suggestion search («Подсказки») in whatIfSuggest — import those two directly
 * (they import this module, so it does not re-export them).
 *
 * Everything here is deterministic and synchronous so it can be unit-tested with synthetic arrays
 * (no DB, no Date.now(), no Math.random()).
 */
import { buildFeeModel, type FeeBandRow } from "./feeModel";
import { whatifT } from "../i18n/ns";
import { maxDrawdownByDay, winRateOf } from "./tradeMath";
import type { Lang } from "../i18n";
import {
  type BootstrapSummary, type ChangedTrade, type DayResult, type EquityPoint, type ExcludedTrade, type ExclusionReason, type Metrics,
  type ResultKind, type Rule, type RuleType, type ScenarioResult, type SimTrade,
  netOf, quantileSorted, round2, sortSim, mulberry32,
} from "./whatIfTypes";
import { buildPasses } from "./whatIfPasses";

export * from "./whatIfTypes";
export { recomputeFees } from "./whatIfPasses";

/* ───────────────────────── Metrics ───────────────────────── */

/** Per-day aggregation in day order. Trades without gross are skipped. */
export function dailyResults(trades: SimTrade[]): DayResult[] {
  const map = new Map<string, DayResult>();
  for (const t of trades) {
    const net = netOf(t);
    if (net == null) continue;
    const d = map.get(t.day) ?? { day: t.day, net: 0, gross: 0, fees: 0, trades: 0 };
    d.net += net;
    d.gross += t.gross ?? 0;
    d.fees += Math.abs(t.fees);
    d.trades++;
    map.set(t.day, d);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, net: round2(d.net), gross: round2(d.gross), fees: round2(d.fees) }));
}

export function equityByDay(daily: DayResult[]): EquityPoint[] {
  let cum = 0;
  return daily.map((d) => ({ day: d.day, net: d.net, cum: round2((cum += d.net)) }));
}

/** Peak-to-trough drawdown (≤ 0) of the cumulative series of `values`. */
export function maxDrawdownOf(values: number[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const v of values) {
    cum += v;
    if (cum > peak) peak = cum;
    if (cum - peak < dd) dd = cum - peak;
  }
  return dd;
}

export function computeMetrics(input: SimTrade[]): Metrics {
  const trades = sortSim(input).filter((t) => t.gross != null);
  let wins = 0, losses = 0, be = 0, gross = 0, fees = 0, posNet = 0, negNet = 0, shares = 0;
  let streak = 0, maxLossStreak = 0, sumR = 0, rCount = 0;
  const nets: number[] = [];
  for (const t of trades) {
    const net = netOf(t)!;
    nets.push(net);
    gross += t.gross!;
    fees += Math.abs(t.fees);
    shares += Math.abs(t.qty ?? 0);
    if (t.r != null && Number.isFinite(t.r)) { sumR += t.r; rCount++; }
    // Result by net money: the broker's win/loss label can disagree with the net after fees.
    const kind: ResultKind = net > 0 ? "win" : net < 0 ? "loss" : "be";
    if (kind === "win") { wins++; posNet += net; streak = 0; }
    else if (kind === "loss") { losses++; negNet += net; streak++; if (streak > maxLossStreak) maxLossStreak = streak; }
    else be++;
  }
  const net = gross - fees;
  const daily = dailyResults(trades);
  const dayNets = daily.map((d) => d.net);
  const dailyMean = dayNets.length ? dayNets.reduce((s, v) => s + v, 0) / dayNets.length : null;
  let dailyStd: number | null = null;
  if (dailyMean != null && dayNets.length >= 2) {
    const v = dayNets.reduce((s, x) => s + (x - dailyMean) ** 2, 0) / (dayNets.length - 1);
    dailyStd = Math.sqrt(v);
  }
  const sharpe = dailyMean != null && dailyStd != null && dailyStd > 0 ? (dailyMean / dailyStd) * Math.sqrt(252) : null;
  let bestDay: DayResult | null = null, worstDay: DayResult | null = null;
  for (const d of daily) {
    if (!bestDay || d.net > bestDay.net) bestDay = d;
    if (!worstDay || d.net < worstDay.net) worstDay = d;
  }
  return {
    trades: trades.length, wins, losses, be,
    gross: round2(gross), fees: round2(fees), net: round2(net),
    winRate: winRateOf(wins, losses),
    profitFactor: negNet < 0 ? posNet / Math.abs(negNet) : null,
    expectancy: trades.length ? net / trades.length : null,
    avgWin: wins ? posNet / wins : null,
    avgLoss: losses ? negNet / losses : null,
    // MAKSIM-08: one definition with stats / dashboard — the end-of-day curve, not trade by trade (−$724 vs −$642).
    maxDrawdown: round2(maxDrawdownByDay(trades.map((t) => ({ day: t.closeDay ?? t.day, value: netOf(t) }))) ?? 0),
    days: daily.length,
    bestDay, worstDay,
    dailyMean, dailyStd, sharpe,
    maxLossStreak,
    feePctOfGross: gross !== 0 ? fees / Math.abs(gross) : null,
    feePerTrade: trades.length ? fees / trades.length : null,
    shares,
    feePerShare: shares > 0 ? fees / shares : null,
    totalR: rCount ? round2(sumR) : null,
    rCount,
  };
}

/* ───────────────────────── Rule descriptions (whatif namespace, reader's language) ───────────────────────── */

export function describeRule(r: Rule, lang: Lang = "ru"): string {
  const t = whatifT.tFor(lang);
  switch (r.type) {
    case "dailyLossLimit": return t("rule.dailyLossLimit", { usd: r.usd });
    case "maxTradesPerDay": return t("rule.maxTradesPerDay", { n: r.n });
    case "stopAfterLosses": return t("rule.stopAfterLosses", { n: r.n });
    case "timeWindow": {
      if (r.from && r.to) return t("rule.windowBoth", { from: r.from, to: r.to });
      if (r.from === "09:30" && !r.to) return t("rule.noPremarket");
      if (r.to === "16:00" && !r.from) return t("rule.noAfterHours");
      if (r.from) return t("rule.windowFrom", { from: r.from });
      if (r.to) return t("rule.windowTo", { to: r.to });
      return t("rule.window");
    }
    case "priceRange": {
      if (r.min != null && r.max != null) return t("rule.priceBoth", { min: r.min, max: r.max });
      if (r.min != null) return t("rule.priceMin", { min: r.min });
      if (r.max != null) return t("rule.priceMax", { max: r.max });
      return t("rule.price");
    }
    case "minHold": return r.seconds < 120 ? t("rule.minHoldSec", { n: r.seconds }) : t("rule.minHoldMin", { n: Math.round(r.seconds / 60) });
    case "excludeTickers": return t("rule.excludeTickers", { tickers: r.tickers.join(", ") });
    case "excludeSide": return r.side === "long" ? t("rule.onlyShort") : t("rule.onlyLong");
    case "commissionPlan": return t("rule.commissionPlan", { perShare: r.perShare, minPerOrder: r.minPerOrder, ecn: r.ecnPerShare });
    case "capLoss": return t("rule.capLoss", { usd: r.usd });
    case "sizeRange": {
      if (r.min != null && r.max != null) return t("rule.sizeBoth", { min: r.min, max: r.max });
      if (r.min != null) return t("rule.sizeMin", { min: r.min });
      if (r.max != null) return t("rule.sizeMax", { max: r.max });
      return t("rule.size");
    }
    case "afterLoss": return t("rule.afterLoss", { n: r.minutes });
    case "excludeSetups": return t("rule.excludeSetups", { setups: r.setups.join(", ") });
    case "minGrade": return r.grade === "A+" ? t("rule.onlyAPlus") : t("rule.minGrade", { grade: r.grade });
    case "excludeImx": return t("rule.excludeImx");
    case "noReentry": return t("rule.noReentry");
    case "requireStop": return t("rule.requireStop");
    case "maxSizeRel": return t("rule.maxSizeRel", { x: r.x });
    case "excludeMistakes": return t("rule.excludeMistakes", { names: r.codes.map((c) => t(`mistake.${c}`)).join(", ") });
    case "excludeTags": return t("rule.excludeTags", { tags: r.tags.join(", ") });
    case "profitGiveback": return t("rule.profitGiveback", { pct: r.pct, peak: r.peak });
    case "dailyProfitTarget": return t("rule.dailyProfitTarget", { usd: r.usd });
    case "afterWin": return t("rule.afterWin", { n: r.minutes });
    case "redZone": return r.floor != null ? t("rule.redZoneFloor", { usd: r.usd, k: r.k, floor: r.floor }) : t("rule.redZone", { usd: r.usd, k: r.k });
    case "blockWindow": return t("rule.blockWindow", { from: r.from, to: r.to });
    case "maxTradesPerTicker": return t("rule.maxTradesPerTicker", { n: r.n });
    case "noReentryAfterLoss": return t("rule.noReentryAfterLoss", { n: r.minutes });
    case "excludeStrategies": return t("rule.excludeStrategies", { strategies: r.strategies.join(", ") });
    case "excludeEarnings": return t("rule.excludeEarnings");
  }
}

/* ───────────────────────── Scenario ───────────────────────── */

/**
 * Applies the rules in three passes (lib/whatIfPasses): (1) static filters per trade, (2) money modifications
 * (fees / scaled size / capped loss), (3) sequential day rules per trader-day in chronological order using the modified
 * net. Returns the scenario next to the baseline.
 */
export function runScenario(input: SimTrade[], rules: Rule[], opts: { bootstrap?: boolean; iters?: number; seed?: number; lang?: Lang } = {}): ScenarioResult {
  const base = sortSim(input).filter((t) => t.gross != null);
  const baseline = computeMetrics(base);
  const baselineDaily = dailyResults(base);
  const excluded: ExcludedTrade[] = [];
  const changed: ChangedTrade[] = [];
  const passes = buildPasses(rules, base, whatifT.tFor(opts.lang ?? "ru"));
  const exclude = (t: SimTrade, reason: ExclusionReason, detail: string) => {
    excluded.push({ id: t.id, day: t.day, ticker: t.ticker, net: round2(netOf(t) ?? 0), reason, detail });
  };

  let kept: SimTrade[] = base;
  if (passes.staticExclusion) {
    kept = [];
    for (const t of base) {
      const h = passes.staticExclusion(t);
      if (h) exclude(t, h.reason, h.detail);
      else kept.push(t);
    }
  }
  if (passes.money) kept = passes.money(kept, (c) => changed.push(c));
  if (passes.sequential) kept = passes.sequential(kept, exclude);

  const scenarioTrades = sortSim(kept);
  const scenario = computeMetrics(scenarioTrades);
  const scenarioDaily = dailyResults(scenarioTrades);
  excluded.sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);

  const bootstrap = opts.bootstrap === false ? null : pairedDayBootstrap(baselineDaily, scenarioDaily, baseline.trades, scenario.trades, opts.iters ?? 1000, opts.seed ?? 20260101);

  return {
    rules: passes.rules,
    baseline, scenario,
    baselineEquity: equityByDay(baselineDaily),
    scenarioEquity: equityByDay(scenarioDaily),
    baselineDaily, scenarioDaily,
    excluded, changed, skipped: passes.skipped,
    keptIds: scenarioTrades.map((t) => t.id),
    bootstrap,
  };
}

/* ───────────────────────── Bootstrap ───────────────────────── */

function ciOf(samples: Float64Array): { mean: number; lo: number; hi: number } {
  const sorted = Array.from(samples).sort((a, b) => a - b);
  let s = 0;
  for (const v of sorted) s += v;
  return { mean: round2(s / sorted.length), lo: round2(quantileSorted(sorted, 0.025)), hi: round2(quantileSorted(sorted, 0.975)) };
}

function monthDist(sorted: number[], rnd: () => number, iters: number, daysInMonth = 21) {
  const n = sorted.length;
  const sums = new Float64Array(iters);
  let pos = 0;
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < daysInMonth; i++) s += sorted[(rnd() * n) | 0];
    sums[b] = s;
    if (s > 0) pos++;
  }
  const arr = Array.from(sums).sort((a, b) => a - b);
  return {
    p5: round2(quantileSorted(arr, 0.05)), p25: round2(quantileSorted(arr, 0.25)), p50: round2(quantileSorted(arr, 0.5)),
    p75: round2(quantileSorted(arr, 0.75)), p95: round2(quantileSorted(arr, 0.95)), probPositive: pos / iters,
  };
}

/**
 * Resamples the baseline's trading days with replacement (paired: the scenario's result on the same day goes with it).
 * Gives a CI for mean daily net of both, for the total difference over the period, and a 21-day month distribution.
 */
export function pairedDayBootstrap(baseDaily: DayResult[], scenDaily: DayResult[], baseTrades: number, scenTrades: number, iters = 1000, seed = 20260101): BootstrapSummary | null {
  const days = baseDaily.map((d) => d.day);
  const n = days.length;
  if (n < 2) return null;
  const scenMap = new Map(scenDaily.map((d) => [d.day, d.net]));
  const b = baseDaily.map((d) => d.net);
  const s = days.map((d) => scenMap.get(d) ?? 0);
  const rnd = mulberry32(seed);
  const diffTot = new Float64Array(iters);
  const baseMean = new Float64Array(iters);
  const scenMean = new Float64Array(iters);
  for (let k = 0; k < iters; k++) {
    let sb = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const j = (rnd() * n) | 0;
      sb += b[j]; ss += s[j];
    }
    baseMean[k] = sb / n;
    scenMean[k] = ss / n;
    diffTot[k] = ss - sb;
  }
  const diff = ciOf(diffTot);
  return {
    iters, days: n,
    diffTotal: diff,
    dailyExpectancy: { base: ciOf(baseMean), scenario: ciOf(scenMean) },
    month: monthDist(s, rnd, iters),
    monthBase: monthDist(b, rnd, iters),
    significant: diff.lo > 0 || diff.hi < 0,
    smallSample: n < 30 || baseTrades < 30 || scenTrades < 30,
  };
}

/** Rule types this engine understands (the UI hides builder fields the running server does not support). */
export const RULE_TYPES: RuleType[] = [
  "dailyLossLimit", "maxTradesPerDay", "stopAfterLosses", "timeWindow", "priceRange", "minHold", "excludeTickers", "excludeSide",
  "commissionPlan", "capLoss", "sizeRange", "afterLoss", "excludeSetups", "minGrade",
  "excludeImx", "noReentry", "requireStop", "maxSizeRel", "excludeMistakes", "excludeTags", "profitGiveback", "dailyProfitTarget",
  "afterWin", "redZone", "blockWindow", "maxTradesPerTicker", "noReentryAfterLoss", "excludeStrategies", "excludeEarnings",
];

/* ───────────────────────── Commission optimizer ───────────────────────── */

export interface FeeGroupRow {
  /** Stable bucket code (RU text the client matches on). */
  key: string;
  /** Display label of the key in the requested language. */
  label?: string;
  trades: number;
  wins: number;
  losses: number;
  gross: number;
  grossWins: number;
  fees: number;
  net: number;
  shares: number;
  /** fees / |gross|. */
  feePctOfGross: number | null;
  /** fees / Σ winning gross. */
  feePctOfGrossWins: number | null;
  feePerTrade: number | null;
  feePerShare: number | null;
  /** Round-trip cost per share in cents = break-even move for this group. */
  breakEvenCents: number | null;
  /** Trades where fees ≥ gross on a gross-positive trade (a winner turned into a loser). */
  eatenWinners: number;
}

export interface FeeReport {
  total: FeeGroupRow;
  byPrice: FeeGroupRow[];
  bySize: FeeGroupRow[];
  byHold: FeeGroupRow[];
  byHour: FeeGroupRow[];
  byTicker: FeeGroupRow[];
  byType: { key: string; label: string; amount: number; share: number }[];
  /** Trades where fees ate > 100% of a positive gross, worst first. */
  eaten: { id: number; day: string; ticker: string; qty: number | null; gross: number; fees: number; net: number; feePct: number }[];
  eatenCount: number;
  /** Trades where fees exceed |gross| (both winners and losers). */
  feesOverGrossCount: number;
  typicalQty: number | null;
  typicalFeePerTrade: number | null;
  breakEvenCents: number | null;
  recommendations: string[];
  /** Per entry-price band (trade-facet bands): fees / gross per share, their ratio and the flag (lib/feeModel, R2). */
  bands: FeeBandRow[];
}

const NO_PRICE = "без цены"; // i18n-ignore (stable bucket key)
const NO_SIZE = "без размера"; // i18n-ignore (stable bucket key)
const NO_TIME = "без времени"; // i18n-ignore (stable bucket key)
const PRICE_BUCKETS: [number, string][] = [[2, "< $2"], [5, "$2–5"], [20, "$5–20"], [50, "$20–50"], [100, "$50–100"], [300, "$100–300"], [Infinity, "> $300"]];
const SIZE_BUCKETS: [number, string][] = [[50, "≤ 50 акц."], // i18n-ignore (stable bucket keys)
  [100, "51–100"], [300, "101–300"], [1000, "301–1000"], [Infinity, "> 1000"]];
// i18n-ignore-next (stable bucket keys, the client matches on them)
const HOLD_BUCKETS: [number, string][] = [ // i18n-ignore
  [30, "< 30 с"], [120, "30 с – 2 мин"], [600, "2–10 мин"], [3600, "10–60 мин"], [Infinity, "> 1 ч"]];

function bucketOf(v: number | null, buckets: [number, string][], unknown: string): string {
  if (v == null) return unknown;
  for (const [lim, label] of buckets) if (v < lim || (lim === Infinity)) return label;
  return unknown;
}

export function hourBucket(entryMin: number | null): string {
  if (entryMin == null) return NO_TIME;
  if (entryMin < 9 * 60 + 30) return "до 09:30"; // i18n-ignore (stable bucket key)
  if (entryMin >= 16 * 60) return "после 16:00"; // i18n-ignore (stable bucket key)
  const h = Math.floor(entryMin / 60);
  const half = entryMin % 60 >= 30;
  if (h === 9) return "09:30–10:00";
  return half ? `${String(h).padStart(2, "0")}:30–${String(h + 1).padStart(2, "0")}:00` : `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:30`;
}

const FEE_TYPE_CODES: Record<string, string> = { sec: "SEC", taf: "FINRA TAF", cat: "CAT", nscc: "NSCC", orf: "ORF", nfa: "NFA" };
/** Fee type label in `lang` (codes like SEC / TAF stay as is). */
function feeTypeLabel(key: string, lang: Lang): string {
  return FEE_TYPE_CODES[key] ?? whatifT.tryFor(lang, `feeType.${key}`) ?? key;
}

/** Display label of a bucket key in `lang` (keys stay the stable RU codes the client matches on). */
const BUCKET_KEY_LABEL: Record<string, string> = {
  "Всего": "bucket.total", "без цены": "bucket.noPrice", "без размера": "bucket.noSize", "без времени": "bucket.noTime", // i18n-ignore (stable bucket keys)
  "до 09:30": "bucket.before0930", "после 16:00": "bucket.after1600", "≤ 50 акц.": "bucket.size50", // i18n-ignore (stable bucket keys)
  "< 30 с": "bucket.hold30s", "30 с – 2 мин": "bucket.hold2m", "2–10 мин": "bucket.hold10m", "10–60 мин": "bucket.hold60m", "> 1 ч": "bucket.hold1h", // i18n-ignore (stable bucket keys)
};
export function bucketLabel(key: string, lang: Lang = "ru"): string {
  const k = BUCKET_KEY_LABEL[key];
  return k ? whatifT.tryFor(lang, k) ?? key : key;
}

function groupRows(trades: SimTrade[], keyOf: (t: SimTrade) => string, order?: string[], lang: Lang = "ru"): FeeGroupRow[] {
  const map = new Map<string, FeeGroupRow>();
  for (const t of trades) {
    if (t.gross == null) continue;
    const key = keyOf(t);
    const row = map.get(key) ?? { key, trades: 0, wins: 0, losses: 0, gross: 0, grossWins: 0, fees: 0, net: 0, shares: 0, feePctOfGross: null, feePctOfGrossWins: null, feePerTrade: null, feePerShare: null, breakEvenCents: null, eatenWinners: 0 };
    const fees = Math.abs(t.fees);
    const net = t.gross - fees;
    row.trades++;
    if (net > 0) row.wins++; else if (net < 0) row.losses++;
    row.gross += t.gross;
    if (t.gross > 0) row.grossWins += t.gross;
    row.fees += fees;
    row.net += net;
    row.shares += Math.abs(t.qty ?? 0);
    if (t.gross > 0 && fees >= t.gross) row.eatenWinners++;
    map.set(key, row);
  }
  const rows = [...map.values()].map((r) => ({
    ...r,
    label: bucketLabel(r.key, lang),
    gross: round2(r.gross), grossWins: round2(r.grossWins), fees: round2(r.fees), net: round2(r.net),
    feePctOfGross: r.gross !== 0 ? r.fees / Math.abs(r.gross) : null,
    feePctOfGrossWins: r.grossWins > 0 ? r.fees / r.grossWins : null,
    feePerTrade: r.trades ? r.fees / r.trades : null,
    feePerShare: r.shares > 0 ? r.fees / r.shares : null,
    // Round trip: fees per trade spread over the position size ⇒ $/share ⇒ cents.
    breakEvenCents: r.shares > 0 ? round2((r.fees / r.shares) * 100) : null,
  }));
  if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return rows;
}

export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return quantileSorted(s, 0.5);
}

export function feeReport(input: SimTrade[], lang: Lang = "ru"): FeeReport {
  const tw = whatifT.tFor(lang);
  const trades = input.filter((t) => t.gross != null);
  const total: FeeGroupRow = groupRows(trades, () => "Всего", undefined, lang)[0] ?? { // i18n-ignore (stable bucket key)
    key: "Всего", label: bucketLabel("Всего", lang), trades: 0, wins: 0, losses: 0, gross: 0, grossWins: 0, fees: 0, net: 0, shares: 0,
    feePctOfGross: null, feePctOfGrossWins: null, feePerTrade: null, feePerShare: null, breakEvenCents: null, eatenWinners: 0,
  };
  // i18n-ignore-next: bucket keys below are stable codes (labels come from bucketLabel).
  const byPrice = groupRows(trades, (t) => bucketOf(t.entry, PRICE_BUCKETS, NO_PRICE), [...PRICE_BUCKETS.map((b) => b[1]), NO_PRICE], lang);
  const bySize = groupRows(trades, (t) => bucketOf(t.qty, SIZE_BUCKETS, NO_SIZE), [...SIZE_BUCKETS.map((b) => b[1]), NO_SIZE], lang);
  const byHold = groupRows(trades, (t) => bucketOf(t.holdSec, HOLD_BUCKETS, NO_TIME), [...HOLD_BUCKETS.map((b) => b[1]), NO_TIME], lang);
  const byHour = groupRows(trades, (t) => hourBucket(t.entryMin), undefined, lang).sort((a, b) => a.key.localeCompare(b.key));
  const byTicker = groupRows(trades, (t) => t.ticker.toUpperCase(), undefined, lang).sort((a, b) => b.fees - a.fees).slice(0, 25);

  const typeTotals = new Map<string, number>();
  for (const t of trades) {
    if (!t.feeBreakdown) continue;
    for (const [k, v] of Object.entries(t.feeBreakdown)) typeTotals.set(k, (typeTotals.get(k) ?? 0) + Math.abs(v ?? 0));
  }
  const typeSum = [...typeTotals.values()].reduce((s, v) => s + v, 0);
  const byType = [...typeTotals.entries()].filter(([, v]) => v > 0).map(([key, amount]) => ({ key, label: feeTypeLabel(key, lang), amount: round2(amount), share: typeSum > 0 ? amount / typeSum : 0 })).sort((a, b) => b.amount - a.amount);

  const eatenAll = trades
    .filter((t) => t.gross! > 0 && Math.abs(t.fees) >= t.gross!)
    .map((t) => ({ id: t.id, day: t.day, ticker: t.ticker, qty: t.qty, gross: round2(t.gross!), fees: round2(Math.abs(t.fees)), net: round2(t.gross! - Math.abs(t.fees)), feePct: Math.abs(t.fees) / t.gross! }))
    .sort((a, b) => b.feePct - a.feePct);
  const feesOverGrossCount = trades.filter((t) => Math.abs(t.fees) > Math.abs(t.gross!)).length;

  const typicalQty = medianOf(trades.map((t) => t.qty).filter((q): q is number => q != null && q > 0));
  const typicalFeePerTrade = medianOf(trades.map((t) => Math.abs(t.fees)));
  const perShareRoundTrip = medianOf(trades.filter((t) => t.qty != null && t.qty > 0).map((t) => Math.abs(t.fees) / t.qty!));
  const breakEvenCents = perShareRoundTrip != null ? round2(perShareRoundTrip * 100) : null;

  const recommendations: string[] = [];
  if (breakEvenCents != null && typicalQty != null) {
    recommendations.push(tw("rec.breakEven", { qty: Math.round(typicalQty), cents: breakEvenCents.toFixed(1), target: (breakEvenCents * 3).toFixed(0) }));
  }
  if (total.feePctOfGross != null && total.feePctOfGross >= 0.5) {
    recommendations.push(tw("rec.feeShare", { pct: Math.round(total.feePctOfGross * 100) }));
  }
  if (eatenAll.length) {
    const lost = eatenAll.reduce((s, x) => s + (x.gross - x.fees), 0);
    recommendations.push(tw("rec.eaten", { count: eatenAll.length, total: usdText(lost) }));
  }
  const worstHold = byHold.filter((r) => r.trades >= 10 && r.feePctOfGross != null).sort((a, b) => (b.feePctOfGross ?? 0) - (a.feePctOfGross ?? 0))[0];
  if (worstHold && (worstHold.feePctOfGross ?? 0) > 1) {
    recommendations.push(tw("rec.hold", { bucket: bucketLabel(worstHold.key, lang), pct: Math.round((worstHold.feePctOfGross ?? 0) * 100), count: worstHold.trades }));
  }
  const smallSize = bySize.find((r) => r.key === SIZE_BUCKETS[0][1]);
  if (smallSize && smallSize.trades >= 10 && smallSize.breakEvenCents != null && total.breakEvenCents != null && smallSize.breakEvenCents > total.breakEvenCents * 1.3) {
    recommendations.push(tw("rec.smallSize", { small: smallSize.breakEvenCents.toFixed(1), avg: total.breakEvenCents.toFixed(1) }));
  }
  const ecn = byType.find((t) => t.key === "ecn");
  if (ecn && ecn.share >= 0.2) {
    recommendations.push(tw("rec.ecn", { pct: Math.round(ecn.share * 100) }));
  }
  const cheap = byPrice.filter((r) => (r.key === "< $2" || r.key === "$2–5") && r.trades >= 5 && r.net < 0);
  if (cheap.length) {
    const cheapTrades = cheap.reduce((s, r) => s + r.trades, 0);
    recommendations.push(tw("rec.cheap", { buckets: cheap.map((r) => r.key).join(", "), count: cheapTrades, net: usdText(cheap.reduce((s, r) => s + r.net, 0)) }));
  }

  return {
    total, byPrice, bySize, byHold, byHour, byTicker, byType,
    eaten: eatenAll.slice(0, 50), eatenCount: eatenAll.length, feesOverGrossCount,
    typicalQty, typicalFeePerTrade, breakEvenCents, recommendations,
    bands: buildFeeModel(trades.map((t) => ({ day: t.day, entry: t.entry, qty: t.qty, gross: t.gross, fees: t.fees }))).bands,
  };
}

/* ───────────────────────── Presets ───────────────────────── */

const PRESET_RULES: { id: "discipline" | "morning" | "nopenny" | "tariff"; rules: Rule[] }[] = [
  { id: "discipline", rules: [{ type: "dailyLossLimit", usd: 100 }, { type: "stopAfterLosses", n: 3 }, { type: "maxTradesPerDay", n: 8 }] },
  { id: "morning", rules: [{ type: "timeWindow", from: "09:30", to: "11:30" }] },
  { id: "nopenny", rules: [{ type: "priceRange", min: 5 }] },
  { id: "tariff", rules: [{ type: "commissionPlan", perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true }] },
];
/** Presets with labels / descriptions in `lang`. */
export function presets(lang: Lang = "ru"): { id: string; label: string; description: string; rules: Rule[] }[] {
  const t = whatifT.tFor(lang);
  return PRESET_RULES.map((p) => ({ id: p.id, label: t(`preset.${p.id}.label`), description: t(`preset.${p.id}.description`), rules: p.rules }));
}
/** RU presets (kept for older imports). */
export const PRESETS = presets("ru");

/** «−$1,026.88» — the same money style as the page. */
function usdText(v: number): string {
  const abs = Math.abs(round2(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}$${abs}`;
}

