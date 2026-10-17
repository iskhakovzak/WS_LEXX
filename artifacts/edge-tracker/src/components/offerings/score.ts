// Dilution score 0–100 for an intraday trader: how hard can this deal press the stock today?
// Simple, explainable sum of six parts; parts without data drop out and the rest is rescaled.
import type { Tone } from "@/components/ds";
import { kindOf, pctOfMcap, type Offering } from "./types";

export type DealType = "spo" | "direct" | "pipe" | "atm" | "shelf" | "s1" | "ipo";

export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  spo: "SPO",
  direct: "Direct",
  pipe: "PIPE",
  atm: "ATM",
  shelf: "Шелф",
  s1: "S-1",
  ipo: "IPO",
};
export const DEAL_TYPE_HINT: Record<DealType, string> = {
  spo: "Вторичное размещение через андеррайтера (424B): цена известна, оффер — магнит на 1–3 дня",
  direct: "Registered direct / best efforts: продали фондам без шоу — слабый спрос, часто с варрантами",
  pipe: "Частное размещение (PIPE): акции выйдут в рынок после регистрации перепродажи",
  atm: "At-the-market: компания продаёт в рынок по ходу торгов и давит на каждый отскок",
  shelf: "Шелф S-3: денег ещё нет, но навес есть — сделка может выйти в любой день",
  s1: "S-1 у торгуемой компании: нет доступа к S-3, обычно токсичная структура",
  ipo: "Первичное размещение",
};
export const DEAL_TYPE_TONE: Record<DealType, Tone> = {
  spo: "purple",
  direct: "down",
  pipe: "warn",
  atm: "warn",
  shelf: "neutral",
  s1: "accent",
  ipo: "accent",
};

export function dealTypeOf(o: Offering): DealType {
  const k = kindOf(o);
  if (k === "IPO") return "ipo";
  if (k === "ATM") return "atm";
  if (k === "S-3") return "shelf";
  if (k === "S-1") return "s1";
  const f = o.dealFlags ?? [];
  if (f.includes("Registered direct") || f.includes("Best efforts")) return "direct";
  if (f.includes("Частное размещение")) return "pipe";
  return "spo";
}

export function hasWarrants(o: Offering): boolean {
  return (o.dealFlags ?? []).some((f) => f === "Варранты" || f === "Pre-funded");
}

/** Shares offered in days of average volume. */
export function advMultiple(o: Offering): number | null {
  if (o.sharesOffered == null || !o.avgVolume) return null;
  return +(o.sharesOffered / o.avgVolume).toFixed(2);
}

/** Shares offered as % of the float. */
export function pctOfFloat(o: Offering): number | null {
  if (o.sharesOffered == null || !o.floatShares) return null;
  return +((o.sharesOffered / o.floatShares) * 100).toFixed(1);
}

/** Offer vs the last close before the deal (negative = discount). Server value, else derived. */
export function discountOf(o: Offering): number | null {
  if (o.discountPct !== undefined) return o.discountPct ?? null;
  if (o.offerPrice == null || !o.prevClose) return null;
  const d = (o.offerPrice / o.prevClose - 1) * 100;
  return d < -70 || d > 25 ? null : +d.toFixed(1);
}

const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/** Underwriter text from the prospectus parser, or null when it is a sentence fragment rather than a name. */
export function cleanUnderwriter(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 70) return null;
  if (!/^[A-Z0-9]/.test(s)) return null;
  if (MONTHS.test(s)) return null;
  if (/^(the|a|an|our|we|such|this|each|any)\b/i.test(s)) return null;
  if (/\b(fees?|expenses|commissions?|agreement|pursuant|hereby|prospectus|per share|shares of)\b/i.test(s)) return null;
  if (/placement$/i.test(s)) return null;
  return s;
}

export type ScorePartKey = "size" | "liquidity" | "discount" | "type" | "frequency" | "cash";
export type ScorePart = { key: ScorePartKey; label: string; points: number; max: number; detail: string };
export type ScoreLevel = "high" | "medium" | "low";
export type DilutionScore = {
  score: number;
  level: ScoreLevel;
  parts: ScorePart[];
  /** Parts left out for lack of data (labels). */
  missing: string[];
  /** Fewer than half of the weight had data: show the score as approximate. */
  rough: boolean;
};

export const SCORE_LEVEL_LABEL: Record<ScoreLevel, string> = { high: "Сильное", medium: "Среднее", low: "Слабое" };
export const SCORE_LEVEL_TONE: Record<ScoreLevel, Tone> = { high: "down", medium: "warn", low: "up" };

const MAX = { size: 35, liquidity: 15, discount: 15, type: 20, frequency: 10, cash: 10 } as const;
const LABEL: Record<ScorePartKey, string> = {
  size: "Размер к капитализации",
  liquidity: "К флоуту / объёму",
  discount: "Дисконт",
  type: "Тип сделки",
  frequency: "Частота размещений",
  cash: "Деньги и сжигание",
};

const step = (v: number, table: Array<[number, number]>, floor = 0): number => {
  for (const [min, pts] of table) if (v >= min) return pts;
  return floor;
};

const n1 = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

export function dilutionScore(o: Offering): DilutionScore {
  const parts: ScorePart[] = [];
  const missing: string[] = [];
  const type = dealTypeOf(o);
  const add = (key: ScorePartKey, points: number | null, detail: string) => {
    if (points == null) { missing.push(LABEL[key]); return; }
    parts.push({ key, label: LABEL[key], points: Math.min(MAX[key], Math.max(0, Math.round(points))), max: MAX[key], detail });
  };

  // 1. Size vs market cap. A shelf is capacity, not a sale — half weight.
  const pct = pctOfMcap(o);
  if (pct == null) add("size", null, "");
  else {
    const pts = step(pct, [[50, 35], [30, 30], [20, 25], [10, 18], [5, 10], [2, 5]], 2);
    add("size", type === "shelf" ? pts / 2 : pts,
      `${pct > 1000 ? ">1000" : n1(pct)}% мкап${type === "shelf" ? " (ёмкость шелфа, вес ½)" : ""}`);
  }

  // 2. Supply vs float, else vs average daily volume.
  const fl = pctOfFloat(o);
  const adv = advMultiple(o);
  if (fl != null) add("liquidity", step(fl, [[50, 15], [25, 12], [10, 8], [5, 4]], 1), `${n1(fl)}% флоута${adv != null ? ` · ${n1(adv)}× ср. объёма` : ""}`);
  else if (adv != null) add("liquidity", step(adv, [[5, 15], [2, 10], [1, 6], [0.5, 3]], 1), `${n1(adv)}× среднего дневного объёма`);
  else add("liquidity", null, "");

  // 3. Discount to the last close (ATM sells at market: small constant pressure).
  const disc = discountOf(o);
  if (type === "atm") add("discount", 3, "по рынку, без дисконта — давление на отскоках");
  else if (type === "shelf" || type === "ipo" || disc == null) add("discount", null, "");
  else if (disc >= 0) add("discount", 0, `премия ${n1(disc)}% к закрытию`);
  else add("discount", step(-disc, [[25, 15], [15, 12], [10, 9], [5, 5]], 2), `${n1(-disc)}% к закрытию`);

  // 4. Deal type (+ warrants).
  const typePts: Record<DealType, number> = { direct: 18, s1: 18, atm: 16, pipe: 14, spo: 12, shelf: 6, ipo: 5 };
  const w = hasWarrants(o) && type !== "shelf" && type !== "ipo";
  const baby = type === "shelf" && !!o.babyShelf;
  add("type", typePts[type] + (w ? 4 : 0) + (baby ? 2 : 0),
    `${DEAL_TYPE_LABEL[type]}${w ? " + варранты" : ""}${baby ? " · baby shelf" : ""}`);

  // 5. How often the company comes to market.
  const prior = o.priorOfferings12m;
  if (prior == null) add("frequency", null, "");
  else add("frequency", step(prior, [[3, 10], [2, 7], [1, 4]], 0), prior === 0 ? "первое размещение за 12 мес" : `ещё ${prior} за 12 мес до этой`);

  // 6. Cash runway: a company that burns cash will be back.
  if (o.burnM === 0) add("cash", 0, "операционный денежный поток положительный");
  else if (o.runwayMonths != null) add("cash", step(-o.runwayMonths, [[-6, 10], [-12, 7], [-24, 4]], 1),
    `денег на ~${o.runwayMonths < 10 ? o.runwayMonths.toFixed(1) : Math.round(o.runwayMonths)} мес${o.cashM != null ? ` (кэш ${o.cashM >= 10 ? Math.round(o.cashM) : o.cashM.toFixed(1)}M)` : ""}`);
  else add("cash", null, "");

  const got = parts.reduce((s, p) => s + p.points, 0);
  const max = parts.reduce((s, p) => s + p.max, 0);
  const score = max ? Math.round((got / max) * 100) : 0;
  return {
    score,
    level: score >= 65 ? "high" : score >= 40 ? "medium" : "low",
    parts,
    missing,
    rough: max < 50,
  };
}
