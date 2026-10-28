/**
 * «Лёгкие деньги дня» — reads (pure rules in ./easyMoney.ts) and the plan notes of seniors / curators (table
 * easy_money_notes, migration 0289 — a note is the author's own plan annotation, the only manual input here).
 *
 *   candidatesOf(day)            the day's in-play tickers and why: desk-wide traded tickers, the desk plan's in-play
 *                                list, plan idea marks and catalyst taps of anyone, events-page rows, earnings (that
 *                                day before the open / the session before after the close), analyst actions, an
 *                                expected move of a report that day, and the archived tickers that gapped ≥ pulse.gapPct;
 *                                ranked by the number of reasons, cut at pulse.easyMaxTickers
 *   easyMovesOf(day)             the clean moves the archive shows for them (cached per day), plus how many candidates
 *                                were checked and how many had no archived day at all (shown, never guessed)
 *   easyMoneyFor(day, people)    every move with one line per person (took / against / skipped / missed)
 *   personalEasyMoney(t, day)    the debrief lines of one trader (./easyMoney personalLines)
 *   notesOf / saveNote           the author's own notes of a day
 * GET never writes.
 */
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { setting } from "../settings/registry";
import { TtlCache } from "../hotCache";
import { nyMinutes } from "../tradingDate";
import { prevSessionDay } from "../catalyst/store";
import { normTicker } from "../catalyst/model";
import { readArchivedDays } from "../candleArchive";
import { flowTrades } from "../sessionFlow/load";
import type { Queryable } from "../interventions/log";
import { barKey, dayBarsOf } from "./dayBars";
import { detectMove, matchMove, personalLines, type EasyCfg, type EasyLine, type EasyMove, type EasySource, type MatchRow, type MinuteBar, type PersonDay } from "./easyMoney";

export const easyCfg = (): EasyCfg => ({ minMovePct: setting("pulse.easyMovePct"), cleanShare: setting("pulse.easyCleanShare"), gapPct: setting("pulse.gapPct") });

type Candidate = { ticker: string; sources: Set<EasySource>; traders: number; emPct: number | null };

/** One source query; a failing source is logged and left out (the others still answer). */
const rowsOf = async (db: Queryable, sql: string, params: unknown[]): Promise<any[]> => {
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "easy money: a source query failed");
    return [];
  }
};

export async function candidatesOf(day: string, db: Queryable = pool): Promise<Candidate[]> {
  const prev = await prevSessionDay(day);
  const gapPct = setting("pulse.gapPct");
  const [traded, plan, ideas, marks, events, earnings, analyst, em, gaps] = await Promise.all([
    rowsOf(db, `SELECT UPPER(TRIM(ticker)) AS t, COUNT(DISTINCT trader)::int AS n FROM trades
                 WHERE deleted_at IS NULL AND date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(date, 10) = $1 GROUP BY 1`, [day]),
    rowsOf(db, `SELECT DISTINCT UPPER(TRIM(x->>'ticker')) AS t FROM game_plans g,
                 jsonb_array_elements(CASE WHEN jsonb_typeof(g.in_play) = 'array' THEN g.in_play ELSE '[]'::jsonb END) x
                 WHERE g.date = $1 AND g.deleted_at IS NULL`, [day]),
    rowsOf(db, `SELECT DISTINCT ticker AS t FROM plan_idea_marks WHERE day = $1`, [day]),
    rowsOf(db, `SELECT DISTINCT ticker AS t FROM catalyst_marks WHERE day = $1 AND (direction IS NOT NULL OR strength IS NOT NULL)`, [day]),
    rowsOf(db, `SELECT DISTINCT UPPER(TRIM(ticker)) AS t FROM market_events WHERE deleted_at IS NULL AND substring(date, 1, 10) = $1`, [day]),
    rowsOf(db, `SELECT DISTINCT UPPER(ticker) AS t FROM finviz_earnings WHERE superseded_at IS NULL
                 AND ((date = $1 AND COALESCE(timing, 'bmo') <> 'amc') OR (date = $2 AND timing = 'amc'))`, [day, prev]),
    rowsOf(db, `SELECT DISTINCT UPPER(ticker) AS t FROM analyst_actions_cache
                 WHERE (graded_at AT TIME ZONE 'America/New_York')::date BETWEEN $2::date AND $1::date`, [day, prev]),
    rowsOf(db, `SELECT e.ticker AS t, e.em_pct::float8 AS em FROM expected_moves e
                 LEFT JOIN finviz_earnings f ON f.ticker = e.ticker AND f.date = e.report_date AND f.superseded_at IS NULL
                 WHERE (e.report_date = $1 AND COALESCE(f.timing, 'bmo') <> 'amc') OR (e.report_date = $2 AND f.timing = 'amc')`, [day, prev]),
    rowsOf(db, `SELECT DISTINCT ON (symbol) symbol AS t FROM candle_archive
                 WHERE day = $1::date AND prev_close > 0 AND rth_open > 0 AND ABS(rth_open - prev_close) / prev_close * 100 >= $2
                 ORDER BY symbol, extended, tf`, [day, gapPct]),
  ]);
  const by = new Map<string, Candidate>();
  const add = (rows: any[], src: EasySource | null) => {
    for (const r of rows) {
      const t = normTicker(r.t);
      if (!t) continue;
      const c = by.get(t) ?? { ticker: t, sources: new Set<EasySource>(), traders: 0, emPct: null };
      if (src) c.sources.add(src);
      if (r.n != null) c.traders = Number(r.n);
      if (r.em != null) c.emPct = Number(r.em);
      by.set(t, c);
    }
  };
  add(traded, "traded"); add(plan, "plan"); add(ideas, "idea"); add(marks, "catalyst"); add(events, "event");
  add(earnings, "earnings"); add(analyst, "analyst"); add(em, null); add(gaps, "gap");
  return [...by.values()]
    .sort((a, b) => b.sources.size - a.sources.size || b.traders - a.traders || a.ticker.localeCompare(b.ticker))
    .slice(0, setting("pulse.easyMaxTickers"));
}

async function minuteBars(ticker: string, day: string): Promise<MinuteBar[] | null> {
  try {
    const d = (await readArchivedDays(ticker, [day])).get(day);
    return d ? d.bars.map((b) => ({ min: nyMinutes(new Date(b.t * 1000)), c: b.c })) : null;
  } catch {
    return null;
  }
}

export type EasyDay = { day: string; moves: EasyMove[]; checked: number; noData: number };

const CACHE_TTL_MS = 10 * 60_000;
const cache = new TtlCache<string, Promise<EasyDay>>(CACHE_TTL_MS);

async function compute(day: string, cfg: EasyCfg): Promise<EasyDay> {
  const cands = await candidatesOf(day);
  const bars = await dayBarsOf(cands.map((c) => ({ ticker: c.ticker, day })));
  const moves: EasyMove[] = [];
  let noData = 0;
  for (const c of cands) {
    const b = bars.get(barKey(day, c.ticker));
    if (!b) { noData++; continue; }
    const first = detectMove(day, c.ticker, b, [...c.sources], cfg, { emPct: c.emPct });
    if (!first) continue;
    // Only a session move needs the intraday bars (its timing); a gap move is pre-market by definition.
    moves.push(first.kind === "session" ? detectMove(day, c.ticker, b, [...c.sources], cfg, { emPct: c.emPct, bars: await minuteBars(c.ticker, day) })! : first);
  }
  moves.sort((a, b) => b.movePct - a.movePct);
  return { day, moves, checked: cands.length, noData };
}

/** The clean moves of `day` (desk-level, cached per day and settings). */
export function easyMovesOf(day: string): Promise<EasyDay> {
  const cfg = easyCfg();
  const key = `${day}|${JSON.stringify(cfg)}|${setting("pulse.easyMaxTickers")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = compute(day, cfg);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Plan marks (idea tier / catalyst tap) of `people` on `day` → "trader|TICKER". */
async function plannedKeys(people: readonly string[], day: string, db: Queryable = pool): Promise<Set<string>> {
  if (!people.length) return new Set();
  const rows = await rowsOf(db,
    `SELECT trader, ticker FROM plan_idea_marks WHERE day = $1 AND trader = ANY($2::text[])
     UNION SELECT trader, ticker FROM catalyst_marks WHERE day = $1 AND trader = ANY($2::text[]) AND (direction IS NOT NULL OR strength IS NOT NULL)`,
    [day, [...people]]);
  return new Set(rows.map((r) => `${r.trader}|${String(r.ticker).toUpperCase()}`));
}

export type EasyBoardMove = EasyMove & { rows: MatchRow[] };

/** Every move of `day` with one line per person of `people`. */
export async function easyMoneyFor(day: string, people: readonly string[]): Promise<Omit<EasyDay, "moves"> & { moves: EasyBoardMove[] }> {
  const d = await easyMovesOf(day);
  if (!d.moves.length || !people.length) return { ...d, moves: d.moves.map((m) => ({ ...m, rows: [] })) };
  const tickers = new Set(d.moves.map((m) => m.ticker));
  const [trades, planned] = await Promise.all([flowTrades(null, day, day, [...people]), plannedKeys(people, day)]);
  const by = new Map<string, PersonDay["trades"][number][]>();
  for (const t of trades) {
    const k = `${t.trader}|${t.ticker.toUpperCase()}`;
    if (!tickers.has(t.ticker.toUpperCase()) || t.result === "open") continue;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return {
    ...d,
    moves: d.moves.map((m) => ({
      ...m,
      rows: people.map((p) => matchMove(m, { trader: p, planned: planned.has(`${p}|${m.ticker}`), trades: by.get(`${p}|${m.ticker}`) ?? [] })),
    })),
  };
}

export type PersonalEasyMoney = { day: string; lines: EasyLine[]; moves: number; checked: number; noData: number };

/** The debrief lines of one trader for `day`. */
export async function personalEasyMoney(trader: string, day: string): Promise<PersonalEasyMoney> {
  const d = await easyMoneyFor(day, [trader]);
  const rows = new Map(d.moves.map((m) => [m.ticker, m.rows[0]!] as const).filter(([, r]) => !!r));
  return { day, lines: personalLines(d.moves, rows, setting("pulse.easyDebriefMissed")), moves: d.moves.length, checked: d.checked, noData: d.noData };
}

// ─── the author's plan notes ──────────────────────────────────────────────────────────────────────────────────────

export const NOTE_MAX = 500;

export async function notesOf(author: string, day: string, db: Queryable = pool): Promise<Record<string, string>> {
  const rows = await rowsOf(db, `SELECT ticker, note FROM easy_money_notes WHERE author = $1 AND day = $2`, [author, day]);
  return Object.fromEntries(rows.map((r) => [String(r.ticker), String(r.note)]));
}

/** Upserts the author's note on a ticker of a day; an empty note removes it. */
export async function saveNote(author: string, day: string, ticker: string, note: string, db: Queryable = pool): Promise<{ ticker: string; note: string | null }> {
  const text = note.trim().slice(0, NOTE_MAX);
  if (!text) {
    await db.query(`DELETE FROM easy_money_notes WHERE author = $1 AND day = $2 AND ticker = $3`, [author, day, ticker]);
    return { ticker, note: null };
  }
  await db.query(
    `INSERT INTO easy_money_notes (author, day, ticker, note) VALUES ($1, $2, $3, $4)
     ON CONFLICT (author, day, ticker) DO UPDATE SET note = EXCLUDED.note, updated_at = now()`,
    [author, day, ticker, text],
  );
  return { ticker, note: text };
}
