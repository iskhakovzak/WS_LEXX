/**
 * Catalyst marks storage and the reads around them (table catalyst_marks + playbook.formula, migration 0276; pure
 * logic in ./model.ts). SQL only, no request handling (routes/catalysts.ts, the mentor facts).
 *
 *   saveMark / marksOf               the two taps of a (trader, day, ticker) — upsert of the whole state
 *   dayEvents / dayMoves             what a day's tickers had: events-page rows, earnings (Finviz), the archived daily move
 *   catalystTrades / edgeOf          the trader's closed trades of a window (setup rolled up to the parent) → the slice
 *   dayHintsOf                       the prefill suggestions for the tickers a screen shows
 *   dayTwoOf                         today's «day two» lines (yesterday's strong catalysts that moved big)
 *   formulaBreaksOf                  recent trades entered without the catalyst their setup's formula needs
 * GET never writes: everything here except saveMark only reads.
 */
import { pool } from "@workspace/db";
import { closedSql } from "../tradeMath";
import { addDays } from "../tradingDate";
import { isMarketClosed } from "../marketDays";
import { normFormula, type StrategyFormula } from "../strategyFormula";
import {
  catalystEdge, dayTwoHints, eventDirection, formulaBreaks, hintFrom, kindOfEventType, normTicker,
  type CatalystEdge, type CatalystMark, type CatalystTrade, type DayEvent, type DayTwoHint, type Direction, type FormulaBreak,
  type Hint, type Kind, type MarkSource, type SetupLite, type Strength,
} from "./model";
import type { Queryable } from "../interventions/log";
import { analystDayTwo, analystSignalsFor } from "./analystStore";
import { withAnalystStrength } from "./analystSignal";

const MARK_COLS = `trader, day, ticker, direction, strength, kind, source, suggested`;

function toMark(r: any): CatalystMark {
  return {
    trader: String(r.trader), day: String(r.day), ticker: String(r.ticker), direction: r.direction ?? null, strength: r.strength ?? null,
    kind: r.kind ?? null, source: r.source === "watchlist" ? "watchlist" : "plan", suggested: r.suggested === true,
  };
}

/** The trader's marks of [from, to] (NY days, inclusive). */
export async function marksOf(trader: string, from: string, to: string, db: Queryable = pool): Promise<CatalystMark[]> {
  const { rows } = await db.query(`SELECT ${MARK_COLS} FROM catalyst_marks WHERE trader = $1 AND day BETWEEN $2 AND $3 ORDER BY day, ticker`, [trader, from, to]);
  return rows.map(toMark);
}

export type MarkInput = { direction: Direction | null; strength: Strength | null; kind: Kind | null; source: MarkSource; suggested: boolean };

/** Writes the current state of the two taps (both null = cleared; the row stays, it counts as unmarked). */
export async function saveMark(trader: string, day: string, ticker: string, m: MarkInput, db: Queryable = pool): Promise<CatalystMark> {
  const { rows } = await db.query(
    `INSERT INTO catalyst_marks (trader, day, ticker, direction, strength, kind, source, suggested)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (trader, day, ticker) DO UPDATE SET direction = EXCLUDED.direction, strength = EXCLUDED.strength,
       kind = COALESCE(EXCLUDED.kind, catalyst_marks.kind), source = EXCLUDED.source, suggested = EXCLUDED.suggested, updated_at = now()
     RETURNING ${MARK_COLS}`,
    [trader, day, ticker, m.direction, m.strength, m.kind, m.source, m.suggested],
  );
  return toMark(rows[0]);
}

/**
 * Events-page rows of `day` (desk-wide) and the earnings that move `day` (a report that day, or after the close the
 * session before) for `tickers`. Directions come from the logged move / reaction; earnings carry none here (the gap
 * gives it, ./model hintFrom).
 */
export async function dayEvents(day: string, tickers: readonly string[] | null, db: Queryable = pool): Promise<DayEvent[]> {
  const prev = await prevSessionDay(day);
  const [ev, er] = await Promise.all([
    db.query(
      `SELECT UPPER(TRIM(ticker)) AS ticker, event_type, reaction, percent_move::float8 AS move
         FROM market_events WHERE deleted_at IS NULL AND substring(date, 1, 10) = $1 ORDER BY id`,
      [day],
    ),
    tickers && tickers.length
      ? db.query(
        `SELECT UPPER(ticker) AS ticker FROM finviz_earnings
          WHERE superseded_at IS NULL AND UPPER(ticker) = ANY($3::text[])
            AND ((date = $1 AND COALESCE(timing, 'bmo') <> 'amc') OR (date = $2 AND timing = 'amc'))`,
        [day, prev, tickers],
      )
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const out: DayEvent[] = [];
  for (const r of ev.rows) {
    const ticker = normTicker(r.ticker);
    if (!ticker) continue;
    const movePct = r.move == null ? null : Number(r.move);
    out.push({ ticker, kind: kindOfEventType(r.event_type), direction: eventDirection({ type: r.event_type, reaction: r.reaction, movePct }), movePct, source: "event" });
  }
  for (const r of er.rows) {
    const ticker = normTicker(r.ticker);
    if (ticker) out.push({ ticker, kind: "earnings", direction: null, movePct: null, source: "earnings" });
  }
  return out;
}

/** The archived daily numbers of `day` (candle archive: close vs the close before, the opening gap), in %. */
export async function dayMoves(day: string, tickers: readonly string[], db: Queryable = pool): Promise<Map<string, { move: number | null; gap: number | null }>> {
  const out = new Map<string, { move: number | null; gap: number | null }>();
  if (!tickers.length) return out;
  const { rows } = await db.query(
    `SELECT DISTINCT ON (symbol) symbol, rth_open::float8 AS o, rth_close::float8 AS c, prev_close::float8 AS p
       FROM candle_archive WHERE day = $1::date AND symbol = ANY($2::text[]) AND prev_close > 0
      ORDER BY symbol, extended, tf`,
    [day, tickers],
  );
  const pct = (a: number | null, p: number) => (a == null || !Number.isFinite(a) ? null : Math.round(((a - p) / p) * 10_000) / 100);
  for (const r of rows) out.set(String(r.symbol), { move: pct(r.c, Number(r.p)), gap: pct(r.o, Number(r.p)) });
  return out;
}

/** The NY trading session before `day` (weekends and full-day holidays skipped). */
export async function prevSessionDay(day: string): Promise<string> {
  let d = addDays(day, -1);
  for (let i = 0; i < 7 && (await isMarketClosed(d)); i++) d = addDays(d, -1);
  return d;
}

/** Prefill suggestions for the tickers of a screen on `day` (an event, earnings with the gap, or the gap alone). */
export async function dayHintsOf(day: string, tickers: readonly string[], db: Queryable = pool): Promise<Hint[]> {
  if (!tickers.length) return [];
  const [events, moves, signals] = await Promise.all([dayEvents(day, tickers, db), dayMoves(day, tickers, db), analystSignalsFor(day, tickers, db)]);
  const hints = tickers.map((t) => hintFrom(t, events, moves.get(t)?.gap ?? null)).filter((h): h is Hint => h != null);
  return withAnalystStrength(hints, signals, tickers) as Hint[];
}

// ─── trades ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The trader's closed trades with $ in [from, to] by entry day; the setup is the top-level one (a variant → its parent). */
export async function catalystTrades(trader: string, from: string, to: string, db: Queryable = pool): Promise<CatalystTrade[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.trader, LEFT(t.date, 10) AS day, UPPER(TRIM(t.ticker)) AS ticker, t.result, t.side, t.entry, t.exit, t.stop,
            t.pnl, t.fees, t.r_multiple AS "rMultiple", t.risk_usd AS "riskUsd",
            COALESCE(pp.id, p.id) AS setup_id, COALESCE(pp.name, p.name) AS setup_name
       FROM trades t
       LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
       LEFT JOIN playbook pp ON pp.id = p.parent_id AND pp.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND t.pnl IS NOT NULL AND ${closedSql("t")}
        AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(t.date, 10) BETWEEN $2 AND $3
      ORDER BY t.date, t.id`,
    [trader, from, to],
  );
  return rows.map((r) => ({
    id: Number(r.id), trader: String(r.trader), day: String(r.day), ticker: String(r.ticker), result: r.result, side: r.side,
    entry: r.entry, exit: r.exit, stop: r.stop, pnl: r.pnl, fees: r.fees, rMultiple: r.rMultiple, riskUsd: r.riskUsd,
    setupId: r.setup_id == null ? null : Number(r.setup_id), setupName: r.setup_name == null ? null : String(r.setup_name),
  }));
}

/** The catalyst slice of one trader's window. */
export async function edgeOf(trader: string, from: string, to: string, db: Queryable = pool): Promise<CatalystEdge> {
  const [trades, marks] = await Promise.all([catalystTrades(trader, from, to, db), marksOf(trader, from, to, db)]);
  return catalystEdge(trades, marks);
}

// ─── mentor ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tickers a trader had in view on `day`: own plan, the desk plan, own marks and the «in play» watchlist rows. */
async function tickersInView(trader: string, day: string, db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT UPPER(TRIM(x.t)) AS ticker FROM (
       SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(doc->'inPlay') = 'array' THEN doc->'inPlay' ELSE '[]'::jsonb END)->>'ticker' AS t
         FROM trader_plans WHERE trader = $1 AND date = $2 AND deleted_at IS NULL
       UNION ALL
       SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(in_play) = 'array' THEN in_play ELSE '[]'::jsonb END)->>'ticker'
         FROM game_plans WHERE date = $2 AND deleted_at IS NULL
       UNION ALL
       SELECT ticker FROM catalyst_marks WHERE trader = $1 AND day = $2
       UNION ALL
       SELECT w.ticker FROM watchlist w
         WHERE w.deleted_at IS NULL AND w.in_play AND (w.owner IS NULL OR w.owner = (SELECT id FROM users WHERE name = $1 LIMIT 1))
     ) x WHERE x.t IS NOT NULL`,
    [trader, day],
  );
  return rows.map((r) => normTicker(r.ticker)).filter((t): t is string => !!t).slice(0, 200);
}

/** Setups a trader may pick from (office + own, top level), with their formulas — the day-two link. */
async function setupsOf(trader: string, db: Queryable): Promise<SetupLite[]> {
  const { rows } = await db.query(
    `SELECT id, name, setup_type, formula FROM playbook
      WHERE deleted_at IS NULL AND parent_id IS NULL
        AND (COALESCE(space, CASE WHEN trader IS NULL THEN 'office' ELSE 'personal' END) = 'office' OR trader = $1)
      ORDER BY id LIMIT 500`,
    [trader],
  );
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), setupType: r.setup_type ?? null, formula: normFormula(r.formula) }));
}

/** Today's «day two» lines for `trader` (yesterday = the session before `today`). */
export async function dayTwoOf(trader: string, today: string, minMovePct: number, db: Queryable = pool): Promise<{ yesterday: string; hints: DayTwoHint[] }> {
  const yesterday = await prevSessionDay(today);
  const [marks, inView, setups] = await Promise.all([marksOf(trader, yesterday, yesterday, db), tickersInView(trader, yesterday, db), setupsOf(trader, db)]);
  const events = await dayEvents(yesterday, inView, db);
  const tickers = [...new Set([...inView, ...events.map((e) => e.ticker)])];
  const moves = await dayMoves(yesterday, tickers, db);
  const moveOnly = new Map([...moves].filter(([, v]) => v.move != null).map(([k, v]) => [k, v.move as number]));
  const analyst = await analystDayTwo(today, tickers, db);
  return { yesterday, hints: dayTwoHints({ marks, events, moves: moveOnly, minMovePct, setups, analyst }) };
}

/** The trader's trades of [from, to] on a setup whose formula needs a catalyst, checked against the plan marks. */
export async function formulaBreaksOf(trader: string, from: string, to: string, db: Queryable = pool): Promise<FormulaBreak[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.trader, LEFT(t.date, 10) AS day, UPPER(TRIM(t.ticker)) AS ticker, p.id AS setup_id, p.name AS setup_name,
            COALESCE(p.formula, pp.formula) AS formula
       FROM trades t
       JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
       LEFT JOIN playbook pp ON pp.id = p.parent_id AND pp.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND COALESCE(p.formula, pp.formula) IS NOT NULL
        AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(t.date, 10) BETWEEN $2 AND $3
      ORDER BY t.date DESC, t.id DESC LIMIT 200`,
    [trader, from, to],
  );
  if (!rows.length) return [];
  const formulas = new Map<number, StrategyFormula>();
  const trades = rows.map((r) => {
    const setupId = Number(r.setup_id);
    const f = normFormula(r.formula);
    if (f) formulas.set(setupId, f);
    return { id: Number(r.id), trader: String(r.trader), day: String(r.day), ticker: String(r.ticker), setupId, setupName: String(r.setup_name) };
  });
  return formulaBreaks(trades, formulas, await marksOf(trader, from, to, db));
}
