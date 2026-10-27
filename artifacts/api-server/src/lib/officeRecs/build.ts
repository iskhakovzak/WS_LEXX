/**
 * All generators in one pass (pure): the window, the edge trades, then every generator; the result is ordered so the
 * first card of each kind comes before the second card of any kind (variety first), kinds in KIND_ORDER.
 */
import type { EdgeTrade } from "../edgeMap";
import type { FeeModelOpts } from "../feeModel";
import type { SimTrade } from "../whatIfTypes";
import { deskCrowding, deskFees } from "./fees";
import { deskLeaks, topPractices } from "./leaks";
import { curatorAttention, readinessPipeline, type AttentionInput, type ReadinessRow } from "./people";
import { deskRegimeLeaks } from "./regime";
import { juniorCostRecs } from "./juniorCost";
import type { FactorResult } from "../juniorCost/attribution";
import { deskRules } from "./rules";
import { windowDays } from "./slices";
import { REC_WINDOW_DAYS, type OfficeRec, type RecKind } from "./types";

export const KIND_ORDER: readonly RecKind[] = ["rule", "leak", "regime", "attention", "readiness", "juniorCost", "fees", "crowding", "practice"];

export type BuildInput = {
  asOf: string;
  sim: readonly SimTrade[];
  edge: readonly EdgeTrade[];
  edgeLeaks?: ReadonlyMap<string, readonly string[]>;
  attention?: AttentionInput | null;
  readiness?: readonly ReadinessRow[] | null;
  /** NY day → desk regime key (desk_regime_days) for «в боковике деск теряет». */
  regimes?: ReadonlyMap<string, string>;
  /** «Что окупается» of «Цена джуна до безубытка» (lib/juniorCost) — at most one staff card. */
  juniorCost?: readonly FactorResult[] | null;
  /** Bootstrap draws (tests use fewer). */
  B?: number;
  fee?: FeeModelOpts;
};

export type BuildResult = { asOf: string; window: { from: string; to: string; days: number }; recs: OfficeRec[] };

export function orderRecs(recs: readonly OfficeRec[]): OfficeRec[] {
  const rank = new Map<string, number>();
  const seen = new Map<RecKind, number>();
  const byPriority = [...recs].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const r of byPriority) {
    const k = seen.get(r.kind) ?? 0;
    seen.set(r.kind, k + 1);
    rank.set(r.id, k * 100 + KIND_ORDER.indexOf(r.kind));
  }
  return byPriority.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
}

export function buildDeskRecs(x: BuildInput): BuildResult {
  const days = windowDays(x.sim.map((t) => ({ day: t.closeDay ?? t.day })), x.asOf, REC_WINDOW_DAYS);
  const from = days[0] ?? x.asOf;
  const to = days[days.length - 1] ?? x.asOf;
  const inWin = new Set(days);
  const sim = x.sim.filter((t) => inWin.has(t.closeDay ?? t.day));
  const edge = x.edge.filter((t) => inWin.has(t.day));
  const ctx = { days, from, to, B: x.B };
  const recs: OfficeRec[] = [
    ...deskLeaks(edge, ctx, x.edgeLeaks),
    ...topPractices(edge, ctx),
    ...(x.regimes?.size ? deskRegimeLeaks(edge, x.regimes, { from, to, B: x.B }) : []),
    ...deskRules(sim, { from, to, iters: x.B ? Math.min(400, x.B) : 400 }),
    ...deskFees(sim, { from, to, days: days.length, B: x.B, fee: x.fee }),
    ...deskCrowding(sim, { from, to, days: days.length, B: x.B }),
    ...(x.attention ? curatorAttention(x.attention, { from, to }) : []),
    ...(x.readiness ? readinessPipeline(x.readiness, { from, to }) : []),
    ...(x.juniorCost ? juniorCostRecs(x.juniorCost, { from, to }) : []),
  ];
  return { asOf: x.asOf, window: { from, to, days: days.length }, recs: orderRecs(recs) };
}
