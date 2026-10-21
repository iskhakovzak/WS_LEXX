/**
 * Offering row shapes of GET /offerings/watch (moved out of routes/offerings.ts, which re-exports them). Types only.
 */
import type { Reaction, Session } from "./offeringReaction";

export type OfferingType = "IPO" | "Follow-on" | "ATM" | "Bought Deal" | "SPAC" | "Shelf" | "Other";
export type SellerType = "company" | "insiders" | "mixed" | "unknown";
/** Filing bucket for the dilution dashboard: priced takedown (424B), ATM program, shelf (S-3/F-3), registration (S-1/F-1), IPO. */
export type FilingKind = "IPO" | "424B" | "ATM" | "S-3" | "S-1";
export type RiskLevel = "high" | "medium" | "low";

export type Offering = {
  ticker: string;
  company: string;
  type: OfferingType;
  date: string;
  offerPrice: number | null;
  currentPrice: number | null;
  priceChangePct: number | null;
  dealSizeM: number | null;
  sharesOffered: number | null;
  sharesOutstandingBefore: number | null;
  sharesOutstandingAfter: number | null;
  dilutionPct: number | null;
  sellerType: SellerType;
  insiderShares: number | null;
  companyShares: number | null;
  underwriter: string | null;
  lockupDays: number | null;
  volume: number | null;
  avgVolume: number | null;
  relVol: number | null;
  marketCapM: number | null;
  sector: string | null;
  rating: number;
  ratingFactors: string[];
  /** ratingFactors as data (offerings namespace `rating.*`), re-rendered per request language. */
  ratingFactorItems?: FactorItem[];
  status: "upcoming" | "priced" | "trading" | "withdrawn" | "filed";
  source: "nasdaq" | "edgar";
  // ── Dilution-dashboard fields (additive) ──
  kind: FilingKind;
  /** Raw SEC form (424B5, S-3, S-1/A…) or "IPO" for the NASDAQ calendar. */
  form: string | null;
  filingUrl: string | null;
  cik: string | null;
  exchange: string | null;
  /** NASDAQ price range text for upcoming IPOs ("10.00-12.00"). */
  priceRange: string | null;
  /** Registered shelf / program size, $M (S-3 base shelf, ATM program). */
  shelfCapacityM: number | null;
  /** Small-cap S-3 (public float < $75M) can sell at most 1/3 of float per 12 months (General Instruction I.B.6). */
  babyShelf: boolean;
  babyShelfLimitM: number | null;
  /** Offering (or shelf) size as % of current market cap. */
  offerPctOfMcap: number | null;
  dealFlags: string[];
  dilutionRisk: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  /** riskFactors as data (offerings namespace `risk.*`). */
  riskFactorItems?: FactorItem[];
  // ── Intraday-trader fields (additive, optional: filled by augmentOfferings) ──
  /** SEC acceptance time, New York wall clock ("2026-10-15 16:31"). */
  acceptedAt?: string | null;
  session?: Session | null;
  /** First session that trades the deal (after-close acceptance → next weekday). */
  reactionDate?: string | null;
  /** Priced takedowns (424B1/4/5/7) in the 12 months before this one. */
  priorOfferings12m?: number | null;
  /** Close before the reaction session; discount = offer / prevClose − 1. */
  prevClose?: number | null;
  discountPct?: number | null;
  /**
   * The parsed offer price is outside −70 %…+25 % of the last close (warrant / pre-split price): it is shown muted and
   * moves neither rating nor risk (priceChangePct = null). See lib/offeringsScore applyOfferPriceCheck.
   */
  offerPriceSuspect?: boolean;
  /** Daily reaction on the reaction session (live = today, bar still forming). */
  reaction?: (Pick<Reaction, "gapPct" | "o2cPct" | "dayPct" | "lowFromOpenPct" | "highFromOpenPct" | "relVol"> & { live: boolean }) | null;
  floatShares?: number | null;
  cashM?: number | null;
  /** Monthly operating cash burn, $M (0 = cash-flow positive). */
  burnM?: number | null;
  runwayMonths?: number | null;
  shortPctFloat?: number | null;
};

export type IpoCalendarItem = {
  ticker: string;
  company: string;
  date: string;
  status: "upcoming" | "priced" | "filed" | "withdrawn";
  priceRange: string | null;
  offerPrice: number | null;
  sharesOffered: number | null;
  dealSizeM: number | null;
  exchange: string | null;
};

export type OfferingBase = Omit<Offering, "rating" | "ratingFactors" | "ratingFactorItems" | "dilutionRisk" | "riskLevel" | "riskFactors" | "riskFactorItems">;

/** A factor as data: key in the `offerings` namespace + params. */
export type FactorItem = { k: string; p?: Record<string, string | number> };
