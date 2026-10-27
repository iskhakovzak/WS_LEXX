/**
 * Personal leak profile (pure, no I/O): which leak patterns statistically cost THIS trader money, and how much.
 *
 * Every pattern is the same measurement: a list of triggers (moments) and a window after each; trades entered inside a
 * window are «at risk», every other trade with a P&L is the trader's norm. Net = pnl − |fees| (lib/tradeMath).
 *
 *   after_loss      triggers = closed intraday losses (exit time), window = pauseMinutes — the what-if rule «пауза N
 *                   минут после убытка» (whatIf afterLoss) and the behaviour pattern «реванш» (revengeMin) measured
 *                   the same way
 *   rule_violation  triggers = exits of the trades that broke an auto rule, window = violationPauseMinutes
 *   near_stop       triggers = the first exit of a day that took the realized day to −warnShare × daily limit,
 *                   window = nearStopPauseMinutes (the live alert also counts unrealized; history has only realized)
 *   first_trade     one trigger per day, the at-risk trade = the first entry of the day («1-я сделка дня»)
 *
 *   costPerTrade    norm − average of the at-risk trades (what one such trade costs against the trader's own norm)
 *   costPerTrigger  Σ (norm − net) of the at-risk trades / triggers — the expected cost of ONE trigger, including the
 *                   triggers the trader never acted on; used as the «saved» estimate when an event is complied with
 *   costly          ≥ minOccurrences at-risk trades, costPerTrade ≥ minCostUsd and Welch t ≤ −minTStat
 */
import type { GuardConfig, GuardPattern, GuardTrade, PatternStat, PersonalProfile } from "./types";

const MIN_MS = 60_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

export type Trigger = { day: string; at: number };

function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function variance(xs: readonly number[], m: number): number {
  return xs.length > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) : 0;
}

/** Welch t of a vs b (null when either side has < 2 values or both variances are 0). */
export function welchT(a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a)!;
  const mb = mean(b)!;
  const se = Math.sqrt(variance(a, ma) / a.length + variance(b, mb) / b.length);
  if (!(se > 0)) return null;
  return round2((ma - mb) / se);
}

export function byDay(trades: readonly GuardTrade[]): Map<string, GuardTrade[]> {
  const m = new Map<string, GuardTrade[]>();
  for (const t of trades) {
    const list = m.get(t.date);
    if (list) list.push(t); else m.set(t.date, [t]);
  }
  for (const list of m.values()) list.sort((x, y) => (x.entryAt ?? 0) - (y.entryAt ?? 0) || x.id - y.id);
  return m;
}

/** Trades of `day` entered after `at` and no later than `at + windowMin` (the at-risk trades of one trigger). */
export function inWindow(dayTrades: readonly GuardTrade[], at: number, windowMin: number): GuardTrade[] {
  const end = at + windowMin * MIN_MS;
  return dayTrades.filter((t) => t.entryAt != null && t.entryAt > at && t.entryAt <= end);
}

/** Closed intraday losses with a known exit (the after-loss triggers). */
export function lossTriggers(trades: readonly GuardTrade[]): Trigger[] {
  return trades
    .filter((t) => t.result === "loss" && t.exitAt != null && t.horizon === "intraday")
    .map((t) => ({ day: t.date, at: t.exitAt! }));
}

/** Per day: the first exit at which the realized day reached −warnShare × dailyLimit (no limit → none). */
export function nearStopTriggers(trades: readonly GuardTrade[], dailyLimit: number | null, warnShare: number): Trigger[] {
  if (!dailyLimit || dailyLimit <= 0) return [];
  const line = -warnShare * dailyLimit;
  const out: Trigger[] = [];
  for (const [day, list] of byDay(trades)) {
    const closed = list.filter((t) => t.exitAt != null && t.net != null).sort((a, b) => a.exitAt! - b.exitAt!);
    let cum = 0;
    for (const t of closed) {
      cum += t.net!;
      if (cum <= line) { out.push({ day, at: t.exitAt! }); break; }
    }
  }
  return out;
}

function judge(s: Omit<PatternStat, "costly">, cfg: Pick<GuardConfig, "minOccurrences" | "minCostUsd" | "minTStat">): PatternStat {
  const costly = s.atRisk >= cfg.minOccurrences && s.costPerTrade != null && s.costPerTrade >= cfg.minCostUsd
    && s.tStat != null && s.tStat <= -cfg.minTStat;
  return { ...s, costly };
}

/** At-risk vs norm for any trigger list (a trade inside two overlapping windows counts once). */
export function windowStat(
  pattern: GuardPattern,
  triggers: readonly Trigger[],
  trades: readonly GuardTrade[],
  windowMin: number,
  cfg: Pick<GuardConfig, "minOccurrences" | "minCostUsd" | "minTStat">,
): PatternStat {
  const days = byDay(trades);
  const risky = new Set<number>();
  for (const tr of triggers) for (const t of inWindow(days.get(tr.day) ?? [], tr.at, windowMin)) risky.add(t.id);
  return statOf(pattern, triggers.length, trades, risky, cfg);
}

function statOf(
  pattern: GuardPattern, triggers: number, trades: readonly GuardTrade[], risky: ReadonlySet<number>,
  cfg: Pick<GuardConfig, "minOccurrences" | "minCostUsd" | "minTStat">,
): PatternStat {
  const at: number[] = [];
  const base: number[] = [];
  for (const t of trades) {
    if (t.net == null) continue;
    (risky.has(t.id) ? at : base).push(t.net);
  }
  const atRiskAvg = mean(at);
  const baselineAvg = mean(base);
  const costPerTrade = atRiskAvg != null && baselineAvg != null ? round2(baselineAvg - atRiskAvg) : null;
  const excess = baselineAvg != null ? at.reduce((s, n) => s + (baselineAvg - n), 0) : null;
  return judge({
    pattern, triggers, atRisk: at.length,
    atRiskAvg: atRiskAvg == null ? null : round2(atRiskAvg),
    baselineAvg: baselineAvg == null ? null : round2(baselineAvg),
    costPerTrade,
    costPerTrigger: excess != null && triggers > 0 ? round2(Math.max(0, excess) / triggers) : null,
    tStat: welchT(at, base),
  }, cfg);
}

export const notionalOf = (t: Pick<GuardTrade, "qty" | "entry">): number | null =>
  t.qty == null ? null : t.entry != null && t.entry > 0 ? Math.abs(t.qty) * t.entry : Math.abs(t.qty);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The first entry of each day vs every later trade, plus the median first-trade notional («half size» reference). */
export function firstTradeStat(trades: readonly GuardTrade[], cfg: Pick<GuardConfig, "minOccurrences" | "minCostUsd" | "minTStat">): PatternStat {
  const firsts = new Set<number>();
  const sizes: number[] = [];
  for (const list of byDay(trades).values()) {
    const first = list.find((t) => t.entryAt != null) ?? list[0];
    if (!first) continue;
    firsts.add(first.id);
    const n = notionalOf(first);
    if (n != null && n > 0) sizes.push(n);
  }
  const med = median(sizes);
  return { ...statOf("first_trade", firsts.size, trades, firsts, cfg), medianNotional: med == null ? null : round2(med) };
}

export type ProfileInput = {
  /** Lookback history (days before today). */
  history: readonly GuardTrade[];
  /** The trader's daily loss limit now (null = no limits → no near_stop). */
  dailyLimit: number | null;
  /** Exit moments of trades that broke an auto rule in the lookback. */
  violations: readonly Trigger[];
};

/** Every pattern's personal numbers (patterns switched off in the settings are left out). */
export function personalProfile(input: ProfileInput, cfg: GuardConfig): PersonalProfile {
  const out: PersonalProfile = {};
  const h = input.history;
  if (cfg.patterns.after_loss) out.after_loss = windowStat("after_loss", lossTriggers(h), h, cfg.pauseMinutes, cfg);
  if (cfg.patterns.first_trade) out.first_trade = firstTradeStat(h, cfg);
  if (cfg.patterns.rule_violation) out.rule_violation = windowStat("rule_violation", input.violations, h, cfg.violationPauseMinutes, cfg);
  if (cfg.patterns.near_stop && input.dailyLimit) {
    out.near_stop = windowStat("near_stop", nearStopTriggers(h, input.dailyLimit, cfg.warnShare), h, cfg.nearStopPauseMinutes, cfg);
  }
  return out;
}
