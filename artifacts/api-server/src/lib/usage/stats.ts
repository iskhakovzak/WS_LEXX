/**
 * Admin console → «Использование» (GET /api/admin/usage): what members actually use, from usage_events plus the data
 * the desk already stores (plans, reviews, trades, trainer games) — events only for what is not stored anywhere.
 * Internal, admins only; never feeds rewards, rankings or pay.
 *
 *   activity   last 30 calendar days: DAU by role + WAU (tracked visits only)
 *   screens    top screens by unique users, 7 and 30 days (+ how many of them are traders)
 *   actions    the tracked daily-loop actions, 7 and 30 days
 *   funnel     every active trader × the last 10 trading days (lib/usage/funnel.ts), trainees first
 *   inactive   traders with no sign of presence for 3+ trading days (today never counts)
 *   pilot      the setting usage.pilotUsers resolved to stored names (unknown entries listed)
 */
import { pool } from "@workspace/db";
import { isMarketClosed } from "../marketDays";
import { addDays, nyDate } from "../tradingDate";
import { closeDateSql, closedSql } from "../tradeMath";
import { setting } from "../settings/registry";
import {
  activitySeries, funnelRow, funnelTotals, missedTradingDays, parsePilot, tierRank,
  type ActivityPoint, type FunnelCells, type FunnelStep, type TraderFacts,
} from "./funnel";

export const FUNNEL_DAYS = 10;
export const ACTIVITY_DAYS = 30;
export const INACTIVE_AFTER = 3;
const INACTIVE_WINDOW = 30;

export type UsageCount = { key: string; users: number; traders: number; count: number };
export type FunnelTrader = { name: string; tier: string | null; pilot: boolean; cells: FunnelCells; totals: Record<FunnelStep, number> };
export type InactiveTrader = { name: string; tier: string | null; pilot: boolean; lastSeen: string | null; missedDays: number; capped: boolean };
export type UsageOverview = {
  today: string;
  enabled: boolean;
  retentionDays: number;
  /** First day with any tracked event (null = nothing tracked yet). */
  trackedSince: string | null;
  activity: ActivityPoint[];
  screens: { d7: UsageCount[]; d30: UsageCount[] };
  actions: { d7: UsageCount[]; d30: UsageCount[] };
  funnel: { days: string[]; traders: FunnelTrader[] };
  inactive: InactiveTrader[];
  pilot: { names: string[]; unknown: string[] };
};

/** The last `n` trading days ending at `today` (today included when the market trades), ascending. */
export async function lastTradingDays(today: string, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let d = today, guard = 0; out.length < n && guard < n * 2 + 15; d = addDays(d, -1), guard++) {
    if (!(await isMarketClosed(d))) out.push(d);
  }
  return out.reverse();
}

type Person = { id: number; name: string; name_latin: string | null; tier: string | null };
type Counted = { key: string; users: number; traders: number; count: number };

async function topKeys(kind: "view" | "action", since: string, limit: number): Promise<UsageCount[]> {
  const { rows } = await pool.query<Counted>(
    `SELECT key, COUNT(DISTINCT user_id)::int AS users, COUNT(DISTINCT user_id) FILTER (WHERE role = 'trader')::int AS traders,
            COUNT(*)::int AS count
       FROM usage_events WHERE kind = $1 AND ny_day >= $2
      GROUP BY key ORDER BY users DESC, count DESC, key LIMIT $3`,
    [kind, since, limit],
  );
  return rows.map((r) => ({ key: r.key, users: Number(r.users), traders: Number(r.traders), count: Number(r.count) }));
}

const add = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => { const s = m.get(k) ?? new Set<V>(); s.add(v); m.set(k, s); };
const day = (v: Date | string) => nyDate(new Date(v));

/** Tag counts per (trader, close day) — the rule of lib/playbookToday/untagged.ts (setup link or «Не для плейбука»). */
async function tagCounts(from: string, to: string): Promise<{ trader: string; d: string; trades: number; tagged: number }[]> {
  const d = `LEFT(${closeDateSql("t")}, 10)`;
  const sql = (withDismissed: boolean) => `
    SELECT t.trader, ${d} AS d, COUNT(*)::int AS trades,
           COUNT(*) FILTER (WHERE p.id IS NOT NULL${withDismissed ? " OR EXISTS (SELECT 1 FROM playbook_inbox_dismissed x WHERE x.trade_id = t.id)" : ""})::int AS tagged
      FROM trades t LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND ${closedSql("t")} AND ${d} >= $1 AND ${d} <= $2
     GROUP BY 1, 2`;
  const run = (w: boolean) => pool.query<{ trader: string; d: string; trades: number; tagged: number }>(sql(w), [from, to]);
  const { rows } = await run(true).catch((err: { code?: string }) => { if (err?.code === "42P01") return run(false); throw err; });
  return rows;
}

/** Everything the funnel needs for [from, to], keyed by trader name. */
async function funnelFacts(from: string, to: string, names: readonly string[]): Promise<Map<string, TraderFacts>> {
  const since = addDays(from, -1); // timestamps: a little earlier, the NY day is decided in JS
  const [visits, plans, opens, tags, reviews, games] = await Promise.all([
    pool.query<{ trader: string; d: string }>(`SELECT DISTINCT trader, ny_day AS d FROM usage_events WHERE ny_day >= $1 AND ny_day <= $2`, [from, to]),
    pool.query<{ trader: string; date: string; created: Date; updated: Date }>(
      `SELECT trader, date, MIN(created_at) AS created, MAX(updated_at) AS updated FROM trader_plans
        WHERE deleted_at IS NULL AND date >= $1 AND date <= $2 GROUP BY 1, 2`, [from, to]),
    pool.query<{ trader: string; at: Date }>(`SELECT trader, at FROM usage_events WHERE kind = 'action' AND key = 'playbook.today' AND ny_day >= $1 AND ny_day <= $2`, [from, to]),
    tagCounts(from, to),
    pool.query<{ trader: string; date: string; reviewed_at: Date }>(
      `SELECT trader, date, reviewed_at FROM daily_reviews WHERE reviewed_at IS NOT NULL AND (date >= $1 OR reviewed_at >= $2::date)`, [from, since]),
    pool.query<{ trader: string; at: Date }>(
      `SELECT u.name AS trader, g.created_at AS at FROM sim_games g JOIN users u ON u.id = g.user_id WHERE g.created_at >= $1::date
       UNION ALL SELECT trader, created_at FROM trainer_drill_attempts WHERE created_at >= $1::date`, [since]),
  ]);
  const visit = new Map<string, Set<string>>();
  const plan = new Map<string, Map<string, Date>>();
  const open = new Map<string, Date[]>();
  const tag = new Map<string, Map<string, { trades: number; tagged: number }>>();
  const reviewed = new Map<string, Set<string>>();
  const trainer = new Map<string, Set<string>>();
  for (const r of visits.rows) add(visit, r.trader, r.d);
  for (const r of plans.rows) {
    const m = plan.get(r.trader) ?? new Map<string, Date>();
    m.set(r.date, new Date(r.created));
    plan.set(r.trader, m);
    add(visit, r.trader, day(r.created));
    add(visit, r.trader, day(r.updated));
  }
  for (const r of opens.rows) open.set(r.trader, [...(open.get(r.trader) ?? []), new Date(r.at)]);
  for (const r of tags) {
    const m = tag.get(r.trader) ?? new Map<string, { trades: number; tagged: number }>();
    m.set(r.d, { trades: Number(r.trades), tagged: Number(r.tagged) });
    tag.set(r.trader, m);
  }
  for (const r of reviews.rows) { add(reviewed, r.trader, r.date); add(visit, r.trader, day(r.reviewed_at)); }
  for (const r of games.rows) { add(trainer, r.trader, day(r.at)); add(visit, r.trader, day(r.at)); }
  const empty = new Set<string>();
  return new Map(names.map((n) => [n, {
    visitDays: visit.get(n) ?? empty,
    plans: plan.get(n) ?? new Map(),
    todayOpens: open.get(n) ?? [],
    tags: tag.get(n) ?? new Map(),
    reviewedDays: reviewed.get(n) ?? empty,
    trainerDays: trainer.get(n) ?? empty,
  } satisfies TraderFacts]));
}

/** Last sign of presence per trader, all time (tracked events + plan saves + reviews + trainer). */
async function lastSeen(): Promise<Map<string, Date>> {
  const { rows } = await pool.query<{ trader: string; at: Date }>(
    `SELECT trader, MAX(at) AS at FROM (
       SELECT trader, MAX(at) AS at FROM usage_events GROUP BY trader
       UNION ALL SELECT trader, MAX(updated_at) FROM trader_plans WHERE deleted_at IS NULL GROUP BY trader
       UNION ALL SELECT trader, MAX(reviewed_at) FROM daily_reviews WHERE reviewed_at IS NOT NULL GROUP BY trader
       UNION ALL SELECT u.name, MAX(g.created_at) FROM sim_games g JOIN users u ON u.id = g.user_id GROUP BY u.name
       UNION ALL SELECT trader, MAX(created_at) FROM trainer_drill_attempts GROUP BY trader
     ) x WHERE trader IS NOT NULL AND at IS NOT NULL GROUP BY trader`,
  );
  return new Map(rows.map((r) => [r.trader, new Date(r.at)]));
}

export async function usageOverview(now: Date = new Date()): Promise<UsageOverview> {
  const today = nyDate(now);
  const first = addDays(today, -(ACTIVITY_DAYS - 1));
  const calendar = Array.from({ length: ACTIVITY_DAYS }, (_, i) => addDays(first, i));
  const [people, window, activityRows, since, d7, d30, a7, a30, seen] = await Promise.all([
    pool.query<Person>(
      `SELECT u.id, u.name, u.name_latin, l.tier FROM users u LEFT JOIN trader_risk_limits l ON l.trader = u.name
        WHERE u.active AND NOT COALESCE(u.banned, false) AND u.role = 'trader'`),
    lastTradingDays(today, INACTIVE_WINDOW),
    pool.query<{ day: string; user_id: number; role: string }>(`SELECT DISTINCT ny_day AS day, user_id, role FROM usage_events WHERE ny_day >= $1`, [addDays(first, -6)]),
    pool.query<{ d: string | null }>(`SELECT MIN(ny_day) AS d FROM usage_events`),
    topKeys("view", addDays(today, -6), 25), topKeys("view", first, 25),
    topKeys("action", addDays(today, -6), 20), topKeys("action", first, 20),
    lastSeen(),
  ]);
  const pilot = parsePilot(String(setting("usage.pilotUsers") ?? ""), people.rows.map((p) => ({ name: p.name, nameLatin: p.name_latin })));
  const inPilot = new Set(pilot.names);
  const traders = [...people.rows].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name, "ru"));
  const days = window.slice(-FUNNEL_DAYS);
  const facts = days.length ? await funnelFacts(days[0]!, today, traders.map((t) => t.name)) : new Map<string, TraderFacts>();
  const funnel: FunnelTrader[] = traders.map((t) => {
    const cells = funnelRow(days, facts.get(t.name)!);
    return { name: t.name, tier: t.tier, pilot: inPilot.has(t.name), cells, totals: funnelTotals(cells) };
  });
  const inactive: InactiveTrader[] = [];
  for (const t of traders) {
    const at = seen.get(t.name) ?? null;
    const lastDay = at ? nyDate(at) : null;
    const missed = missedTradingDays(window, lastDay, today);
    if (missed < INACTIVE_AFTER) continue;
    const capped = !lastDay || lastDay < (window[0] ?? today);
    inactive.push({ name: t.name, tier: t.tier, pilot: inPilot.has(t.name), lastSeen: at ? at.toISOString() : null, missedDays: missed, capped });
  }
  inactive.sort((a, b) => b.missedDays - a.missedDays || tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name, "ru"));
  return {
    today,
    enabled: setting("usage.enabled"),
    retentionDays: setting("usage.retentionDays"),
    trackedSince: since.rows[0]?.d ?? null,
    activity: activitySeries(calendar, activityRows.rows.map((r) => ({ day: r.day, userId: Number(r.user_id), role: r.role }))),
    screens: { d7, d30 },
    actions: { d7: a7, d30: a30 },
    funnel: { days, traders: funnel },
    inactive,
    pilot,
  };
}
