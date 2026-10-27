/**
 * «Мой edge» — the four answers of routes/my-edge, composed from the loaders (./load) and the pure parts
 * (./facts, ./rows, ./market, ./marketJoin, ./compare). A short in-process cache keyed by the request keeps a tab
 * switch from recomputing the bootstraps.
 */
import { UNKNOWN } from "../tradeFacetBuckets";
import { addDays, nyDate } from "../tradingDate";
import { OUTCOME_DIMS, STRENGTH_DIMS, strengthKeys, type MeTrade } from "./facts";
import { buildRows, rankRows, type MeCoverage, type MeRow, type MeRowTrade } from "./rows";
import { MARKET_DIMS, MARKET_EOD_DIMS, NODATA, classifyIndexDays, type IndexDay, type MarketDim } from "./market";
import { joinMarket, todayBasis, type TodayBasis } from "./marketJoin";
import { compareSelf, type CompareResult } from "./compare";
import {
  loadAnalyst, loadEarnings, loadIndexDaily, loadMeTrades, loadSectors, loadThemes, loadTickerDaily, type MeLoadFilters,
} from "./load";

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: now, value });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return value;
}

const rowTrade = (t: MeTrade): MeRowTrade => ({ id: t.id, day: t.day, net: t.net, win: t.net > 0 ? true : t.net < 0 ? false : null });

export type Totals = { trades: number; days: number; net: number; perDay: number | null };

function totalsOf(trades: readonly MeTrade[]): Totals {
  const days = new Set(trades.map((t) => t.day)).size;
  const net = Math.round(trades.reduce((s, t) => s + t.net, 0) * 100) / 100;
  return { trades: trades.length, days, net, perDay: days ? Math.round((net / days) * 100) / 100 : null };
}

export type StrengthsAnswer = {
  source: "my-edge";
  trader: string;
  typicalDay: number;
  totals: Totals;
  rows: MeRow[];
  strengths: MeRow[];
  leaks: MeRow[];
  coverage: MeCoverage[];
};

export function strengths(trader: string, f: MeLoadFilters, key: string): Promise<StrengthsAnswer> {
  return cached(`s|${key}`, async () => {
    const all = await loadMeTrades(trader, f);
    const { keys, D } = strengthKeys(all);
    const passing = all.filter((t) => t.pass);
    const { rows, coverage } = buildRows({
      trades: passing.map(rowTrade), dims: STRENGTH_DIMS, keyOf: (id, dim) => keys.get(id)?.[dim] ?? UNKNOWN,
      skip: new Set([UNKNOWN]), outcomeDims: OUTCOME_DIMS,
    });
    const ranked = rankRows(rows);
    return { source: "my-edge", trader, typicalDay: D, totals: totalsOf(passing), rows, ...ranked, coverage };
  });
}

async function indexDays(symbol: string, from: string, to: string): Promise<Map<string, IndexDay>> {
  return classifyIndexDays(await loadIndexDaily(symbol, addDays(from, -45), to));
}

/** The feeds behind each market dimension (the «что улучшит» note names the missing ones). */
export const MARKET_FEEDS: Record<MarketDim, string> = {
  spyTrend: "spyBars", spyGap: "spyBars", spyVol: "spyBars", spyPrevVol: "spyBars", qqqTrend: "qqqBars", qqqGap: "qqqBars",
  tkGap: "tickerBars", tkAtr: "tickerBars", tkRvol: "tickerBars", earnings: "earnings", analyst: "analyst", sector: "sector", theme: "themes",
};
/** Not stored anywhere in the app today — they would sharpen this block. */
export const MISSING_FEEDS = ["vix", "sectorEtfDaily", "premarketVolume", "spyDailyHistory"] as const;

export type MarketAnswer = {
  trader: string;
  totals: Totals;
  rows: MeRow[];
  coverage: MeCoverage[];
  eodDims: string[];
  missingFeeds: string[];
};

export function market(trader: string, f: MeLoadFilters, key: string): Promise<MarketAnswer> {
  return cached(`m|${key}`, async () => {
    const passing = (await loadMeTrades(trader, f)).filter((t) => t.pass);
    const days = passing.map((t) => t.entryDay).sort();
    const from = days[0] ?? nyDate();
    const to = days[days.length - 1] ?? nyDate();
    const tickers = [...new Set(passing.map((t) => t.ticker).filter(Boolean))];
    const [spy, qqq, tickerBars, earnings, analyst, sectors, themes] = await Promise.all([
      indexDays("SPY", from, to), indexDays("QQQ", from, to),
      loadTickerDaily(passing.map((t) => ({ ticker: t.ticker, day: t.entryDay }))),
      loadEarnings(tickers), loadAnalyst(tickers), loadSectors(tickers), loadThemes(),
    ]);
    const keys = joinMarket(passing, { spy, qqq, tickerBars, earnings, analyst, sectors, themes });
    const { rows, coverage } = buildRows({
      trades: passing.map(rowTrade), dims: MARKET_DIMS, keyOf: (id, dim) => keys.get(id)?.[dim] ?? NODATA,
      skip: new Set([NODATA]), outcomeDims: MARKET_EOD_DIMS,
    });
    const weak = new Set(coverage.filter((c) => c.total && c.known / c.total < 0.6).map((c) => MARKET_FEEDS[c.dim as MarketDim]));
    return {
      trader, totals: totalsOf(passing), rows, coverage, eodDims: [...MARKET_EOD_DIMS],
      missingFeeds: [...MISSING_FEEDS, ...[...weak].map((w) => `${w}:partial`)],
    };
  });
}

export type CompareAnswer = CompareResult & { trader: string; window: { from: string; to: string; prevFrom: string; prevTo: string } };

export function compare(trader: string, f: MeLoadFilters, prev: { from: string; to: string }, key: string): Promise<CompareAnswer> {
  return cached(`c|${key}|${prev.from}|${prev.to}`, async () => {
    const [cur, before] = await Promise.all([loadMeTrades(trader, f), loadMeTrades(trader, { ...f, from: prev.from, to: prev.to })]);
    const toC = (t: MeTrade) => ({ day: t.day, net: t.net, gross: t.gross, fees: t.fees, holdSec: t.holdSec, overnight: t.overnight });
    const res = compareSelf(cur.filter((t) => t.pass).map(toC), before.filter((t) => t.pass).map(toC), { seed: trader });
    return { ...res, trader, window: { from: f.from ?? "", to: f.to ?? "", prevFrom: prev.from, prevTo: prev.to } };
  });
}

/** History length behind «Сегодняшний рынок» (calendar days). */
export const TODAY_HISTORY_DAYS = 365;

export type TodayAnswer = {
  trader: string;
  today: string;
  basis: TodayBasis;
  /** The trader's row for today's bucket (null: no history / no market data). */
  row: MeRow | null;
  /** Every bucket of the same dimension (context: «в другие дни …»). */
  siblings: MeRow[];
  coverage: MeCoverage | null;
  historyFrom: string;
};

export function today(trader: string, now = new Date()): Promise<TodayAnswer> {
  const day = nyDate(now);
  return cached(`t|${trader}|${day}`, async () => {
    const historyFrom = addDays(day, -TODAY_HISTORY_DAYS);
    const [spy, trades] = await Promise.all([indexDays("SPY", historyFrom, day), loadMeTrades(trader, { from: historyFrom, to: day })]);
    const basis = todayBasis(spy, day);
    if (!basis.dim) return { trader, today: day, basis, row: null, siblings: [], coverage: null, historyFrom };
    const dim = basis.dim;
    const byId = new Map(trades.map((t) => [t.id, t] as const));
    const { rows, coverage } = buildRows({
      trades: trades.map(rowTrade), dims: [dim],
      keyOf: (id) => {
        const t = byId.get(id);
        const d = t ? spy.get(t.entryDay) : undefined;
        return (dim === "spyGap" ? d?.gap : d?.prevVol) ?? NODATA;
      },
      skip: new Set([NODATA]),
    });
    return { trader, today: day, basis, row: rows.find((r) => r.key === basis.key) ?? null, siblings: rows, coverage: coverage[0] ?? null, historyFrom };
  });
}
