/**
 * «Мои правила в деле» — for the rules the trader actually has (the rules catalogue, lib/rulesCatalog; later also rule
 * trials, lib/whatIfRuleTrials), what they are worth on real trades since adoption. Pure, no I/O.
 *
 * A trade the trader did NOT take because of a rule leaves no record, so «the same period without the rule» cannot be
 * re-run trade by trade. What the trades do say, per rule with a what-if twin (catalogueRule):
 *   - since adoption: the trades that still broke it and what they cost — Δ of the rule on the trades since adoption
 *     (what following it fully would have added; 0 = kept every time);
 *   - before adoption: the same rule's Δ per day on the trades before (what it would have saved then);
 *   - the estimate «сэкономило»: (Δ/day before − Δ/day since) × days since — the part of the old leak that closed after
 *     the rule came in. An ESTIMATE: the market and the trader changed too; it needs ≥ MIN_SIDE_DAYS trading days on each
 *     side, else the card says «рано судить».
 * Rules without an honest twin (no overnight, checklist, averaging down, % of capital, self-checks…) are listed as
 * «не моделируется» with no number.
 */
import { runScenario } from "./whatIf";
import { type Rule, type SimTrade, round2 } from "./whatIfTypes";

/** Trading days needed on each side of the adoption day before the estimate is shown. */
export const MIN_SIDE_DAYS = 10;

export interface AdoptedRule {
  id: string;
  name: string;
  kind: string;
  threshold: Record<string, unknown>;
  /** First trading day the rule was in force (YYYY-MM-DD, NY). */
  since: string | null;
  /** «catalog» = trading_rules; «trial» = a rule trial (adapter). */
  source: "catalog" | "trial";
}

export interface RuleInAction {
  id: string;
  name: string;
  kind: string;
  source: "catalog" | "trial";
  since: string | null;
  /** The what-if twin; null = not modelled. */
  rule: Rule | null;
  /** The twin is an approximation (a loss cap: we do not know whether the price came back). */
  estimate: boolean;
  status: "ok" | "early" | "notModelled" | "noSince";
  after: { days: number; trades: number; broke: number; cost: number } | null;
  before: { days: number; trades: number; perDay: number } | null;
  /** (perDay before − perDay since) × days since; null unless status ok. */
  saved: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const posInt = (v: unknown) => { const n = num(v); return n != null && n >= 1 ? Math.round(n) : null; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** 930 → "09:30" (the catalogue's time fields), null when not a time. */
export function catalogTime(v: unknown): string | null {
  const n = num(v);
  if (n == null || n < 0 || n > 2359 || n % 100 > 59) return null;
  return hhmm(Math.floor(n / 100) * 60 + (n % 100));
}

/** The trader's risk limits a catalogue field may fall back to (a «по лимиту риска» rule leaves its $ empty). */
export interface RiskFallback { dailyLossLimit?: number | null; maxRiskPerTrade?: number | null }

/** The what-if twin of a catalogue rule; null when the rule has no honest twin. */
export function catalogueRule(kind: string, th: Record<string, unknown>, limits: RiskFallback = {}): { rule: Rule; estimate: boolean } | null {
  switch (kind) {
    case "max_trades_per_day": { const n = posInt(th.n); return n ? { rule: { type: "maxTradesPerDay", n }, estimate: false } : null; }
    case "no_trade_after_n_losses":
    case "max_consecutive_losses": { const n = posInt(th.n); return n ? { rule: { type: "stopAfterLosses", n }, estimate: false } : null; }
    case "max_daily_loss_usd": { const usd = num(th.usd) ?? limits.dailyLossLimit ?? null; return usd && usd > 0 ? { rule: { type: "dailyLossLimit", usd }, estimate: false } : null; }
    case "max_trades_per_ticker_day": { const n = posInt(th.n); return n ? { rule: { type: "maxTradesPerTicker", n }, estimate: false } : null; }
    case "min_pause_after_loss": { const m = num(th.min); return m && m > 0 ? { rule: { type: "afterLoss", minutes: m }, estimate: false } : null; }
    case "no_trade_first_minutes": { const m = posInt(th.n); return m ? { rule: { type: "timeWindow", from: hhmm(570 + Math.min(m, 389)) }, estimate: false } : null; }
    case "trading_window": {
      const from = catalogTime(th.start), to = catalogTime(th.end);
      return from || to ? { rule: { type: "timeWindow", from, to }, estimate: false } : null;
    }
    case "max_position_shares": { const q = num(th.qty); return q && q > 0 ? { rule: { type: "sizeRange", max: q }, estimate: false } : null; }
    case "banned_tickers": {
      const list = Array.isArray(th.tickers) ? th.tickers.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim().toUpperCase()) : [];
      return list.length ? { rule: { type: "excludeTickers", tickers: [...new Set(list)] }, estimate: false } : null;
    }
    case "max_loss_per_trade_usd": { const usd = num(th.usd) ?? limits.maxRiskPerTrade ?? null; return usd && usd > 0 ? { rule: { type: "capLoss", usd }, estimate: true } : null; }
    default: return null;
  }
}

const daysOf = (trades: SimTrade[]) => new Set(trades.map((t) => t.day)).size;

/** One rule on the trader's trades (all of them, any order). */
export function ruleInAction(trades: SimTrade[], r: AdoptedRule, limits: RiskFallback = {}): RuleInAction {
  const twin = catalogueRule(r.kind, r.threshold, limits);
  const head = { id: r.id, name: r.name, kind: r.kind, source: r.source, since: r.since, rule: twin?.rule ?? null, estimate: twin?.estimate ?? false };
  if (!twin) return { ...head, status: "notModelled", after: null, before: null, saved: null };
  if (!r.since) return { ...head, status: "noSince", after: null, before: null, saved: null };
  const since = r.since;
  const withMoney = trades.filter((t) => t.gross != null);
  const after = withMoney.filter((t) => t.day >= since);
  const before = withMoney.filter((t) => t.day < since);
  const ra = runScenario(after, [twin.rule], { bootstrap: false });
  const rb = runScenario(before, [twin.rule], { bootstrap: false });
  const da = daysOf(after), db = daysOf(before);
  const cost = round2(ra.scenario.net - ra.baseline.net);
  const perDayBefore = db ? (rb.scenario.net - rb.baseline.net) / db : 0;
  const perDayAfter = da ? cost / da : 0;
  const ok = da >= MIN_SIDE_DAYS && db >= MIN_SIDE_DAYS;
  return {
    ...head,
    status: ok ? "ok" : "early",
    after: { days: da, trades: after.length, broke: new Set([...ra.excluded.map((e) => e.id), ...ra.changed.map((c) => c.id)]).size, cost },
    before: { days: db, trades: before.length, perDay: round2(perDayBefore) },
    saved: ok ? round2((perDayBefore - perDayAfter) * da) : null,
  };
}

/** Every adopted rule, modelled ones first (then by adoption day). */
export function rulesInAction(trades: SimTrade[], rules: AdoptedRule[], limits: RiskFallback = {}): RuleInAction[] {
  const rank = (x: RuleInAction) => (x.status === "ok" ? 0 : x.status === "early" ? 1 : x.status === "noSince" ? 2 : 3);
  return rules.map((r) => ruleInAction(trades, r, limits)).sort((a, b) => rank(a) - rank(b) || (a.since ?? "").localeCompare(b.since ?? "") || a.id.localeCompare(b.id));
}
