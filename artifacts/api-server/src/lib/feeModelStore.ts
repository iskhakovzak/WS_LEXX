/**
 * DB side of the fee model (lib/feeModel) and the breakeven line (lib/breakeven): one trader's closed trades of the
 * last coach.feeWindowDays ACTIVE days (days with closed trades) up to `to`. Used by GET /edge/costs?group=price and
 * the weekly review. Money: gross = pnl, fees = |fees|, net = pnl − |fees| (lib/tradeMath).
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql } from "./tradeMath";
import { setting } from "./settings/registry";
import { buildFeeModel, type FeeModel, type FeeModelTrade } from "./feeModel";
import { edgeMargin, type EdgeMargin } from "./coreMetrics/kpi";

export type FeeWindow = { from: string | null; to: string; days: number; trades: (FeeModelTrade & { net: number | null })[] };

const CLOSE_DAY = `substring(${closeDateSql("t")} from 1 for 10)`;

export async function loadFeeWindow(trader: string, to: string, days: number = setting("coach.feeWindowDays")): Promise<FeeWindow> {
  const { rows } = await pool.query<{ day: string; entry: number | null; qty: number | null; gross: number | null; fees: number; net: number | null }>(
    `WITH d AS (
       SELECT DISTINCT ${CLOSE_DAY} AS d FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")} AND t.pnl IS NOT NULL AND ${CLOSE_DAY} <= $2
        ORDER BY 1 DESC LIMIT $3)
     SELECT ${CLOSE_DAY} AS day, t.entry::float8 AS entry, t.qty::float8 AS qty, t.pnl::float8 AS gross,
            ABS(COALESCE(t.fees, 0))::float8 AS fees, ${netPnlSql("t")}::float8 AS net
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader = $1 AND ${closedSql("t")} AND t.pnl IS NOT NULL AND ${CLOSE_DAY} IN (SELECT d FROM d)
      ORDER BY 1, t.id`,
    [trader, to, days],
  );
  const trades = rows.map((r) => ({ day: String(r.day), entry: r.entry, qty: r.qty, gross: r.gross, fees: Number(r.fees) || 0, net: r.net }));
  return { from: trades[0]?.day ?? null, to, days: new Set(trades.map((t) => t.day)).size, trades };
}

export type FeeCoaching = { window: { from: string | null; to: string; days: number }; model: FeeModel; breakeven: EdgeMargin | null };

/** The fee model + the breakeven line of one trader's rolling window. */
export async function feeCoachingFor(trader: string, to: string): Promise<FeeCoaching> {
  const w = await loadFeeWindow(trader, to);
  return { window: { from: w.from, to: w.to, days: w.days }, model: buildFeeModel(w.trades), breakeven: edgeMargin(w.trades.map((t) => t.net)) };
}
