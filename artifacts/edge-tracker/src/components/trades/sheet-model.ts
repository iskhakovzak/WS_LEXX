/**
 * Small pure helpers of the trade sheet and the review list (split out of trade-utils.ts): an estimated broker stop,
 * the fees share of gross and the linked playbook setup.
 */
import type { Trade } from "@workspace/api-client-react";
import { fmtRate } from "@/lib/format";
import { isBrokerTrade } from "./trade-utils";

/**
 * The stored stop is a guess, not the trader's: a broker trade whose stop equals its exit price (the import fills the
 * stop from the exit when none was sent), so its R is −1R / +1R by construction (MAKSIM-25). Shown as «оценка».
 */
export function stopIsEstimate(t: Pick<Trade, "source" | "stop" | "exit">): boolean {
  if (!isBrokerTrade(t) || t.stop == null || t.exit == null) return false;
  const stop = Number(t.stop), exit = Number(t.exit);
  return Number.isFinite(stop) && Number.isFinite(exit) && stop > 0 && Math.abs(stop - exit) < 1e-6;
}

/** Fees as a share of gross: null without a positive gross; above 100 % it reads «>100%» (gross near 0 gave «1,609%»). */
export function feeShareText(fees: number | null | undefined, gross: number | null | undefined): { text: string; share: number } | null {
  if (fees == null || gross == null || !(gross > 0) || !(fees > 0)) return null;
  const share = fees / gross;
  return { share, text: share > 1 ? `>${fmtRate(1)}` : fmtRate(share) };
}

/** Playbook setup id the trade is linked to (`playbook_id`), when the API sends it. */
export function linkedPlaybookId(trade: Trade): number | null {
  const v = (trade as Trade & { playbookId?: number | string | null }).playbookId;
  const n = v == null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
