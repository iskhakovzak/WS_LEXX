import { pool } from "@workspace/db";
import { logger } from "./logger";

type TickerCacheRow = {
  market_cap: string | number | null;
  float: string | number | null;
  average_daily_volume: string | number | null;
  atr: string | number | null;
  relative_volume: string | number | null;
  sector: string | null;
  // ticker_data_cache.raw is written by marketDataService as { quote, summary, chart },
  // where `quote` is the Yahoo v7 quote object. Older rows may carry price at the top level.
  raw: {
    price?: number;
    regularMarketPrice?: number;
    quote?: { regularMarketPrice?: number; [k: string]: unknown } | null;
    [k: string]: unknown;
  } | null;
};

export type ScoreInputs = {
  hasCatalyst: boolean;
  floatScore: number;
  atrScore: number;
  rVolScore: number;
  sectorStrengthScore: number;
  liquidityScore: number;
};

export type ScoreBreakdown = {
  total: number;
  components: {
    catalyst: { weight: number; raw: number; weighted: number; reason: string };
    float: { weight: number; raw: number; weighted: number; reason: string };
    atr: { weight: number; raw: number; weighted: number; reason: string };
    relativeVolume: { weight: number; raw: number; weighted: number; reason: string };
    sectorStrength: { weight: number; raw: number; weighted: number; reason: string };
    liquidity: { weight: number; raw: number; weighted: number; reason: string };
  };
};

const WEIGHTS = {
  catalyst: 25,
  float: 15,
  atr: 15,
  relativeVolume: 20,
  sectorStrength: 15,
  liquidity: 10,
};

function parseNumeric(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,]/g, "").trim();
  if (!s) return null;
  let mult = 1;
  const last = s.slice(-1).toUpperCase();
  let body = s;
  if (last === "B") { mult = 1_000_000_000; body = s.slice(0, -1); }
  else if (last === "M") { mult = 1_000_000; body = s.slice(0, -1); }
  else if (last === "K") { mult = 1_000; body = s.slice(0, -1); }
  const n = Number(body);
  return Number.isFinite(n) ? n * mult : null;
}

function scoreFloat(floatRaw: unknown): { raw: number; reason: string } {
  const v = parseNumeric(floatRaw);
  if (v == null) return { raw: 50, reason: "no float data (neutral)" };
  if (v < 2_000_000) return { raw: 100, reason: "<2M (extremely low)" };
  if (v < 10_000_000) return { raw: 90, reason: "<10M (low)" };
  if (v < 30_000_000) return { raw: 75, reason: "<30M (mid-low)" };
  if (v < 100_000_000) return { raw: 55, reason: "<100M (mid)" };
  if (v < 500_000_000) return { raw: 35, reason: "<500M (high)" };
  return { raw: 15, reason: ">500M (very high)" };
}

function scoreAtr(atr: unknown, price: unknown): { raw: number; reason: string } {
  const a = parseNumeric(atr);
  const p = parseNumeric(price);
  if (a == null) return { raw: 50, reason: "no ATR data (neutral)" };
  const atrPct = p && p > 0 ? (a / p) * 100 : null;
  if (atrPct != null) {
    if (atrPct >= 8) return { raw: 100, reason: `ATR ${atrPct.toFixed(1)}% (very high vol)` };
    if (atrPct >= 5) return { raw: 85, reason: `ATR ${atrPct.toFixed(1)}% (high vol)` };
    if (atrPct >= 3) return { raw: 65, reason: `ATR ${atrPct.toFixed(1)}% (good vol)` };
    if (atrPct >= 1.5) return { raw: 45, reason: `ATR ${atrPct.toFixed(1)}% (moderate)` };
    return { raw: 25, reason: `ATR ${atrPct.toFixed(1)}% (low vol)` };
  }
  if (a >= 5) return { raw: 90, reason: `ATR $${a.toFixed(2)}` };
  if (a >= 2) return { raw: 70, reason: `ATR $${a.toFixed(2)}` };
  if (a >= 1) return { raw: 50, reason: `ATR $${a.toFixed(2)}` };
  return { raw: 30, reason: `ATR $${a.toFixed(2)} (low)` };
}

function scoreRVol(rvol: unknown): { raw: number; reason: string } {
  const v = parseNumeric(rvol);
  if (v == null) return { raw: 50, reason: "no rVol data (neutral)" };
  if (v >= 5) return { raw: 100, reason: `rVol ${v.toFixed(1)}x (massive)` };
  if (v >= 3) return { raw: 90, reason: `rVol ${v.toFixed(1)}x (very high)` };
  if (v >= 2) return { raw: 75, reason: `rVol ${v.toFixed(1)}x (high)` };
  if (v >= 1.5) return { raw: 60, reason: `rVol ${v.toFixed(1)}x (elevated)` };
  if (v >= 1) return { raw: 40, reason: `rVol ${v.toFixed(1)}x (normal)` };
  return { raw: 20, reason: `rVol ${v.toFixed(1)}x (light)` };
}

function scoreCatalyst(hasCatalystField: string | null, recentNews: number): { raw: number; reason: string } {
  if (hasCatalystField && hasCatalystField.trim().length > 5) {
    if (recentNews > 0) return { raw: 100, reason: "explicit catalyst + recent news" };
    return { raw: 80, reason: "explicit catalyst noted" };
  }
  if (recentNews >= 3) return { raw: 70, reason: `${recentNews} recent news items` };
  if (recentNews > 0) return { raw: 50, reason: `${recentNews} recent news item(s)` };
  return { raw: 15, reason: "no catalyst noted, no recent news" };
}

async function scoreSectorStrength(sector: string | null): Promise<{ raw: number; reason: string }> {
  if (!sector) return { raw: 50, reason: "no sector data (neutral)" };
  try {
    const { rows } = await pool.query(
      `SELECT change_pct, trend_5d FROM sector_strength_cache WHERE LOWER(name) LIKE $1 OR LOWER(symbol) = $2 LIMIT 1`,
      [`%${sector.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`, sector.toLowerCase()]
    );
    if (rows.length === 0) return { raw: 50, reason: `${sector} (no data)` };
    const change = Number(rows[0].change_pct ?? 0);
    const trend = Number(rows[0].trend_5d ?? 0);
    const composite = change * 0.6 + trend * 0.4;
    if (composite >= 2) return { raw: 100, reason: `${sector} +${composite.toFixed(2)}% strong` };
    if (composite >= 1) return { raw: 80, reason: `${sector} +${composite.toFixed(2)}%` };
    if (composite >= 0) return { raw: 55, reason: `${sector} +${composite.toFixed(2)}% flat` };
    if (composite >= -1) return { raw: 35, reason: `${sector} ${composite.toFixed(2)}% weak` };
    return { raw: 15, reason: `${sector} ${composite.toFixed(2)}% very weak` };
  } catch {
    return { raw: 50, reason: `${sector} (lookup error)` };
  }
}

function scoreLiquidity(adv: unknown): { raw: number; reason: string } {
  const v = parseNumeric(adv);
  if (v == null) return { raw: 50, reason: "no ADV data (neutral)" };
  if (v >= 50_000_000) return { raw: 100, reason: `ADV ${(v / 1_000_000).toFixed(0)}M (deep)` };
  if (v >= 10_000_000) return { raw: 85, reason: `ADV ${(v / 1_000_000).toFixed(0)}M (good)` };
  if (v >= 2_000_000) return { raw: 65, reason: `ADV ${(v / 1_000_000).toFixed(1)}M (ok)` };
  if (v >= 500_000) return { raw: 40, reason: `ADV ${(v / 1_000).toFixed(0)}K (thin)` };
  return { raw: 15, reason: `ADV ${(v / 1_000).toFixed(0)}K (very thin)` };
}

export async function calcWatchlistScore(opts: {
  ticker: string;
  catalyst?: string | null;
  sector?: string | null;
}): Promise<ScoreBreakdown> {
  const { ticker, catalyst, sector } = opts;
  const tickerUp = ticker.toUpperCase();

  let cache: TickerCacheRow | null = null;
  try {
    const { rows } = await pool.query<TickerCacheRow>(
      `SELECT market_cap, float, average_daily_volume, atr, relative_volume, sector, raw FROM ticker_data_cache WHERE ticker = $1`,
      [tickerUp]
    );
    cache = rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, ticker: tickerUp }, "scoreEngine: ticker_data_cache lookup failed (treating as no data)");
  }

  let recentNews = 0;
  try {
    const { rows } = await pool.query<{ cnt: string | number }>(
      `SELECT COUNT(*) AS cnt FROM news_cache WHERE ticker = $1 AND published_at > NOW() - INTERVAL '48 hours'`,
      [tickerUp]
    );
    recentNews = Number(rows[0]?.cnt ?? 0);
  } catch (err) {
    logger.warn({ err, ticker: tickerUp }, "scoreEngine: news_cache lookup failed (treating as 0 recent news)");
  }

  const price = cache?.raw?.quote?.regularMarketPrice ?? cache?.raw?.price ?? cache?.raw?.regularMarketPrice ?? null;
  const effSector = sector || cache?.sector || null;

  const catalystScore = scoreCatalyst(catalyst ?? null, recentNews);
  const floatScore = scoreFloat(cache?.float);
  const atrScore = scoreAtr(cache?.atr, price);
  const rVolScore = scoreRVol(cache?.relative_volume);
  const sectorScore = await scoreSectorStrength(effSector);
  const liquidityScore = scoreLiquidity(cache?.average_daily_volume);

  const total = Math.round(
    (catalystScore.raw * WEIGHTS.catalyst +
      floatScore.raw * WEIGHTS.float +
      atrScore.raw * WEIGHTS.atr +
      rVolScore.raw * WEIGHTS.relativeVolume +
      sectorScore.raw * WEIGHTS.sectorStrength +
      liquidityScore.raw * WEIGHTS.liquidity) / 100
  );

  return {
    total: Math.max(0, Math.min(100, total)),
    components: {
      catalyst: { weight: WEIGHTS.catalyst, raw: catalystScore.raw, weighted: Math.round(catalystScore.raw * WEIGHTS.catalyst / 100), reason: catalystScore.reason },
      float: { weight: WEIGHTS.float, raw: floatScore.raw, weighted: Math.round(floatScore.raw * WEIGHTS.float / 100), reason: floatScore.reason },
      atr: { weight: WEIGHTS.atr, raw: atrScore.raw, weighted: Math.round(atrScore.raw * WEIGHTS.atr / 100), reason: atrScore.reason },
      relativeVolume: { weight: WEIGHTS.relativeVolume, raw: rVolScore.raw, weighted: Math.round(rVolScore.raw * WEIGHTS.relativeVolume / 100), reason: rVolScore.reason },
      sectorStrength: { weight: WEIGHTS.sectorStrength, raw: sectorScore.raw, weighted: Math.round(sectorScore.raw * WEIGHTS.sectorStrength / 100), reason: sectorScore.reason },
      liquidity: { weight: WEIGHTS.liquidity, raw: liquidityScore.raw, weighted: Math.round(liquidityScore.raw * WEIGHTS.liquidity / 100), reason: liquidityScore.reason },
    },
  };
}
