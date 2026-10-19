/**
 * SQL and packing for GET /events/stats and GET /events/day-book (routes/events.ts), kept out of the route file.
 */
import { netPnlSql, resultSql, signedRSql } from "./tradeMath";

/** Post-event edge table: per (event type, session) reaction stats and the scoped trade stats around those events. */
export function eventStatsSql(where: string, scopeParam: string): string {
  // Two equi-joins (linked trade | same day + one of the event's tickers) instead of one OR-join with a regexp per
  // (event, trade) pair, and one GROUP BY instead of seven correlated sub-queries: ~1.4 s → ~40 ms for the whole desk.
  // A trade counts once per (event type, session) group, as before.
  // i18n-ignore (SQL matches stored RU / EN reaction text)
  return `WITH ev AS (
       SELECT e.id, LOWER(TRIM(e.event_type)) AS event_type, UPPER(COALESCE(e.session, '')) AS session, substring(e.date, 1, 10) AS d,
              e.percent_move, LOWER(COALESCE(e.reaction, '')) AS reaction,
              string_to_array(regexp_replace(UPPER(e.ticker), '[[:space:],;/]+', ',', 'g'), ',') AS tks
         FROM market_events e WHERE ${where}
     ),
     hit AS (
       SELECT ev.event_type, ev.session, t.id AS trade_id
         FROM ev JOIN trades t ON t.event_id = ev.id
        WHERE t.deleted_at IS NULL AND (${scopeParam}::text IS NULL OR t.trader = ${scopeParam})
       UNION
       SELECT ev.event_type, ev.session, t.id
         FROM ev JOIN trades t ON substring(t.date, 1, 10) = ev.d AND UPPER(t.ticker) = ANY(ev.tks)
        WHERE t.deleted_at IS NULL AND (${scopeParam}::text IS NULL OR t.trader = ${scopeParam})
     ),
     trs AS (
       SELECT h.event_type, h.session,
              COUNT(*)::int AS trades,
              COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS wins,
              COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::int AS losses,
              COUNT(*) FILTER (WHERE ${resultSql("t")} = 'be')::int AS be,
              SUM(${signedRSql("t")})::float AS sum_r,
              SUM(t.pnl)::float AS gross,
              SUM(ABS(COALESCE(t.fees, 0))) FILTER (WHERE t.pnl IS NOT NULL)::float AS fees
         FROM hit h JOIN trades t ON t.id = h.trade_id
        GROUP BY h.event_type, h.session
     ),
     evs AS (
       SELECT ev.event_type, ev.session,
              COUNT(DISTINCT ev.id)::int AS n,
              COUNT(ev.percent_move)::int AS with_move,
              AVG(ev.percent_move)::float AS avg_move,
              AVG(ABS(ev.percent_move))::float AS avg_abs_move,
              COUNT(*) FILTER (WHERE ev.percent_move > 0)::int AS up,
              COUNT(*) FILTER (WHERE ev.percent_move < 0)::int AS down,
              COUNT(*) FILTER (WHERE ev.reaction LIKE '%up%' OR ev.reaction LIKE '%рост%' OR ev.reaction LIKE '%гэп вверх%')::int AS reaction_up
         FROM ev
        GROUP BY ev.event_type, ev.session
     )
     SELECT evs.*, COALESCE(trs.trades, 0) AS trades, COALESCE(trs.wins, 0) AS wins, COALESCE(trs.losses, 0) AS losses,
            COALESCE(trs.be, 0) AS be, trs.sum_r, trs.gross, trs.fees
       FROM evs LEFT JOIN trs ON trs.event_type = evs.event_type AND trs.session = evs.session
      ORDER BY evs.n DESC, evs.event_type`;
}

/** Closed trades per entry day × ticker (count, W, L, net $), $1 = scope (null = whole desk). */
export const DAY_BOOK_SQL =
    `SELECT substring(t.date, 1, 10) AS d, UPPER(TRIM(COALESCE(t.ticker, ''))) AS tk,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'win')::int AS w,
            COUNT(*) FILTER (WHERE ${resultSql("t")} = 'loss')::int AS l,
            SUM(${netPnlSql("t")}) AS net
       FROM trades t
      WHERE t.deleted_at IS NULL
        AND ($1::text IS NULL OR t.trader = $1)
        AND ${resultSql("t")} IS DISTINCT FROM 'open'
        AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}'
      GROUP BY 1, 2
      ORDER BY 1, 2`;

/** One (entry day, ticker) cell of the day book: [ticker index, trades, wins, losses, net $]. */
export type DayBookCell = [number, number, number, number, number];
export type DayBook = { scope: string | null; tickers: string[]; days: [string, DayBookCell[]][] };

/**
 * Packs (day, ticker) aggregate rows into the compact day book: tickers once in a dictionary, cells grouped by day,
 * net rounded to cents. Rows must come sorted by day.
 */
export function packDayBook(
  scope: string | null,
  rows: { d: string; tk: string; n: number | string; w: number | string; l: number | string; net: number | string | null }[],
): DayBook {
  const tickers: string[] = [];
  const idx = new Map<string, number>();
  const days: [string, DayBookCell[]][] = [];
  for (const r of rows) {
    const d = String(r.d);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const tk = String(r.tk ?? "");
    let i = idx.get(tk);
    if (i === undefined) { i = tickers.length; tickers.push(tk); idx.set(tk, i); }
    const net = r.net == null ? 0 : Math.round(Number(r.net) * 100) / 100;
    const cell: DayBookCell = [i, Number(r.n), Number(r.w), Number(r.l), Number.isFinite(net) ? net : 0];
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(cell);
    else days.push([d, [cell]]);
  }
  return { scope, tickers, days };
}

