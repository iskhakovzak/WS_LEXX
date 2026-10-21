/**
 * The «из них IMX» line and the «Исключить IMX» switch outside the /trades facets: «Разбор дня» (routes/day-report.ts)
 * and «Мой разбор» (lib/myReview). IMX = strategy MOC (lib/tradeStrategy, lib/imx).
 *
 *   splitImx(items, exclude)          pure: the items to keep + the IMX count / net among ALL of them
 *   excludeImxSql(sql)                pure: a trades query (WHERE t.deleted_at IS NULL …) without IMX trades
 *   imxTotals(trader, from, to)       closed IMX trades of a trader by close day: { count, net }
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql } from "./tradeMath";

export interface ImxLine { count: number; net: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitImx<T>(items: readonly { imx: boolean; net: number | null; item: T }[], exclude: boolean): { kept: T[]; imx: ImxLine } {
  let count = 0, net = 0;
  const kept: T[] = [];
  for (const x of items) {
    if (x.imx) { count++; net += x.net ?? 0; }
    if (!(exclude && x.imx)) kept.push(x.item);
  }
  return { kept, imx: { count, net: round2(net) } };
}

/** The live-trades predicate every builder starts with (routes/edge buildWhere, routes/day-report): IMX added after it. */
const LIVE = "WHERE t.deleted_at IS NULL";
export const NOT_IMX_SQL = `COALESCE(t.strategy, '') <> 'MOC'`;

export function excludeImxSql(sql: string): string {
  const i = sql.indexOf(LIVE);
  if (i < 0) throw new Error("excludeImxSql: no live-trades predicate");
  return `${sql.slice(0, i + LIVE.length)} AND ${NOT_IMX_SQL}${sql.slice(i + LIVE.length)}`;
}

export async function imxTotals(trader: string, from: string, to: string): Promise<ImxLine> {
  const day = `substring(${closeDateSql("t")} from 1 for 10)`;
  const { rows } = await pool.query<{ n: number; net: number | null }>(
    `SELECT COUNT(*)::int AS n, SUM(${netPnlSql("t")})::float8 AS net FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND t.strategy = 'MOC' AND ${closedSql("t")} AND ${day} >= $2 AND ${day} <= $3`,
    [trader, from, to],
  );
  return { count: Number(rows[0]?.n ?? 0), net: round2(Number(rows[0]?.net ?? 0)) };
}
