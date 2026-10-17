/**
 * «Что-если» engine — a pure, I/O-free rule simulator over a trader's real trades, plus the commission optimizer.
 *
 * Input: SimTrade[] (one row per closed round trip, money in $: gross = broker P&L before fees, fees ≥ 0,
 * net = gross − fees — the shared lib/tradeMath convention) and a list of rules.
 * Output: baseline vs scenario metrics, per-day equity curves for both, the list of excluded/changed trades with
 * the reason, a paired day-bootstrap (seeded, deterministic) for the difference, a grid search for the best single
 * rules («Подсказки») and a fee breakdown by price / size / hold / hour / ticker with a break-even estimate.
 *
 * Everything here is deterministic and synchronous so it can be unit-tested with synthetic arrays
 * (no DB, no Date.now(), no Math.random()).
 */

/* ───────────────────────── Types ───────────────────────── */

export type Side = "long" | "short";
export type Horizon = "intraday" | "overnight" | "swing";
export type ResultKind = "win" | "loss" | "be";

export interface SimTrade {
  id: number;
  /** Trading day (New York calendar date), YYYY-MM-DD. */
  day: string;
  /** Minutes since NY midnight of the first entry fill (fractional allowed); null when unknown. */
  entryMin: number | null;
  ticker: string;
  side: Side | null;
  qty: number | null;
  entry: number | null;
  exit: number | null;
  /** Gross P&L ($, before fees). Null ⇒ the trade has no money result and is ignored by every money metric. */
  gross: number | null;
  /** Total costs (commission + ECN + regulatory), always ≥ 0. */
  fees: number;
  /** Hold time in seconds; null when unknown. */
  holdSec: number | null;
  r: number | null;
  stop: number | null;
  setup: string | null;
  tags: string[];
  horizon: Horizon;
  result: ResultKind | null;
  /** Fee components from the broker when known (comm, ecn, sec, taf, cat, nscc, clr, …). */
  feeBreakdown?: Record<string, number> | null;
  /** Number of fills (orders) in the round trip; null ⇒ assume 2 (one entry, one exit). */
  fills?: number | null;
  /** Secondary order inside the day when entry times tie / are unknown (import order). */
  seq: number;
  /** Trader's own grade of the trade (A+, A, B, C); null / absent when not graded. */
  grade?: string | null;
}

export type Rule =
  | { type: "dailyLossLimit"; usd: number }
  | { type: "maxTradesPerDay"; n: number }
  | { type: "stopAfterLosses"; n: number }
  /** Keep only entries inside [from, to) in ET, "HH:MM". Either bound may be omitted. */
  | { type: "timeWindow"; from?: string | null; to?: string | null }
  /** Keep only trades whose entry price is inside [min, max]. */
  | { type: "priceRange"; min?: number | null; max?: number | null }
  | { type: "minHold"; seconds: number }
  | { type: "excludeTickers"; tickers: string[] }
  | { type: "excludeSide"; side: Side }
  /** Hypothetical tariff: commission per share with a per-order minimum, ECN per share; regulatory fees optionally kept. */
  | { type: "commissionPlan"; perShare: number; minPerOrder: number; ecnPerShare: number; keepRegulatory?: boolean }
  /** Approximation: every loss worse than −usd becomes −usd (we do not know whether price would have come back). */
  | { type: "capLoss"; usd: number }
  /** Keep only trades whose size (shares) is inside [min, max]. */
  | { type: "sizeRange"; min?: number | null; max?: number | null }
  /** Skip entries taken within `minutes` after a losing trade closed the same day («после убытка», revenge trades). */
  | { type: "afterLoss"; minutes: number }
  /** Skip trades of these setups (case-insensitive). Trades without a setup are kept. */
  | { type: "excludeSetups"; setups: string[] }
  /** Keep only trades graded at least `grade` (A+ > A > B > C); ungraded trades are dropped. */
  | { type: "minGrade"; grade: Grade };

export const GRADES = ["A+", "A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];
/** 0 = best (A+); null when the value is not a known grade. */
export function gradeRank(g: string | null | undefined): number | null {
  const i = GRADES.indexOf(String(g ?? "").trim().toUpperCase() as Grade);
  return i < 0 ? null : i;
}

export type RuleType = Rule["type"];

export type ExclusionReason =
  | "dailyLossLimit" | "maxTradesPerDay" | "stopAfterLosses" | "timeWindow" | "priceRange" | "minHold" | "excludeTickers" | "excludeSide"
  | "sizeRange" | "afterLoss" | "excludeSetups" | "minGrade";
export type ChangeReason = "commissionPlan" | "capLoss";

export interface ExcludedTrade {
  id: number;
  day: string;
  ticker: string;
  net: number;
  reason: ExclusionReason;
  detail: string;
}

export interface ChangedTrade {
  id: number;
  day: string;
  ticker: string;
  reason: ChangeReason;
  before: number;
  after: number;
  detail: string;
  /** True when the number is an approximation (capLoss), not a recomputation from fills. */
  estimate: boolean;
}

export interface DayResult {
  day: string;
  net: number;
  gross: number;
  fees: number;
  trades: number;
}

export interface EquityPoint {
  day: string;
  net: number;
  cum: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  be: number;
  gross: number;
  fees: number;
  net: number;
  /** W / (W + L), break-even excluded; null when no decided trades. */
  winRate: number | null;
  /** Σ net⁺ / |Σ net⁻|; null when there are no losses (never ∞). */
  profitFactor: number | null;
  /** Mean net per trade. */
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Peak-to-trough drawdown of the cumulative net equity (≤ 0), trade by trade. */
  maxDrawdown: number;
  days: number;
  bestDay: DayResult | null;
  worstDay: DayResult | null;
  dailyMean: number | null;
  dailyStd: number | null;
  /** Sharpe-like: mean daily net / std of daily net, annualised by √252. Null when < 2 days or zero variance. */
  sharpe: number | null;
  maxLossStreak: number;
  /** fees / |gross|; null when gross is 0. */
  feePctOfGross: number | null;
  feePerTrade: number | null;
  shares: number;
  feePerShare: number | null;
  /** Σ R of the trades that have an R (stop / risk known); null when none has. Money rules (capLoss) do not change R. */
  totalR: number | null;
  /** Trades with a known R. */
  rCount: number;
}

export interface BootstrapSummary {
  iters: number;
  /** Number of days resampled (paired). */
  days: number;
  /** 95% CI of the total net difference (scenario − baseline) over the period. */
  diffTotal: { mean: number; lo: number; hi: number };
  /** 95% CI of mean daily net for baseline and scenario. */
  dailyExpectancy: { base: { mean: number; lo: number; hi: number }; scenario: { mean: number; lo: number; hi: number } };
  /** Distribution of a simulated 21-day month under the scenario. */
  month: { p5: number; p25: number; p50: number; p75: number; p95: number; probPositive: number };
  monthBase: { p5: number; p25: number; p50: number; p75: number; p95: number; probPositive: number };
  /** CI of the difference excludes zero. */
  significant: boolean;
  /** n < 30 days or n < 30 trades — too little to trust. */
  smallSample: boolean;
}

export interface SkippedRule { rule: RuleType; reason: string }

export interface ScenarioResult {
  rules: Rule[];
  baseline: Metrics;
  scenario: Metrics;
  baselineEquity: EquityPoint[];
  scenarioEquity: EquityPoint[];
  baselineDaily: DayResult[];
  scenarioDaily: DayResult[];
  excluded: ExcludedTrade[];
  changed: ChangedTrade[];
  skipped: SkippedRule[];
  /** Ids of the trades that remain in the scenario, in simulation order. */
  keptIds: number[];
  bootstrap: BootstrapSummary | null;
}

/* ───────────────────────── Small helpers ───────────────────────── */

export function netOf(t: SimTrade): number | null {
  return t.gross == null ? null : t.gross - Math.abs(t.fees);
}

/** "HH:MM" → minutes since midnight; null when malformed. */
export function parseHm(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtHm(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Sort by day, entry time (unknown last), then import order. */
export function sortSim(trades: SimTrade[]): SimTrade[] {
  return [...trades].sort(
    (a, b) => a.day.localeCompare(b.day) || (a.entryMin ?? 1e9) - (b.entryMin ?? 1e9) || a.seq - b.seq || a.id - b.id,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ───────────────────────── RNG (deterministic) ───────────────────────── */

/** mulberry32 — same seed ⇒ same resamples on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

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
  const decided = wins + losses;
  return {
    trades: trades.length, wins, losses, be,
    gross: round2(gross), fees: round2(fees), net: round2(net),
    winRate: decided ? wins / decided : null,
    profitFactor: negNet < 0 ? posNet / Math.abs(negNet) : null,
    expectancy: trades.length ? net / trades.length : null,
    avgWin: wins ? posNet / wins : null,
    avgLoss: losses ? negNet / losses : null,
    maxDrawdown: round2(maxDrawdownOf(nets)),
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

/* ───────────────────────── Fee recomputation ───────────────────────── */

const REGULATORY_KEYS = ["sec", "taf", "cat", "orf", "nfa"];

/**
 * Fees under a hypothetical tariff. Orders = fills (default 2); shares per order = 2·qty / orders.
 * Commission per order = max(minPerOrder, perShare · sharesInOrder); ECN = ecnPerShare per share both ways.
 * Regulatory pass-through (SEC/TAF/CAT/ORF/NFA) is kept from the broker breakdown when requested and known.
 */
export function recomputeFees(t: SimTrade, plan: Extract<Rule, { type: "commissionPlan" }>): number | null {
  if (t.qty == null || t.qty <= 0) return null;
  const orders = Math.max(2, Math.round(t.fills ?? 2));
  const sharesPerOrder = (2 * t.qty) / orders;
  const commission = orders * Math.max(plan.minPerOrder, plan.perShare * sharesPerOrder);
  const ecn = plan.ecnPerShare * 2 * t.qty;
  let regulatory = 0;
  if (plan.keepRegulatory && t.feeBreakdown) {
    for (const k of REGULATORY_KEYS) regulatory += Math.abs(t.feeBreakdown[k] ?? 0);
  }
  return round2(commission + ecn + regulatory);
}

/* ───────────────────────── Rule descriptions (Russian) ───────────────────────── */

export function describeRule(r: Rule): string {
  switch (r.type) {
    case "dailyLossLimit": return `Дневной лимит убытка −$${r.usd}`;
    case "maxTradesPerDay": return `Не больше ${r.n} сделок в день`;
    case "stopAfterLosses": return `Стоп после ${r.n} убытков подряд за день`;
    case "timeWindow": {
      if (r.from && r.to) return `Только ${r.from}–${r.to} ET`;
      if (r.from) return `Не раньше ${r.from} ET`;
      if (r.to) return `Не позже ${r.to} ET`;
      return "Окно времени";
    }
    case "priceRange": {
      if (r.min != null && r.max != null) return `Цена $${r.min}–$${r.max}`;
      if (r.min != null) return `Без акций дешевле $${r.min}`;
      if (r.max != null) return `Без акций дороже $${r.max}`;
      return "Диапазон цены";
    }
    case "minHold": return `Без скальпов короче ${r.seconds < 120 ? `${r.seconds} с` : `${Math.round(r.seconds / 60)} мин`}`;
    case "excludeTickers": return `Без ${r.tickers.join(", ")}`;
    case "excludeSide": return r.side === "long" ? "Только шорт" : "Только лонг";
    case "commissionPlan": return `Тариф $${r.perShare}/акц., мин. $${r.minPerOrder}/ордер, ECN $${r.ecnPerShare}/акц.`;
    case "capLoss": return `Убыток не хуже −$${r.usd} (оценка)`;
    case "sizeRange": {
      if (r.min != null && r.max != null) return `Размер ${r.min}–${r.max} акц.`;
      if (r.min != null) return `Без позиций меньше ${r.min} акц.`;
      if (r.max != null) return `Без позиций больше ${r.max} акц.`;
      return "Размер позиции";
    }
    case "afterLoss": return `Пауза ${r.minutes} мин после убыточной сделки`;
    case "excludeSetups": return `Без сетапов: ${r.setups.join(", ")}`;
    case "minGrade": return r.grade === "A+" ? "Только сделки A+" : `Только сделки ${r.grade} и лучше`;
  }
}

/* ───────────────────────── Scenario ───────────────────────── */

type Modified = SimTrade & { _before?: number };

/**
 * Applies the rules in three passes: (1) static filters per trade, (2) money modifications (fees / capped loss),
 * (3) sequential day rules in chronological order using the modified net. Returns the scenario next to the baseline.
 */
export function runScenario(input: SimTrade[], rules: Rule[], opts: { bootstrap?: boolean; iters?: number; seed?: number } = {}): ScenarioResult {
  const base = sortSim(input).filter((t) => t.gross != null);
  const baseline = computeMetrics(base);
  const baselineDaily = dailyResults(base);

  const excluded: ExcludedTrade[] = [];
  const changed: ChangedTrade[] = [];
  const skipped: SkippedRule[] = [];
  const seen = new Set<RuleType>();
  for (const r of rules) {
    if (seen.has(r.type)) skipped.push({ rule: r.type, reason: "правило указано дважды — учтено первое" });
    seen.add(r.type);
  }
  const uniq = rules.filter((r, i) => rules.findIndex((x) => x.type === r.type) === i);
  const get = <T extends RuleType>(type: T) => uniq.find((r): r is Extract<Rule, { type: T }> => r.type === type);

  const exclude = (t: SimTrade, reason: ExclusionReason, detail: string) => {
    excluded.push({ id: t.id, day: t.day, ticker: t.ticker, net: round2(netOf(t) ?? 0), reason, detail });
  };

  /* 1. static filters */
  let kept: Modified[] = [];
  const tw = get("timeWindow");
  const twFrom = tw ? parseHm(tw.from) : null;
  const twTo = tw ? parseHm(tw.to) : null;
  if (tw && twFrom == null && twTo == null) skipped.push({ rule: "timeWindow", reason: "границы окна не заданы" });
  if (tw && (twFrom != null || twTo != null) && !base.some((t) => t.entryMin != null)) skipped.push({ rule: "timeWindow", reason: "в сделках нет времени входа" });
  const pr = get("priceRange");
  if (pr && pr.min == null && pr.max == null) skipped.push({ rule: "priceRange", reason: "границы цены не заданы" });
  const mh = get("minHold");
  if (mh && !base.some((t) => t.holdSec != null)) skipped.push({ rule: "minHold", reason: "в сделках нет времени удержания" });
  const et = get("excludeTickers");
  const etSet = new Set((et?.tickers ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));
  if (et && !etSet.size) skipped.push({ rule: "excludeTickers", reason: "тикеры не заданы" });
  const es = get("excludeSide");
  const sr = get("sizeRange");
  if (sr && sr.min == null && sr.max == null) skipped.push({ rule: "sizeRange", reason: "границы размера не заданы" });
  if (sr && (sr.min != null || sr.max != null) && !base.some((t) => t.qty != null)) skipped.push({ rule: "sizeRange", reason: "в сделках нет количества акций" });
  const xs = get("excludeSetups");
  const xsSet = new Set((xs?.setups ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (xs && !xsSet.size) skipped.push({ rule: "excludeSetups", reason: "сетапы не заданы" });
  else if (xs && !base.some((t) => t.setup)) skipped.push({ rule: "excludeSetups", reason: "в сделках не размечены сетапы" });
  const mg = get("minGrade");
  const mgRank = mg ? gradeRank(mg.grade) : null;
  const mgActive = mg != null && mgRank != null && base.some((t) => gradeRank(t.grade) != null);
  if (mg && mgRank == null) skipped.push({ rule: "minGrade", reason: "неизвестная оценка" });
  else if (mg && !mgActive) skipped.push({ rule: "minGrade", reason: "в сделках нет оценок A+…C" });

  for (const t of base) {
    if (tw && t.entryMin != null) {
      if (twFrom != null && t.entryMin < twFrom) { exclude(t, "timeWindow", `вход ${fmtHm(t.entryMin)} раньше ${fmtHm(twFrom)}`); continue; }
      if (twTo != null && t.entryMin >= twTo) { exclude(t, "timeWindow", `вход ${fmtHm(t.entryMin)} позже ${fmtHm(twTo)}`); continue; }
    }
    if (pr && t.entry != null) {
      if (pr.min != null && t.entry < pr.min) { exclude(t, "priceRange", `цена $${t.entry} < $${pr.min}`); continue; }
      if (pr.max != null && t.entry > pr.max) { exclude(t, "priceRange", `цена $${t.entry} > $${pr.max}`); continue; }
    }
    if (mh && t.holdSec != null && t.holdSec < mh.seconds) { exclude(t, "minHold", `удержание ${Math.round(t.holdSec)} с`); continue; }
    if (etSet.size && etSet.has(t.ticker.toUpperCase())) { exclude(t, "excludeTickers", `тикер ${t.ticker}`); continue; }
    if (es && t.side === es.side) { exclude(t, "excludeSide", es.side === "long" ? "лонг" : "шорт"); continue; }
    if (sr && t.qty != null) {
      if (sr.min != null && t.qty < sr.min) { exclude(t, "sizeRange", `${t.qty} акц. < ${sr.min}`); continue; }
      if (sr.max != null && t.qty > sr.max) { exclude(t, "sizeRange", `${t.qty} акц. > ${sr.max}`); continue; }
    }
    if (xsSet.size && t.setup && xsSet.has(t.setup.trim().toLowerCase())) { exclude(t, "excludeSetups", `сетап ${t.setup}`); continue; }
    if (mgActive) {
      const g = gradeRank(t.grade);
      if (g == null) { exclude(t, "minGrade", "без оценки"); continue; }
      if (g > (mgRank as number)) { exclude(t, "minGrade", `оценка ${t.grade}`); continue; }
    }
    kept.push({ ...t });
  }

  /* 2. money modifications */
  const plan = get("commissionPlan");
  if (plan) {
    let applied = 0;
    kept = kept.map((t) => {
      const f = recomputeFees(t, plan);
      if (f == null) return t;
      applied++;
      if (Math.abs(f - Math.abs(t.fees)) >= 0.005) {
        changed.push({ id: t.id, day: t.day, ticker: t.ticker, reason: "commissionPlan", before: round2(Math.abs(t.fees)), after: f, detail: `комиссия $${round2(Math.abs(t.fees))} → $${f}`, estimate: false });
      }
      return { ...t, fees: f };
    });
    if (!applied) skipped.push({ rule: "commissionPlan", reason: "в сделках нет количества акций" });
  }
  const cap = get("capLoss");
  if (cap) {
    kept = kept.map((t) => {
      const net = netOf(t);
      if (net == null || net >= -cap.usd) return t;
      // Keep the fees; lift the gross so that net = −cap.
      const newGross = -cap.usd + Math.abs(t.fees);
      changed.push({ id: t.id, day: t.day, ticker: t.ticker, reason: "capLoss", before: round2(net), after: -cap.usd, detail: `убыток $${round2(net)} ограничен до −$${cap.usd}`, estimate: true });
      return { ...t, gross: round2(newGross) };
    });
  }

  /* 3. sequential day rules */
  const dll = get("dailyLossLimit");
  const mtd = get("maxTradesPerDay");
  const sal = get("stopAfterLosses");
  const al = get("afterLoss");
  if (al && !base.some((t) => t.entryMin != null)) skipped.push({ rule: "afterLoss", reason: "в сделках нет времени входа" });
  if (dll || mtd || sal || al) {
    const out: Modified[] = [];
    let day = "", dayNet = 0, count = 0, lossRun = 0, stoppedBy: ExclusionReason | null = null, stopDetail = "";
    /** Close time (minutes since NY midnight) of the last kept losing trade of the day. */
    let lastLossClose: number | null = null;
    for (const t of sortSim(kept) as Modified[]) {
      if (t.day !== day) { day = t.day; dayNet = 0; count = 0; lossRun = 0; stoppedBy = null; stopDetail = ""; lastLossClose = null; }
      if (stoppedBy) { exclude(t, stoppedBy, stopDetail); continue; }
      if (mtd && count >= mtd.n) { stoppedBy = "maxTradesPerDay"; stopDetail = `${mtd.n}-я сделка дня уже была`; exclude(t, stoppedBy, stopDetail); continue; }
      if (al && lastLossClose != null && t.entryMin != null && t.entryMin >= lastLossClose && t.entryMin < lastLossClose + al.minutes) {
        exclude(t, "afterLoss", `вход через ${Math.max(0, Math.round(t.entryMin - lastLossClose))} мин после убытка`);
        continue;
      }
      out.push(t);
      count++;
      const net = netOf(t) ?? 0;
      dayNet += net;
      if (net < 0) lossRun++; else if (net > 0) lossRun = 0;
      if (net < 0 && t.entryMin != null) lastLossClose = t.entryMin + (t.holdSec ?? 0) / 60;
      if (dll && dayNet <= -dll.usd) { stoppedBy = "dailyLossLimit"; stopDetail = `день уже −$${round2(Math.abs(dayNet))} (лимит −$${dll.usd})`; }
      else if (sal && lossRun >= sal.n) { stoppedBy = "stopAfterLosses"; stopDetail = `${sal.n} убытка подряд`; }
    }
    kept = out;
  }

  const scenarioTrades = sortSim(kept);
  const scenario = computeMetrics(scenarioTrades);
  const scenarioDaily = dailyResults(scenarioTrades);
  excluded.sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);

  const bootstrap = opts.bootstrap === false ? null : pairedDayBootstrap(baselineDaily, scenarioDaily, baseline.trades, scenario.trades, opts.iters ?? 1000, opts.seed ?? 20260101);

  return {
    rules: uniq,
    baseline, scenario,
    baselineEquity: equityByDay(baselineDaily),
    scenarioEquity: equityByDay(scenarioDaily),
    baselineDaily, scenarioDaily,
    excluded, changed, skipped,
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

/* ───────────────────────── Suggestions (single-rule grid) ───────────────────────── */

export interface Suggestion {
  rule: Rule;
  label: string;
  /** scenario.net − baseline.net, $. */
  improvement: number;
  ci: { lo: number; hi: number };
  tradesLeft: number;
  excluded: number;
  scenarioNet: number;
  scenarioWinRate: number | null;
  scenarioProfitFactor: number | null;
  /** True when the 95% CI of the improvement is above zero; false = a weaker signal (CI crosses zero). */
  robust: boolean;
  /** Net of the trades the rule removes (≤ 0 for a helpful filter), $. */
  removedNet: number;
}

/**
 * Losing setups (≥ `minTrades` trades, negative net), worst first: the single worst, then the worst two together.
 * Empty when the trades carry no setups.
 */
export function worstSetups(trades: SimTrade[], minTrades = 10): string[][] {
  const by = new Map<string, { name: string; net: number; n: number }>();
  for (const t of trades) {
    const net = netOf(t);
    if (net == null || !t.setup?.trim()) continue;
    const k = t.setup.trim().toLowerCase();
    const e = by.get(k) ?? { name: t.setup.trim(), net: 0, n: 0 };
    e.net += net; e.n++;
    by.set(k, e);
  }
  const losing = [...by.values()].filter((e) => e.n >= minTrades && e.net < 0).sort((a, b) => a.net - b.net);
  const out: string[][] = [];
  if (losing[0]) out.push([losing[0].name]);
  if (losing[1]) out.push([losing[0].name, losing[1].name]);
  return out;
}

export function suggestionGrid(trades: SimTrade[]): Rule[] {
  const grid: Rule[] = [];
  const hasTime = trades.some((t) => t.entryMin != null);
  const hasHold = trades.some((t) => t.holdSec != null);
  if (hasTime) {
    for (const to of ["10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "15:00"]) grid.push({ type: "timeWindow", to });
    for (const from of ["09:35", "09:45", "10:00", "10:30"]) grid.push({ type: "timeWindow", from });
    grid.push({ type: "timeWindow", from: "09:30", to: "10:30" });
    grid.push({ type: "timeWindow", from: "10:00", to: "12:00" });
  }
  for (const min of [2, 5, 10, 20, 50]) grid.push({ type: "priceRange", min });
  for (const max of [20, 50, 100, 200]) grid.push({ type: "priceRange", max });
  if (hasHold) for (const seconds of [30, 60, 120, 300]) grid.push({ type: "minHold", seconds });
  for (const n of [2, 3, 5, 8, 10]) grid.push({ type: "maxTradesPerDay", n });
  for (const n of [2, 3]) grid.push({ type: "stopAfterLosses", n });
  if (hasTime) for (const minutes of [2, 5, 10, 15]) grid.push({ type: "afterLoss", minutes });
  // Size caps relative to the trader's own sizes (median and upper quantiles).
  const sizes = trades.map((t) => t.qty).filter((q): q is number => q != null && q > 0).sort((a, b) => a - b);
  if (sizes.length >= 20) {
    const caps = new Set<number>();
    for (const q of [0.5, 0.75, 0.9]) {
      const v = quantileSorted(sizes, q);
      const nice = v < 100 ? Math.max(1, Math.round(v / 10) * 10) : Math.round(v / 50) * 50;
      if (nice > 0) caps.add(nice);
    }
    for (const max of caps) grid.push({ type: "sizeRange", max });
  }
  // Daily loss limits relative to the trader's own losing days.
  const dayLosses = dailyResults(trades).map((d) => d.net).filter((v) => v < 0).map((v) => Math.abs(v)).sort((a, b) => a - b);
  if (dayLosses.length >= 3) {
    const cands = new Set<number>();
    for (const q of [0.5, 0.75, 0.9]) {
      const v = quantileSorted(dayLosses, q);
      const nice = v < 100 ? Math.round(v / 10) * 10 : Math.round(v / 50) * 50;
      if (nice > 0) cands.add(nice);
    }
    for (const usd of cands) grid.push({ type: "dailyLossLimit", usd });
  }
  grid.push({ type: "excludeSide", side: "long" });
  grid.push({ type: "excludeSide", side: "short" });
  // Worst tickers by net with enough trades.
  const byTicker = new Map<string, { net: number; n: number }>();
  for (const t of trades) {
    const net = netOf(t);
    if (net == null) continue;
    const e = byTicker.get(t.ticker) ?? { net: 0, n: 0 };
    e.net += net; e.n++;
    byTicker.set(t.ticker, e);
  }
  const worst = [...byTicker.entries()].filter(([, e]) => e.n >= 10 && e.net < 0).sort((a, b) => a[1].net - b[1].net).slice(0, 5);
  for (const [ticker] of worst) grid.push({ type: "excludeTickers", tickers: [ticker] });
  for (const setups of worstSetups(trades)) grid.push({ type: "excludeSetups", setups });
  return grid;
}

/**
 * Runs every single rule of the grid and keeps the ones that (a) leave at least `minTrades` trades, (b) change
 * at least `minExcluded` trades and (c) improve net. Rules whose paired-bootstrap CI lower bound is above zero
 * («robust») come first, sorted by improvement; when there are fewer than `limit`, the list is topped up with
 * weaker positive rules (CI crosses zero, `robust: false`) so the UI can show them marked as such.
 * One suggestion per rule type (the best one) keeps the list varied. These are historical facts, not forecasts.
 */
export function findSuggestions(trades: SimTrade[], opts: { limit?: number; minTrades?: number; minExcluded?: number; iters?: number; seed?: number } = {}): Suggestion[] {
  const limit = opts.limit ?? 5, minTrades = opts.minTrades ?? 30, minExcluded = opts.minExcluded ?? 5;
  const all: Suggestion[] = [];
  for (const rule of suggestionGrid(trades)) {
    const r = runScenario(trades, [rule], { iters: opts.iters ?? 600, seed: opts.seed });
    if (r.skipped.length) continue;
    if (r.scenario.trades < minTrades || r.excluded.length < minExcluded) continue;
    const improvement = round2(r.scenario.net - r.baseline.net);
    if (improvement <= 0 || !r.bootstrap) continue;
    all.push({
      rule, label: describeRule(rule), improvement,
      ci: { lo: r.bootstrap.diffTotal.lo, hi: r.bootstrap.diffTotal.hi },
      tradesLeft: r.scenario.trades, excluded: r.excluded.length,
      scenarioNet: r.scenario.net, scenarioWinRate: r.scenario.winRate, scenarioProfitFactor: r.scenario.profitFactor,
      robust: r.bootstrap.diffTotal.lo > 0,
      removedNet: round2(r.excluded.reduce((sum, e) => sum + e.net, 0)),
    });
  }
  all.sort((a, b) => Number(b.robust) - Number(a.robust) || b.improvement - a.improvement);
  const out: Suggestion[] = [];
  const seenTypes = new Set<RuleType>();
  for (const sg of all) {
    if (out.length >= limit) break;
    if (seenTypes.has(sg.rule.type)) continue;
    seenTypes.add(sg.rule.type);
    out.push(sg);
  }
  return out;
}

/** Rule types this engine understands (the UI hides builder fields the running server does not support). */
export const RULE_TYPES: RuleType[] = [
  "dailyLossLimit", "maxTradesPerDay", "stopAfterLosses", "timeWindow", "priceRange", "minHold", "excludeTickers", "excludeSide",
  "commissionPlan", "capLoss", "sizeRange", "afterLoss", "excludeSetups", "minGrade",
];

/* ───────────────────────── Commission optimizer ───────────────────────── */

export interface FeeGroupRow {
  key: string;
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
}

const PRICE_BUCKETS: [number, string][] = [[2, "< $2"], [5, "$2–5"], [20, "$5–20"], [50, "$20–50"], [100, "$50–100"], [300, "$100–300"], [Infinity, "> $300"]];
const SIZE_BUCKETS: [number, string][] = [[50, "≤ 50 акц."], [100, "51–100"], [300, "101–300"], [1000, "301–1000"], [Infinity, "> 1000"]];
const HOLD_BUCKETS: [number, string][] = [[30, "< 30 с"], [120, "30 с – 2 мин"], [600, "2–10 мин"], [3600, "10–60 мин"], [Infinity, "> 1 ч"]];

function bucketOf(v: number | null, buckets: [number, string][], unknown: string): string {
  if (v == null) return unknown;
  for (const [lim, label] of buckets) if (v < lim || (lim === Infinity)) return label;
  return unknown;
}

export function hourBucket(entryMin: number | null): string {
  if (entryMin == null) return "без времени";
  if (entryMin < 9 * 60 + 30) return "до 09:30";
  if (entryMin >= 16 * 60) return "после 16:00";
  const h = Math.floor(entryMin / 60);
  const half = entryMin % 60 >= 30;
  if (h === 9) return "09:30–10:00";
  return half ? `${String(h).padStart(2, "0")}:30–${String(h + 1).padStart(2, "0")}:00` : `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:30`;
}

const FEE_TYPE_LABEL: Record<string, string> = {
  comm: "Комиссия брокера", ecn: "ECN / биржа", sec: "SEC", taf: "FINRA TAF", cat: "CAT", nscc: "NSCC", clr: "Клиринг", orf: "ORF", nfa: "NFA", misc: "Прочее", exfee: "Биржевые сборы",
};

function groupRows(trades: SimTrade[], keyOf: (t: SimTrade) => string, order?: string[]): FeeGroupRow[] {
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

export function feeReport(input: SimTrade[]): FeeReport {
  const trades = input.filter((t) => t.gross != null);
  const total: FeeGroupRow = groupRows(trades, () => "Всего")[0] ?? {
    key: "Всего", trades: 0, wins: 0, losses: 0, gross: 0, grossWins: 0, fees: 0, net: 0, shares: 0,
    feePctOfGross: null, feePctOfGrossWins: null, feePerTrade: null, feePerShare: null, breakEvenCents: null, eatenWinners: 0,
  };
  const byPrice = groupRows(trades, (t) => bucketOf(t.entry, PRICE_BUCKETS, "без цены"), [...PRICE_BUCKETS.map((b) => b[1]), "без цены"]);
  const bySize = groupRows(trades, (t) => bucketOf(t.qty, SIZE_BUCKETS, "без размера"), [...SIZE_BUCKETS.map((b) => b[1]), "без размера"]);
  const byHold = groupRows(trades, (t) => bucketOf(t.holdSec, HOLD_BUCKETS, "без времени"), [...HOLD_BUCKETS.map((b) => b[1]), "без времени"]);
  const byHour = groupRows(trades, (t) => hourBucket(t.entryMin)).sort((a, b) => a.key.localeCompare(b.key));
  const byTicker = groupRows(trades, (t) => t.ticker.toUpperCase()).sort((a, b) => b.fees - a.fees).slice(0, 25);

  const typeTotals = new Map<string, number>();
  for (const t of trades) {
    if (!t.feeBreakdown) continue;
    for (const [k, v] of Object.entries(t.feeBreakdown)) typeTotals.set(k, (typeTotals.get(k) ?? 0) + Math.abs(v ?? 0));
  }
  const typeSum = [...typeTotals.values()].reduce((s, v) => s + v, 0);
  const byType = [...typeTotals.entries()].filter(([, v]) => v > 0).map(([key, amount]) => ({ key, label: FEE_TYPE_LABEL[key] ?? key, amount: round2(amount), share: typeSum > 0 ? amount / typeSum : 0 })).sort((a, b) => b.amount - a.amount);

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
    recommendations.push(`Безубыток при твоём типичном размере (${Math.round(typicalQty)} акц.) — ${breakEvenCents.toFixed(1)} ¢ хода. Минимальный целевой ход, чтобы комиссия забирала не больше трети, — ${(breakEvenCents * 3).toFixed(0)} ¢.`);
  }
  if (total.feePctOfGross != null && total.feePctOfGross >= 0.5) {
    recommendations.push(`Издержки составляют ${Math.round(total.feePctOfGross * 100)}% от брутто-результата — исторически почти весь результат уходит в комиссию.`);
  }
  if (eatenAll.length) {
    const lost = eatenAll.reduce((s, x) => s + (x.gross - x.fees), 0);
    recommendations.push(`${eatenAll.length} ${pluralRu(eatenAll.length, "прибыльная по брутто сделка стала", "прибыльные по брутто сделки стали", "прибыльных по брутто сделок стали")} убыточными после комиссии (итого ${usdText(lost)}).`);
  }
  const worstHold = byHold.filter((r) => r.trades >= 10 && r.feePctOfGross != null).sort((a, b) => (b.feePctOfGross ?? 0) - (a.feePctOfGross ?? 0))[0];
  if (worstHold && (worstHold.feePctOfGross ?? 0) > 1) {
    recommendations.push(`Удержание «${worstHold.key}»: комиссия ${Math.round((worstHold.feePctOfGross ?? 0) * 100)}% от брутто на ${worstHold.trades} ${pluralRu(worstHold.trades, "сделке", "сделках", "сделках")} — самые дорогие сделки относительно хода.`);
  }
  const smallSize = bySize.find((r) => r.key === SIZE_BUCKETS[0][1]);
  if (smallSize && smallSize.trades >= 10 && smallSize.breakEvenCents != null && total.breakEvenCents != null && smallSize.breakEvenCents > total.breakEvenCents * 1.3) {
    recommendations.push(`Размер ≤ 50 акций: безубыток ${smallSize.breakEvenCents.toFixed(1)} ¢ против ${total.breakEvenCents.toFixed(1)} ¢ в среднем — минимальная комиссия за ордер бьёт по маленьким позициям.`);
  }
  const ecn = byType.find((t) => t.key === "ecn");
  if (ecn && ecn.share >= 0.2) {
    recommendations.push(`ECN-сборы — ${Math.round(ecn.share * 100)}% всех издержек: лимитные ордера, добавляющие ликвидность, исторически обходятся дешевле рыночных.`);
  }
  const cheap = byPrice.filter((r) => (r.key === "< $2" || r.key === "$2–5") && r.trades >= 5 && r.net < 0);
  if (cheap.length) {
    const cheapTrades = cheap.reduce((s, r) => s + r.trades, 0);
    recommendations.push(`Дешёвые акции (${cheap.map((r) => r.key).join(", ")}): ${cheapTrades} ${pluralRu(cheapTrades, "сделка", "сделки", "сделок")}, нетто ${usdText(cheap.reduce((s, r) => s + r.net, 0))} — регуляторные сборы на цент хода там выше.`);
  }

  return {
    total, byPrice, bySize, byHold, byHour, byTicker, byType,
    eaten: eatenAll.slice(0, 50), eatenCount: eatenAll.length, feesOverGrossCount,
    typicalQty, typicalFeePerTrade, breakEvenCents, recommendations,
  };
}

/* ───────────────────────── Presets ───────────────────────── */

export const PRESETS: { id: string; label: string; description: string; rules: Rule[] }[] = [
  { id: "discipline", label: "Дисциплина", description: "Дневной лимит, стоп после серии убытков, не больше 8 сделок", rules: [{ type: "dailyLossLimit", usd: 100 }, { type: "stopAfterLosses", n: 3 }, { type: "maxTradesPerDay", n: 8 }] },
  { id: "morning", label: "Только утро", description: "Входы только 09:30–11:30 ET", rules: [{ type: "timeWindow", from: "09:30", to: "11:30" }] },
  { id: "nopenny", label: "Без пенни", description: "Без акций дешевле $5", rules: [{ type: "priceRange", min: 5 }] },
  { id: "tariff", label: "Новый тариф", description: "$0.003/акц., мин. $0.50 за ордер, ECN $0.002/акц., регуляторные сборы сохраняются", rules: [{ type: "commissionPlan", perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true }] },
];

/** «−$1,026.88» — the same money style as the page. */
function usdText(v: number): string {
  const abs = Math.abs(round2(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}$${abs}`;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
