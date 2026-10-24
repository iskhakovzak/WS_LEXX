/**
 * «Итоги недели / месяца» — pure model (unit-tested in model.test.ts): the API slices of api.ts → the story cards.
 * No new metric is computed here; every number is one the owning page already shows:
 *
 *   net         stats aggregate totals: net $ (or total R), trading / green / red days, closed trades, win rate
 *   best        stats aggregate extremes: the best trade of the period (net $, or R under r_only / without $)
 *   discipline  week reports: trading days without a violation or a logged mistake, the clean streak
 *   edge        behaviour profile: the best setup (≥ 5 trades, else the top setup row) and the best hour
 *   lesson      behaviour patterns: the costliest habit ($ vs the trader's own norm); else the cost of broken rules
 *   progress    academy readiness: criteria passed for the next stage
 *   focus       the curator's open goal for next week → the trader's own focus → the habit's recommendation
 *
 * A card without data is dropped (5–7 cards in practice). Desk rule shareCards.money = "r_only" never puts $ on a card.
 */
import { netPnl, signedR, winRateOf } from "@/lib/trade-math";
import type { MoneyPolicy } from "@/components/shared/share-canvas/policy";
import type { AggBucket, AggTrade, BehaviorBucket, BehaviorSlice, ReadinessSlice, StatsSlice, WeeklySlice } from "./api";
import type { WrappedPeriod } from "./period";

export type Unit = "usd" | "r";
export type CardKind = "net" | "best" | "discipline" | "edge" | "lesson" | "progress" | "focus";
export const CARD_ORDER: readonly CardKind[] = ["net", "best", "discipline", "edge", "lesson", "progress", "focus"];

export type NetCard = {
  kind: "net"; unit: Unit; value: number | null; trades: number; tradingDays: number; green: number; red: number;
  winRate: number | null; bestDay: { date: string; value: number } | null;
};
export type BestTrade = {
  id: number; ticker: string; side: "long" | "short"; day: string; entry: number | null; exit: number | null;
  net: number | null; r: number | null; setup: string | null; raw: AggTrade;
};
export type BestCard = { kind: "best"; unit: Unit; value: number; trade: BestTrade };
export type DisciplineCard = { kind: "discipline"; tradingDays: number; cleanDays: number; streak: number; days: Array<{ date: string; clean: boolean }> };
export type EdgeStat = { label: string; n: number; net: number | null; winRate: number | null };
export type EdgeCard = { kind: "edge"; unit: Unit; setup: EdgeStat | null; hour: EdgeStat | null };
export type Leak = { title: string; cost: number | null; trades: number; days: number; advice: string | null };
export type LessonCard = { kind: "lesson"; unit: Unit; leak: Leak | null; rules: { trades: number; cost: number | null } | null };
export type ProgressCard = {
  kind: "progress"; stage: string | null; next: string; passed: number; total: number; ready: boolean;
  criteria: Array<{ label: string; value: string; target: string; progress: number; pass: boolean }>;
};
export type FocusSource = "curator" | "self" | "habit" | "none";
export type FocusCard = { kind: "focus"; text: string | null; source: FocusSource };
export type WrappedCard = NetCard | BestCard | DisciplineCard | EdgeCard | LessonCard | ProgressCard | FocusCard;

export interface WrappedModel {
  period: WrappedPeriod;
  unit: Unit;
  cards: WrappedCard[];
  /** False when the period has no closed trade (the story shows the empty state). */
  hasTrades: boolean;
}

export interface WrappedInput {
  period: WrappedPeriod;
  money: MoneyPolicy;
  stats: StatsSlice | null;
  behavior: BehaviorSlice | null;
  weeks: readonly WeeklySlice[];
  readiness: ReadinessSlice | null;
}

const fieldOf = (s: StatsSlice, b: AggBucket | undefined, k: string): number => {
  const i = s.fields.indexOf(k);
  return i >= 0 && b ? b[i] ?? 0 : 0;
};

/** $ when the desk allows it and the book has P&L; R otherwise. */
export function unitOf(stats: StatsSlice | null, money: MoneyPolicy): Unit {
  if (money === "r_only" || !stats || !stats.money) return "r";
  return fieldOf(stats, stats.total, "pnlN") > 0 ? "usd" : "r";
}

function bucketValue(s: StatsSlice, b: AggBucket, unit: Unit): number | null {
  if (unit === "usd") return fieldOf(s, b, "pnlN") ? fieldOf(s, b, "net") : null;
  return fieldOf(s, b, "rN") ? fieldOf(s, b, "r") : null;
}

export function netCard(stats: StatsSlice | null, unit: Unit): NetCard {
  if (!stats) return { kind: "net", unit, value: null, trades: 0, tradingDays: 0, green: 0, red: 0, winRate: null, bestDay: null };
  const days = stats.days.map((d) => ({ date: d.key, value: bucketValue(stats, d.b, unit) }));
  let bestDay: NetCard["bestDay"] = null;
  for (const d of days) if (d.value != null && d.value > 0 && (!bestDay || d.value > bestDay.value)) bestDay = { date: d.date, value: d.value };
  return {
    kind: "net", unit,
    value: bucketValue(stats, stats.total, unit),
    trades: fieldOf(stats, stats.total, "closed"),
    tradingDays: days.length,
    green: days.filter((d) => d.value != null && d.value > 0).length,
    red: days.filter((d) => d.value != null && d.value < 0).length,
    winRate: winRateOf(fieldOf(stats, stats.total, "wins"), fieldOf(stats, stats.total, "losses")),
    bestDay,
  };
}

export function bestCard(stats: StatsSlice | null, unit: Unit): BestCard | null {
  const ids = stats?.extremes?.[unit === "usd" ? "net" : "r"]?.best ?? [];
  const raw = ids.length ? stats?.trades?.find((t) => t.id === ids[0]) : undefined;
  if (!raw || !raw.ticker) return null;
  const net = netPnl(raw);
  const r = signedR(raw);
  const value = unit === "usd" ? net : r;
  if (value == null || !(value > 0)) return null;
  return {
    kind: "best", unit, value,
    trade: {
      id: raw.id, ticker: raw.ticker.trim().toUpperCase(), side: (raw.side ?? "").toLowerCase().startsWith("s") ? "short" : "long",
      day: String(raw.exitDate || raw.date || "").slice(0, 10), entry: raw.entry, exit: raw.exit,
      net: unit === "usd" ? net : null, r, setup: raw.setup?.trim() || null, raw,
    },
  };
}

/** Trading days (a trade closed) of the period in the week reports, each marked clean when no violation / mistake hit it. */
function disciplineDays(p: WrappedPeriod, weeks: readonly WeeklySlice[]): Array<{ date: string; clean: boolean }> {
  const dirty = new Set<string>();
  const days = new Map<string, boolean>();
  for (const w of weeks) {
    for (const d of w.days) if (d.trades > 0 && d.date >= p.from && d.date <= p.to) days.set(d.date, true);
    for (const x of [...w.violations.items, ...w.mistakes.items]) if (x.tradeId != null && x.tradeDate) dirty.add(x.tradeDate.slice(0, 10));
  }
  return [...days.keys()].sort().map((date) => ({ date, clean: !dirty.has(date) }));
}

/** Clean days in a row up to the last trading day. */
export function trailingRun(days: ReadonlyArray<{ clean: boolean }>): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0 && days[i]!.clean; i--) n++;
  return n;
}

export function disciplineCard(p: WrappedPeriod, weeks: readonly WeeklySlice[]): DisciplineCard | null {
  if (!weeks.length) return null;
  const days = disciplineDays(p, weeks);
  if (!days.length) return null;
  // A week: the report's own streak (it runs back across earlier weeks). A month: the run inside the month.
  const own = p.kind === "week" ? weeks.find((w) => w.week.key === p.key)?.discipline.cleanStreak : undefined;
  return { kind: "discipline", tradingDays: days.length, cleanDays: days.filter((d) => d.clean).length, streak: own ?? trailingRun(days), days };
}

const edgeOf = (b: BehaviorBucket | null | undefined): EdgeStat | null => (b ? { label: b.label, n: b.n, net: b.net, winRate: b.winRate } : null);

export function edgeCard(behavior: BehaviorSlice | null, unit: Unit): EdgeCard | null {
  if (!behavior) return null;
  // The profile's pick needs ≥ 5 trades a setup; a short week falls back to the top row of the same setup table.
  const rows = behavior.profile?.setups?.rows ?? [];
  const setup = behavior.profile?.setups?.best ?? rows.find((r) => r.n >= 2 && (r.net ?? 0) > 0) ?? null;
  const hours = (behavior.byHour ?? []).filter((h) => h.n >= 2 && (h.net ?? 0) > 0);
  const hour = behavior.profile?.hours?.best ?? (hours.length ? hours.reduce((a, b) => ((b.net ?? 0) > (a.net ?? 0) ? b : a)) : null);
  if (!setup && !hour) return null;
  return { kind: "edge", unit, setup: edgeOf(setup), hour: edgeOf(hour) };
}

/** $ lost on distinct trades linked to violations / mistakes in the period (the week report's «cost»). */
function rulesCost(p: WrappedPeriod, weeks: readonly WeeklySlice[], unit: Unit): { trades: number; cost: number | null } | null {
  const seen = new Set<number>();
  let cost = 0, valued = 0;
  for (const w of weeks) {
    for (const x of [...w.violations.items, ...w.mistakes.items]) {
      const d = x.tradeDate?.slice(0, 10);
      if (x.tradeId == null || seen.has(x.tradeId) || !d || d < p.from || d > p.to) continue;
      seen.add(x.tradeId);
      const v = unit === "usd" ? x.tradeNet : x.tradeR;
      if (v != null) { valued++; if (v < 0) cost += -v; }
    }
  }
  if (!seen.size) return null;
  return { trades: seen.size, cost: valued ? Math.round(cost * 100) / 100 : null };
}

export function lessonCard(p: WrappedPeriod, behavior: BehaviorSlice | null, weeks: readonly WeeklySlice[], unit: Unit): LessonCard | null {
  const costly = (behavior?.patterns ?? []).filter((x) => x.cost != null && x.cost < 0).sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
  const top = costly[0];
  const leak: Leak | null = top
    ? { title: top.title, cost: unit === "usd" ? -(top.cost ?? 0) : null, trades: top.n, days: top.days, advice: top.insight?.recommendation?.trim() || top.rule?.trim() || null }
    : null;
  const rules = leak ? null : rulesCost(p, weeks, unit);
  if (!behavior && !rules) return null;
  return { kind: "lesson", unit, leak, rules };
}

export function progressCard(r: ReadinessSlice | null): ProgressCard | null {
  if (!r || !r.nextStage || !r.total) return null;
  const rows = r.criteria.filter((c) => c.status !== "na");
  // Closest to passing first, then the passed ones; four rows fit the card.
  const failing = rows.filter((c) => c.status === "fail").sort((a, b) => b.progress - a.progress);
  const passing = rows.filter((c) => c.status === "pass");
  return {
    kind: "progress", stage: r.stage?.name ?? null, next: r.nextStage.name, passed: r.passed, total: r.total, ready: r.ready,
    criteria: [...failing, ...passing].slice(0, 4).map((c) => ({
      label: c.label, value: c.display, target: c.targetDisplay, progress: Math.max(0, Math.min(1, c.progress)), pass: c.status === "pass",
    })),
  };
}

export function focusCard(p: WrappedPeriod, weeks: readonly WeeklySlice[], lesson: LessonCard | null): FocusCard {
  // The report of the period's last week carries next week's goals (set by the curator) and the trader's own focus.
  const last = [...weeks].filter((w) => w.week.start <= p.to).sort((a, b) => b.week.start.localeCompare(a.week.start))[0];
  const goal = last?.review?.goals?.find((g) => g.status === "open" && g.text.trim());
  if (goal) return { kind: "focus", text: goal.text.trim(), source: "curator" };
  const own = last?.review?.selfReview?.focus?.trim();
  if (own) return { kind: "focus", text: own, source: "self" };
  const advice = lesson?.leak?.advice;
  if (advice) return { kind: "focus", text: advice, source: "habit" };
  return { kind: "focus", text: null, source: "none" };
}

export function buildWrapped(input: WrappedInput): WrappedModel {
  const { period, stats, behavior, weeks, readiness } = input;
  const unit = unitOf(stats, input.money);
  const net = netCard(stats, unit);
  const hasTrades = net.trades > 0;
  if (!hasTrades) return { period, unit, hasTrades, cards: [net, focusCard(period, weeks, null)] };
  const lesson = lessonCard(period, behavior, weeks, unit);
  const cards: Array<WrappedCard | null> = [
    net, bestCard(stats, unit), disciplineCard(period, weeks), edgeCard(behavior, unit), lesson, progressCard(readiness),
    focusCard(period, weeks, lesson),
  ];
  return { period, unit, hasTrades, cards: cards.filter((c): c is WrappedCard => c != null) };
}
