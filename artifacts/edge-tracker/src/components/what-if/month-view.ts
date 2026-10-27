/**
 * «Как бы выглядел мой месяц» — pure maths of the side-by-side month (month-panel.tsx): the trader's real trades of one
 * month (or the whole period) as a trade-by-trade equity, next to the same trades under the scenario from the server's
 * run (removed trades drop out, changed trades take their new net). For both: the net, the max drawdown on the
 * end-of-day curve (the engine's definition), the worst day and the number of red days.
 */
import type { ChangedTrade, ExcludedTrade, SimTrade } from "./api";

export const ALL_MONTHS = "all";

export interface MonthPoint {
  i: number;
  day: string;
  ticker: string;
  /** Cumulative net of the real trades. */
  fact: number;
  /** Cumulative net under the scenario (unchanged at a removed trade). */
  scenario: number;
  /** The scenario removed this trade / changed its net. */
  removed: boolean;
  changed: boolean;
  net: number;
}

export interface SideStats { net: number; maxDrawdown: number; worstDay: { day: string; net: number } | null; redDays: number; days: number; trades: number }

export interface MonthView {
  points: MonthPoint[];
  fact: SideStats;
  scenario: SideStats;
  removed: number;
  changed: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const netOf = (t: SimTrade) => (t.gross == null ? null : t.gross - Math.abs(t.fees));

/** Months with trades (YYYY-MM), newest first. */
export function monthsOf(trades: SimTrade[]): string[] {
  return [...new Set(trades.filter((t) => t.gross != null).map((t) => t.day.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
}

/** Peak-to-trough (≤ 0) of the cumulative day nets, peak starting at 0 (engine lib/whatIf maxDrawdownOf). */
export function maxDrawdownOf(dayNets: number[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const v of dayNets) {
    cum += v;
    if (cum > peak) peak = cum;
    if (cum - peak < dd) dd = cum - peak;
  }
  return r2(dd);
}

function stats(byDay: Map<string, number>, trades: number): SideStats {
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let worst: { day: string; net: number } | null = null;
  let red = 0, net = 0;
  for (const [day, v] of days) {
    net += v;
    if (v < -1e-9) red++;
    if (!worst || v < worst.net) worst = { day, net: r2(v) };
  }
  return { net: r2(net), maxDrawdown: maxDrawdownOf(days.map(([, v]) => v)), worstDay: worst, redDays: red, days: days.length, trades };
}

/** The month (YYYY-MM, or ALL_MONTHS) of the real trades next to the scenario of a run. */
export function monthView(trades: SimTrade[], excluded: Pick<ExcludedTrade, "id">[], changed: Pick<ChangedTrade, "id" | "after">[], month: string): MonthView {
  const gone = new Set(excluded.map((e) => e.id));
  const after = new Map<number, number>();
  for (const c of changed) after.set(c.id, c.after); // the last change of a trade wins (size cap, then loss cap)
  const list = trades
    .filter((t) => t.gross != null && (month === ALL_MONTHS || t.day.startsWith(month)))
    .sort((a, b) => a.day.localeCompare(b.day) || (a.entryMin ?? 1e9) - (b.entryMin ?? 1e9) || a.seq - b.seq || a.id - b.id);
  const factDay = new Map<string, number>(), scenDay = new Map<string, number>();
  const points: MonthPoint[] = [];
  let fact = 0, scen = 0, removed = 0, nChanged = 0, kept = 0;
  list.forEach((t, i) => {
    const net = netOf(t) as number;
    fact += net;
    factDay.set(t.day, (factDay.get(t.day) ?? 0) + net);
    const isRemoved = gone.has(t.id);
    const isChanged = !isRemoved && after.has(t.id);
    if (isRemoved) removed++;
    else {
      const v = isChanged ? (after.get(t.id) as number) : net;
      if (isChanged) nChanged++;
      scen += v;
      kept++;
      scenDay.set(t.day, (scenDay.get(t.day) ?? 0) + v);
    }
    points.push({ i: i + 1, day: t.day, ticker: t.ticker, fact: r2(fact), scenario: r2(scen), removed: isRemoved, changed: isChanged, net: r2(net) });
  });
  return { points, fact: stats(factDay, list.length), scenario: stats(scenDay, kept), removed, changed: nChanged };
}
