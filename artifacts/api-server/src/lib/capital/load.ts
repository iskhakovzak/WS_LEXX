/**
 * Capital allocation — what the engine reads (read-only). The roster, tiers, the ladder's recommendation and the
 * pending proposals come from the scaling plan itself (routes/scaling evaluateScope: the same traders, staff
 * excluded); the rest is one query per source over the window:
 *
 *   trades            closed trades by close day: Σ net, count, Σ signed R (lib/tradeMath); broker rows only when the
 *                     trader has any in the window (as the scaling metrics)
 *   desk regime       desk_regime_days by day (lib/marketRegime) — the day's regime and «this week's» regime
 *   discipline        behaviour discipline index (lib/disciplineDays), rule_violations + trading_errors, eod_days
 *                     closed, risk_alert_log breach days
 *   limits / stage    trader_risk_limits (daily, weekly, buying_power), lib/people/stage (Джун)
 *   achievements      big achievements as a positive signal (lib/achievements/signal: held setup mastery, closed leaks,
 *                     clean months, comebacks; reset by a fresh violation)
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql, num, signedRSql } from "../tradeMath";
import { violationDaySql } from "../violationWindow";
import { windowStart } from "../scalingEngine";
import { loadDisciplineDaysFor } from "../disciplineDays";
import { disciplineIndexOf } from "../disciplineIndex";
import { loadStageInfo } from "../people/stage";
import { regimeDaysMap } from "../marketRegime/store";
import { isWeekend, addDays } from "../tradingDate";
import type { RegimeKey } from "../marketRegime/regimes";
import type { CapDay, CapDiscipline, CapTier, CapTraderInput, LadderAction } from "./types";
import { loadAchievementSignals } from "../achievements/signal";
import { disabledLines } from "../achievements/view";

/** How far back «this week's regime» looks when today has none (trading days). */
const REGIME_LOOKBACK_DAYS = 5;

type DayAgg = { trader: string; d: string; src: string; net: number | null; n: number; rsum: number | null; rn: number };

export type CapitalInputs = {
  from: string;
  inputs: CapTraderInput[];
  tiers: CapTier[];
  regime: { key: RegimeKey; source: "today" | "week" } | null;
  /** trader → the id of the pending capital (limits) proposal. */
  pending: Map<string, number>;
};

/** Today's desk regime, else the latest one of the last REGIME_LOOKBACK_DAYS trading days. */
export function currentRegime(byDay: ReadonlyMap<string, RegimeKey>, today: string): { key: RegimeKey; source: "today" | "week" } | null {
  const own = byDay.get(today);
  if (own) return { key: own, source: "today" };
  let d = today;
  for (let seen = 0; seen < REGIME_LOOKBACK_DAYS;) {
    d = addDays(d, -1);
    if (isWeekend(d)) continue;
    seen++;
    const k = byDay.get(d);
    if (k) return { key: k, source: "week" };
  }
  return null;
}

async function loadDays(names: string[], from: string, today: string, regimes: ReadonlyMap<string, RegimeKey>): Promise<Map<string, CapDay[]>> {
  const close = `LEFT(${closeDateSql("t")}, 10)`;
  const r = signedRSql("t");
  const { rows } = await pool.query<DayAgg>(
    `SELECT t.trader, ${close} AS d,
            CASE WHEN t.source = 'propreports' OR t.context_snapshot ->> 'source' = 'propreports' THEN 'pr' ELSE 'manual' END AS src,
            SUM(${netPnlSql("t")})::float8 AS net, COUNT(*)::int AS n, SUM(${r})::float8 AS rsum, COUNT(${r})::int AS rn
       FROM trades t
      WHERE t.deleted_at IS NULL AND t.trader = ANY($1::text[]) AND ${closedSql("t")} AND ${close} BETWEEN $2 AND $3
      GROUP BY 1, 2, 3`,
    [names, from, today],
  );
  const broker = new Set(rows.filter((x) => x.src === "pr").map((x) => x.trader));
  const out = new Map<string, Map<string, CapDay>>();
  for (const x of rows) {
    if (broker.has(x.trader) && x.src !== "pr") continue;
    const byDay = out.get(x.trader) ?? out.set(x.trader, new Map()).get(x.trader)!;
    const day = byDay.get(x.d) ?? { date: x.d, net: 0, trades: 0, rSum: 0, rCount: 0, regime: regimes.get(x.d) ?? null };
    day.net += num(x.net) ?? 0;
    day.trades += Number(x.n) || 0;
    day.rSum += num(x.rsum) ?? 0;
    day.rCount += Number(x.rn) || 0;
    byDay.set(x.d, day);
  }
  return new Map([...out].map(([t, m]) => [t, [...m.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}

async function countBy(sql: string, params: unknown[]): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ trader: string; n: number }>(sql, params).catch(() => ({ rows: [] as { trader: string; n: number }[] }));
  return new Map(rows.map((x) => [String(x.trader), Number(x.n) || 0]));
}

async function loadDiscipline(names: string[], from: string, today: string, days: Map<string, CapDay[]>): Promise<Map<string, CapDiscipline>> {
  const [index, viol, errs, stops, closed] = await Promise.all([
    loadDisciplineDaysFor(names, from, today),
    countBy(`SELECT trader, COUNT(*)::int AS n FROM rule_violations WHERE trader = ANY($1::text[]) AND archived_at IS NULL AND ${violationDaySql("")} BETWEEN $2 AND $3 GROUP BY 1`, [names, from, today]),
    countBy(`SELECT trader, COUNT(*)::int AS n FROM trading_errors WHERE trader = ANY($1::text[]) AND created_at >= $2::date AND created_at < ($3::date + 1) GROUP BY 1`, [names, from, today]),
    countBy(`SELECT trader, COUNT(DISTINCT date)::int AS n FROM risk_alert_log WHERE trader = ANY($1::text[]) AND level = 'breach' AND date BETWEEN $2 AND $3 GROUP BY 1`, [names, from, today]),
    pool.query<{ trader: string; date: string }>(
      `SELECT trader, date FROM eod_days WHERE trader = ANY($1::text[]) AND closed_at IS NOT NULL AND date BETWEEN $2 AND $3`, [names, from, today],
    ).catch(() => ({ rows: [] as { trader: string; date: string }[] })),
  ]);
  const closedBy = new Map<string, Set<string>>();
  for (const x of closed.rows) (closedBy.get(x.trader) ?? closedBy.set(x.trader, new Set()).get(x.trader)!).add(String(x.date).slice(0, 10));
  const out = new Map<string, CapDiscipline>();
  for (const name of names) {
    const traded = (days.get(name) ?? []).map((d) => d.date);
    const cl = closedBy.get(name);
    out.set(name, {
      index: disciplineIndexOf(index.get(name), from, today).value,
      tradedDays: traded.length,
      closedDays: cl ? traded.filter((d) => cl.has(d)).length : 0,
      violations: (viol.get(name) ?? 0) + (errs.get(name) ?? 0),
      stopDays: stops.get(name) ?? 0,
    });
  }
  return out;
}

export async function loadCapitalInputs(today: string, windowDays: number): Promise<CapitalInputs> {
  const { evaluateScope } = await import("../../routes/scaling");
  const { ensureScalingSeed } = await import("../scalingStore");
  await ensureScalingSeed();
  const from = windowStart(today, windowDays);
  const [{ tiers, traders }, regimes] = await Promise.all([evaluateScope(null, today, "ru"), regimeDaysMap(from, today)]);
  const names = traders.map((t) => t.trader);
  const [days, stages, extra, open] = await Promise.all([
    loadDays(names, from, today, regimes),
    loadStageInfo(names),
    pool.query<{ trader: string; bp: string | null }>(`SELECT trader, buying_power AS bp FROM trader_risk_limits WHERE trader = ANY($1::text[])`, [names]),
    pool.query<{ id: number; trader: string }>(`SELECT id, trader FROM scaling_proposals WHERE status = 'pending' AND kind = 'limits'`),
  ]);
  const bp = new Map(extra.rows.map((x) => [x.trader, num(x.bp)]));
  const [discipline, signals] = await Promise.all([
    loadDiscipline(names, from, today, days),
    loadAchievementSignals(names, today, disabledLines()).catch(() => new Map()),
  ]);
  const pending = new Map(open.rows.map((x) => [String(x.trader), Number(x.id)]));
  const inputs: CapTraderInput[] = traders.map((t) => {
    const stage = stages.get(t.trader)?.stage ?? null;
    return {
      trader: t.trader,
      tierKey: t.tierKey,
      junior: stage ? stage === "junior" : t.tierKey === "junior",
      dailyLossLimit: t.limits?.dailyLossLimit ?? null,
      weeklyLossLimit: t.limits?.weeklyLossLimit ?? null,
      buyingPower: bp.get(t.trader) ?? null,
      days: days.get(t.trader) ?? [],
      discipline: discipline.get(t.trader) ?? { index: null, tradedDays: 0, closedDays: 0, violations: 0, stopDays: 0 },
      ladderAction: t.recommendation.action as LadderAction,
      pendingTier: !!t.pendingProposal, // evaluateScope reads tier proposals only
      achievements: signals.get(t.trader) ?? null,
    };
  });
  return {
    from,
    inputs,
    tiers: tiers.map((t) => ({ key: t.key, order: t.order, dailyLossLimit: t.dailyLossLimit })),
    regime: currentRegime(regimes, today),
    pending,
  };
}
