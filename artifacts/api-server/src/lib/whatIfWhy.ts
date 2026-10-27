/**
 * «Почему» of a suggestion (or of any rule set): where its dollar effect comes from. Pure, no I/O.
 *
 * The effect Δ = scenario net − baseline net decomposes exactly into per-trade contributions:
 *   - a removed trade contributes −net (removing a −$40 loser = +$40);
 *   - a changed trade (size / loss cap) contributes after − before;
 * and the per-day differences are the sums of those contributions over each day. The card shows the 3 trades and the
 * 3 days that moved it most, and the share of the effect coming from the single best day: a rule whose dollars sit on
 * one lucky day is visible as such («держится на одном дне») — whatever its interval says.
 */
import { runScenario } from "./whatIf";
import { type Rule, type ScenarioResult, type SimTrade, round2 } from "./whatIfTypes";

export interface WhyTrade {
  id: number;
  day: string;
  ticker: string;
  /** The trade's own net before the rule ($). */
  net: number;
  /** Its share of Δ ($, positive = the rule helped through it). */
  contribution: number;
  /** removed | changed. */
  kind: "removed" | "changed";
}

export interface WhyDay { day: string; delta: number }

export interface Why {
  /** Δ of the rule set ($): Σ of every contribution. */
  total: number;
  /** Days on which the rule changed something. */
  days: number;
  /** The 3 trades with the largest contribution in the direction of Δ (helped most when Δ ≥ 0, hurt most otherwise). */
  topTrades: WhyTrade[];
  /** The 3 days with the largest difference in the direction of Δ. */
  topDays: WhyDay[];
  /** Best day / Δ (only when Δ > 0); ≥ 0.5 = half of the effect is one day. */
  topDayShare: number | null;
  /** The 3 best days / Δ (only when Δ > 0). */
  top3Share: number | null;
  /** Δ without the best day (only when Δ > 0): what is left once the luckiest day is taken out. */
  withoutTopDay: number | null;
}

/** Half of the effect or more on one day: the card warns that the rule may be one lucky day. */
export const ONE_DAY_SHARE = 0.5;

/** The decomposition of a computed scenario (exact: Σ contributions = Σ day differences = Δ, to the cent). */
export function whyOf(r: Pick<ScenarioResult, "excluded" | "changed" | "baselineDaily" | "scenarioDaily">, top = 3): Why {
  const contrib = new Map<number, WhyTrade>();
  // Changes first, in pass order (a size cap, then a loss cap: the contributions add up, the net stays the original).
  for (const c of r.changed) {
    const prev = contrib.get(c.id);
    if (prev) prev.contribution = round2(prev.contribution + c.after - c.before);
    else contrib.set(c.id, { id: c.id, day: c.day, ticker: c.ticker, net: c.before, contribution: round2(c.after - c.before), kind: "changed" });
  }
  // A removed trade gives back its ORIGINAL net (a day rule may remove a trade the money pass had already changed).
  for (const e of r.excluded) {
    const net = contrib.get(e.id)?.net ?? e.net;
    contrib.set(e.id, { id: e.id, day: e.day, ticker: e.ticker, net, contribution: round2(-net), kind: "removed" });
  }
  const scen = new Map(r.scenarioDaily.map((d) => [d.day, d.net]));
  const dayDiff: WhyDay[] = r.baselineDaily
    .map((d) => ({ day: d.day, delta: round2((scen.get(d.day) ?? 0) - d.net) }))
    .filter((d) => d.delta !== 0);
  const total = round2(dayDiff.reduce((s, d) => s + d.delta, 0));
  const dir = total >= 0 ? 1 : -1;
  const trades = [...contrib.values()].sort((a, b) => dir * (b.contribution - a.contribution) || a.id - b.id);
  const days = [...dayDiff].sort((a, b) => dir * (b.delta - a.delta) || a.day.localeCompare(b.day));
  const best = days[0]?.delta ?? 0;
  const top3 = days.slice(0, 3).reduce((s, d) => s + d.delta, 0);
  return {
    total, days: dayDiff.length,
    topTrades: trades.slice(0, top),
    topDays: days.slice(0, top),
    topDayShare: total > 0 ? round2(Math.max(0, best) / total) : null,
    top3Share: total > 0 ? round2(Math.max(0, top3) / total) : null,
    withoutTopDay: total > 0 ? round2(total - Math.max(0, best)) : null,
  };
}

/** «Почему» of one rule set on these trades. */
export function whyOfRules(trades: SimTrade[], rules: Rule[]): Why {
  return whyOf(runScenario(trades, rules, { bootstrap: false }));
}

/** Every suggestion of a body with its «Почему» (≤ 8 scenarios per request; nothing when there are no trades). */
export function withWhy<B extends { suggestions: { rule: Rule }[] }>(body: B, trades: SimTrade[]): B {
  if (!trades.length || !body.suggestions.length) return body;
  return { ...body, suggestions: body.suggestions.map((s) => ({ ...s, why: whyOfRules(trades, [s.rule]) })) };
}
