/**
 * Snapshot-first fundamentals (owner item 4): offerings, watchlist score and the ticker fundamentals behind the
 * watchlist / catalyst (events) forms read float, short float, sector, market cap, ATR, volumes from the Finviz
 * snapshot when it is fresh (desk setting finviz.snapshotMaxAgeDays, default 3), and fall back to their old source
 * (Yahoo / ticker_data_cache) only when the snapshot is missing or stale. Never throws: a DB problem = no snapshot.
 */
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { readSnapshots, type SnapshotFull } from "./read";

export async function freshSnapshots(tickers: readonly string[]): Promise<Map<string, SnapshotFull>> {
  if (!tickers.length) return new Map();
  try {
    return await readSnapshots(tickers, setting("finviz.snapshotMaxAgeDays"));
  } catch (err) {
    logger.warn({ err }, "finviz: snapshot read failed — old source used");
    return new Map();
  }
}

export async function freshSnapshot(ticker: string): Promise<SnapshotFull | null> {
  const t = ticker.toUpperCase();
  return (await freshSnapshots([t])).get(t) ?? null;
}

type OfferingLike = { ticker: string; floatShares?: number | null; shortPctFloat?: number | null; sector: string | null; marketCapM: number | null };

/**
 * Offerings (routes/offerings.ts augment): float / short float from the snapshot, sector and market cap where the
 * quote left them empty — in place. Returns the tickers the snapshot covered (Yahoo must not overwrite those).
 */
export async function overlaySnapshots(list: OfferingLike[]): Promise<Set<string>> {
  const covered = new Set<string>();
  const m = await freshSnapshots(list.map((o) => o.ticker.toUpperCase()));
  for (const o of list) {
    const s = m.get(o.ticker.toUpperCase());
    if (!s) continue;
    covered.add(o.ticker);
    o.floatShares = s.float;
    o.shortPctFloat = s.shortFloatPct;
    o.sector ??= s.sector;
    if (o.marketCapM == null && s.marketCap != null) o.marketCapM = +(s.marketCap / 1e6).toFixed(1);
  }
  return covered;
}

/** «15.2M»-style text the old fundamentals API returns (marketDataService formatLargeNumber). */
export function largeNumberText(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(n);
}

/** Snapshot → the TickerFundamentals shape of lib/marketDataService (GET /api/stockdata/fundamentals). */
export function fundamentalsFromSnapshot(s: SnapshotFull) {
  return {
    ticker: s.ticker,
    marketCap: largeNumberText(s.marketCap),
    float: largeNumberText(s.float ?? s.sharesOutstanding),
    sharesOutstanding: largeNumberText(s.sharesOutstanding),
    shortInterest: s.shortFloatPct,
    atr: s.atr,
    relativeVolume: s.relVolume,
    beta: s.beta,
    averageDailyVolume: largeNumberText(s.avgVolume),
    sector: s.sector,
    industry: s.industry,
    longName: s.company ?? s.ticker,
  };
}
