/**
 * Edge map storage and the nightly run (roadmap R4; table edge_map, migration 0247; pure engine lib/edgeMap.ts).
 *
 *   runEdgeMapNightly()        job edgemap.nightly (18:40 NY): the desk's closed trades of the last ~250 trading days →
 *                              computeEdgeMap → one run per as-of date (re-running the same date replaces it)
 *   edgeMapView(trader)        the latest verdicts of one trader: ≤ 3 STRENGTH, ≤ 3 LEAK (GET /edge/map, «Мой разбор»)
 *   leakCostsPerDay(traders)   Σ $ per active day of the latest LEAK slices (the curator priority, R11)
 *   topVerdicts(traders)       ≤ 3 LEAK + ≤ 3 STRENGTH slice keys per trader (the plateau diagnosis pack, R6)
 *
 * Nothing here is shown raw: only rows that passed every gate leave the store.
 */
import { pool } from "@workspace/db";
import { addDays, nyDate } from "./tradingDate";
import { setting } from "./settings/registry";
import { querySimTrades } from "./whatIfLoader";
import { computeEdgeMap, visibleVerdicts, type EdgeMapRow, type EdgeTrade } from "./edgeMap";
import type { SimTrade } from "./whatIfTypes";
import type { Queryable } from "./interventions/log";

/** Calendar days loaded to cover 250 desk trading days (holidays included). */
const LOAD_CALENDAR_DAYS = 380;

/** SimTrade (the what-if loader's shape) → EdgeTrade. Multi-day holds have no same-day exit minute. */
export function toEdgeTrade(t: SimTrade): EdgeTrade | null {
  if (!t.trader || t.gross == null) return null;
  const sameDay = !t.closeDay || t.closeDay === t.day;
  const exitMin = sameDay && t.entryMin != null && t.holdSec != null ? t.entryMin + t.holdSec / 60 : null;
  return {
    trader: t.trader, day: t.day, entryMin: t.entryMin, exitMin, seq: t.seq, net: t.gross - t.fees,
    notional: t.qty != null && t.entry != null && t.qty > 0 && t.entry > 0 ? t.qty * t.entry : null,
    price: t.entry, side: t.side, ticker: t.ticker, sizeRel: t.sizeRel ?? null,
  };
}

/** Replace the run of `asOf` and drop the NONE rows of older runs (their verdict rows stay). */
export async function saveEdgeMap(rows: readonly EdgeMapRow[], asOf: string, db: { connect: () => Promise<any> } = pool): Promise<number> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM edge_map WHERE as_of = $1::date`, [asOf]);
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const col = <K extends keyof EdgeMapRow>(k: K) => part.map((r) => r[k]);
      await c.query(
        `INSERT INTO edge_map (trader, as_of, slice_key, family, n, days, net, xbar_bps, se_bps, theta_bps, lo80, hi80, q, persist_blocks,
                               verdict, cost_per_day, cost_lo, cost_hi, prior_mu, prior_tau)
         SELECT t.trader, $2::date, t.slice_key, t.family, t.n, t.days, t.net, t.xbar, t.se, t.theta, t.lo, t.hi, t.q, t.persist, t.verdict,
                t.cost, t.cost_lo, t.cost_hi, t.mu, t.tau
           FROM UNNEST($1::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[],
                       $11::numeric[], $12::numeric[], $13::numeric[], $14::smallint[], $15::text[], $16::numeric[], $17::numeric[], $18::numeric[],
                       $19::numeric[], $20::numeric[])
                AS t(trader, slice_key, family, n, days, net, xbar, se, theta, lo, hi, q, persist, verdict, cost, cost_lo, cost_hi, mu, tau)`,
        [
          col("trader"), asOf, col("sliceKey"), col("family"), col("n"), col("days"), col("net"), col("xbarBps"), col("seBps"), col("thetaBps"),
          col("lo80Bps"), col("hi80Bps"), col("q"), col("persistBlocks"), col("verdict"), col("costPerDay"), col("costLo"), col("costHi"),
          col("priorMu"), col("priorTau"),
        ],
      );
    }
    await c.query(`DELETE FROM edge_map WHERE as_of < $1::date AND verdict = 'NONE'`, [asOf]);
    await c.query("COMMIT");
    return rows.length;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** The nightly job: compute and store today's (NY) edge map for the whole desk. */
export async function runEdgeMapNightly(opts: { signal?: AbortSignal; asOf?: string } = {}): Promise<{ asOf: string; trades: number; traders: number; rows: number; leaks: number; strengths: number }> {
  const asOf = opts.asOf ?? nyDate();
  const sim = await querySimTrades(null, addDays(asOf, -LOAD_CALENDAR_DAYS), asOf);
  if (opts.signal?.aborted) throw new Error("aborted");
  const trades = sim.map(toEdgeTrade).filter((t): t is EdgeTrade => t != null);
  const rows = computeEdgeMap(trades, { asOf, tauDefaultBps: setting("coach.tauDefaultBps"), minUsdPerDay: setting("coach.leakMinUsdPerDay") });
  if (opts.signal?.aborted) throw new Error("aborted");
  await saveEdgeMap(rows, asOf);
  return {
    asOf, trades: trades.length, traders: new Set(trades.map((t) => t.trader)).size, rows: rows.length,
    leaks: rows.filter((r) => r.verdict === "LEAK").length, strengths: rows.filter((r) => r.verdict === "STRENGTH").length,
  };
}

/** A verdict as people see it: the slice, its size, θ in $ per active day with the 80% interval. */
export type EdgeVerdict = {
  sliceKey: string;
  family: string;
  verdict: "LEAK" | "STRENGTH";
  n: number;
  days: number;
  perDay: number;
  perDayLo: number;
  perDayHi: number;
  thetaBps: number;
  persistBlocks: number;
};

export type EdgeMapView = { trader: string; asOf: string | null; earn: EdgeVerdict[]; lose: EdgeVerdict[] };

const num = (v: unknown) => Number(v);

function verdictOf(r: any): EdgeVerdict & { costPerDay: number } {
  return {
    sliceKey: String(r.slice_key), family: String(r.family), verdict: r.verdict, n: num(r.n), days: num(r.days),
    perDay: num(r.cost_per_day), perDayLo: num(r.cost_lo), perDayHi: num(r.cost_hi), thetaBps: num(r.theta_bps),
    persistBlocks: num(r.persist_blocks), costPerDay: num(r.cost_per_day),
  };
}

/** Latest run's verdict rows of the given traders (as_of = the newest run that has the trader). */
async function latestVerdictRows(traders: readonly string[], db: Queryable): Promise<any[]> {
  if (!traders.length) return [];
  const { rows } = await db.query(
    `SELECT m.trader, to_char(m.as_of, 'YYYY-MM-DD') AS as_of, m.slice_key, m.family, m.verdict, m.n, m.days, m.cost_per_day, m.cost_lo, m.cost_hi,
            m.theta_bps, m.persist_blocks
       FROM edge_map m
       JOIN (SELECT trader, MAX(as_of) AS as_of FROM edge_map WHERE trader = ANY($1::text[]) GROUP BY trader) l
         ON l.trader = m.trader AND l.as_of = m.as_of
      WHERE m.verdict <> 'NONE'`,
    [traders],
  );
  return rows;
}

/** The trader's latest edge map: at most 3 strengths and 3 leaks (the gates already applied). */
export async function edgeMapView(trader: string, db: Queryable = pool): Promise<EdgeMapView> {
  const [rows, latest] = await Promise.all([
    latestVerdictRows([trader], db),
    db.query(`SELECT to_char(MAX(as_of), 'YYYY-MM-DD') AS as_of FROM edge_map WHERE trader = $1`, [trader]),
  ]);
  const v = visibleVerdicts(rows.map(verdictOf));
  const strip = ({ costPerDay: _c, ...rest }: EdgeVerdict & { costPerDay: number }) => rest;
  return { trader, asOf: latest.rows[0]?.as_of ?? null, earn: v.earn.map(strip), lose: v.lose.map(strip) };
}

/** Σ |$ per active day| of each trader's latest LEAK slices (0 when none). */
export async function leakCostsPerDay(traders: readonly string[], db: Queryable = pool): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await latestVerdictRows(traders, db).catch(() => [])) {
    if (r.verdict !== "LEAK") continue;
    out.set(String(r.trader), (out.get(String(r.trader)) ?? 0) + Math.abs(num(r.cost_per_day)));
  }
  return out;
}

/** Up to 3 LEAK and 3 STRENGTH slices per trader with $ per day (the plateau diagnosis pack). */
export async function topVerdicts(traders: readonly string[], db: Queryable = pool): Promise<Map<string, { leaks: EdgeVerdict[]; strengths: EdgeVerdict[] }>> {
  const by = new Map<string, any[]>();
  for (const r of await latestVerdictRows(traders, db).catch(() => [])) by.set(String(r.trader), [...(by.get(String(r.trader)) ?? []), r]);
  const out = new Map<string, { leaks: EdgeVerdict[]; strengths: EdgeVerdict[] }>();
  for (const [t, rows] of by) {
    const v = visibleVerdicts(rows.map(verdictOf));
    out.set(t, { leaks: v.lose, strengths: v.earn });
  }
  return out;
}
