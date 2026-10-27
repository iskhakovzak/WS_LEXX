/**
 * Market themes («Темы рынка») — pure logic, no I/O (unit-tested in __tests__/themes/logic.test.ts).
 *
 *   session   pre (04:00–09:30 NY) · rth (09:30–16:00) · post (16:00–20:00) · closed (night, weekend, NYSE holiday)
 *   TTL       30 s while the market is open (rth), 5 min otherwise (pre / post still move, slower)
 *   quote     today      = price / previous close − 1         (%; pre: the premarket print vs yesterday's close)
 *             fromOpen   = price / today's open − 1           (%; null before 09:30 NY — there is no open yet)
 *             premarket  = last premarket print / previous close − 1 (live 04:00–09:30, then frozen for the day: the
 *                          providers stop sending it after the open, so the last print of the day is held —
 *                          holdPremarket, kept per process by quotes.ts for both the Finviz and the Yahoo path)
 *             afterHours = after-hours print / the session's regular close − 1 (null while the market is open)
 *             Both belong to the session the page describes: today in pre / rth / post, the last regular session when
 *             closed (night, weekend) — a print of another day is never shown as this session's.
 *             Finviz exports Change (vs prev close) and Gap (open vs prev close): fromOpen = (1+change)/(1+gap) − 1.
 *   theme     equal-weight mean of the members that have the value; `missing` = tickers with no quote at all.
 * Percentages are percent units (1.25 = 1.25 %) rounded to 2 decimals; unknown = null, never NaN.
 */
import { nySession, nyDate, type DaySession } from "../tradingDate";

export type ThemeSession = "pre" | "rth" | "post" | "closed";
export type ThemeSource = "finviz" | "yahoo";

/** One ticker's move (percent units, 2 decimals; null = unknown). */
export type MemberQuote = {
  ticker: string;
  price: number | null;
  today: number | null;
  fromOpen: number | null;
  premarket: number | null;
  afterHours: number | null;
};

/** The four reference points of a move (percent units). */
export const THEME_METRICS = ["premarket", "fromOpen", "today", "afterHours"] as const;
export type ThemeMetric = (typeof THEME_METRICS)[number];

export type ThemeRow = { id: number; name: string; tickers: readonly string[] };

export type ThemeOut = {
  id: number;
  name: string;
  today: number | null;
  fromOpen: number | null;
  premarket: number | null;
  afterHours: number | null;
  members: MemberQuote[];
  missing: string[];
};

/** GET /api/themes. `stale`: the last refresh failed (or is still running) and these are older numbers. */
export type ThemesResponse = {
  asOf: string | null;
  session: ThemeSession;
  source: ThemeSource | null;
  stale: boolean;
  themes: ThemeOut[];
  /** Cold start: the first quote refresh is still running (no numbers yet); ask again in a few seconds. */
  warming?: boolean;
};

export const TTL_OPEN_MS = 30_000;
export const TTL_SLOW_MS = 5 * 60_000;

/** Ticker shape stored in market_themes (staff input is upper-cased first). */
export const THEME_TICKER_RE = /^[A-Z.\-]{1,10}$/;
export const MAX_THEME_TICKERS = 30;

/**
 * The themes session at `now`. `day` = today's session (lib/marketDays sessionFor: closed / early close at 13:00 —
 * the post-market then runs 13:00–17:00) or, as before, just «the market is closed today».
 */
export function themeSession(now: Date, day: boolean | Pick<DaySession, "closed" | "closeMin">): ThemeSession {
  const session = typeof day === "boolean" ? { closed: day, closeMin: undefined } : day;
  if (session.closed) return "closed";
  const s = nySession(now, session.closeMin == null ? null : { closed: false, closeMin: session.closeMin });
  return s === "premarket" ? "pre" : s === "regular" ? "rth" : s === "postmarket" ? "post" : "closed";
}

export function ttlMs(session: ThemeSession): number {
  return session === "rth" ? TTL_OPEN_MS : TTL_SLOW_MS;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function round2(v: number | null | undefined): number | null {
  if (!finite(v)) return null;
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** price / base − 1 in percent (null without both, or a non-positive base). */
export function pctChange(price: number | null | undefined, base: number | null | undefined): number | null {
  if (!finite(price) || !finite(base) || base <= 0 || price <= 0) return null;
  return ((price / base) - 1) * 100;
}

/** "$aapl, msft  brk.b" → ["AAPL", "MSFT", "BRK.B"]: upper-cased, `$` dropped, unique, in order. Invalid kept out. */
export function normalizeTickers(input: readonly string[] | string): { tickers: string[]; invalid: string[] } {
  const parts = typeof input === "string" ? input.split(/[\s,;]+/) : input;
  const tickers: string[] = [];
  const invalid: string[] = [];
  for (const raw of parts) {
    const t = String(raw ?? "").trim().toUpperCase().replace(/^\$/, "");
    if (!t) continue;
    if (!THEME_TICKER_RE.test(t)) {
      if (!invalid.includes(t)) invalid.push(t);
      continue;
    }
    if (!tickers.includes(t)) tickers.push(t);
  }
  return { tickers, invalid };
}

// ─── provider rows → MemberQuote ────────────────────────────────────────────

/** The fields of a Finviz export row the themes use (lib/finviz/csv FinvizRow). */
export type FinvizLike = {
  ticker: string;
  price: number | null;
  changePct: number | null;
  gapPct: number | null;
  relVolume?: number | null;
  float?: number | null;
};

/** Per-ticker context of the tickers boards: gap % (open vs previous close), relative volume, float (shares). */
export type TickerExtras = { gap: number | null; rvol: number | null; float: number | null };
export const NO_EXTRAS: TickerExtras = { gap: null, rvol: null, float: null };

export function extrasFromFinviz(row: FinvizLike, session: ThemeSession): TickerExtras {
  return {
    gap: session === "pre" ? null : round2(finite(row.gapPct) ? row.gapPct : null),
    rvol: round2(finite(row.relVolume) ? row.relVolume : null),
    float: finite(row.float) && row.float > 0 ? row.float : null,
  };
}

export function quoteFromFinviz(row: FinvizLike, session: ThemeSession): MemberQuote {
  const today = finite(row.changePct) ? row.changePct : null;
  let fromOpen: number | null = null;
  if (session !== "pre" && today != null && finite(row.gapPct) && row.gapPct > -100) {
    fromOpen = ((1 + today / 100) / (1 + row.gapPct / 100) - 1) * 100;
  }
  // Finviz exports no premarket / after-hours columns: quotes.ts fills those two from Yahoo when it can.
  return {
    ticker: row.ticker.toUpperCase(), price: finite(row.price) ? row.price : null, today: round2(today), fromOpen: round2(fromOpen),
    premarket: null, afterHours: null,
  };
}

/** The fields of a Yahoo v7 /finance/quote result the themes use. Times are epoch seconds. */
export type YahooQuoteLike = {
  symbol?: string;
  regularMarketPrice?: number | null;
  regularMarketOpen?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketTime?: number | null;
  preMarketPrice?: number | null;
  preMarketTime?: number | null;
  preMarketChangePercent?: number | null;
  postMarketPrice?: number | null;
  postMarketTime?: number | null;
  postMarketChangePercent?: number | null;
  regularMarketVolume?: number | null;
  averageDailyVolume3Month?: number | null;
};

const dayOf = (sec: number | null | undefined): string | null => (finite(sec) && sec > 0 ? nyDate(new Date(sec * 1000)) : null);

/**
 * Premarket / after-hours moves of a Yahoo quote for the session the page describes (`sessionDay`: today in pre / rth /
 * post, the last regular session's day when closed).
 *   premarket   the sessionDay's last premarket print vs the close before it (Yahoo's own % when that
 *               close is unknown); a print of another day → null.
 *   afterHours  the sessionDay's after-hours print vs that day's regular close; only once the regular session is over
 *               (post / closed) — during rth Yahoo still carries yesterday's print, which is not this session's.
 */
export function extendedFromYahoo(q: YahooQuoteLike, session: ThemeSession, today: string): { premarket: number | null; afterHours: number | null } {
  const reg = finite(q.regularMarketPrice) ? q.regularMarketPrice : null;
  const regDay = dayOf(q.regularMarketTime);
  const sessionDay = session === "closed" ? (regDay ?? today) : today;
  // Close before sessionDay: before the open the "regular" fields still describe the previous session.
  const prevClose = regDay != null && regDay < sessionDay ? reg : finite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null;
  let premarket: number | null = null;
  if (finite(q.preMarketPrice) && dayOf(q.preMarketTime) === sessionDay) {
    premarket = pctChange(q.preMarketPrice, prevClose) ?? (finite(q.preMarketChangePercent) ? q.preMarketChangePercent : null);
  }
  let afterHours: number | null = null;
  if ((session === "post" || session === "closed") && regDay === sessionDay && finite(q.postMarketPrice) && dayOf(q.postMarketTime) === sessionDay) {
    afterHours = pctChange(q.postMarketPrice, reg) ?? (finite(q.postMarketChangePercent) ? q.postMarketChangePercent : null);
  }
  return { premarket: round2(premarket), afterHours: round2(afterHours) };
}

/**
 * Yahoo quote → member, for the session at hand (`today` = NY date):
 *   pre     price = today's premarket print, base = the last regular close (regularMarketPrice of a previous day);
 *           no open yet → fromOpen null
 *   rth     regular price vs previous close / today's open
 *   post    the after-hours print (today's) when there is one, else the close; same bases as rth
 *   closed  the last regular session as it ended
 * premarket / afterHours: extendedFromYahoo.
 */
export function quoteFromYahoo(q: YahooQuoteLike, session: ThemeSession, today: string): MemberQuote | null {
  const ticker = String(q.symbol ?? "").toUpperCase();
  if (!ticker) return null;
  const reg = finite(q.regularMarketPrice) ? q.regularMarketPrice : null;
  const regDay = dayOf(q.regularMarketTime);
  const ext = extendedFromYahoo(q, session, today);
  if (session === "pre") {
    // Before the open the "regular" fields still describe the previous session.
    const base = regDay != null && regDay < today ? reg : finite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null;
    const pre = finite(q.preMarketPrice) && dayOf(q.preMarketTime) === today ? q.preMarketPrice : null;
    return { ticker, price: pre ?? base, today: round2(pctChange(pre, base)), fromOpen: null, ...ext };
  }
  const prev = finite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null;
  const open = finite(q.regularMarketOpen) && (session === "closed" || regDay === today) ? q.regularMarketOpen : null;
  let price = reg;
  if (session === "post" && finite(q.postMarketPrice) && dayOf(q.postMarketTime) === today) price = q.postMarketPrice;
  if (price == null) return null;
  return { ticker, price, today: round2(pctChange(price, prev)), fromOpen: round2(pctChange(price, open)), ...ext };
}

/**
 * Yahoo quote → gap / RVOL for the session the page describes (float: Yahoo's quote has none → null; the Finviz
 * snapshot fills it). Gap = today's open vs the previous close (none before the open); RVOL = the session's volume /
 * the 3-month average volume (not time-of-day adjusted).
 */
export function extrasFromYahoo(q: YahooQuoteLike, session: ThemeSession, today: string): TickerExtras {
  const regDay = dayOf(q.regularMarketTime);
  const sameDay = session === "closed" || regDay === today;
  if (session === "pre" || !sameDay) return { ...NO_EXTRAS };
  const prev = finite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null;
  const open = finite(q.regularMarketOpen) ? q.regularMarketOpen : null;
  const vol = finite(q.regularMarketVolume) ? q.regularMarketVolume : null;
  const avg = finite(q.averageDailyVolume3Month) && q.averageDailyVolume3Month > 0 ? q.averageDailyVolume3Month : null;
  return { gap: round2(pctChange(open, prev)), rvol: vol != null && avg != null ? round2(vol / avg) : null, float: null };
}

// ─── premarket of the day ──────────────────────────────────────────────────

/** The last premarket move seen per ticker and the NY day it belongs to (percent units). */
export type PremarketHold = Map<string, { day: string; pct: number }>;
export const PREMARKET_HOLD_MAX = 10_000;

/**
 * Keeps the premarket column filled for the whole day (in place): a quote with a premarket move updates the hold for
 * `today`; a quote without one (after 09:30 NY Yahoo stops sending premarket fields, Finviz never has them) gets the
 * value held for `today`. A print of another day is never shown (weekend / next morning start empty). Entries of
 * older days are dropped; the hold is bounded by PREMARKET_HOLD_MAX.
 */
export function holdPremarket(quotes: Map<string, MemberQuote>, hold: PremarketHold, today: string): void {
  for (const [t, h] of hold) if (h.day !== today) hold.delete(t);
  for (const [t, q] of quotes) {
    if (q.premarket != null) {
      hold.delete(t);
      hold.set(t, { day: today, pct: q.premarket });
      continue;
    }
    const h = hold.get(t);
    if (h && h.day === today) quotes.set(t, { ...q, premarket: h.pct });
  }
  while (hold.size > PREMARKET_HOLD_MAX) hold.delete(hold.keys().next().value!);
}

// ─── aggregation ────────────────────────────────────────────────────────────

function mean(values: readonly (number | null)[]): number | null {
  const xs = values.filter(finite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** A member counts when the provider returned a usable row for it (a price or a move). */
const usable = (q: MemberQuote | undefined): q is MemberQuote => !!q && (q.price != null || q.today != null);

export function aggregateTheme(theme: ThemeRow, quotes: ReadonlyMap<string, MemberQuote>): ThemeOut {
  const members: MemberQuote[] = [];
  const missing: string[] = [];
  for (const t of theme.tickers) {
    const q = quotes.get(t.toUpperCase());
    if (usable(q)) members.push(q);
    else missing.push(t.toUpperCase());
  }
  return {
    id: theme.id,
    name: theme.name,
    today: round2(mean(members.map((m) => m.today))),
    fromOpen: round2(mean(members.map((m) => m.fromOpen))),
    premarket: round2(mean(members.map((m) => m.premarket))),
    afterHours: round2(mean(members.map((m) => m.afterHours))),
    members,
    missing,
  };
}

/** Every distinct ticker of the given themes (upper-case, first-seen order). */
export function themeTickers(themes: readonly ThemeRow[]): string[] {
  const out = new Set<string>();
  for (const th of themes) for (const t of th.tickers) out.add(t.toUpperCase());
  return [...out];
}

export function buildResponse(
  themes: readonly ThemeRow[],
  cache: { quotes: ReadonlyMap<string, MemberQuote>; asOf: number | null; source: ThemeSource | null } | null,
  session: ThemeSession,
  stale: boolean,
): ThemesResponse {
  const quotes = cache?.quotes ?? new Map<string, MemberQuote>();
  return {
    asOf: cache?.asOf != null ? new Date(cache.asOf).toISOString() : null,
    session,
    source: cache?.source ?? null,
    stale,
    themes: themes.map((th) => aggregateTheme(th, quotes)),
  };
}
