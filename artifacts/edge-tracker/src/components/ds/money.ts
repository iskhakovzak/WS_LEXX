/**
 * Money colours with the «Вид» break-even range (lib/appearance/be-range): a dollar result inside ±range reads as
 * break-even (the --be colour), everything else as up / down. Presentation only — never feed these into analytics.
 *   const range = useBeRange();                      // re-renders when the range changes
 *   <span className={moneyText(net, range)}>…</span>
 */
import * as React from "react";
import { classifyPnl, getBeRange, subscribeBeRange, type PnlClass } from "@/lib/appearance/be-range";

export function useBeRange(): number {
  return React.useSyncExternalStore(subscribeBeRange, getBeRange, getBeRange);
}

const TEXT: Record<PnlClass, string> = {
  win: "text-up",
  loss: "text-down",
  be: "text-be",
  flat: "text-foreground",
  none: "text-muted-foreground",
};

/** Text colour class for a dollar result. */
export function moneyText(usd: number | null | undefined, beRange: number = getBeRange()): string {
  return TEXT[classifyPnl(usd, beRange)];
}

const TINT: Record<PnlClass, (k: number) => string> = {
  win: (k) => (k > 0.66 ? "bg-up/30" : k > 0.33 ? "bg-up/20" : "bg-up/10"),
  loss: (k) => (k > 0.66 ? "bg-down/30" : k > 0.33 ? "bg-down/20" : "bg-down/10"),
  be: () => "bg-be/15",
  flat: () => "",
  none: () => "",
};

/** Calendar cell tint for a dollar result; `k` 0…1 is the size relative to the period's largest day. */
export function moneyTint(usd: number | null | undefined, k: number, beRange: number = getBeRange()): string {
  return TINT[classifyPnl(usd, beRange)](k);
}
