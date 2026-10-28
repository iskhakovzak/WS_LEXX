/**
 * Session flow reads (no writes): the per-trader stats of a window (GET /session-flow/stats, the analytics «Эдж» tab)
 * and the facts of one day (the mentor's debrief, the curator's give-back item). Thresholds are desk settings
 * (lib/settings registry «flow.*»). Everything is derived from PropReports trades by lib/sessionFlow/flow.ts.
 */
import { computeUsdStats, type UsdStats } from "../playbookEdge";
import { loadLimits } from "../riskData";
import { setting } from "../settings/registry";
import { chaseIds, dayGiveback, entryNumbers, greenToRed, reentryBuckets, type DayGiveback, type GreenToRed, type GivebackCfg, type GreenToRedCfg, type ReentryRow } from "./flow";
import { flowTrades, groupBy } from "./load";
import { normTimings, offTiming, timingOf, type Timing } from "./timing";
import type { FlowTrade } from "./types";
import { pool } from "@workspace/db";

export const givebackCfg = (): GivebackCfg => ({ thresholdStops: setting("flow.givebackStops"), nearPeakShare: setting("flow.givebackNearPeakShare") });
export const greenToRedCfg = (): GreenToRedCfg => ({ sizeRatio: setting("flow.g2rSizeRatio"), paceRatio: setting("flow.g2rPaceRatio"), minAfter: setting("flow.g2rMinAfter") });

export type FlowStats = {
  trader: string;
  from: string;
  to: string;
  reentry: ReentryRow[];
  /** Trades that chased a stopped pre-market / print / after-market trade, with their $ stats. */
  chase: UsdStats;
  giveback: { threshold: number; flaggedDays: number; days: DayGiveback[] };
  greenToRed: { crossDays: number; materialDays: number; days: GreenToRed[] };
};

/** Days are listed newest first, at most this many. */
const MAX_DAYS_LISTED = 10;

export function statsOf(trader: string, from: string, to: string, trades: readonly FlowTrade[], dailyLimit: number | null): FlowStats {
  const chase = chaseIds(trades);
  const days = groupBy(trades, (t) => t.day);
  const gb: DayGiveback[] = [];
  const g2r: GreenToRed[] = [];
  const gCfg = givebackCfg();
  const rCfg = greenToRedCfg();
  for (const list of days.values()) {
    const g = dayGiveback(list, dailyLimit, gCfg);
    if (g?.flagged) gb.push(g);
    const x = greenToRed(list, rCfg);
    if (x) g2r.push(x);
  }
  gb.sort((a, b) => b.day.localeCompare(a.day));
  g2r.sort((a, b) => b.day.localeCompare(a.day));
  return {
    trader, from, to,
    reentry: reentryBuckets(trades),
    chase: computeUsdStats(trades.filter((t) => chase.has(t.id))),
    giveback: { threshold: gCfg.thresholdStops, flaggedDays: gb.length, days: gb.slice(0, MAX_DAYS_LISTED) },
    greenToRed: { crossDays: g2r.length, materialDays: g2r.filter((x) => x.material).length, days: g2r.filter((x) => x.material).slice(0, MAX_DAYS_LISTED) },
  };
}

export async function dailyLimitOf(trader: string): Promise<number | null> {
  const l = (await loadLimits(trader)).get(trader);
  return l?.dailyLossLimit ?? null;
}

export async function flowStats(trader: string, from: string, to: string): Promise<FlowStats> {
  const [trades, limit] = await Promise.all([flowTrades(trader, from, to), dailyLimitOf(trader)]);
  return statsOf(trader, from, to, trades, limit);
}

export type DayFlowFacts = {
  /** (ticker, side) pairs entered more than once today, with the number of entries. */
  reentries: { ticker: string; side: string | null; entries: number; net: number }[];
  /** Chase entries of today. */
  chase: { ticker: string; net: number | null }[];
  /** Today's give-back when it is past the threshold. */
  giveback: Pick<DayGiveback, "peak" | "close" | "giveback" | "stops" | "r" | "unit"> | null;
  /** Today's green-to-red cross when the size / pace went up after it. */
  greenToRed: Pick<GreenToRed, "peak" | "sizeRatio" | "paceRatio"> & { afterTrades: number } | null;
  /** Trades taken in a timing their playbook setup does not allow (playbook.timings). */
  offTiming: { ticker: string; setup: string; timing: Timing; allowed: Timing[] }[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Trades whose timing their setup's matrix does not allow (setup id → allowed timings; a setup without one never flags). */
export function offTimingTrades(trades: readonly FlowTrade[], allowedBySetup: ReadonlyMap<number, readonly Timing[]>): DayFlowFacts["offTiming"] {
  const out: DayFlowFacts["offTiming"] = [];
  for (const t of trades) {
    if (t.setupId == null) continue;
    const allowed = allowedBySetup.get(t.setupId) ?? [];
    const timing = timingOf(t);
    if (timing && offTiming(timing, allowed)) out.push({ ticker: t.ticker.toUpperCase(), setup: t.setupName ?? String(t.setupId), timing, allowed: [...allowed] });
  }
  return out;
}

/** The facts of one trader-day (pure: the day's trades + the daily limit + the setups' timing matrices). */
export function dayFlowFacts(dayTrades: readonly FlowTrade[], dailyLimit: number | null, allowedBySetup: ReadonlyMap<number, readonly Timing[]> = new Map()): DayFlowFacts {
  const nums = entryNumbers(dayTrades);
  const pairs = groupBy(dayTrades, (t) => `${t.ticker.toUpperCase()}\u0000${t.side ?? ""}`);
  const reentries: DayFlowFacts["reentries"] = [];
  for (const list of pairs.values()) {
    const entries = Math.max(...list.map((t) => nums.get(t.id) ?? 1));
    if (entries < 2) continue;
    reentries.push({ ticker: list[0]!.ticker.toUpperCase(), side: list[0]!.side, entries, net: r2(list.reduce((a, t) => a + (t.net ?? 0), 0)) });
  }
  reentries.sort((a, b) => b.entries - a.entries || a.net - b.net);
  const chase = chaseIds(dayTrades);
  const g = dayGiveback(dayTrades, dailyLimit, givebackCfg());
  const x = greenToRed(dayTrades, greenToRedCfg());
  return {
    reentries: reentries.slice(0, 5),
    chase: dayTrades.filter((t) => chase.has(t.id)).slice(0, 5).map((t) => ({ ticker: t.ticker.toUpperCase(), net: t.net })),
    giveback: g?.flagged ? { peak: g.peak, close: g.close, giveback: g.giveback, stops: g.stops, r: g.r, unit: g.unit } : null,
    greenToRed: x?.material ? { peak: x.peak, sizeRatio: x.sizeRatio, paceRatio: x.paceRatio, afterTrades: x.after.trades } : null,
    offTiming: offTimingTrades(dayTrades, allowedBySetup).slice(0, 5),
  };
}

/** Setup id → its allowed timings (only setups that restrict them). */
export async function setupTimings(ids: readonly number[]): Promise<Map<number, Timing[]>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query<{ id: number; timings: string[] | null }>(`SELECT id, timings FROM playbook WHERE id = ANY($1::int[]) AND timings IS NOT NULL`, [ids]);
  return new Map(rows.map((r) => [Number(r.id), normTimings(r.timings)] as const).filter(([, v]) => v.length > 0));
}

export async function dayFlowFactsOf(trader: string, day: string): Promise<DayFlowFacts> {
  const [trades, limit] = await Promise.all([flowTrades(trader, day, day), dailyLimitOf(trader)]);
  const ids = [...new Set(trades.map((t) => t.setupId).filter((x): x is number => x != null))];
  return dayFlowFacts(trades, limit, await setupTimings(ids));
}

export const isEmptyDayFlow = (f: DayFlowFacts): boolean => !f.reentries.length && !f.chase.length && !f.giveback && !f.greenToRed && !f.offTiming.length;
