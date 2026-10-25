/**
 * Trainer day rules — SQL (rules and masking: catalyst.ts). Local DB only, never a provider call.
 *
 * Catalyst window of a play day D with previous trading day P (weekdays minus full-day holidays of holiday_calendar):
 *   finviz_earnings        D before the open (bmo / unknown timing) or P after the close (amc)
 *   news_cache             a ticker-specific item published in [P 16:00, D 16:00) New York
 *   market_events          the desk's «Катализаторы» log on D (macro / economic rows are not a ticker catalyst; one
 *                          row may list several tickers «XOM, CVX»)
 *   big7_catalysts         a Big 7 catalyst on D
 *   analyst_actions_cache  in [P 16:00, D 09:30): an upgrade / downgrade / initiation, or ≥ 3 firms changing targets
 * Every query degrades to «no catalyst» on an error (a missing table on an old database): the pickers then find no
 * day and say so, they never relax the rule.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { etOf } from "./scenario";
import { parseLarge, sortCatalysts, timingOf, type Catalyst } from "./catalyst";

export type DayKey = { ticker: string; day: string };
export const dayKey = (k: DayKey): string => `${k.ticker}:${k.day}`;

/** k.p = the previous trading day of k.d. */
const KEYS = `
  WITH k AS (
    SELECT u.t, u.d,
           (SELECT max(x)::date FROM generate_series(u.d - 7, u.d - 1, interval '1 day') x
             WHERE extract(isodow FROM x) < 6
               AND NOT EXISTS (SELECT 1 FROM holiday_calendar h WHERE h.date = x::date::text AND h.type = 'holiday' AND h.description ILIKE 'market closed%')) AS p
      FROM unnest($1::text[], $2::date[]) AS u(t, d)
  )`;

const NY = `'America/New_York'`;
const FROM = `((k.p + time '16:00') AT TIME ZONE ${NY})`;
const OPEN = `((k.d + time '09:30') AT TIME ZONE ${NY})`;
const CLOSE = `((k.d + time '16:00') AT TIME ZONE ${NY})`;
const EVENT_TICKER = `(upper(m.ticker) = k.t OR k.t = ANY(string_to_array(upper(replace(m.ticker, ' ', '')), ',')))`;
const EVENT_KIND = `lower(coalesce(m.event_type, '')) NOT IN ('macro', 'economic')`;

/** SQL condition over k.t / k.d / k.p: the day has a catalyst. */
export const HAS_CATALYST = `(
  EXISTS (SELECT 1 FROM finviz_earnings e WHERE e.ticker = k.t AND e.superseded_at IS NULL
           AND ((e.date = k.d::text AND e.timing IS DISTINCT FROM 'amc') OR (e.date = k.p::text AND e.timing = 'amc')))
  OR EXISTS (SELECT 1 FROM news_cache n WHERE n.ticker = k.t AND n.is_ticker_specific IS NOT FALSE
           AND n.published_at >= ${FROM} AND n.published_at < ${CLOSE})
  OR EXISTS (SELECT 1 FROM market_events m WHERE m.deleted_at IS NULL AND m.date = k.d::text AND ${EVENT_TICKER} AND ${EVENT_KIND})
  OR EXISTS (SELECT 1 FROM big7_catalysts b WHERE b.ticker = k.t AND b.date = k.d::text)
  OR EXISTS (SELECT 1 FROM analyst_actions_cache a WHERE a.ticker = k.t AND a.graded_at >= ${FROM} AND a.graded_at < ${OPEN}
           AND a.action IN ('up', 'down', 'init'))
  OR (SELECT count(DISTINCT a.firm) FROM analyst_actions_cache a WHERE a.ticker = k.t AND a.graded_at >= ${FROM} AND a.graded_at < ${OPEN}) >= 3
)`;

const uniq = (keys: readonly DayKey[]) => [...new Map(keys.map((k) => [dayKey(k), k])).values()];

/** "TICKER:DAY" of the keys whose day has a catalyst. */
export async function catalystKeys(keys: readonly DayKey[]): Promise<Set<string>> {
  const list = uniq(keys);
  if (!list.length) return new Set();
  try {
    const { rows } = await pool.query<{ t: string; d: string }>(
      `${KEYS} SELECT k.t, k.d::text AS d FROM k WHERE ${HAS_CATALYST}`,
      [list.map((k) => k.ticker), list.map((k) => k.day)],
    );
    return new Set(rows.map((r) => `${r.t}:${r.d}`));
  } catch (err) {
    logger.warn({ err }, "trainer: catalyst lookup failed");
    return new Set();
  }
}

/** Gap % of archived days (1-minute row first): open vs the previous close. */
export async function archivedGaps(keys: readonly DayKey[]): Promise<Map<string, number | null>> {
  const list = uniq(keys);
  const out = new Map<string, number | null>();
  if (!list.length) return out;
  try {
    const { rows } = await pool.query<{ t: string; d: string; g: string | null }>(
      `SELECT DISTINCT ON (a.symbol, a.day) a.symbol AS t, a.day::text AS d,
              CASE WHEN a.prev_close > 0 THEN (a.rth_open - a.prev_close) / a.prev_close * 100 END AS g
         FROM unnest($1::text[], $2::date[]) AS u(t, d) JOIN candle_archive a ON a.symbol = u.t AND a.day = u.d
        WHERE a.rth_open IS NOT NULL
        ORDER BY a.symbol, a.day, CASE a.tf WHEN '1m' THEN 1 WHEN '5m' THEN 2 ELSE 3 END`,
      [list.map((k) => k.ticker), list.map((k) => k.day)],
    );
    for (const r of rows) out.set(`${r.t}:${r.d}`, r.g == null ? null : Math.round(Number(r.g) * 100) / 100);
  } catch (err) {
    logger.warn({ err }, "trainer: archived gaps failed");
  }
  return out;
}

const nyOf = (iso: string) => etOf(Date.parse(iso) / 1000);

/** Every catalyst of one ticker-day (real text and times — server only until the reveal). */
export async function catalystsOf(ticker: string, day: string): Promise<Catalyst[]> {
  const out: Catalyst[] = [];
  const args = [[ticker], [day]];
  const safe = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> => {
    try {
      return (await pool.query<T>(`${KEYS} ${sql}`, args)).rows;
    } catch (err) {
      logger.warn({ err, ticker }, "trainer: catalyst read failed");
      return [];
    }
  };
  const [earn, news, events, big7, analyst] = await Promise.all([
    safe<{ date: string; timing: string | null; p: string }>(
      `SELECT e.date, e.timing, k.p::text AS p FROM k JOIN finviz_earnings e ON e.ticker = k.t AND e.superseded_at IS NULL
        AND ((e.date = k.d::text AND e.timing IS DISTINCT FROM 'amc') OR (e.date = k.p::text AND e.timing = 'amc'))`,
    ),
    safe<{ title: string | null; source: string | null; url: string | null; category: string | null; at: Date }>(
      `SELECT n.title, n.source, n.url, n.category, n.published_at AS at FROM k JOIN news_cache n ON n.ticker = k.t
        AND n.is_ticker_specific IS NOT FALSE AND n.published_at >= ${FROM} AND n.published_at < ${CLOSE}
        ORDER BY n.published_at LIMIT 5`,
    ),
    safe<{ headline: string | null; summary: string | null; event_type: string | null; session: string | null }>(
      `SELECT m.headline, m.summary, m.event_type, m.session FROM k JOIN market_events m ON m.deleted_at IS NULL AND m.date = k.d::text
        AND ${EVENT_TICKER} AND ${EVENT_KIND} ORDER BY m.id LIMIT 3`,
    ),
    safe<{ type: string | null; description: string | null }>(
      `SELECT b.type, b.description FROM k JOIN big7_catalysts b ON b.ticker = k.t AND b.date = k.d::text ORDER BY b.id LIMIT 3`,
    ),
    safe<{ action: string; firm: string | null; to_grade: string | null; from_grade: string | null; at: Date }>(
      `SELECT a.action, a.firm, a.to_grade, a.from_grade, a.graded_at AS at FROM k JOIN analyst_actions_cache a ON a.ticker = k.t
        AND a.graded_at >= ${FROM} AND a.graded_at < ${OPEN} ORDER BY a.graded_at`,
    ),
  ]);
  for (const e of earn) {
    const pre = e.date === day;
    out.push({ kind: "earnings", source: "earnings", timing: pre ? "pre" : "prevAfter", at: e.date, headline: null, publisher: "Finviz", url: null });
  }
  for (const n of news) {
    const iso = new Date(n.at).toISOString();
    const et = nyOf(iso);
    out.push({
      // The feed's «earnings» category also tags previews («buy ahead of earnings?»): a feed item is news; a report
      // is the earnings calendar's (or the desk log's) word.
      kind: "news", source: "news", timing: timingOf(et.date, et.min, day),
      at: iso, headline: n.title, publisher: n.source, url: n.url,
    });
  }
  for (const m of events) {
    const earnings = /earn/i.test(m.event_type ?? "");
    const session = /pre|before/i.test(m.session ?? "") ? "pre" : /after|post/i.test(m.session ?? "") ? "prevAfter" : /rth|regular|intraday|session/i.test(m.session ?? "") ? "session" : null;
    out.push({ kind: earnings ? "earnings" : "news", source: "event", timing: session, at: day, headline: m.headline || m.summary, publisher: null, url: null });
  }
  for (const b of big7) out.push({ kind: /earn/i.test(b.type ?? "") ? "earnings" : "news", source: "big7", timing: null, at: day, headline: b.description, publisher: null, url: null });
  const ratings = analyst.filter((a) => a.action === "up" || a.action === "down" || a.action === "init");
  for (const a of ratings.slice(0, 3)) {
    const iso = new Date(a.at).toISOString();
    const et = nyOf(iso);
    out.push({
      kind: "news", source: "analyst", timing: timingOf(et.date, et.min, day), at: iso, headline: null, publisher: a.firm, url: null,
      analyst: { action: a.action, firm: a.firm, from: a.from_grade || null, to: a.to_grade || null },
    });
  }
  const firms = new Set(analyst.map((a) => a.firm ?? "")).size;
  if (!ratings.length && firms >= 3) {
    const iso = new Date(analyst[0].at).toISOString();
    const et = nyOf(iso);
    out.push({ kind: "news", source: "analyst", timing: timingOf(et.date, et.min, day), at: iso, headline: null, publisher: null, url: null, analyst: { action: "targets", firm: null, from: null, to: null, firms } });
  }
  return sortCatalysts(out);
}

export type Fundamentals = { names: string[]; shares: number | null; floatShares: number | null; capNow: number | null };

/** Company names (for masking), shares outstanding, float and the latest cap of a ticker — newest source first. */
export async function fundamentalsOf(ticker: string): Promise<Fundamentals> {
  const res: Fundamentals = { names: [], shares: null, floatShares: null, capNow: null };
  const q = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> => {
    try { return (await pool.query<T>(sql, [ticker])).rows; } catch { return []; }
  };
  const [snap, tdc, earn, trade, ev] = await Promise.all([
    q<{ company: string | null; market_cap: string | null; shares_outstanding: string | null; float_shares: string | null }>(
      `SELECT company, market_cap, shares_outstanding, float_shares FROM finviz_ticker_snapshot WHERE ticker = $1 AND as_of IS NOT NULL`,
    ),
    q<{ long_name: string | null; market_cap: string | null; shares_outstanding: string | null; float: string | null }>(
      `SELECT long_name, market_cap, shares_outstanding, float FROM ticker_data_cache WHERE ticker = $1`,
    ),
    q<{ company: string | null }>(`SELECT company FROM finviz_earnings WHERE ticker = $1 AND company IS NOT NULL ORDER BY date DESC LIMIT 1`),
    q<{ n: string | null }>(`SELECT long_name AS n FROM trades WHERE ticker = $1 AND long_name IS NOT NULL AND long_name <> '' ORDER BY id DESC LIMIT 1`),
    q<{ n: string | null }>(`SELECT long_name AS n FROM market_events WHERE upper(ticker) = $1 AND long_name IS NOT NULL AND long_name <> '' LIMIT 1`),
  ]);
  const s = snap[0], t = tdc[0];
  res.names = [s?.company, t?.long_name, earn[0]?.company, trade[0]?.n, ev[0]?.n].filter((x): x is string => !!x && x.trim().length > 0);
  res.shares = parseLarge(s?.shares_outstanding ?? null) ?? parseLarge(t?.shares_outstanding ?? null);
  res.floatShares = parseLarge(s?.float_shares ?? null) ?? parseLarge(t?.float ?? null);
  res.capNow = parseLarge(s?.market_cap ?? null) ?? parseLarge(t?.market_cap ?? null);
  return res;
}
