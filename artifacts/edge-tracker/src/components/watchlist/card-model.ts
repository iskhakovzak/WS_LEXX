/**
 * Phone cards of the watchlist (Волна 2 п. 2.11) — pure view model, unit-tested in card-model.test.ts. Below `sm`
 * every row is a card (no 1000 px table): ticker + price + day % on top, a 3-cell strip gap / rVol / ATR %, then the
 * nearest level and the own history. The same thresholds as the table: |gap| ≥ 3 % and rVol ≥ 1.5 are highlighted.
 */
import type { EarningsHit, KeyLevel, ListName, NewsDigest, Plan, Quote, WatchlistItem } from "./lib";
import type { DayLevelSet, UpcomingEarnings } from "./use-market";
import type { TickerHistory } from "./use-history";

/** One prepared row: the watchlist item plus everything the table / the card shows next to it. */
export type WlRow = {
  item: WatchlistItem;
  /** Working list; null = archived. */
  list: ListName | null;
  quote?: Quote;
  plan: Plan;
  levels: DayLevelSet | null | undefined;
  keys: KeyLevel[];
  history?: TickerHistory;
  earnings?: EarningsHit;
  upcoming?: UpcomingEarnings;
  news?: NewsDigest;
  /** Temporary optimistic row (being created). */
  pending?: boolean;
};

export type CardMetric = { value: number | null; strong: boolean };

export type CardFacts = {
  price: number | null;
  change: number | null;
  gap: CardMetric;
  rvol: CardMetric;
  /** ATR as % of the price. */
  atrPct: CardMetric;
};

const GAP_STRONG = 3;
const RVOL_STRONG = 1.5;

export function cardFacts(q: Quote | undefined): CardFacts {
  const gap = q?.gapPct ?? null;
  const rvol = q?.relativeVolume ?? null;
  const atrPct = q?.atr != null && q.price ? (q.atr / q.price) * 100 : null;
  return {
    price: q?.price ?? null,
    change: q?.change ?? null,
    gap: { value: gap, strong: gap != null && Math.abs(gap) >= GAP_STRONG },
    rvol: { value: rvol, strong: rvol != null && rvol >= RVOL_STRONG },
    atrPct: { value: atrPct, strong: false },
  };
}
