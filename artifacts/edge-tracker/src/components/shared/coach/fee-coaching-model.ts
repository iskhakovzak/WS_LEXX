/**
 * Fee-aware coaching (roadmap R2), pure: the API shapes (api lib/feeModel, lib/breakeven, lib/feeModelStore) and what
 * the weekly fee card says. Task framing: what costs money and one rule to test — never a verdict on the trader.
 */
import { PRICE_BUCKETS } from "@/lib/trade-facets";
import { encodeRules } from "@/components/shared/what-if-rules";

export type FeeBandRow = {
  band: string; trades: number; days: number; shares: number; gross: number; fees: number; net: number;
  feeShareOfGross: number | null; fps: number | null; gps: number | null; ratio: number | null; gpsHi80: number | null; flagged: boolean;
};
export type FeeModel = { bands: FeeBandRow[]; total: FeeBandRow; flagged: string[] };
export type EdgeMargin = { wins: number; losses: number; winRate: number; avgWin: number; avgLoss: number; breakevenWr: number; marginPp: number };
export type FeeCoaching = { window: { from: string | null; to: string; days: number }; model: FeeModel; breakeven: EdgeMargin | null };

/** The card shows up from this share of the gross (or with a flagged band). */
export const CARD_MIN_SHARE = 0.25;

/** «$10–20», «< $5», «> $200» for a trade-facet price band key. */
export function bandLabel(key: string): string {
  const i = PRICE_BUCKETS.findIndex((b) => b.key === key);
  if (i < 0) return key;
  const hi = PRICE_BUCKETS[i].before;
  const lo = i > 0 ? PRICE_BUCKETS[i - 1].before : null;
  if (lo == null) return `< $${hi}`;
  if (!Number.isFinite(hi)) return `> $${lo}`;
  return `$${lo}–${hi}`;
}

export type FeeCard = {
  /** Fees ÷ gross of the window (null when the gross is ≤ 0). */
  share: number | null;
  fees: number;
  gross: number;
  days: number;
  /** The worst flagged band (lowest gross ÷ fees per share). */
  band: { key: string; label: string; ratio: number; loses: boolean } | null;
  /** The «price ≥ $X» rule to test (the upper bound of that band), null for the top band. */
  minPrice: number | null;
};

/** What the weekly card says; null when fees are not a problem worth a card. */
export function feeCardOf(fc: FeeCoaching | null | undefined): FeeCard | null {
  if (!fc || fc.model.total.trades === 0) return null;
  const t = fc.model.total;
  const worst = fc.model.bands.filter((b) => b.flagged && b.ratio != null).sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))[0] ?? null;
  const share = t.feeShareOfGross;
  const heavy = share == null ? t.fees > 0 : share >= CARD_MIN_SHARE;
  if (!worst && !heavy) return null;
  const upper = worst ? PRICE_BUCKETS.find((b) => b.key === worst.band)?.before ?? null : null;
  return {
    share, fees: t.fees, gross: t.gross, days: fc.window.days,
    band: worst ? { key: worst.band, label: bandLabel(worst.band), ratio: worst.ratio ?? 0, loses: (worst.ratio ?? 0) < 1 } : null,
    minPrice: upper != null && Number.isFinite(upper) ? upper : null,
  };
}

/** The what-if link that tests the card's price rule on the trader's own trades. */
export function priceRuleHref(minPrice: number, trader?: string | null): string {
  const sp = new URLSearchParams({ r: encodeRules([{ type: "priceRange", min: minPrice, max: null }]) });
  if (trader) sp.set("trader", trader);
  return `/what-if?${sp.toString()}`;
}
