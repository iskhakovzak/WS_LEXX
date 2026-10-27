/**
 * «Автобиография» — a trader's career as dated events and monthly eras. PURE (no I/O), unit-tested
 * (__tests__/profileTimeline.test.ts). The web turns each event (kind + params) into one plain sentence.
 *
 * Events, oldest first:
 *   joined              the account was created (only when that precedes the first trade)
 *   first_trade         the first closed trade (ticker)
 *   milestone_trades    the 100th / 250th / 500th / 1000th / 2500th / 5000th trade
 *   stage_change        a move along the ladder (academy_stage_history: from → to)
 *   readiness           every criterion of the next stage met (academy_readiness_notices)
 *   achievement         a medal tier earned (trader_achievements)
 *   best_day / best_week / best_month   the best positive day, Monday-week and month
 *   first_green_month   the first calendar month that closed positive (only when it is not the very first month)
 *   drawdown            the deepest fall of the cumulative net: peak day → trough day, depth
 *   recovery            the day the cumulative net came back to that peak (absent while not recovered)
 *   rule_adopted        a trading rule taken on (trading_rules.created_at)
 *   intervention        a curator step (curator_interventions) — only in a staff view (the caller decides)
 *
 * Eras: one per calendar month with trades (trades, net, active days, win rate).
 */
import type { DayAgg, Era, TimelineEvent } from "./types";
import { winRateOf } from "../coreMetrics/kpi";

export const TRADE_MILESTONES = [100, 250, 500, 1000, 2500, 5000] as const;
/** At most this many achievement events (the newest tiers win) — a long medal list would drown the story. */
export const MAX_ACHIEVEMENT_EVENTS = 8;
export const MAX_RULE_EVENTS = 6;
export const MAX_INTERVENTION_EVENTS = 10;

export type TimelineInput = {
  joinedAt: string | null;
  /** All trading days of the career, any order. */
  days: readonly DayAgg[];
  firstTrade: { day: string; ticker: string } | null;
  stages: readonly { day: string; from: string | null; to: string; action: string }[];
  readiness: readonly { day: string; stage: string }[];
  achievements: readonly { day: string; line: string; tier: string }[];
  rules: readonly { day: string; kind: string; origin: string }[];
  /** Empty unless the viewer is staff. */
  interventions: readonly { day: string; kind: string; trigger: string }[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Monday (YYYY-MM-DD) of the week of `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Calendar months with trades, oldest first. */
export function erasOf(days: readonly DayAgg[]): Era[] {
  const map = new Map<string, Era & { wins: number; losses: number }>();
  for (const d of days) {
    const month = d.day.slice(0, 7);
    const e = map.get(month) ?? { month, trades: 0, net: 0, activeDays: 0, winRate: null, wins: 0, losses: 0 };
    e.trades += d.n;
    e.net += d.net;
    e.activeDays += 1;
    e.wins += d.wins;
    e.losses += d.losses;
    map.set(month, e);
  }
  return [...map.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map(({ wins, losses, ...e }) => ({ ...e, net: r2(e.net), winRate: wins + losses ? r2((winRateOf(wins, losses) ?? 0)) : null }));
}

/** Deepest fall of the cumulative daily net: peak day, trough day, depth and the recovery day (null while under water). */
export function deepestDrawdown(days: readonly DayAgg[]): { peakDay: string; troughDay: string; depth: number; recoveredDay: string | null } | null {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : 1));
  let cum = 0;
  let peak = 0;
  // Before the first trade the curve stands at 0: a career that starts red falls from its first day.
  let peakDay = sorted[0]?.day ?? "";
  let best: { peakDay: string; troughDay: string; depth: number; peakValue: number } | null = null;
  for (const d of sorted) {
    cum += d.net;
    if (cum >= peak) {
      peak = cum;
      peakDay = d.day;
      continue;
    }
    const depth = peak - cum;
    if (!best || depth > best.depth) best = { peakDay, troughDay: d.day, depth, peakValue: peak };
  }
  if (!best) return null;
  let recoveredDay: string | null = null;
  cum = 0;
  for (const d of sorted) {
    cum += d.net;
    if (d.day > best.troughDay && cum >= best.peakValue) { recoveredDay = d.day; break; }
  }
  return { peakDay: best.peakDay, troughDay: best.troughDay, depth: r2(best.depth), recoveredDay };
}

function bestOf(groups: Map<string, { net: number; last: string }>): { key: string; net: number; last: string } | null {
  let best: { key: string; net: number; last: string } | null = null;
  for (const [key, g] of groups) if (g.net > 0 && (!best || g.net > best.net)) best = { key, net: g.net, last: g.last };
  return best;
}

function grouped(days: readonly DayAgg[], keyOf: (day: string) => string): Map<string, { net: number; last: string }> {
  const m = new Map<string, { net: number; last: string }>();
  for (const d of days) {
    const k = keyOf(d.day);
    const g = m.get(k) ?? { net: 0, last: d.day };
    g.net += d.net;
    if (d.day > g.last) g.last = d.day;
    m.set(k, g);
  }
  return m;
}

function newest<T extends { day: string }>(xs: readonly T[], n: number): T[] {
  return [...xs].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, n);
}

/** The career as events, oldest first (same-day events keep a stable kind order). */
export function buildTimeline(x: TimelineInput): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const days = [...x.days].sort((a, b) => (a.day < b.day ? -1 : 1));
  // The account date opens the story only when it precedes the trades (history imported later is not «joined»).
  const firstDay = x.firstTrade?.day ?? days[0]?.day ?? null;
  if (x.joinedAt && (!firstDay || x.joinedAt <= firstDay)) ev.push({ kind: "joined", day: x.joinedAt, params: {} });
  if (x.firstTrade) ev.push({ kind: "first_trade", day: x.firstTrade.day, params: { ticker: x.firstTrade.ticker } });

  let count = 0;
  let next = 0;
  for (const d of days) {
    count += d.n;
    while (next < TRADE_MILESTONES.length && count >= TRADE_MILESTONES[next]!) {
      ev.push({ kind: "milestone_trades", day: d.day, params: { count: TRADE_MILESTONES[next]! } });
      next++;
    }
  }

  for (const s of x.stages) ev.push({ kind: "stage_change", day: s.day, params: { from: s.from, to: s.to, action: s.action } });
  for (const r of x.readiness) ev.push({ kind: "readiness", day: r.day, params: { stage: r.stage } });
  for (const a of newest(x.achievements, MAX_ACHIEVEMENT_EVENTS)) ev.push({ kind: "achievement", day: a.day, params: { line: a.line, tier: a.tier } });

  const bestDay = days.reduce<DayAgg | null>((b, d) => (d.net > 0 && (!b || d.net > b.net) ? d : b), null);
  if (bestDay) ev.push({ kind: "best_day", day: bestDay.day, params: { net: r2(bestDay.net), trades: bestDay.n } });
  const week = bestOf(grouped(days, mondayOf));
  if (week) ev.push({ kind: "best_week", day: week.last, params: { net: r2(week.net), week: week.key } });
  const months = grouped(days, (d) => d.slice(0, 7));
  const month = bestOf(months);
  if (month) ev.push({ kind: "best_month", day: month.last, params: { net: r2(month.net), month: month.key } });
  const ordered = [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const firstGreen = ordered.findIndex(([, g]) => g.net > 0);
  if (firstGreen > 0) {
    const [key, g] = ordered[firstGreen]!;
    ev.push({ kind: "first_green_month", day: g.last, params: { month: key, net: r2(g.net) } });
  }

  const dd = deepestDrawdown(days);
  if (dd) {
    ev.push({ kind: "drawdown", day: dd.troughDay, params: { depth: dd.depth, from: dd.peakDay } });
    if (dd.recoveredDay) ev.push({ kind: "recovery", day: dd.recoveredDay, params: { depth: dd.depth, from: dd.troughDay } });
  }

  for (const r of newest(x.rules, MAX_RULE_EVENTS)) ev.push({ kind: "rule_adopted", day: r.day, params: { kind: r.kind, origin: r.origin } });
  for (const i of newest(x.interventions, MAX_INTERVENTION_EVENTS)) ev.push({ kind: "intervention", day: i.day, params: { kind: i.kind, trigger: i.trigger } });

  const order = ["joined", "first_trade", "milestone_trades", "stage_change", "readiness", "achievement", "rule_adopted", "intervention", "best_day", "best_week", "best_month", "first_green_month", "drawdown", "recovery"];
  return ev.sort((a, b) => (a.day === b.day ? order.indexOf(a.kind) - order.indexOf(b.kind) : a.day < b.day ? -1 : 1));
}
