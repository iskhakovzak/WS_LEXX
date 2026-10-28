/**
 * Pod stats (pure): per member and for the pod — the sum and the median of the members — on the shared core metrics
 * (lib/coreMetrics: winRateOf, roundShare). Members' rows come from the store already summed per trader (net $ =
 * netPnlSql, wins / losses = resultSql, R = signedRSql).
 *
 * Privacy (lib/moneyVisibility, owner decision 9): staff see every dollar. A trader sees the dollars of his own row
 * only; other members' rows keep counts, win rate and R. The pod's $ sum is shown to a trader only when at least
 * DESK_AGGREGATE_MIN_TRADERS members traded (a sum over two people gives the other one away); the $ median is never
 * shown to a trader (the median of 2–4 values IS one member's value) — the R and win-rate medians are.
 */
import { perTrade, roundShare, winRateOf } from "../coreMetrics";
import { canSeeDeskAggregate, redactOthersMoney } from "../moneyVisibility";

export type MemberTotals = {
  trader: string;
  trades: number;
  wins: number;
  losses: number;
  /** Σ net $ of the window (null when the trader has no trade with $). */
  net: number | null;
  /** Σ signed R over trades that have R, and how many had it. */
  sumR: number;
  rTrades: number;
};

export type MemberRow = MemberTotals & { winRate: number | null; avgR: number | null };
export type PodStats = {
  members: MemberRow[];
  /** Members with at least one trade in the window. */
  active: number;
  sum: { trades: number; wins: number; losses: number; winRate: number | null; net: number | null };
  median: { trades: number | null; winRate: number | null; avgR: number | null; net: number | null };
  /** false = the $ sum is hidden for this viewer (too few active members). */
  netVisible: boolean;
};

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const money = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/** The pod's stats as `viewer` may see them (`staff` = curator / admin). */
export function podStats(totals: readonly MemberTotals[], viewer: string | null, staff: boolean): PodStats {
  const rows: MemberRow[] = totals.map((t) => ({
    ...t, net: money(t.net), winRate: roundShare(winRateOf(t.wins, t.losses), 3), avgR: roundShare(perTrade(t.sumR, t.rTrades), 2),
  }));
  const active = rows.filter((r) => r.trades > 0);
  const wins = active.reduce((a, r) => a + r.wins, 0);
  const losses = active.reduce((a, r) => a + r.losses, 0);
  const nets = active.map((r) => r.net).filter((v): v is number => v != null);
  const netVisible = canSeeDeskAggregate(staff, active.length);
  return {
    members: redactOthersMoney(rows, viewer, staff),
    active: active.length,
    sum: {
      trades: active.reduce((a, r) => a + r.trades, 0), wins, losses, winRate: roundShare(winRateOf(wins, losses), 3),
      net: netVisible && nets.length ? money(nets.reduce((a, b) => a + b, 0)) : null,
    },
    median: {
      trades: median(active.map((r) => r.trades)),
      winRate: roundShare(median(active.map((r) => r.winRate).filter((v): v is number => v != null)), 3),
      avgR: roundShare(median(active.map((r) => r.avgR).filter((v): v is number => v != null)), 2),
      net: staff ? money(median(nets)) : null,
    },
    netVisible,
  };
}
