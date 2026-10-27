/**
 * Setup mastery by a CONFIRMED edge (PURE, seeded) — bronze / silver / gold per playbook setup, granted when the setup's
 * edge is statistically confirmed, never by a count of trades. The same honest estimate as the capital engine
 * (lib/capital/edge.ts) and the edge map (lib/edgeMap.ts):
 *
 *   x       net bps of notional per trade, 1e4 · (pnl − |fees|) / (qty × entry) — comparable across sizes; R is used
 *           instead when ≥ 80 % of the setup's trades carry one (stops are rare in the broker data)
 *   x̄, se   day-clustered bootstrap (trades of one day are not independent), a noise floor on se
 *   θ       shrunk toward ZERO (normal–normal) with the fallback desk spread τ: a short lucky run counts as no edge
 *   window  the last `windowDays` trading days of the trader up to the checkpoint (250 ≈ one year, as the edge map)
 *
 *   bronze  n ≥ masteryTrades1 on ≥ 10 days and the 80 % interval of θ above zero
 *   silver  n ≥ masteryTrades2 on ≥ 20 days and the 90 % interval above zero, and the whole book's θ not negative
 *   gold    n ≥ masteryTrades3 on ≥ 30 days, the 95 % interval above zero, the book not negative, and the most recent
 *           60-trading-day block of the setup positive (the edge still works now)
 *
 * Anti-gaming: the trader tags his own trades with a setup, so every tier also needs the tag coverage — the share of the
 * trader's closed trades in the window that carry ANY setup — at least `masteryTagShare` (tagging only the winners is
 * not possible without tagging the losers too), and silver / gold need the whole book's edge not to be negative.
 *
 * Decay: the tier HELD now is evaluated at `asOf`; a stored higher tier that no longer holds is shown as lost (the
 * earned day stays — history is honest), and only the held tier feeds the capital signal. Earned days are the first
 * month-end checkpoint (or asOf) at which the tier held.
 */
import { STATS_SEED, clusterBootstrapMean, rngFor, shrink, winsorBounds } from "../stats";
import type { AchievementTier } from "../quests/types";

export type MasteryTrade = { day: string; net: number; notional: number | null; r: number | null; setupId: number | null };

export type MasteryRules = { trades: readonly [number, number, number]; tagShare: number; windowDays: number; tauBps: number; tauR: number };

export type MasteryEstimate = { metric: "bps" | "r"; n: number; days: number; theta: number; sd: number; lo80: number; lo90: number; lo95: number; recent: number | null };

export type SetupMasteryState = {
  setupId: number;
  /** Tier held at asOf (null = none). */
  held: AchievementTier | null;
  /** First checkpoint each tier held (null = never in the loaded history). */
  earnedOn: Record<"bronze" | "silver" | "gold", string | null>;
  estimate: MasteryEstimate | null;
  /** Tag coverage of the trader's book in the window at asOf (0..1). */
  tagShare: number;
};

const Z90 = 1.6449;
const Z95 = 1.96;
const B = 500;
const SE_FLOOR_BPS = 10;
const SE_FLOOR_R = 1;
const BLOCK_DAYS = 60;
export const MASTERY_TIERS = ["bronze", "silver", "gold"] as const;
const MIN_DAYS = [10, 20, 30] as const;

type Unit = { day: string; x: number };

function unitsOf(trades: readonly MasteryTrade[]): { units: Unit[]; metric: "bps" | "r" } {
  const withR = trades.filter((t) => t.r != null && Number.isFinite(t.r));
  if (trades.length > 0 && withR.length >= 0.8 * trades.length) return { units: withR.map((t) => ({ day: t.day, x: t.r! })), metric: "r" };
  const units = trades.filter((t) => t.notional != null && t.notional > 0).map((t) => ({ day: t.day, x: (1e4 * t.net) / t.notional! }));
  return { units, metric: "bps" };
}

/** Shrunk estimate of the mean per trade over the units (null with fewer than 2 days). */
export function estimateOf(trades: readonly MasteryTrade[], rules: Pick<MasteryRules, "tauBps" | "tauR">, seedKey: string): MasteryEstimate | null {
  const { units, metric } = unitsOf(trades);
  const days = new Map<string, { s: number; n: number }>();
  const xs = units.map((u) => u.x);
  const bounds = metric === "bps" ? winsorBounds(xs, 5) : null;
  for (const u of units) {
    const x = bounds ? Math.min(bounds.hi, Math.max(bounds.lo, u.x)) : u.x;
    const d = days.get(u.day) ?? { s: 0, n: 0 };
    d.s += x;
    d.n += 1;
    days.set(u.day, d);
  }
  if (days.size < 2) return null;
  const list = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  const boot = clusterBootstrapMean(list.map(([, d]) => d.s), list.map(([, d]) => d.n), rngFor(STATS_SEED, seedKey, "mastery"), B);
  if (!boot) return null;
  const n = units.length;
  const se = Math.max(boot.se, (metric === "r" ? SE_FLOOR_R : SE_FLOOR_BPS) / Math.sqrt(n));
  const p = shrink(boot.mean, se, { mu: 0, tau: metric === "r" ? rules.tauR : rules.tauBps });
  const recentDays = list.slice(-BLOCK_DAYS);
  const rs = recentDays.reduce((a, [, d]) => ({ s: a.s + d.s, n: a.n + d.n }), { s: 0, n: 0 });
  return {
    metric, n, days: days.size, theta: p.theta, sd: p.sdPost, lo80: p.lo80, lo90: p.theta - Z90 * p.sdPost, lo95: p.theta - Z95 * p.sdPost,
    recent: rs.n ? rs.s / rs.n : null,
  };
}

/** The highest tier the estimate supports (null = none). `book` = the whole book's estimate (silver / gold need θ ≥ 0). */
export function tierOf(e: MasteryEstimate | null, book: MasteryEstimate | null, tagShare: number, rules: MasteryRules): AchievementTier | null {
  if (!e || tagShare < rules.tagShare) return null;
  const okAt = (k: 0 | 1 | 2) => e.n >= rules.trades[k] && e.days >= MIN_DAYS[k];
  const bookOk = !book || book.theta >= 0;
  if (okAt(2) && e.lo95 > 0 && bookOk && e.recent != null && e.recent > 0) return "gold";
  if (okAt(1) && e.lo90 > 0 && bookOk) return "silver";
  if (okAt(0) && e.lo80 > 0) return "bronze";
  return null;
}

/** The trader's trading days up to `asOf`, newest last. */
const tradingDays = (trades: readonly MasteryTrade[], asOf: string) => [...new Set(trades.map((t) => t.day).filter((d) => d <= asOf))].sort();

/** Month-end checkpoints between the first trade and asOf, plus asOf. */
export function checkpoints(days: readonly string[], asOf: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (i === days.length - 1 || days[i + 1]!.slice(0, 7) !== d.slice(0, 7)) out.add(d);
  }
  out.add(asOf);
  return [...out].filter((d) => d <= asOf).sort();
}

type Snapshot = { tiers: Map<number, AchievementTier | null>; estimates: Map<number, MasteryEstimate | null>; tagShare: number };

function snapshotAt(trades: readonly MasteryTrade[], at: string, rules: MasteryRules, setups: readonly number[], final: boolean): Snapshot {
  const days = tradingDays(trades, at);
  const from = days[Math.max(0, days.length - rules.windowDays)] ?? at;
  const win = trades.filter((t) => t.day >= from && t.day <= at);
  const tagShare = win.length ? win.filter((t) => t.setupId != null).length / win.length : 0;
  const tiers = new Map<number, AchievementTier | null>();
  const estimates = new Map<number, MasteryEstimate | null>();
  const bySetup = new Map(setups.map((id) => [id, win.filter((t) => t.setupId === id)]));
  // Below the bronze sample no tier can hold: the bootstrap runs only at asOf (the card shows the numbers so far).
  if (!final && ![...bySetup.values()].some((l) => l.length >= rules.trades[0])) return { tiers, estimates, tagShare };
  const book = estimateOf(win, rules, `book|${at}`);
  for (const id of setups) {
    const list = bySetup.get(id)!;
    if (!final && list.length < rules.trades[0]) { tiers.set(id, null); estimates.set(id, null); continue; }
    const e = estimateOf(list, rules, `setup|${id}|${at}`);
    estimates.set(id, e);
    tiers.set(id, tierOf(e, book, tagShare, rules));
  }
  return { tiers, estimates, tagShare };
}

const rank = (t: AchievementTier | null) => (t ? MASTERY_TIERS.indexOf(t as (typeof MASTERY_TIERS)[number]) : -1);

/** Every setup the trader tagged: the tier held at asOf and the first checkpoint each tier held. */
export function setupMastery(trades: readonly MasteryTrade[], asOf: string, rules: MasteryRules): SetupMasteryState[] {
  const setups = [...new Set(trades.map((t) => t.setupId).filter((x): x is number => x != null))].sort((a, b) => a - b);
  if (!setups.length) return [];
  const earned = new Map(setups.map((id) => [id, { bronze: null, silver: null, gold: null } as SetupMasteryState["earnedOn"]]));
  let last: Snapshot | null = null;
  for (const at of checkpoints(tradingDays(trades, asOf), asOf)) {
    const snap = snapshotAt(trades, at, rules, setups, at === asOf);
    for (const id of setups) {
      const r = rank(snap.tiers.get(id) ?? null);
      const e = earned.get(id)!;
      for (let k = 0; k <= r; k++) e[MASTERY_TIERS[k]!] ??= at;
    }
    last = snap;
  }
  return setups.map((id) => ({
    setupId: id,
    held: last?.tiers.get(id) ?? null,
    earnedOn: earned.get(id)!,
    estimate: last?.estimates.get(id) ?? null,
    tagShare: last?.tagShare ?? 0,
  }));
}
