/**
 * Session flow — client model (pure; tests in model.test.ts). Shapes mirror the API (artifacts/api-server/src/lib/
 * sessionFlow/*, routes/session-flow.ts). `robustEdge` is the same definition as the server's (lib/sessionFlow/flow.ts)
 * for the breakdown rows the analytics tab builds on the client; the opening-window gate uses the server's.
 */
import type { UsdBlock } from "@/components/shared/strategy/model";

export type ReentryBucket = "1" | "2" | "3" | "4+";
export type ReentryRow = UsdBlock & { bucket: ReentryBucket };

export type DayGiveback = {
  day: string; peak: number; close: number; giveback: number; stops: number | null; r: number | null; unit: "stops" | "r" | null; flagged: boolean;
};
export type GreenToRed = {
  day: string; peak: number; sizeRatio: number | null; paceRatio: number | null; material: boolean;
  before: { trades: number; avgNotional: number | null; perHour: number | null };
  after: { trades: number; avgNotional: number | null; perHour: number | null };
};

export type FlowStats = {
  trader: string;
  from: string;
  to: string;
  reentry: ReentryRow[];
  chase: UsdBlock;
  giveback: { threshold: number; flaggedDays: number; days: DayGiveback[] };
  greenToRed: { crossDays: number; materialDays: number; days: GreenToRed[] };
};

export type RobustEdge = {
  n: number;
  net: number;
  /** Net without the 3 best trades. */
  netExTop3: number;
  median: number | null;
  /** Σ of the 3 best trades ÷ the net (null when the net is not positive). */
  top3Share: number | null;
  /** A positive net that rests on its 3 best trades (they are more than all of it, or nothing is left without them). */
  outliers: boolean;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Robustness of a slice from its per-trade nets (same rule as the server's lib/sessionFlow/flow robustEdge). */
export function robustEdge(nets: readonly number[]): RobustEdge {
  const sorted = [...nets].sort((a, b) => b - a);
  const net = r2(sorted.reduce((a, b) => a + b, 0));
  const top3 = sorted.slice(0, 3).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const netExTop3 = r2(net - top3);
  const top3Share = net > 0 ? r2(top3 / net) : null;
  const m = sorted.length >> 1;
  const median = !sorted.length ? null : sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
  return {
    n: sorted.length, net, netExTop3, median: median == null ? null : r2(median), top3Share,
    outliers: net > 0 && ((top3Share != null && top3Share > 1) || netExTop3 <= 0),
  };
}

/** The worst re-entry bucket worth a line (2+ entries, at least 3 trades, losing): the panel's one insight. */
export function reentryInsight(rows: readonly ReentryRow[]): ReentryRow | null {
  return rows.filter((r) => r.bucket !== "1" && r.n >= 3 && (r.net ?? 0) < 0).sort((a, b) => (a.net ?? 0) - (b.net ?? 0))[0] ?? null;
}
