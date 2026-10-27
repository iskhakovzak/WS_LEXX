/**
 * The risk desk's basis for the scaling metrics (lib/scalingEngine TraderInput.currentDrawdownUsd / drawdownBreachDates),
 * so tier progress and the risk header agree: the drawdown now from the equity peak — the risk desk's own number
 * (lib/coreMetrics drawdownsFromPeak: broker rows win per day, the curator review resets the peak) — and the days the
 * desk recorded a drawdown breach (risk_alert_log, level breach) since `from`.
 */
import { pool } from "@workspace/db";
import { drawdownsFromPeak } from "./coreMetrics/risk";

export type RiskBasis = { currentDrawdownUsd: number; drawdownBreachDates: string[] };

export async function loadRiskBasis(trader: string | null, from: string, today: string): Promise<Map<string, RiskBasis>> {
  const [dd, breaches] = await Promise.all([
    drawdownsFromPeak(trader, today).catch(() => new Map<string, number>()),
    pool.query<{ trader: string; date: string }>(
      `SELECT trader, date FROM risk_alert_log WHERE level = 'breach' AND kind = 'drawdown' AND ($1::text IS NULL OR trader = $1) AND date >= $2`,
      [trader, from],
    ).catch(() => ({ rows: [] as { trader: string; date: string }[] })),
  ]);
  const out = new Map<string, RiskBasis>();
  const get = (t: string) => out.get(t) ?? out.set(t, { currentDrawdownUsd: 0, drawdownBreachDates: [] }).get(t)!;
  for (const [t, v] of dd) get(t).currentDrawdownUsd = v;
  for (const r of breaches.rows) get(String(r.trader)).drawdownBreachDates.push(String(r.date));
  return out;
}
