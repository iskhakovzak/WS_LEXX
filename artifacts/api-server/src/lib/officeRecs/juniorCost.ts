/**
 * Staff-only generator (pure): «окупается» — the one practice from «Цена джуна до безубытка» (lib/juniorCost/attribution)
 * whose juniors reached breakeven cheaper and not slower, past the small-sample gate (status not «low»). At most one card:
 * the largest price difference. $ go in `…Usd` params (partners only — redact.ts strips them for curators), the unit-free
 * twin in `rel` (the difference as a share of the other group's median price).
 */
import type { FactorResult } from "../juniorCost/attribution";
import { round, ticksOf, type RawRec } from "./types";

export function juniorCostRecs(factors: readonly FactorResult[], period: { from: string; to: string }): RawRec[] {
  const best = factors
    .filter((f) => f.verdict === "pays" && f.status !== "low" && f.costDiff && f.no.medianCost && f.no.medianCost > 0)
    .sort((a, b) => a.costDiff!.point - b.costDiff!.point)[0];
  if (!best) return [];
  const c = best.costDiff!;
  const base = best.no.medianCost!;
  const q = best.q ?? 1;
  return [{
    id: `juniorCost:${best.factor}`, kind: "juniorCost", audience: "staff",
    priority: 30 + Math.min(30, Math.abs(c.point) / 100),
    confidence: ticksOf(q, c.hi < 0),
    params: {
      factor: best.factor, threshold: best.threshold, yes: best.yes.juniors, no: best.no.juniors,
      days: best.daysDiff ? Math.abs(Math.round(best.daysDiff.point)) : null,
      costDiffUsd: round(Math.abs(c.point), 0), costLoUsd: round(c.lo, 0), costHiUsd: round(c.hi, 0),
    },
    money: null,
    rel: { mean: round(c.point / base, 4), lo: round(c.lo / base, 4), hi: round(c.hi / base, 4), unit: "share" },
    // The groups are named in the why line («8 против 8»); no per-person list for a desk practice.
    affected: { count: 0, names: [] },
    action: { kind: "office", href: "/office#office-juniors" }, secondary: null,
    basis: { trades: 0, days: 0, traders: best.yes.juniors + best.no.juniors, from: period.from, to: period.to, q: best.q },
  }];
}
