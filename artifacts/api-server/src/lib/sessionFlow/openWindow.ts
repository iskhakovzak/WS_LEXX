/**
 * The opening window 09:30–10:00 as its own risk zone (pure; tests in __tests__/gates.test.ts).
 *
 *   openWindowEdge(history)   the trader's trades entered in the window (timing open30): count, net and the robust
 *                             net without the three best trades (./flow robustEdge)
 *   openWindowState(input)    the window's loss limit today: the risk desk's own per-trader limit when set, else the
 *                             stage share of the daily limit (flow.openShare*, lower for juniors). The stage default
 *                             LIFTS by itself once the edge in the window is proven (≥ flow.openLiftMinTrades trades
 *                             and a positive net without the top 3); a limit the risk desk set by hand stays.
 *   openWindowBreach(day, …)  the first exit before 10:00 at which the realised net of the window's trades reached
 *                             −limit (the leak guard's open_window event: no entries until 10:00)
 */
import { robustEdge, type RobustEdge } from "./flow";
import { inOpenWindow, timingOf } from "./timing";
import { round2, type FlowTrade } from "./types";

export type Stage = "junior" | "trader" | "senior";

export type OpenWindowCfg = { shares: Record<Stage, number>; liftMinTrades: number };

export type OpenWindowEdge = Pick<RobustEdge, "n" | "net" | "netExTop3" | "outliers">;

const inWindow = (t: FlowTrade) => {
  const tm = timingOf(t);
  return tm === "open30" || (tm == null && inOpenWindow(t.entrySec));
};

export function openWindowEdge(history: readonly FlowTrade[]): OpenWindowEdge {
  const nets = history.filter((t) => inWindow(t) && t.net != null && t.result !== "open").map((t) => t.net!);
  const r = robustEdge(nets);
  return { n: r.n, net: r.net, netExTop3: r.netExTop3, outliers: r.outliers };
}

export type OpenWindowState = {
  /** The window's loss limit in $ today; null = none (lifted, or no daily limit to take a share of). */
  limitUsd: number | null;
  /** own = set by the risk desk for this trader; stage = the stage share of the daily limit. */
  source: "own" | "stage" | null;
  share: number | null;
  /** The stage default would apply but the edge in the window is proven. */
  lifted: boolean;
  /** What the stage default would be (shown next to «lifted»). */
  stageLimitUsd: number | null;
  edge: OpenWindowEdge;
  liftMinTrades: number;
};

export function openWindowState(input: {
  stage: Stage; dailyLimit: number | null; ownLimit: number | null; edge: OpenWindowEdge; cfg: OpenWindowCfg;
}): OpenWindowState {
  const { cfg, edge } = input;
  const share = cfg.shares[input.stage];
  const daily = input.dailyLimit != null && input.dailyLimit > 0 ? input.dailyLimit : null;
  const stageLimitUsd = daily != null && share > 0 ? round2(daily * share) : null;
  const proven = edge.n >= cfg.liftMinTrades && edge.netExTop3 > 0;
  const base = { stageLimitUsd, edge, liftMinTrades: cfg.liftMinTrades };
  if (input.ownLimit != null && input.ownLimit > 0) return { ...base, limitUsd: round2(input.ownLimit), source: "own", share: null, lifted: false };
  if (stageLimitUsd == null) return { ...base, limitUsd: null, source: null, share, lifted: false };
  if (proven) return { ...base, limitUsd: null, source: "stage", share, lifted: true };
  return { ...base, limitUsd: stageLimitUsd, source: "stage", share, lifted: false };
}

export type OpenWindowBreach = { at: number; tradeId: number; loss: number };

/** The first exit (≤ windowEndAt) at which the window trades' realised net reached −limit; null when it never did. */
export function openWindowBreach(dayTrades: readonly FlowTrade[], limitUsd: number | null, windowEndAt: number): OpenWindowBreach | null {
  if (limitUsd == null || !(limitUsd > 0)) return null;
  const closed = dayTrades
    .filter((t) => inWindow(t) && t.net != null && t.exitAt != null && t.exitAt <= windowEndAt && t.result !== "open")
    .sort((a, b) => a.exitAt! - b.exitAt! || a.id - b.id);
  let cum = 0;
  for (const t of closed) {
    cum += t.net!;
    if (cum <= -limitUsd) return { at: t.exitAt!, tradeId: t.id, loss: round2(-cum) };
  }
  return null;
}
