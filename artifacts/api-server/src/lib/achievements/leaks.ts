/**
 * «Закрыл утечку» (PURE, seeded) — a leak of «Где уходят деньги» stops costing money. A leak is a slice of the trader's
 * own trades the edge map (lib/edgeMap.ts, table edge_map) flagged LEAK: hi80(θ) < 0, BH q ≤ 0.10, persistent in 2 of 3
 * 60-day blocks, cost ≥ coach.leakMinUsdPerDay, n ≥ 30 on ≥ 10 days. Slices are observable before the entry (time,
 * session, after a loss, day zone, trade number, price band, side, size, familiarity, rapid entries) — the trader cannot
 * re-tag a trade into or out of one.
 *
 * The window after the FIRST flag decides, with the same statistics as the edge map (bps of notional, winsorized,
 * day-clustered bootstrap, normal–normal shrinkage):
 *
 *   fixed    ≥ leakMinTrades slice trades on ≥ 10 days after the flag, and their θ — shrunk toward the leak's OWN flagged
 *            θ with the desk spread τ of that slice — is no longer negative. Shrinking toward the old loss means a few
 *            lucky trades are not enough: the new evidence must outweigh the history.
 *   avoided  the trader kept trading (≥ 2·leakMinTrades trades on ≥ 20 days after the flag) and the slice's share of
 *            his trades fell to ≤ 25 % of its share before the flag — e.g. no more trades #4–5 of the day. Stopping the
 *            leaking behaviour IS closing the leak; trading less overall is not (the volume gate).
 *   reopened after the closing day, ≥ leakMinTrades slice trades on ≥ 10 days whose θ (shrunk toward 0) has its 80 %
 *            interval below zero: the leak is back. The award stays (earned once) and is shown as lost; it no longer
 *            counts for the capital signal.
 *
 * The edge map itself keeps a closed slice flagged for a while (its window is ~250 trading days and still holds the old
 * trades); the achievement reads the new trades only — the card says so.
 */
import { sliceKeysOf, type EdgeTrade } from "../edgeMap";
import { STATS_SEED, clusterBootstrapMean, rngFor, shrink, winsorBounds } from "../stats";

export type LeakFlag = {
  sliceKey: string;
  /** First and last edge-map run (as-of day) that flagged the slice LEAK. */
  firstFlag: string;
  lastFlag: string;
  /** θ (bps) and the slice prior's τ of the first flagging run. */
  thetaBps: number;
  priorTau: number;
};

export type LeakRules = { minTrades: number; minDays: number };

export type LeakState = {
  sliceKey: string;
  flaggedOn: string;
  closedOn: string | null;
  method: "fixed" | "avoided" | null;
  reopenedOn: string | null;
  /** Slice trades with notional after the flag, their days, and the sample «fixed» needs. */
  progress: { trades: number; days: number; need: number };
  /** θ (bps) of the slice trades after the flag (shrunk toward the flagged θ), null below 2 days. */
  postThetaBps: number | null;
};

const B = 300;
const AVOID_SHARE = 0.25;
const PRE_DAYS = 250;

type Pt = { day: string; x: number | null; inSlice: boolean };

function postEstimate(pts: readonly Pt[], prior: { mu: number; tau: number }, seed: string): { theta: number; hi80: number; n: number; days: number } | null {
  const days = new Map<string, { s: number; n: number }>();
  for (const p of pts) {
    if (!p.inSlice || p.x == null) continue;
    const d = days.get(p.day) ?? { s: 0, n: 0 };
    d.s += p.x;
    d.n += 1;
    days.set(p.day, d);
  }
  if (days.size < 2) return null;
  const list = [...days.values()];
  const boot = clusterBootstrapMean(list.map((d) => d.s), list.map((d) => d.n), rngFor(STATS_SEED, seed, "leak-closed"), B);
  if (!boot) return null;
  const n = list.reduce((s, d) => s + d.n, 0);
  const post = shrink(boot.mean, Math.max(boot.se, 10 / Math.sqrt(n)), prior);
  return { theta: post.theta, hi80: post.hi80, n, days: days.size };
}

/** Points (bps of notional, winsorized at the trader's own ±5 SD) with slice membership for every leak slice. */
export function slicePoints(trades: readonly EdgeTrade[]): { day: string; x: number | null; keys: Set<string> }[] {
  const keys = sliceKeysOf(trades);
  const xs = trades.map((t) => (t.notional != null && t.notional > 0 ? (1e4 * t.net) / t.notional : null));
  const bounds = winsorBounds(xs.filter((x): x is number => x != null), 5);
  return trades
    .map((t, i) => ({ day: t.day, x: xs[i] == null ? null : bounds ? Math.min(bounds.hi, Math.max(bounds.lo, xs[i]!)) : xs[i]!, keys: new Set(keys[i]) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** One leak's state as of the last loaded day. */
export function leakState(flag: LeakFlag, points: ReturnType<typeof slicePoints>, rules: LeakRules, seedKey: string): LeakState {
  const pts: Pt[] = points.map((p) => ({ day: p.day, x: p.x, inSlice: p.keys.has(flag.sliceKey) }));
  const preDays = [...new Set(pts.filter((p) => p.day <= flag.firstFlag).map((p) => p.day))].slice(-PRE_DAYS);
  const pre = pts.filter((p) => p.day >= (preDays[0] ?? flag.firstFlag) && p.day <= flag.firstFlag);
  const preShare = pre.length ? pre.filter((p) => p.inSlice).length / pre.length : 0;
  const post = pts.filter((p) => p.day > flag.firstFlag);
  const postDays = [...new Set(post.map((p) => p.day))];
  const prior = { mu: flag.thetaBps, tau: Math.max(1, flag.priorTau) };
  let closedOn: string | null = null;
  let method: LeakState["method"] = null;
  let checkedAt = -1;
  for (const day of postDays) {
    const upTo = post.filter((p) => p.day <= day);
    const slice = upTo.filter((p) => p.inSlice && p.x != null);
    const sliceDays = new Set(slice.map((p) => p.day)).size;
    const allDays = new Set(upTo.map((p) => p.day)).size;
    if (preShare > 0 && upTo.length >= 2 * rules.minTrades && allDays >= 2 * rules.minDays && slice.length / upTo.length <= AVOID_SHARE * preShare) {
      closedOn = day; method = "avoided"; break;
    }
    // «fixed» is re-tested once the slice sample grew by 5 trades (bootstrap cost), and on the last day.
    if (slice.length >= rules.minTrades && sliceDays >= rules.minDays && (slice.length - checkedAt >= 5 || day === postDays[postDays.length - 1])) {
      checkedAt = slice.length;
      const e = postEstimate(upTo, prior, `${seedKey}|${flag.sliceKey}|${day}`);
      if (e && e.theta >= 0) { closedOn = day; method = "fixed"; break; }
    }
  }
  let reopenedOn: string | null = null;
  if (closedOn) {
    const after = post.filter((p) => p.day > closedOn!);
    const e = postEstimate(after, { mu: 0, tau: prior.tau }, `${seedKey}|${flag.sliceKey}|reopen`);
    if (e && e.n >= rules.minTrades && e.days >= rules.minDays && e.hi80 < 0) reopenedOn = after[after.length - 1]?.day ?? null;
  }
  const sliceAll = post.filter((p) => p.inSlice && p.x != null);
  const est = postEstimate(post, prior, `${seedKey}|${flag.sliceKey}|now`);
  return {
    sliceKey: flag.sliceKey, flaggedOn: flag.firstFlag, closedOn, method, reopenedOn,
    progress: { trades: sliceAll.length, days: new Set(sliceAll.map((p) => p.day)).size, need: rules.minTrades },
    postThetaBps: est ? Math.round(est.theta * 100) / 100 : null,
  };
}

export function leakStates(flags: readonly LeakFlag[], trades: readonly EdgeTrade[], rules: LeakRules, seedKey: string): LeakState[] {
  if (!flags.length) return [];
  const points = slicePoints(trades);
  return flags.map((f) => leakState(f, points, rules, seedKey)).sort((a, b) => a.flaggedOn.localeCompare(b.flaggedOn) || a.sliceKey.localeCompare(b.sliceKey));
}
