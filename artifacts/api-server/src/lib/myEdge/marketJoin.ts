/**
 * «Рынок и мой edge» — the join of each trade (by its ENTRY day and ticker) with the stored market context, and the
 * «Сегодняшний рынок» basis. Pure: the loaders (./load) hand in plain maps.
 */
import {
  MARKET_DIMS, NODATA, PREV_MAX_GAP_DAYS, analystKeyOf, earningsKeyOf, tickerDayContext, tkAtrKeyOf, tkGapKeyOf, tkRvolKeyOf,
  type IndexDay, type MarketDim, type MeDailyBar,
} from "./market";

export type MarketJoinTrade = { id: number; entryDay: string; ticker: string };

export type MarketSources = {
  spy: ReadonlyMap<string, IndexDay>;
  qqq: ReadonlyMap<string, IndexDay>;
  /** Daily bars per ticker (ascending). */
  tickerBars: ReadonlyMap<string, readonly MeDailyBar[]>;
  earnings: { days: ReadonlyMap<string, readonly string[]>; coveredFrom: string | null };
  /** ticker → NY day → actions; a ticker absent from the map was never fetched (nodata). */
  analyst: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  sectors: ReadonlyMap<string, string>;
  themes: ReadonlyMap<string, string>;
};

const or = (v: string | null | undefined) => v ?? NODATA;

/** Market bucket keys of every trade (id → dim → key). */
export function joinMarket(trades: readonly MarketJoinTrade[], src: MarketSources): Map<number, Record<MarketDim, string>> {
  const out = new Map<number, Record<MarketDim, string>>();
  for (const t of trades) {
    const spy = src.spy.get(t.entryDay);
    const qqq = src.qqq.get(t.entryDay);
    const bars = src.tickerBars.get(t.ticker);
    const tk = bars ? tickerDayContext(bars, t.entryDay) : null;
    const rec: Record<MarketDim, string> = {
      spyTrend: or(spy?.trend),
      spyGap: or(spy?.gap),
      spyVol: or(spy?.vol),
      spyPrevVol: or(spy?.prevVol),
      qqqTrend: or(qqq?.trend),
      qqqGap: or(qqq?.gap),
      tkGap: tkGapKeyOf(tk?.gapPct ?? null),
      tkAtr: tkAtrKeyOf(tk?.atrPct ?? null),
      tkRvol: tkRvolKeyOf(tk?.rvol ?? null),
      earnings: earningsKeyOf(t.entryDay, src.earnings.days.get(t.ticker), src.earnings.coveredFrom),
      analyst: analystKeyOf(t.entryDay, src.analyst.get(t.ticker)),
      sector: src.sectors.get(t.ticker) ?? NODATA,
      theme: src.themes.get(t.ticker) ?? "none",
    };
    out.set(t.id, rec);
  }
  return out;
}

export const marketDims = (): readonly MarketDim[] => MARKET_DIMS;

export type TodayBasis =
  | { basis: "gap"; dim: "spyGap"; key: string; asOf: string; gapPct: number | null }
  | { basis: "prevVol"; dim: "spyPrevVol"; key: string; asOf: string; rangeAtr: number | null }
  | { basis: null; dim: null; key: null; asOf: string | null };

/**
 * What is known about today's market before / at the open, from the cache only:
 *   today's SPY session is there (at least the opening bar) → its gap («гэп SPY сегодня»);
 *   else the latest earlier session's volatility (≤ PREV_MAX_GAP_DAYS back), which is today's «prevVol».
 */
export function todayBasis(spy: ReadonlyMap<string, IndexDay>, today: string): TodayBasis {
  const td = spy.get(today);
  if (td?.gap) return { basis: "gap", dim: "spyGap", key: td.gap, asOf: today, gapPct: td.gapPct };
  const last = [...spy.keys()].filter((d) => d < today).sort().pop();
  const ld = last ? spy.get(last) : undefined;
  const fresh = last != null && (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`)) / 86_400_000 <= PREV_MAX_GAP_DAYS;
  if (last && fresh && ld?.vol) return { basis: "prevVol", dim: "spyPrevVol", key: ld.vol, asOf: last, rangeAtr: ld.rangeAtr };
  return { basis: null, dim: null, key: null, asOf: last ?? null };
}
