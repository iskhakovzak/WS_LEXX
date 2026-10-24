/**
 * The one fee rule (roadmap R2), shared by the daily engine «day:fees» (lib/daily/detectors), the curator queue «fees»
 * (lib/daily/costQueue) and the day report «fee_over_gross» (lib/dayReport). Light module: settings only.
 *
 *   flagged  fees ≥ max(minUsd, share × max(gross, 0))  — a day / week with gross ≤ 0 counts: the fees bought nothing
 *   cost     −(fees − healthyShare × max(gross, 0))      — what trading less would have saved, not every cent
 *
 * Thresholds are desk settings (daily.feesShare / feesHealthyShare / feesMinUsd / feesWeeklyMinUsd).
 */
import { setting } from "./settings/registry";

export type FeeShares = { feesShare: number; feesHealthyShare: number };

/** The shares now in force (the healthy share never above the mistake share: a fee day never «earns»). */
export function feeShares(): FeeShares {
  const share = setting("daily.feesShare");
  return { feesShare: share, feesHealthyShare: Math.min(setting("daily.feesHealthyShare"), share) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The daily minimum (daily.feesMinUsd). */
export const feeMinUsd = (): number => setting("daily.feesMinUsd");

/** Cost (≤ 0) of the fees of a day / week, or null when they are not a problem. */
export function feeCost(gross: number, fees: number, minUsd: number, k: FeeShares = feeShares()): number | null {
  const g = Math.max(gross, 0);
  const f = Math.abs(fees);
  if (!(f > 0) || f < Math.max(minUsd, k.feesShare * g)) return null;
  return round2(-(f - k.feesHealthyShare * g));
}
