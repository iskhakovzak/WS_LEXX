/**
 * Algo rating + dilution risk of an offering row and the offer-price sanity check (moved out of routes/offerings.ts).
 * Pure: no network, no DB.
 */
import { offeringsT } from "../i18n/ns";
import type { Lang } from "../i18n";
import type { FactorItem, Offering, OfferingBase, RiskLevel } from "./offeringsTypes";

export const factorText = (it: FactorItem, lang: Lang) => offeringsT.tryFor(lang, it.k, it.p) ?? it.k;

// ── Underwriter tier (for algo rating) ───────────────────────────────────────

const TIER1_UW = ["Goldman", "Morgan Stanley", "JPMorgan", "J.P. Morgan", "Bank of America", "BofA", "Citigroup", "Citi", "Barclays", "Credit Suisse", "Deutsche Bank", "UBS"];
const TIER2_UW = ["Jefferies", "Piper Sandler", "Oppenheimer", "Needham", "Cowen", "Canaccord", "Stifel", "Raymond James", "RBC", "Guggenheim", "William Blair", "Baird", "Truist"];

function uwTier(uw: string | null): 1 | 2 | 3 {
  if (!uw) return 3;
  if (TIER1_UW.some(t => uw.includes(t))) return 1;
  if (TIER2_UW.some(t => uw.includes(t))) return 2;
  return 3;
}

// ── Algo rating ───────────────────────────────────────────────────────────────

/**
 * Dilution risk 0–100 for holders (overnight/swing) and short-side ideas:
 * size vs market cap, structure (ATM / shelf / warrants / registered direct), cap size, price vs offer.
 */
function computeRisk(o: OfferingBase): { dilutionRisk: number; riskLevel: RiskLevel; riskFactors: string[]; riskFactorItems: FactorItem[] } {
  let s = 15;
  const f: FactorItem[] = [];
  const pct = Math.max(o.offerPctOfMcap ?? 0, o.dilutionPct ?? 0);
  if (pct > 30) { s += 40; f.push({ k: "risk.size", p: { pct: pct.toFixed(0) } }); }
  else if (pct > 15) { s += 28; f.push({ k: "risk.size", p: { pct: pct.toFixed(0) } }); }
  else if (pct > 7) { s += 15; f.push({ k: "risk.size", p: { pct: pct.toFixed(1) } }); }
  else if (pct > 3) { s += 6; f.push({ k: "risk.size", p: { pct: pct.toFixed(1) } }); }

  if (o.kind === "ATM") { s += 15; f.push({ k: "risk.atm" }); }
  else if (o.kind === "S-3") {
    if (o.form?.toUpperCase().includes("ASR")) { s -= 10; f.push({ k: "risk.wksi" }); }
    else { s += 10; f.push({ k: "risk.newShelf" }); }
  } else if (o.kind === "S-1" && o.currentPrice != null) { s += 18; f.push({ k: "risk.s1" }); }

  if (o.babyShelf) { s += 6; f.push({ k: "risk.babyShelf" }); }
  if (o.marketCapM != null) {
    if (o.marketCapM < 50) { s += 20; f.push({ k: "risk.micro", p: { cap: o.marketCapM.toFixed(0) } }); }
    else if (o.marketCapM < 300) { s += 10; f.push({ k: "risk.small", p: { cap: o.marketCapM.toFixed(0) } }); }
    else if (o.marketCapM > 10_000) { s -= 15; f.push({ k: "risk.mega" }); }
  }
  if (o.dealFlags.includes("warrants")) { s += 12; f.push({ k: "risk.warrants" }); }
  if (o.dealFlags.includes("Pre-funded")) s += 5;
  if (o.dealFlags.includes("Registered direct") || o.dealFlags.includes("Best efforts")) { s += 10; f.push({ k: "risk.direct" }); }
  if (o.sellerType === "insiders" || o.sellerType === "mixed") { s += 5; f.push({ k: "risk.insiders" }); }
  if (o.priceChangePct != null && o.offerPrice != null) {
    if (o.priceChangePct > 20) { s += 8; f.push({ k: "risk.aboveOffer", p: { pct: o.priceChangePct.toFixed(0) } }); }
    else if (o.priceChangePct < -10) { f.push({ k: "risk.broken", p: { pct: o.priceChangePct.toFixed(0) } }); }
  }
  const dilutionRisk = Math.max(0, Math.min(100, Math.round(s)));
  const riskLevel: RiskLevel = dilutionRisk >= 60 ? "high" : dilutionRisk >= 35 ? "medium" : "low";
  return { dilutionRisk, riskLevel, riskFactors: f.map((it) => factorText(it, "ru")), riskFactorItems: f };
}

export function finalize(base: OfferingBase): Offering {
  const offerPctOfMcap = base.marketCapM && base.marketCapM > 0
    ? (base.dealSizeM ?? base.shelfCapacityM) != null
      ? +((((base.dealSizeM ?? base.shelfCapacityM) as number) / base.marketCapM) * 100).toFixed(1)
      : null
    : null;
  const babyShelf = (base.kind === "S-3" || base.kind === "ATM") && base.marketCapM != null && base.marketCapM < 75;
  const withDerived: OfferingBase = {
    ...base,
    offerPctOfMcap,
    babyShelf,
    babyShelfLimitM: babyShelf && base.marketCapM != null ? +(base.marketCapM / 3).toFixed(1) : null,
  };
  const { rating, factors } = computeRating(withDerived);
  return { ...withDerived, rating, ratingFactors: factors.map((it) => factorText(it, "ru")), ratingFactorItems: factors, ...computeRisk(withDerived) };
}

function computeRating(o: OfferingBase): { rating: number; factors: FactorItem[] } {
  let score = 50;
  const factors: FactorItem[] = [];

  // Price vs offer — biggest signal
  if (o.priceChangePct !== null) {
    if (o.priceChangePct > 30) { score += 25; factors.push({ k: "rating.strongStart", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else if (o.priceChangePct > 15) { score += 18; factors.push({ k: "rating.aboveOffer", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else if (o.priceChangePct > 5) { score += 10; factors.push({ k: "rating.aboveOffer", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else if (o.priceChangePct >= -5) { factors.push({ k: "rating.atOffer", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else if (o.priceChangePct < -20) { score -= 25; factors.push({ k: "rating.farBelow", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else if (o.priceChangePct < -10) { score -= 15; factors.push({ k: "rating.below", p: { pct: o.priceChangePct.toFixed(1) } }); }
    else { score -= 6; factors.push({ k: "rating.weakStart", p: { pct: o.priceChangePct.toFixed(1) } }); }
  }

  // Dilution
  if (o.dilutionPct !== null) {
    if (o.dilutionPct > 40) { score -= 18; factors.push({ k: "rating.dilCritical", p: { pct: o.dilutionPct.toFixed(1) } }); }
    else if (o.dilutionPct > 20) { score -= 10; factors.push({ k: "rating.dilHigh", p: { pct: o.dilutionPct.toFixed(1) } }); }
    else if (o.dilutionPct > 10) { score -= 4; factors.push({ k: "rating.dilModerate", p: { pct: o.dilutionPct.toFixed(1) } }); }
    else if (o.dilutionPct < 5 && o.dilutionPct > 0) { score += 8; factors.push({ k: "rating.dilLow", p: { pct: o.dilutionPct.toFixed(1) } }); }
  }

  // Who sells
  if (o.sellerType === "insiders") { score -= 22; factors.push({ k: "rating.insiders" }); }
  else if (o.sellerType === "mixed") { score -= 10; factors.push({ k: "rating.mixed" }); }
  else if (o.sellerType === "company") { score += 10; factors.push({ k: "rating.company" }); }

  // Volume relative
  if (o.relVol !== null) {
    if (o.relVol > 5) { score += 15; factors.push({ k: "rating.volExtreme", p: { x: o.relVol.toFixed(1) } }); }
    else if (o.relVol > 3) { score += 10; factors.push({ k: "rating.volHigh", p: { x: o.relVol.toFixed(1) } }); }
    else if (o.relVol > 1.5) { score += 5; factors.push({ k: "rating.volHigh", p: { x: o.relVol.toFixed(1) } }); }
    else if (o.relVol < 0.5) { score -= 10; factors.push({ k: "rating.volLow" }); }
  }

  // Offering type
  if (o.type === "IPO") { score += 5; factors.push({ k: "rating.ipo" }); }
  else if (o.type === "Bought Deal") { score += 8; factors.push({ k: "rating.bought" }); }
  else if (o.type === "ATM") { score -= 12; factors.push({ k: "rating.atm" }); }
  else if (o.type === "SPAC") { score -= 5; factors.push({ k: "rating.spac" }); }

  // Underwriter quality
  const tier = uwTier(o.underwriter);
  if (tier === 1) { score += 8; factors.push({ k: "rating.uw1", p: { name: String(o.underwriter) } }); }
  else if (tier === 2) { score += 4; factors.push({ k: "rating.uw2", p: { name: String(o.underwriter) } }); }

  // Lockup
  if (o.lockupDays !== null) {
    if (o.lockupDays < 60) { score -= 8; factors.push({ k: "rating.lockShortest", p: { days: o.lockupDays } }); }
    else if (o.lockupDays <= 90) { score -= 4; factors.push({ k: "rating.lockShort", p: { days: o.lockupDays } }); }
    else if (o.lockupDays >= 180) { score += 3; factors.push({ k: "rating.lockStandard", p: { days: o.lockupDays } }); }
  }

  // Deal size
  if (o.dealSizeM !== null) {
    if (o.dealSizeM > 1000) { score += 10; factors.push({ k: "rating.dealBig", p: { b: (o.dealSizeM / 1000).toFixed(1) } }); }
    else if (o.dealSizeM > 200) { score += 6; factors.push({ k: "rating.deal", p: { m: o.dealSizeM.toFixed(0) } }); }
    else if (o.dealSizeM < 15) { score -= 6; factors.push({ k: "rating.dealSmall", p: { m: o.dealSizeM.toFixed(0) } }); }
  }

  return { rating: Math.max(0, Math.min(100, Math.round(score))), factors };
}

/** Highest dilution risk first, then rating (the order of GET /offerings/watch). */
export const byRiskThenRating = (a: Pick<Offering, "dilutionRisk" | "rating">, b: Pick<Offering, "dilutionRisk" | "rating">) =>
  b.dilutionRisk - a.dilutionRisk || b.rating - a.rating;

/** Offer vs the last close, %: outside this window the parsed offer price is almost surely wrong (warrant / pre-split price). */
export const OFFER_DISCOUNT_MIN = -70;
export const OFFER_DISCOUNT_MAX = 25;

/**
 * Discount of the offer to the last close. `suspect`: true = the price is outside the window (rejected), false = it
 * passed, null = cannot judge (no offer price or no close).
 */
export function offerDiscount(offerPrice: number | null | undefined, prevClose: number | null | undefined): { discountPct: number | null; suspect: boolean | null } {
  if (offerPrice == null || !prevClose) return { discountPct: null, suspect: null };
  const d = ((offerPrice / prevClose) - 1) * 100;
  return d >= OFFER_DISCOUNT_MIN && d <= OFFER_DISCOUNT_MAX ? { discountPct: +d.toFixed(2), suspect: false } : { discountPct: null, suspect: true };
}

/** Current price vs the offer, % (same formula as the market-data enrichment). */
export function changeVsOffer(currentPrice: number | null | undefined, offerPrice: number | null | undefined): number | null {
  return currentPrice && offerPrice ? +((((currentPrice - offerPrice) / offerPrice) * 100).toFixed(2)) : null;
}

/**
 * Sets discountPct in place and keeps a rejected offer price out of the scores: when the price is rejected,
 * priceChangePct becomes null, the row is marked `offerPriceSuspect` and rating / risk are recomputed (`rescore`,
 * normally finalize) — so «−84 % к офферу» moves neither. A later accepted check (a better close) undoes it.
 * Returns true when the scores were recomputed.
 */
export function applyOfferPriceCheck<T extends Offering>(o: T, rescore: (o: T) => Partial<Offering>): boolean {
  const { discountPct, suspect } = offerDiscount(o.offerPrice, o.prevClose);
  o.discountPct = discountPct;
  if (suspect == null || suspect === (o.offerPriceSuspect === true)) return false;
  if (suspect) {
    o.offerPriceSuspect = true;
    o.priceChangePct = null;
  } else {
    delete o.offerPriceSuspect;
    o.priceChangePct = changeVsOffer(o.currentPrice, o.offerPrice);
  }
  Object.assign(o, rescore(o));
  return true;
}
