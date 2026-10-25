/**
 * «Правило, которое помогло бы большинству» — the what-if engine run per trader for a short, fixed list of ex-ante
 * desk rules (pure; lib/whatIf runScenario, paired day bootstrap).
 *
 * Per trader with ≥ RULE_MIN_DAYS active days and ≥ RULE_MIN_TRADES trades in the window: Δ = net with the rule − net
 * as traded, «robust» when the 95% paired-day interval of Δ is above zero. Desk test per rule: a one-sided sign test
 * (helped vs hurt among traders with Δ ≠ 0), Benjamini–Hochberg across the rules tried. A rule is recommended when
 *   q ≤ 0.10 ∧ helped ≥ 3 ∧ robust-helped ≥ 2 ∧ robust-helped > robust-hurt ∧ the median Δ per active day > 0.
 * The $ figure is the pooled desk run (every eligible trader, day rules per trader) per desk day with its 95% interval;
 * non-partners see the share of traders it helps (Wilson 80% interval).
 */
import { runScenario } from "../whatIf";
import type { Rule, SimTrade } from "../whatIfTypes";
import { bhQValues } from "../stats";
import { whatIfAction } from "./leaks";
import { REC_Q_MAX, median, round, ticksOf, type RawRec } from "./types";

export const RULE_MIN_DAYS = 20;
export const RULE_MIN_TRADES = 60;
export const RULE_MIN_TRADERS = 5;
export const RULE_MAX_RECS = 2;

/** The rules tried (each one a habit a desk rule can enforce). `catalog` = the rules-catalogue kind when one exists. */
export const DESK_RULE_CANDIDATES: readonly { key: string; rule: Rule; catalog: string | null }[] = [
  { key: "stopAfterLosses3", rule: { type: "stopAfterLosses", n: 3 }, catalog: "no_trade_after_n_losses" },
  { key: "afterLoss10", rule: { type: "afterLoss", minutes: 10 }, catalog: "min_pause_after_loss" },
  { key: "maxTradesPerDay10", rule: { type: "maxTradesPerDay", n: 10 }, catalog: "max_trades_per_day" },
  { key: "maxTradesPerTicker3", rule: { type: "maxTradesPerTicker", n: 3 }, catalog: "max_trades_per_ticker_day" },
  { key: "noReentryAfterLoss15", rule: { type: "noReentryAfterLoss", minutes: 15 }, catalog: null },
  { key: "priceMin5", rule: { type: "priceRange", min: 5 }, catalog: null },
];

/** P(X ≥ k) for X ~ Binomial(n, 1/2). */
export function signTestP(k: number, n: number): number {
  if (n <= 0) return 1;
  let p = 0;
  let c = 1; // C(n, 0)
  const half = 0.5 ** n;
  for (let i = 0; i <= n; i++) {
    if (i >= k) p += c * half;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, p);
}

/** Wilson score interval of a share (z = 1.2816: 80%). */
export function wilson(k: number, n: number, z = 1.2816): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - r) / d), hi: Math.min(1, (c + r) / d) };
}

type Ctx = { from: string; to: string; iters?: number };

type TraderEffect = { trader: string; delta: number; perDay: number; robust: boolean; hurtRobust: boolean };

export function deskRules(trades: readonly SimTrade[], ctx: Ctx): RawRec[] {
  const by = new Map<string, SimTrade[]>();
  for (const t of trades) {
    if (!t.trader || t.gross == null) continue;
    const list = by.get(t.trader);
    if (list) list.push(t); else by.set(t.trader, [t]);
  }
  const eligible = [...by.entries()]
    .filter(([, list]) => list.length >= RULE_MIN_TRADES && new Set(list.map((t) => t.closeDay ?? t.day)).size >= RULE_MIN_DAYS)
    .sort(([a], [b]) => a.localeCompare(b));
  if (eligible.length < RULE_MIN_TRADERS) return [];
  const iters = ctx.iters ?? 400;
  const pooled = eligible.flatMap(([, list]) => list);
  const deskDays = new Set(pooled.map((t) => t.closeDay ?? t.day)).size;

  const tried = DESK_RULE_CANDIDATES.map((c) => {
    const effects: TraderEffect[] = eligible.map(([trader, list]) => {
      const r = runScenario(list, [c.rule], { bootstrap: true, iters });
      const delta = r.scenario.net - r.baseline.net;
      return {
        trader, delta, perDay: r.baseline.days ? delta / r.baseline.days : 0,
        robust: !!r.bootstrap && r.bootstrap.diffTotal.lo > 0, hurtRobust: !!r.bootstrap && r.bootstrap.diffTotal.hi < 0,
      };
    });
    const helped = effects.filter((e) => e.delta > 0.005).length;
    const hurt = effects.filter((e) => e.delta < -0.005).length;
    return { c, effects, helped, hurt, p: signTestP(helped, helped + hurt) };
  });
  const q = bhQValues(tried.map((x) => x.p));
  const out: RawRec[] = [];
  tried.forEach((x, i) => {
    const robust = x.effects.filter((e) => e.robust);
    const robustHurt = x.effects.filter((e) => e.hurtRobust).length;
    const med = median(x.effects.map((e) => e.perDay));
    if (q[i] > REC_Q_MAX || x.helped < 3 || robust.length < 2 || robust.length <= robustHurt || !(med > 0)) return;
    const desk = runScenario(pooled, [x.c.rule], { bootstrap: true, iters });
    const b = desk.bootstrap;
    const per = (v: number) => round(v / Math.max(1, deskDays));
    const share = wilson(x.helped, eligible.length);
    const names = x.effects.filter((e) => e.delta > 0.005).sort((a, b2) => b2.delta - a.delta || a.trader.localeCompare(b2.trader)).map((e) => e.trader);
    out.push({
      id: `rule:${x.c.key}`, kind: "rule", audience: "desk",
      priority: round(per(desk.scenario.net - desk.baseline.net), 2),
      confidence: ticksOf(q[i], robust.length >= Math.max(3, Math.ceil(eligible.length / 4))),
      params: {
        rule: x.c.key, catalog: x.c.catalog, helped: x.helped, hurt: x.hurt, robust: robust.length, robustHurt, eligible: eligible.length,
        medianPerDayUsd: round(med), ci: 95,
      },
      money: { mean: per(desk.scenario.net - desk.baseline.net), lo: b ? per(b.diffTotal.lo) : per(desk.scenario.net - desk.baseline.net), hi: b ? per(b.diffTotal.hi) : per(desk.scenario.net - desk.baseline.net), per: "day" },
      rel: { mean: round(x.helped / eligible.length, 4), lo: round(share.lo, 4), hi: round(share.hi, 4), unit: "share" },
      affected: { count: names.length, names },
      action: whatIfAction(x.c.rule as unknown as Record<string, unknown>),
      secondary: x.c.catalog ? { kind: "rules", href: "/rules" } : null,
      basis: { trades: pooled.length, days: deskDays, traders: eligible.length, from: ctx.from, to: ctx.to, q: round(q[i], 4) },
    });
  });
  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, RULE_MAX_RECS);
}
