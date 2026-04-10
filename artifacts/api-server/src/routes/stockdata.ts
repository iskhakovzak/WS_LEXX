import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000;

router.get("/stockdata/quote", asyncHandler(async (req, res): Promise<void> => {
  const symbols = String(req.query.symbols || "").toUpperCase().split(",").filter(Boolean);
  if (!symbols.length) { res.status(400).json({ error: "symbols required" }); return; }

  const cacheKey = `quotes_${symbols.sort().join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const results: Record<string, any> = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1mo&interval=1d&includePrePost=true`;
        const resp = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const chart = data?.chart?.result?.[0];
        if (!chart) return;

        const meta = chart.meta || {};
        const quote = chart.indicators?.quote?.[0] || {};
        const timestamps = chart.timestamp || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const opens = quote.open || [];

        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
        const open = meta.regularMarketDayHigh ? opens[opens.length - 1] : null;
        const gapPct = prevClose && open ? +(((open - prevClose) / prevClose) * 100).toFixed(2) : null;

        const avgVol = volumes.length >= 2
          ? Math.round(volumes.slice(0, -1).reduce((a: number, b: number) => a + (b || 0), 0) / Math.max(volumes.length - 1, 1))
          : null;
        const currentVol = volumes[volumes.length - 1] ?? null;
        const rvol = avgVol && currentVol ? +(currentVol / avgVol).toFixed(2) : null;

        const candles = timestamps.map((ts: number, i: number) => ({
          h: highs[i] ?? 0, l: lows[i] ?? 0, c: closes[i] ?? 0
        })).filter((c: any) => c.c > 0);
        const atr = calcATR(candles);

        results[sym] = {
          price: meta.regularMarketPrice ?? null,
          change: prevClose && meta.regularMarketPrice
            ? +(((meta.regularMarketPrice - prevClose) / prevClose) * 100).toFixed(2) : null,
          open: meta.regularMarketDayHigh ? opens[opens.length - 1] ?? null : null,
          high: meta.regularMarketDayHigh ?? null,
          low: meta.regularMarketDayLow ?? null,
          prevClose,
          volume: meta.regularMarketVolume ?? currentVol,
          avgVolume: avgVol,
          relativeVolume: rvol,
          preMarketPrice: null,
          preMarketChange: null,
          high52w: meta.fiftyTwoWeekHigh ?? null,
          low52w: meta.fiftyTwoWeekLow ?? null,
          marketCap: null,
          name: meta.longName ?? meta.shortName ?? sym,
          gapPct,
          atr,
        };
      } catch (err: any) {
        logger.warn({ symbol: sym, error: err.message }, "Failed to fetch single symbol");
      }
    }));

    cache.set(cacheKey, { data: results, ts: Date.now() });
    res.json(results);
  } catch (e: any) {
    logger.warn({ error: e.message }, "Yahoo Finance quote error");
    res.status(502).json({ error: "Failed to fetch stock data", message: e.message });
  }
}));

router.get("/stockdata/chart", asyncHandler(async (req, res): Promise<void> => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const range = String(req.query.range || "5d");
  const interval = String(req.query.interval || "1d");
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }

  const cKey = `chart_${symbol}_${range}_${interval}`;
  const cached = cache.get(cKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL * 5) {
    res.json(cached.data);
    return;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!resp.ok) throw new Error(`Yahoo chart: ${resp.status}`);
    const data = await resp.json();

    const result = data?.chart?.result?.[0];
    if (!result) { res.json({ candles: [] }); return; }

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const candles = timestamps.map((ts: number, i: number) => ({
      t: ts * 1000,
      o: quote.open?.[i] ?? null,
      h: quote.high?.[i] ?? null,
      l: quote.low?.[i] ?? null,
      c: quote.close?.[i] ?? null,
      v: quote.volume?.[i] ?? null,
    })).filter((c: any) => c.c !== null);

    const meta = result.meta || {};
    const chartData = {
      candles,
      atr: calcATR(candles),
      prevClose: meta.chartPreviousClose ?? null,
    };

    cache.set(cKey, { data: chartData, ts: Date.now() });
    res.json(chartData);
  } catch (e: any) {
    logger.warn({ error: e.message }, "Yahoo Finance chart error");
    res.status(502).json({ error: "Failed to fetch chart data" });
  }
}));

function calcATR(candles: { h: number; l: number; c: number }[]): number | null {
  if (candles.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevC = candles[i - 1].c;
    const h = candles[i].h;
    const l = candles[i].l;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  const last14 = trs.slice(-14);
  return +(last14.reduce((a, b) => a + b, 0) / last14.length).toFixed(2);
}

export default router;
