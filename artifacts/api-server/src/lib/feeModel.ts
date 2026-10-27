/**
 * Per-trader fee model (roadmap R2.2): fees scale with shares, not with edge, so a thin edge on cheap stocks turns
 * net-negative. Over a rolling window (coach.feeWindowDays, 60) and per price band of the entry (the trade-facet price
 * bands, lib/tradeFacetBuckets):
 *
 *   fps    = Σ fees / Σ shares          (fees per share)
 *   gps    = Σ gross / Σ shares         (gross per share)
 *   ratio  = gps / fps                  (< 1: the band pays more in fees than it earns gross)
 *   gpsHi80 = upper 80 % bound of gps   (day-clustered bootstrap, lib/stats/dayBootstrap, seeded)
 *
 * A band is FLAGGED when n ≥ coach.feeBandMinTrades (30), ratio < coach.feeBandRatioMin (1.5) and gpsHi80 <
 * ratioMin × fps: even the optimistic bound of its gross does not clear the fees comfortably. Pure; money in $.
 */
import { PRICE_BUCKETS, UNKNOWN, priceKeyOf } from "./tradeFacetBuckets";
import { setting } from "./settings/registry";
import { COACH_SEED, dayClusterQuantile } from "./stats/dayBootstrap";

export type FeeModelTrade = { day: string; entry: number | null; qty: number | null; gross: number | null; fees: number };

export type FeeBandRow = {
  /** Price band key (tradeFacetBuckets PRICE_BUCKETS: lt5 | 5-10 | …) or "all". */
  band: string;
  trades: number;
  days: number;
  shares: number;
  gross: number;
  fees: number;
  net: number;
  /** Σ fees / Σ gross when the gross is positive, else null («gross ≤ 0»). */
  feeShareOfGross: number | null;
  fps: number | null;
  gps: number | null;
  ratio: number | null;
  gpsHi80: number | null;
  flagged: boolean;
};

export type FeeModel = { bands: FeeBandRow[]; total: FeeBandRow; flagged: string[] };

export type FeeModelOpts = { minTrades?: number; ratioMin?: number; iters?: number; seed?: number };

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r2 = (v: number) => Math.round(v * 100) / 100;

function bandRow(band: string, trades: readonly FeeModelTrade[], o: Required<FeeModelOpts>, bootstrap: boolean): FeeBandRow {
  const byDay = new Map<string, { gross: number; shares: number }>();
  let shares = 0, gross = 0, fees = 0;
  for (const t of trades) {
    const q = Math.abs(t.qty ?? 0);
    shares += q; gross += t.gross ?? 0; fees += Math.abs(t.fees);
    const d = byDay.get(t.day) ?? { gross: 0, shares: 0 };
    d.gross += t.gross ?? 0; d.shares += q;
    byDay.set(t.day, d);
  }
  const fps = shares > 0 ? fees / shares : null;
  const gps = shares > 0 ? gross / shares : null;
  const ratio = fps != null && fps > 0 && gps != null ? gps / fps : null;
  const hi = bootstrap ? dayClusterQuantile([...byDay.values()].map((d) => ({ num: d.gross, den: d.shares })), 0.9, o.iters, o.seed) : null;
  const flagged = bootstrap && trades.length >= o.minTrades && ratio != null && ratio < o.ratioMin && fps != null && hi != null && hi < o.ratioMin * fps;
  return {
    band, trades: trades.length, days: byDay.size, shares: Math.round(shares), gross: r2(gross), fees: r2(fees), net: r2(gross - fees),
    feeShareOfGross: gross > 0 ? r4(fees / gross) : null,
    fps: fps == null ? null : r4(fps), gps: gps == null ? null : r4(gps), ratio: ratio == null ? null : r2(ratio),
    gpsHi80: hi == null ? null : r4(hi), flagged,
  };
}

/** The model of `trades` (closed trades with a gross; open ones are skipped by the caller). */
export function buildFeeModel(trades: readonly FeeModelTrade[], opts: FeeModelOpts = {}): FeeModel {
  const o: Required<FeeModelOpts> = {
    minTrades: opts.minTrades ?? setting("coach.feeBandMinTrades"),
    ratioMin: opts.ratioMin ?? setting("coach.feeBandRatioMin"),
    iters: opts.iters ?? 1000,
    seed: opts.seed ?? COACH_SEED,
  };
  const priced = trades.filter((t) => t.gross != null);
  const groups = new Map<string, FeeModelTrade[]>();
  for (const t of priced) {
    const k = priceKeyOf(t.entry);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const order = [...PRICE_BUCKETS.map((b) => b.key), UNKNOWN];
  const bands = order.filter((k) => groups.has(k)).map((k) => bandRow(k, groups.get(k)!, o, k !== UNKNOWN));
  return { bands, total: bandRow("all", priced, o, false), flagged: bands.filter((b) => b.flagged).map((b) => b.band) };
}

/** The worst flagged band (lowest ratio) — the one a coaching card names; null when none is flagged. */
export function worstBand(m: FeeModel): FeeBandRow | null {
  return m.bands.filter((b) => b.flagged).sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))[0] ?? null;
}
