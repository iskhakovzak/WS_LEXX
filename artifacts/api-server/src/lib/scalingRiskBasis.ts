/**
 * The risk desk's basis for the scaling metrics (lib/scalingEngine TraderInput.currentDrawdownUsd / drawdownBreachDates),
 * so tier progress and the risk header agree: the drawdown now from the all-time equity peak (daily nets by close day,
 * like routes/risk) and the days the desk recorded a drawdown breach (risk_alert_log, level breach) since `from`.
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql, num } from "./tradeMath";

export type RiskBasis = { currentDrawdownUsd: number; drawdownBreachDates: string[] };

export async function loadRiskBasis(trader: string | null, from: string, today: string): Promise<Map<string, RiskBasis>> {
  const [equity, breaches] = await Promise.all([
    pool.query<{ trader: string; d: string; net: number | null }>(
      `SELECT t.trader, LEFT(${closeDateSql("t")}, 10) AS d, SUM(${netPnlSql("t")})::float AS net
         FROM trades t
        WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND t.trader <> '' AND ($1::text IS NULL OR t.trader = $1)
          AND ${closedSql("t")} AND LEFT(${closeDateSql("t")}, 10) <= $2
        GROUP BY 1, 2 ORDER BY 2`,
      [trader, today],
    ).catch(() => ({ rows: [] as { trader: string; d: string; net: number | null }[] })),
    pool.query<{ trader: string; date: string }>(
      `SELECT trader, date FROM risk_alert_log WHERE level = 'breach' AND kind = 'drawdown' AND ($1::text IS NULL OR trader = $1) AND date >= $2`,
      [trader, from],
    ).catch(() => ({ rows: [] as { trader: string; date: string }[] })),
  ]);
  const out = new Map<string, RiskBasis & { cum: number; peak: number }>();
  const get = (t: string) => out.get(t) ?? out.set(t, { cum: 0, peak: 0, currentDrawdownUsd: 0, drawdownBreachDates: [] }).get(t)!;
  for (const r of equity.rows) {
    const e = get(String(r.trader));
    e.cum += num(r.net) ?? 0;
    e.peak = Math.max(e.peak, e.cum);
    e.currentDrawdownUsd = Math.round((e.peak - e.cum) * 100) / 100;
  }
  for (const r of breaches.rows) get(String(r.trader)).drawdownBreachDates.push(String(r.date));
  return new Map([...out].map(([t, { currentDrawdownUsd, drawdownBreachDates }]) => [t, { currentDrawdownUsd, drawdownBreachDates }]));
}
