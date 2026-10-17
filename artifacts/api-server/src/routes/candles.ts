import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { fetchYahooWithSession } from "../lib/marketDataService";
import { pool } from "@workspace/db";
import { nyDate } from "../lib/tradingDate";

const router: IRouter = Router();

export type Interval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";

const ALLOWED_INTERVALS: ReadonlySet<Interval> = new Set(["1m", "5m", "15m", "30m", "60m", "1d"]);

/** Bar length in seconds per interval (shared with trade quality / replay). */
export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "1d": 86400 };

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function parseDateStrict(dateStr: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) return null;
  return { y, m, d };
}

export function pickIntervalForAge(ageDays: number): Interval {
  if (ageDays <= 7) return "1m";
  if (ageDays <= 60) return "5m";
  if (ageDays <= 730) return "60m";
  return "1d";
}

export function ageDaysOf(parsed: { y: number; m: number; d: number }): number {
  return (Date.now() - Date.UTC(parsed.y, parsed.m - 1, parsed.d)) / (1000 * 60 * 60 * 24);
}

function fmtDate(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Walk back N trading days from `parsed`, returning [oldest, ..., parsed].
// Skips Sat/Sun. Does not (yet) check for US market holidays — those
// just yield empty candles from Yahoo and get filtered out at assembly.
export function collectTradingDays(parsed: { y: number; m: number; d: number }, daysBack: number): { y: number; m: number; d: number; str: string }[] {
  const out: { y: number; m: number; d: number; str: string }[] = [
    { ...parsed, str: fmtDate(parsed) },
  ];
  let cur = parsed;
  for (let i = 0; i < daysBack; i++) {
    const dt = new Date(Date.UTC(cur.y, cur.m - 1, cur.d));
    do {
      dt.setUTCDate(dt.getUTCDate() - 1);
    } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
    cur = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    out.push({ ...cur, str: fmtDate(cur) });
  }
  return out.reverse(); // oldest first
}

// DST-aware: convert (date in ET, h:m wall time) to epoch seconds.
// Uses Intl to read America/New_York offset at the candidate moment.
export function etWallToUtcSeconds(parsed: { y: number; m: number; d: number }, h: number, m: number): number {
  const candidateUtcMs = Date.UTC(parsed.y, parsed.m - 1, parsed.d, h, m, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(candidateUtcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const etMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = etMs - candidateUtcMs; // negative for ET (e.g. -4h EDT, -5h EST)
  return Math.floor((candidateUtcMs - offsetMs) / 1000);
}

export function dayWindowEpochSeconds(parsed: { y: number; m: number; d: number }, includeExtended: boolean): { start: number; end: number } {
  const start = includeExtended
    ? etWallToUtcSeconds(parsed, 4, 0)
    : etWallToUtcSeconds(parsed, 9, 30);
  const end = includeExtended
    ? etWallToUtcSeconds(parsed, 20, 0)
    : etWallToUtcSeconds(parsed, 16, 0);
  return { start, end };
}

export type SessionLevels = {
  pmHigh: number | null;
  pmLow: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

const ET_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// Premarket = 04:00–09:29 ET, regular = 09:30–15:59 ET, for bars on `dateStr` (ET).
export function computeSessionLevels(candles: Candle[], dateStr: string): SessionLevels {
  const out: SessionLevels = { pmHigh: null, pmLow: null, open: null, high: null, low: null, close: null };
  for (const c of candles) {
    const parts = ET_PARTS_FMT.formatToParts(new Date(c.t * 1000));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    if (`${get("year")}-${get("month")}-${get("day")}` !== dateStr) continue;
    const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
    if (mins >= 240 && mins < 570) {
      out.pmHigh = out.pmHigh == null ? c.h : Math.max(out.pmHigh, c.h);
      out.pmLow = out.pmLow == null ? c.l : Math.min(out.pmLow, c.l);
    } else if (mins >= 570 && mins < 960) {
      if (out.open == null) out.open = c.o;
      out.high = out.high == null ? c.h : Math.max(out.high, c.h);
      out.low = out.low == null ? c.l : Math.min(out.low, c.l);
      out.close = c.c;
    }
  }
  return out;
}

// In-memory cache for previous-trading-day closes. Keyed by `TICKER:YYYY-MM-DD`.
// Past days are stable forever; today's value is refreshed every 5 minutes so
// intraday updates to the prior close (rare, e.g. corporate actions) propagate.
const prevCloseCache = new Map<string, { value: number | null; fetchedAt: number }>();
const PREV_CLOSE_TTL_MS = 5 * 60 * 1000;

export async function getPrevDailyCloseCached(ticker: string, parsed: { y: number; m: number; d: number }, dateStr: string): Promise<number | null> {
  const key = `${ticker}:${dateStr}`;
  // Trading date = New York date: a day is "past" (stable) only once the ET calendar has moved on.
  const today = nyDate();
  const isPast = dateStr < today;
  const cached = prevCloseCache.get(key);
  if (cached && (isPast || Date.now() - cached.fetchedAt < PREV_CLOSE_TTL_MS)) {
    return cached.value;
  }
  const value = await fetchPrevDailyClose(ticker, parsed);
  prevCloseCache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

async function fetchPrevDailyClose(ticker: string, parsed: { y: number; m: number; d: number }): Promise<number | null> {
  // Fetch ~14 calendar days of daily candles ending the day before `date` and
  // return the last available close. This robustly handles weekends and
  // holidays (just picks the most recent trading day).
  const targetMidnight = Math.floor(Date.UTC(parsed.y, parsed.m - 1, parsed.d) / 1000);
  const start = targetMidnight - 14 * 86400;
  const end = targetMidnight; // exclusive upper bound: we want closes BEFORE the trade date
  const params = (s: { cookie: string; crumb: string }) => {
    const p = new URLSearchParams({
      period1: String(start),
      period2: String(end),
      interval: "1d",
      events: "div,split",
      crumb: s.crumb,
    });
    return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${p.toString()}`;
  };
  try {
    const resp = await fetchYahooWithSession(params);
    if (!resp || !resp.ok) return null;
    const data: any = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (c != null && Number.isFinite(c) && ts[i] < targetMidnight) return Number(c);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchYahooCandles(ticker: string, parsed: { y: number; m: number; d: number }, interval: Interval, extended: boolean): Promise<Candle[] | null> {
  const { start, end } = dayWindowEpochSeconds(parsed, extended);
  const params = (s: { cookie: string; crumb: string }) => {
    const p = new URLSearchParams({
      period1: String(start),
      period2: String(end),
      interval,
      includePrePost: extended ? "true" : "false",
      events: "div,split",
      crumb: s.crumb,
    });
    return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${p.toString()}`;
  };
  try {
    const resp = await fetchYahooWithSession(params);
    if (!resp || !resp.ok) return null;
    const data: any = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles: Candle[] = ts.map((t, i) => ({
      t,
      o: q.open?.[i],
      h: q.high?.[i],
      l: q.low?.[i],
      c: q.close?.[i],
      v: q.volume?.[i] ?? 0,
    })).filter((c: Candle) => c.o != null && c.h != null && c.l != null && c.c != null);
    return candles;
  } catch {
    return null;
  }
}

/**
 * Cache-only read of one day (no Yahoo call). Lets trade quality / replay use a finer interval than
 * Yahoo would still serve for an old day (e.g. 1m bars cached while the trade was fresh). Past days
 * are stable; today's rows must be fresh (5 min).
 */
export async function readCachedDay(ticker: string, dateStr: string, interval: Interval, extended: boolean): Promise<Candle[] | null> {
  const isPast = dateStr < nyDate();
  const cacheCondition = isPast
    ? `ticker = $1 AND date = $2 AND interval = $3 AND extended = $4`
    : `ticker = $1 AND date = $2 AND interval = $3 AND extended = $4 AND fetched_at > NOW() - INTERVAL '5 minutes'`;
  const { rows } = await pool.query(
    `SELECT ohlcv FROM candles_cache WHERE ${cacheCondition} ORDER BY fetched_at DESC LIMIT 1`,
    [ticker, dateStr, interval, extended],
  );
  const cached = rows[0]?.ohlcv as Candle[] | undefined;
  return cached && cached.length > 0 ? cached : null;
}

// Single-day cache lookup + Yahoo fetch + cache write. Returns candles + a
// cached flag so callers can report aggregate cache status. Returns null if
// Yahoo has no data for that day (e.g. holiday, new listing).
export async function fetchSingleDayWithCache(
  ticker: string,
  parsed: { y: number; m: number; d: number },
  dateStr: string,
  interval: Interval,
  extended: boolean,
  force: boolean,
  log?: any
): Promise<{ candles: Candle[]; cached: boolean } | null> {
  if (!force) {
    const cached = await readCachedDay(ticker, dateStr, interval, extended);
    if (cached) return { candles: cached, cached: true };
  }

  const candles = await fetchYahooCandles(ticker, parsed, interval, extended);
  if (!candles || candles.length === 0) return null;

  try {
    await pool.query(
      `INSERT INTO candles_cache (ticker, date, interval, extended, ohlcv, fetched_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (ticker, date, interval, extended) DO UPDATE SET
         ohlcv = EXCLUDED.ohlcv,
         fetched_at = NOW()`,
      [ticker, dateStr, interval, extended, JSON.stringify(candles)]
    );
  } catch (err) {
    log?.warn?.({ err, ticker, dateStr, interval, extended }, "candles cache write failed");
  }

  return { candles, cached: false };
}

// ── Daily bars over a date range (one Yahoo call, in-memory TTL cache) ──────
// Used by trade replay / execution quality for multi-week swings. Keyed by
// ticker + from + to; past ranges are stable, ranges touching today expire.
const dailyRangeCache = new Map<string, { candles: Candle[]; fetchedAt: number }>();
const DAILY_RANGE_TTL_MS = 5 * 60 * 1000;
const DAILY_RANGE_MAX = 200;

export async function fetchDailyRange(ticker: string, fromStr: string, toStr: string): Promise<Candle[] | null> {
  const from = parseDateStrict(fromStr);
  const to = parseDateStrict(toStr);
  if (!from || !to || fromStr > toStr) return null;
  const key = `${ticker}:${fromStr}:${toStr}`;
  const stable = toStr < nyDate();
  const hit = dailyRangeCache.get(key);
  if (hit && (stable || Date.now() - hit.fetchedAt < DAILY_RANGE_TTL_MS)) return hit.candles;

  const start = Math.floor(Date.UTC(from.y, from.m - 1, from.d) / 1000);
  const end = Math.floor(Date.UTC(to.y, to.m - 1, to.d) / 1000) + 86400; // inclusive upper day
  const params = (s: { cookie: string; crumb: string }) => {
    const p = new URLSearchParams({
      period1: String(start),
      period2: String(end),
      interval: "1d",
      events: "div,split",
      crumb: s.crumb,
    });
    return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${p.toString()}`;
  };
  try {
    const resp = await fetchYahooWithSession(params);
    if (!resp || !resp.ok) return null;
    const data: any = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles: Candle[] = ts
      .map((t, i) => ({ t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? 0 }))
      .filter((c: Candle) => c.o != null && c.h != null && c.l != null && c.c != null);
    if (dailyRangeCache.size > DAILY_RANGE_MAX) {
      const oldest = dailyRangeCache.keys().next().value;
      if (oldest) dailyRangeCache.delete(oldest);
    }
    dailyRangeCache.set(key, { candles, fetchedAt: Date.now() });
    return candles;
  } catch {
    return null;
  }
}

// Trading days in [fromStr, toStr] (weekends skipped; holidays yield no bars and are dropped by callers).
export function tradingDaysBetween(fromStr: string, toStr: string, cap = 30): { y: number; m: number; d: number; str: string }[] {
  const from = parseDateStrict(fromStr);
  const to = parseDateStrict(toStr);
  if (!from || !to || fromStr > toStr) return [];
  const out: { y: number; m: number; d: number; str: string }[] = [];
  const dt = new Date(Date.UTC(from.y, from.m - 1, from.d));
  const endMs = Date.UTC(to.y, to.m - 1, to.d);
  while (dt.getTime() <= endMs && out.length < cap) {
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const p = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
      out.push({ ...p, str: fmtDate(p) });
    }
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return out;
}

// GET /candles/:ticker/range?from=&to=&interval=&extended=1
// Multi-day series for replay of overnight / swing trades: intraday bars per
// trading day (cache-first, ≤30 days) or a single daily call for `interval=1d`.
router.get("/candles/:ticker/range", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase().trim();
  const fromStr = String(req.query.from || "").trim();
  const toStr = String(req.query.to || "").trim();
  const extended = req.query.extended === "1" || req.query.extended === "true";
  if (!ticker || !/^[A-Z][A-Z0-9.\-]{0,10}$/.test(ticker)) { res.status(400).json({ error: "invalid ticker" }); return; }
  const from = parseDateStrict(fromStr);
  const to = parseDateStrict(toStr);
  if (!from || !to || fromStr > toStr) { res.status(400).json({ error: "invalid range (expected from<=to, YYYY-MM-DD)" }); return; }

  const days = tradingDaysBetween(fromStr, toStr, 30);
  if (!days.length) { res.status(422).json({ error: "non_trading_day", reason: "weekend", ticker, from: fromStr, to: toStr }); return; }
  const oldestAge = ageDaysOf(days[0]);
  const requestedRaw = String(req.query.interval || "").toLowerCase().trim();
  const requested = ALLOWED_INTERVALS.has(requestedRaw as Interval) ? (requestedRaw as Interval) : null;
  const allowed = (iv: Interval, age: number) => iv === "1m" ? age <= 7 : (iv === "5m" || iv === "15m" || iv === "30m") ? age <= 60 : iv === "60m" ? age <= 730 : true;
  let interval: Interval = requested && allowed(requested, oldestAge) ? requested : pickIntervalForAge(oldestAge);
  let rangeDays = days;
  if (requested && requested !== "1d" && interval !== requested) {
    // Only the context days are too old for the finer bars: keep the requested interval (1m → the 1/2/3-minute
    // charts) for the trailing run of days that allow it — by age, or already in the cache — and drop the older
    // context days instead of coarsening the whole series to 5m.
    const { rows } = await pool.query(
      `SELECT DISTINCT date::text AS d FROM candles_cache WHERE ticker = $1 AND interval = $2 AND extended = $3 AND date = ANY($4::date[])`,
      [ticker, requested, extended, days.map((d) => d.str)],
    ).catch(() => ({ rows: [] as { d: string }[] }));
    const inCache = new Set(rows.map((r) => String(r.d).slice(0, 10)));
    const ok = (d: (typeof days)[number]) => allowed(requested, ageDaysOf(d)) || inCache.has(d.str);
    let i = days.length;
    while (i > 0 && ok(days[i - 1])) i--;
    if (i < days.length) { rangeDays = days.slice(i); interval = requested; }
  }
  const spanDays = (Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86400000;
  if (spanDays > 45 && interval !== "1d") { interval = "1d"; rangeDays = days; }

  // `trim=1` (trade replay) is accepted for compatibility: the block above already keeps the finest bars and drops
  // older leading context days whenever the requested interval cannot be served for every day.

  let candles: Candle[] = [];
  let cached = true;
  if (interval === "1d") {
    const daily = await fetchDailyRange(ticker, fromStr, toStr);
    candles = daily ?? [];
    cached = false;
  } else {
    for (const day of rangeDays) {
      const r = await fetchSingleDayWithCache(ticker, day, day.str, interval, extended, false, req.log);
      if (r) { candles.push(...r.candles); if (!r.cached) cached = false; }
    }
  }
  candles.sort((a, b) => a.t - b.t);
  const dedup: Candle[] = [];
  let lastT = -1;
  for (const c of candles) if (c.t !== lastT) { dedup.push(c); lastT = c.t; }
  if (!dedup.length) { res.status(404).json({ error: "no candles available", ticker, from: fromStr, to: toStr, interval }); return; }

  // The response `from` / `days` say which days were actually served (older context days may have been dropped).
  const servedDays = interval === "1d" ? days : rangeDays;
  const servedFrom = servedDays[0]?.str ?? fromStr;
  const prevClose = await getPrevDailyCloseCached(ticker, servedDays[0] ?? from, servedFrom);
  res.json({ ticker, from: servedFrom, to: toStr, interval, extended, days: servedDays.length, candles: dedup, prevClose, cached, fetchedAt: new Date().toISOString() });
}));

router.get("/candles/:ticker", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase().trim();
  const dateStr = String(req.query.date || "").trim();
  const extended = req.query.extended === "1" || req.query.extended === "true";
  const force = req.query.force === "1";
  const daysBackRaw = Number(req.query.daysBack);
  const daysBack = Number.isFinite(daysBackRaw) ? Math.max(0, Math.min(10, Math.floor(daysBackRaw))) : 0;

  if (!ticker || !/^[A-Z][A-Z0-9.\-]{0,10}$/.test(ticker)) {
    res.status(400).json({ error: "invalid ticker" });
    return;
  }
  const parsed = parseDateStrict(dateStr);
  if (!parsed) {
    res.status(400).json({ error: "invalid date (expected calendar YYYY-MM-DD)" });
    return;
  }

  // Pre-check: weekend (Sat/Sun) → no trading
  const probe = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  const dow = probe.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    res.status(422).json({
      error: "non_trading_day",
      reason: "weekend",
      ticker,
      date: dateStr,
    });
    return;
  }
  const todayStr = nyDate();
  if (dateStr > todayStr) {
    res.status(422).json({
      error: "non_trading_day",
      reason: "future",
      ticker,
      date: dateStr,
    });
    return;
  }

  // For multi-day requests, the OLDEST day's age determines what intervals
  // Yahoo will accept (e.g. 1m only works for the last 7 days). Auto-pick
  // and per-interval validation use the oldest age.
  const targetDays = collectTradingDays(parsed, daysBack);
  const oldestDay = targetDays[0];
  const oldestAge = ageDaysOf(oldestDay);

  const requestedRaw = String(req.query.interval || "").toLowerCase().trim();
  const requested = ALLOWED_INTERVALS.has(requestedRaw as Interval) ? (requestedRaw as Interval) : null;
  const auto = pickIntervalForAge(oldestAge);
  function intervalAllowedForAge(iv: Interval, age: number): boolean {
    if (iv === "1m") return age <= 7;
    if (iv === "5m" || iv === "15m" || iv === "30m") return age <= 60;
    if (iv === "60m") return age <= 730;
    return true;
  }
  const interval: Interval = requested && intervalAllowedForAge(requested, oldestAge) ? requested : auto;

  // Fetch each requested trading day (cache-first), concatenate.
  // Holidays / no-data days are silently skipped.
  const allCandles: Candle[] = [];
  let allCached = true;
  let anyFetched = false;
  for (const day of targetDays) {
    const r = await fetchSingleDayWithCache(ticker, day, day.str, interval, extended, force, req.log);
    if (r) {
      allCandles.push(...r.candles);
      anyFetched = true;
      if (!r.cached) allCached = false;
    } else {
      // missing day — not catastrophic for multi-day; only fatal if it's the
      // primary trade day and nothing else was fetched
      allCached = false;
    }
  }

  if (!anyFetched || allCandles.length === 0) {
    res.status(404).json({ error: "no candles available", ticker, date: dateStr, interval, extended, daysBack });
    return;
  }

  // Sort by epoch and de-duplicate (in case overlapping days share boundary
  // candles — defensive, normally Yahoo splits cleanly per day).
  // Yahoo sometimes appends the *current* live bar (e.g. today's 60m bar) to
  // historical responses — and those got cached. Drop anything outside the
  // requested [oldest day open, trade day close] window.
  const windowStart = dayWindowEpochSeconds(oldestDay, extended).start - (interval === "1d" ? 86400 : 0);
  const windowEnd = dayWindowEpochSeconds(parsed, extended).end + (interval === "1d" ? 86400 : 0);
  allCandles.sort((a, b) => a.t - b.t);
  const dedup: Candle[] = [];
  let lastT = -1;
  for (const c of allCandles) {
    if (c.t < windowStart || c.t > windowEnd) continue;
    if (c.t !== lastT) { dedup.push(c); lastT = c.t; }
  }
  if (dedup.length === 0) {
    res.status(404).json({ error: "no candles available", ticker, date: dateStr, interval, extended, daysBack });
    return;
  }

  // prevClose is the close of the trading day BEFORE the TRADE DATE itself
  // (Y.close semantically means "yesterday close" relative to the trade day,
  // even when older context days are also visible).
  const prevClose = await getPrevDailyCloseCached(ticker, parsed, dateStr);

  // Optional trade-day session levels (premarket high/low, regular OHLC).
  // Premarket needs extended-hours bars: when the main request was regular-
  // hours only, fetch (and cache) the extended series for the trade day.
  let sessionLevels: SessionLevels | null | undefined;
  if (req.query.levels === "1" || req.query.levels === "true") {
    try {
      let source: Candle[] = dedup;
      if (interval !== "1d" && !extended) {
        const ext = await fetchSingleDayWithCache(ticker, parsed, dateStr, interval, true, false, req.log);
        if (ext?.candles?.length) source = ext.candles;
      }
      sessionLevels = interval === "1d" ? null : computeSessionLevels(source, dateStr);
    } catch (err) {
      req.log?.warn?.({ err, ticker, dateStr }, "session levels failed");
      sessionLevels = null;
    }
  }

  res.json({
    ...(sessionLevels !== undefined ? { sessionLevels } : {}),
    ticker,
    date: dateStr,
    interval,
    extended,
    daysBack,
    candles: dedup,
    prevClose,
    cached: allCached,
    fetchedAt: new Date().toISOString(),
  });
}));

export default router;
