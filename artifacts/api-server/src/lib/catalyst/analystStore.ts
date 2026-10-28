/**
 * Reads of the analyst feed for the catalyst strength (pure logic: ./analystSignal.ts). SQL only; GET never writes.
 *
 *   analystActsOf(tickers, from, to)   analyst_actions_cache rows of a window (all tickers when `tickers` is null)
 *   signalOpts()                       the desk thresholds (catalyst.analystClusterMin / ClusterHours / TargetPct)
 *   analystSignalsFor(day, tickers)    the strength signals that react on a plan day (prefill of catalyst_marks)
 *   analystDayTwo(today, tickers)      tickers analysts comment on today → net direction (the day-two lines)
 *   signalsBoard(trader, day)          the analyst page block: signals of the day and the session before, each with
 *                                      «in my watchlist / in my plan / my mark» so one tap confirms the strength
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { etWallToUtcSeconds, parseDateStrict } from "../candleDay";
import { reactionDay } from "../analystReaction";
import { analystSignals, dayTwoAnalyst, signalsForDay, type AnalystAct, type AnalystSignal, type SignalOpts } from "./analystSignal";
import { normTicker, type Direction } from "./model";
import type { Queryable } from "../interventions/log";

export function signalOpts(): SignalOpts {
  return {
    clusterMin: setting("catalyst.analystClusterMin"),
    windowHours: setting("catalyst.analystClusterHours"),
    targetPct: setting("catalyst.analystTargetPct"),
  };
}

/** 16:00 New York of `day` as an instant (the end of the session that can react). */
function closeOf(day: string): Date {
  const p = parseDateStrict(day);
  return p ? new Date(etWallToUtcSeconds(p, 16, 0) * 1000) : new Date(`${day}T20:00:00Z`);
}

export async function analystActsOf(tickers: readonly string[] | null, from: Date, to: Date, db: Queryable = pool): Promise<AnalystAct[]> {
  if (tickers && !tickers.length) return [];
  const { rows } = await db.query(
    `SELECT UPPER(ticker) AS ticker, graded_at, firm, action, to_grade, price_target, price_target_from
       FROM analyst_actions_cache
      WHERE graded_at >= $1 AND graded_at < $2 AND ($3::text[] IS NULL OR UPPER(ticker) = ANY($3::text[]))
      ORDER BY graded_at
      LIMIT 20000`,
    [from.toISOString(), to.toISOString(), tickers ? [...tickers] : null],
  );
  return rows.map((r) => ({
    ticker: String(r.ticker), at: new Date(r.graded_at), firm: String(r.firm ?? ""), action: String(r.action ?? ""),
    toGrade: r.to_grade ?? null, priceTarget: r.price_target, priceTargetFrom: r.price_target_from,
  }));
}

/** Actions that can feed the signals of `day`: from a few days before (a cluster may start the evening before) to the close. */
async function actsAround(day: string, tickers: readonly string[] | null, db: Queryable): Promise<AnalystAct[]> {
  const back = Math.ceil(Math.max(1, setting("catalyst.analystClusterHours")) / 24) + 3;
  return analystActsOf(tickers, closeOf(addDays(day, -back)), closeOf(day), db);
}

export async function analystSignalsFor(day: string, tickers: readonly string[], db: Queryable = pool): Promise<AnalystSignal[]> {
  if (!tickers.length) return [];
  return signalsForDay(await actsAround(day, tickers, db), day, signalOpts());
}

export async function analystDayTwo(today: string, tickers: readonly string[], db: Queryable = pool): Promise<Map<string, Direction | null>> {
  if (!tickers.length || !setting("catalyst.analystDayTwo")) return new Map();
  return dayTwoAnalyst(await analystActsOf(tickers, closeOf(addDays(today, -4)), closeOf(today), db), today);
}

export type BoardSignal = AnalystSignal & {
  /** The session the signal reacts on (the plan day or the one before). */
  day: string;
  inWatchlist: boolean;
  inPlan: boolean;
  mark: { direction: Direction | null; strength: "weak" | "strong" | null } | null;
};

/** The analyst page block «Сила катализатора»: the signals of `day` and of `prevDay`, newest first. */
export async function signalsBoard(trader: string, day: string, prevDay: string, db: Queryable = pool): Promise<{ day: string; opts: SignalOpts; signals: BoardSignal[] }> {
  const opts = signalOpts();
  const acts = await actsAround(day, null, db);
  const signals = analystSignals(acts, opts)
    .map((s) => ({ s, day: reactionDay(new Date(s.lastAt)) }))
    .filter((x) => x.day === day || x.day === prevDay)
    .slice(0, 60);
  const tickers = signals.map((x) => x.s.ticker);
  if (!tickers.length) return { day, opts, signals: [] };
  const [watch, plan, marks] = await Promise.all([
    db.query(
      `SELECT DISTINCT UPPER(TRIM(w.ticker)) AS t FROM watchlist w
        WHERE w.deleted_at IS NULL AND UPPER(TRIM(w.ticker)) = ANY($1::text[])
          AND (w.owner IS NULL OR w.owner = (SELECT id FROM users WHERE name = $2 LIMIT 1))
          AND COALESCE(LOWER(w.status), '') NOT IN ('passed', 'archived')`,
      [tickers, trader],
    ),
    db.query(
      `SELECT DISTINCT UPPER(TRIM(x->>'ticker')) AS t FROM trader_plans p
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.doc->'inPlay') = 'array' THEN p.doc->'inPlay' ELSE '[]'::jsonb END) x
        WHERE p.trader = $1 AND p.date = $2 AND p.deleted_at IS NULL`,
      [trader, day],
    ),
    db.query(`SELECT ticker, direction, strength FROM catalyst_marks WHERE trader = $1 AND day = $2 AND ticker = ANY($3::text[])`, [trader, day, tickers]),
  ]);
  const w = new Set(watch.rows.map((r) => String(r.t)));
  const p = new Set(plan.rows.map((r) => String(r.t)));
  const m = new Map(marks.rows.map((r) => [String(r.ticker), { direction: r.direction ?? null, strength: r.strength ?? null }]));
  return {
    day,
    opts,
    signals: signals.map(({ s, day: d }) => {
      const t = normTicker(s.ticker) ?? s.ticker;
      return { ...s, day: d, inWatchlist: w.has(t), inPlan: p.has(t), mark: m.get(t) ?? null };
    }),
  };
}
