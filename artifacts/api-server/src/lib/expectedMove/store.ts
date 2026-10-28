/**
 * Expected move — storage and reads (table expected_moves, migration 0278; pure maths in ./model.ts).
 *
 *   expectedMoves(tickers, today)  per ticker: the next report (≤ 10 days ahead) or the last one (≤ 7 days back), its EM
 *                                  (the implied snapshot taken before it, else the historical average from the candle
 *                                  archive — labelled), the prior close, the EM levels and, after the report, the
 *                                  reaction-day move and whether it broke the EM. Read-only.
 *   snapshotUpcoming(now, deps)    job «em.snapshot»: the implied move of the reports that land on the next reaction
 *                                  day (today after the close, the next session before the open), tickers on plans and
 *                                  watchlists first, at most em.maxSnapshots per run. Deps are injectable: tests never
 *                                  reach a real host.
 * Sources: finviz_earnings (report dates, timing), candle_archive (daily close / prev close), the options chain
 * (lib/options, free delayed Yahoo / NASDAQ). No new provider.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { isMarketClosed } from "../marketDays";
import { addDays, nyDate } from "../tradingDate";
import { setting } from "../settings/registry";
import { getOptionsChain, LIVE_CHAIN_DEPS, type ChainDeps } from "../options/chainService";
import { broken, historicalMove, impliedMove, levels, reactionDay, type EmSource } from "./model";

type Queryable = { query: (typeof pool)["query"] };

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const AHEAD_DAYS = 10;
const BACK_DAYS = 7;

async function nextSession(day: string): Promise<string> {
  let d = addDays(day, 1);
  for (let i = 0; i < 7 && (await isMarketClosed(d)); i++) d = addDays(d, 1);
  return d;
}

type Report = { ticker: string; date: string; timing: string | null };

async function reportsOf(tickers: readonly string[], from: string, to: string, db: Queryable): Promise<Report[]> {
  const { rows } = await db.query(
    `SELECT UPPER(ticker) AS ticker, date, timing FROM finviz_earnings
      WHERE superseded_at IS NULL AND UPPER(ticker) = ANY($1::text[]) AND date BETWEEN $2 AND $3 ORDER BY ticker, date`,
    [tickers, from, to],
  );
  return rows.map((r: any) => ({ ticker: String(r.ticker), date: String(r.date), timing: r.timing ?? null }));
}

/** Close-to-close move (%) of each (symbol, day) in the archive, and the close itself. */
async function dayCloses(pairs: readonly { symbol: string; day: string }[], db: Queryable): Promise<Map<string, { close: number; prev: number }>> {
  const out = new Map<string, { close: number; prev: number }>();
  if (!pairs.length) return out;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (symbol, day) symbol, to_char(day, 'YYYY-MM-DD') AS day, rth_close::float8 AS c, prev_close::float8 AS p
       FROM candle_archive
      WHERE (symbol, day) IN (SELECT * FROM unnest($1::text[], $2::date[])) AND rth_close > 0 AND prev_close > 0
      ORDER BY symbol, day, extended, tf`,
    [pairs.map((x) => x.symbol), pairs.map((x) => x.day)],
  );
  for (const r of rows as any[]) out.set(`${r.symbol}|${r.day}`, { close: Number(r.c), prev: Number(r.p) });
  return out;
}

/** The latest archived close before `day` (the prior close of an upcoming report). */
async function lastClose(symbol: string, before: string, db: Queryable): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT rth_close::float8 AS c FROM candle_archive WHERE symbol = $1 AND day < $2::date AND rth_close > 0 ORDER BY day DESC, extended, tf LIMIT 1`,
    [symbol, before],
  );
  return rows[0] ? Number((rows[0] as any).c) : null;
}

const pct = (c: number, p: number) => Math.round(((c - p) / p) * 10_000) / 100;

/** Historical EM of `ticker` before `report`: the average |reaction move| of its earlier reports in the archive. */
async function historicalBefore(ticker: string, report: string, db: Queryable): Promise<{ em: number; quarters: number } | null> {
  const n = setting("em.historyQuarters");
  const past = (await reportsOf([ticker], addDays(report, -365 * 3), addDays(report, -1), db)).slice(-n);
  if (!past.length) return null;
  const days = await Promise.all(past.map(async (r) => reactionDay(r.date, r.timing, await nextSession(r.date))));
  const closes = await dayCloses(days.map((day) => ({ symbol: ticker, day })), db);
  const moves = days.map((d) => closes.get(`${ticker}|${d}`)).filter((x): x is { close: number; prev: number } => !!x).map((x) => pct(x.close, x.prev));
  return historicalMove(moves, n);
}

export type ExpectedMove = {
  ticker: string;
  reportDate: string;
  timing: "bmo" | "amc" | null;
  reactionDate: string;
  emPct: number | null;
  source: EmSource | null;
  /** Quarters the historical average used (null for an implied EM). */
  quarters: number | null;
  priorClose: number | null;
  levels: { up: number; down: number } | null;
  /** After the report: the reaction day's close-to-close move and whether it went past the EM. */
  reaction: { movePct: number; broken: boolean | null } | null;
};

export async function expectedMoves(tickers: readonly string[], today: string = nyDate(), db: Queryable = pool): Promise<ExpectedMove[]> {
  const list = [...new Set(tickers.map((t) => t.toUpperCase()).filter((t) => TICKER_RE.test(t)))].slice(0, 60);
  if (!list.length) return [];
  const reports = await reportsOf(list, addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS), db);
  // One report per ticker: the nearest upcoming, else the latest past one.
  const pick = new Map<string, Report>();
  for (const r of reports) {
    const cur = pick.get(r.ticker);
    if (!cur) { pick.set(r.ticker, r); continue; }
    const up = r.date >= today, curUp = cur.date >= today;
    if ((up && (!curUp || r.date < cur.date)) || (!up && !curUp && r.date > cur.date)) pick.set(r.ticker, r);
  }
  const chosen = [...pick.values()];
  if (!chosen.length) return [];
  const { rows: snaps } = await db.query(
    `SELECT ticker, report_date, source, em_pct::float8 AS em, prior_close::float8 AS pc FROM expected_moves WHERE (ticker, report_date) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [chosen.map((r) => r.ticker), chosen.map((r) => r.date)],
  );
  const snapBy = new Map((snaps as any[]).map((s) => [`${s.ticker}|${s.report_date}`, s]));
  const out: ExpectedMove[] = [];
  for (const r of chosen) {
    const reaction = reactionDay(r.date, r.timing, await nextSession(r.date));
    const snap = snapBy.get(`${r.ticker}|${r.date}`);
    const hist = snap ? null : await historicalBefore(r.ticker, r.date, db);
    const emPct = snap ? Number(snap.em) : hist?.em ?? null;
    const source: EmSource | null = snap ? (snap.source as EmSource) : hist ? "historical" : null;
    const priorClose = snap?.pc != null ? Number(snap.pc) : await lastClose(r.ticker, reaction, db);
    const done = reaction <= today ? (await dayCloses([{ symbol: r.ticker, day: reaction }], db)).get(`${r.ticker}|${reaction}`) : undefined;
    const movePct = done ? pct(done.close, done.prev) : null;
    out.push({
      ticker: r.ticker, reportDate: r.date, timing: r.timing === "amc" || r.timing === "bmo" ? r.timing : null, reactionDate: reaction,
      emPct, source, quarters: hist?.quarters ?? null, priorClose, levels: levels(done ? done.prev : priorClose, emPct),
      reaction: movePct == null ? null : { movePct, broken: broken(movePct, emPct) },
    });
  }
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.ticker.localeCompare(b.ticker));
}

// ─── the snapshot job ─────────────────────────────────────────────────────────────────────────────────────────────

/** Reports whose reaction day is the next one: today after the close, and the next session before the open. */
async function upcoming(today: string, db: Queryable): Promise<Report[]> {
  const next = await nextSession(today);
  const { rows } = await db.query(
    `SELECT UPPER(e.ticker) AS ticker, e.date, e.timing,
            EXISTS (SELECT 1 FROM watchlist w WHERE w.deleted_at IS NULL AND UPPER(w.ticker) = UPPER(e.ticker)) AS watched
       FROM finviz_earnings e
      WHERE e.superseded_at IS NULL AND ((e.date = $1 AND e.timing = 'amc') OR (e.date = $2 AND COALESCE(e.timing, 'bmo') <> 'amc'))
      ORDER BY watched DESC, e.market_cap DESC NULLS LAST, e.ticker`,
    [today, next],
  );
  return rows.map((r: any) => ({ ticker: String(r.ticker), date: String(r.date), timing: r.timing ?? null }));
}

export type SnapshotResult = { candidates: number; implied: number; historical: number; failed: number; skipped?: string };

export async function snapshotUpcoming(now: Date = new Date(), deps: ChainDeps = LIVE_CHAIN_DEPS, db: Queryable = pool): Promise<SnapshotResult> {
  const res: SnapshotResult = { candidates: 0, implied: 0, historical: 0, failed: 0 };
  const today = nyDate(now);
  if (await isMarketClosed(today)) return { ...res, skipped: "market closed" };
  const max = setting("em.maxSnapshots");
  const all = (await upcoming(today, db)).filter((r) => TICKER_RE.test(r.ticker));
  const { rows: have } = await db.query(`SELECT ticker, report_date FROM expected_moves WHERE source = 'implied' AND report_date >= $1`, [today]);
  const done = new Set((have as any[]).map((h) => `${h.ticker}|${h.report_date}`));
  const todo = all.filter((r) => !done.has(`${r.ticker}|${r.date}`)).slice(0, max);
  res.candidates = todo.length;
  for (const r of todo) {
    const reaction = reactionDay(r.date, r.timing, await nextSession(r.date));
    let em: number | null = null;
    let expiration: string | null = null;
    let spot: number | null = null;
    if (setting("em.implied")) {
      try {
        const list = await getOptionsChain(r.ticker, null, deps);
        const exp = list.expirations.map((e) => e.label).filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l) && l >= reaction).sort()[0] ?? null;
        const chain = exp && exp !== list.expiration ? await getOptionsChain(r.ticker, exp, deps) : list;
        if (exp && chain.calls && chain.puts && chain.spot > 0) {
          em = impliedMove({ calls: chain.calls, puts: chain.puts }, chain.spot);
          expiration = exp;
          spot = chain.spot;
        }
      } catch (err) {
        logger.info({ err, ticker: r.ticker }, "em.snapshot: no options chain");
      }
    }
    const hist = em == null ? await historicalBefore(r.ticker, r.date, db) : null;
    const value = em ?? hist?.em ?? null;
    if (value == null) { res.failed++; continue; }
    const source: EmSource = em != null ? "implied" : "historical";
    const prior = spot ?? (await lastClose(r.ticker, reaction, db));
    await db.query(
      `INSERT INTO expected_moves (ticker, report_date, source, em_pct, prior_close, expiration, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticker, report_date) DO UPDATE SET source = EXCLUDED.source, em_pct = EXCLUDED.em_pct, prior_close = EXCLUDED.prior_close,
         expiration = EXCLUDED.expiration, captured_at = EXCLUDED.captured_at
       WHERE expected_moves.source <> 'implied' OR EXCLUDED.source = 'implied'`,
      [r.ticker, r.date, source, value, prior, expiration, now.toISOString()],
    );
    if (source === "implied") res.implied++; else res.historical++;
  }
  return res;
}
