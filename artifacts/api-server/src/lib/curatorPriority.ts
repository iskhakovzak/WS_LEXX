/**
 * Inputs of the curator priority score (roadmap R11, lib/curatorLogic priorityScore) for a roster, in one round of SQL:
 *
 *   shrunkMean20     mean daily net of the last 20 trading days, shrunk toward the roster (P2: method-of-moments prior
 *                    over traders with ≥ 5 active days; else toward the roster's mean with τ = $50/day)
 *   leakCostPerDay   Σ |$ per active day| of the latest edge-map LEAK slices (R4, lib/edgeMapStore)
 *   activityDrop     active days in the last 20 trading days fell ≥ 40% vs the previous 20
 *   noGreenWeek6     no week with a positive net in the last 6 weeks (traded weeks only; no trades at all = no signal)
 *   completionDrop   share of active days with a closed day (EOD) or a ready plan fell ≥ 30 pp (last 20 vs previous 20)
 *
 * The SLA part (overdue review items) and the plateau come from the cabinet's bulk load (routes/curator.ts). v2 of the
 * dropout part is a fitted hazard (R13); the weights are a starting point for the owner / curators to tune (R9).
 */
import { pool } from "@workspace/db";
import { addDays } from "./tradingDate";
import { mondayOf } from "./curatorLogic";
import { deskPrior, shrink } from "./stats";
import { leakCostsPerDay } from "./edgeMapStore";
import type { PriorityInputs } from "./curatorLogic";
import type { Queryable } from "./interventions/log";

/** The last `n` weekdays up to and including `today` (holidays not excluded), oldest first. */
export function lastWeekdays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let d = today; out.length < n; d = addDays(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d);
  }
  return out;
}

type DayStat = { trader: string; day: string; net: number };

/** Pure part: the inputs from per-day rows (exported for tests). Missing traders get the empty inputs. */
export function priorityInputsFrom(
  traders: readonly string[],
  today: string,
  days: readonly DayStat[],
  completed: ReadonlyMap<string, ReadonlySet<string>>,
  leaks: ReadonlyMap<string, number>,
): Map<string, Omit<PriorityInputs, "overdueQueue">> {
  const w40 = lastWeekdays(today, 40);
  const recent = new Set(w40.slice(20));
  const prior = new Set(w40.slice(0, 20));
  const sixWeeksFrom = addDays(mondayOf(today), -35);
  const by = new Map<string, DayStat[]>();
  for (const d of days) by.set(d.trader, [...(by.get(d.trader) ?? []), d]);
  const units = traders.map((t) => {
    const nets = (by.get(t) ?? []).filter((d) => recent.has(d.day)).map((d) => d.net);
    const n = nets.length;
    const mean = n ? nets.reduce((a, v) => a + v, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(nets.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
    return { t, n, xbar: mean, se: n ? Math.max(sd, 1) / Math.sqrt(n) : Number.POSITIVE_INFINITY };
  });
  const withData = units.filter((u) => u.n > 0);
  const deskMean = withData.length ? withData.reduce((a, u) => a + u.xbar, 0) / withData.length : 0;
  const prior20 = deskPrior(withData.map((u) => ({ xbar: u.xbar, se: u.se, n: u.n })), { minN: 5, minUnits: 5, tauMin: 1, fallbackMu: deskMean, fallbackTau: 50 });
  const out = new Map<string, Omit<PriorityInputs, "overdueQueue">>();
  for (const u of units) {
    const mine = by.get(u.t) ?? [];
    const activeRecent = mine.filter((d) => recent.has(d.day)).length;
    const activePrior = mine.filter((d) => prior.has(d.day)).length;
    const weeks = new Map<string, number>();
    for (const d of mine) if (d.day >= sixWeeksFrom && d.day <= today) weeks.set(mondayOf(d.day), (weeks.get(mondayOf(d.day)) ?? 0) + d.net);
    const done = completed.get(u.t) ?? new Set<string>();
    const rate = (set: ReadonlySet<string>) => {
      const act = mine.filter((d) => set.has(d.day));
      return act.length ? act.filter((d) => done.has(d.day)).length / act.length : null;
    };
    const rRecent = rate(recent);
    const rPrior = rate(prior);
    out.set(u.t, {
      shrunkMean20: u.n ? shrink(u.xbar, u.se, prior20).theta : null,
      leakCostPerDay: leaks.get(u.t) ?? 0,
      activityDrop: activePrior >= 5 && activeRecent <= 0.6 * activePrior,
      noGreenWeek6: weeks.size > 0 && ![...weeks.values()].some((v) => v > 0),
      completionDrop: rRecent != null && rPrior != null && rPrior - rRecent >= 0.3,
      trialAttention: false,
    });
  }
  return out;
}

/** The R11 inputs (without the SLA part) of every trader in `traders`. Missing optional tables → empty signals. */
export async function loadPriorityInputs(traders: readonly string[], today: string, db: Queryable = pool): Promise<Map<string, Omit<PriorityInputs, "overdueQueue">>> {
  if (!traders.length) return new Map();
  const from = lastWeekdays(today, 40)[0] < addDays(mondayOf(today), -35) ? lastWeekdays(today, 40)[0] : addDays(mondayOf(today), -35);
  const soft = <T>(p: Promise<{ rows: T[] }>) => p.catch(() => ({ rows: [] as T[] }));
  const [days, eod, plans, leaks] = await Promise.all([
    soft(db.query(
      `SELECT trader, LEFT(COALESCE(exit_date, date), 10) AS day, SUM(pnl - ABS(COALESCE(fees, 0)))::float AS net
         FROM trades WHERE deleted_at IS NULL AND pnl IS NOT NULL AND LOWER(TRIM(result)) <> 'open' AND trader = ANY($1::text[])
          AND LEFT(COALESCE(exit_date, date), 10) BETWEEN $2 AND $3 GROUP BY 1, 2`,
      [traders, from, today],
    )),
    soft(db.query(`SELECT trader, date AS day FROM eod_days WHERE closed_at IS NOT NULL AND trader = ANY($1::text[]) AND date BETWEEN $2 AND $3`, [traders, from, today])),
    soft(db.query(`SELECT trader, date AS day FROM trader_plans WHERE deleted_at IS NULL AND status = 'ready' AND trader = ANY($1::text[]) AND date BETWEEN $2 AND $3`, [traders, from, today])),
    leakCostsPerDay(traders, db),
  ]);
  const completed = new Map<string, Set<string>>();
  for (const r of [...eod.rows, ...plans.rows] as any[]) {
    const t = String(r.trader);
    if (!completed.has(t)) completed.set(t, new Set());
    completed.get(t)!.add(String(r.day).slice(0, 10));
  }
  const stats = (days.rows as any[]).map((r) => ({ trader: String(r.trader), day: String(r.day), net: Number(r.net) }));
  return priorityInputsFrom(traders, today, stats, completed, leaks);
}
