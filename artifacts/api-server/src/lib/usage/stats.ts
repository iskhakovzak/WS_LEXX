/**
 * Admin console → «Использование» (GET /api/admin/usage): what members actually use, from usage_events plus the data
 * the desk already stores (plans, reviews, trades, trainer games) — events only for what is not stored anywhere.
 * Internal, admins only; never feeds rewards, rankings or pay.
 *
 *   activity   last 30 calendar days: DAU by role + WAU (tracked visits only)
 *   screens    top screens by unique users, 7 and 30 days (+ how many of them are traders)
 *   actions    the tracked daily-loop actions, 7 and 30 days
 *   funnel     every active trader × the last 10 trading days (lib/usage/funnel.ts), trainees first
 *   inactive   traders with no sign of presence for 3+ trading days since tracking started (today never counts);
 *              the same rule feeds the Обзор card (routes/admin.ts desk-pulse → inactiveTraders)
 *   pilot      the setting usage.pilotUsers resolved to stored names (unknown entries listed)
 */
import { pool } from "@workspace/db";
import { isMarketClosed } from "../marketDays";
import { addDays, nyDate } from "../tradingDate";
import { closeDateSql, closedSql } from "../tradeMath";
import { setting } from "../settings/registry";
import {
  INACTIVE_AFTER, activitySeries, funnelRow, funnelTotals, inactiveFrom, parsePilot, tierRank,
  type ActivityPoint, type FunnelCells, type FunnelStep, type TraderFacts,
} from "./funnel";

export const FUNNEL_DAYS = 10;
export const ACTIVITY_DAYS = 30;
export { INACTIVE_AFTER };
const INACTIVE_WINDOW = 30;
export const OPENED_DAYS = 14;

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
  /** Fewer than INACTIVE_AFTER trading days tracked yet: `inactive` is empty on purpose (OWNER-04). */
  inactiveLowData: boolean;
  /** Route patterns (no query) traders opened in the last OPENED_DAYS days — the «никто не открыл» list (PILOT §3). */
  opened14: string[];
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

export type Presence = Map<string, { day: string; at: Date | null }>;

/**
 * Last sign of presence per trader, all time: tracked events, plan saves, reviews, trainer, journal, comments, the
 * activity feed and the trading day of their own trades (a trader who traded on Friday was there). Each source is read
 * on its own so a missing optional table never hides the others.
 */
export async function lastPresence(): Promise<Presence> {
  const stamps: string[] = [
    `SELECT trader, MAX(at) AS at FROM usage_events GROUP BY trader`,
    `SELECT trader, MAX(updated_at) AS at FROM trader_plans WHERE deleted_at IS NULL GROUP BY trader`,
    `SELECT trader, MAX(reviewed_at) AS at FROM daily_reviews WHERE reviewed_at IS NOT NULL GROUP BY trader`,
    `SELECT u.name AS trader, MAX(g.created_at) AS at FROM sim_games g JOIN users u ON u.id = g.user_id GROUP BY u.name`,
    `SELECT trader, MAX(created_at) AS at FROM trainer_drill_attempts GROUP BY trader`,
    `SELECT trader, MAX(updated_at) AS at FROM journal_days GROUP BY trader`,
    `SELECT trader, MAX(created_at) AS at FROM comments WHERE trader IS NOT NULL GROUP BY trader`,
    `SELECT trader, MAX(created_at) AS at FROM activity_log WHERE trader IS NOT NULL GROUP BY trader`,
  ];
  const tradeDays = `SELECT trader, MAX(LEFT(${closeDateSql("t")}, 10)) AS d FROM trades t
    WHERE t.deleted_at IS NULL AND t.trader IS NOT NULL AND ${closedSql("t")} GROUP BY t.trader`;
  const [stampRows, tradeRows] = await Promise.all([
    Promise.all(stamps.map((q) => pool.query<{ trader: string | null; at: Date | null }>(q).then((r) => r.rows).catch(() => []))),
    pool.query<{ trader: string; d: string | null }>(tradeDays).then((r) => r.rows).catch(() => []),
  ]);
  const out: Presence = new Map();
  const put = (name: string | null, day: string, at: Date | null) => {
    if (!name) return;
    const cur = out.get(name);
    if (!cur || day > cur.day || (day === cur.day && at && (!cur.at || at > cur.at))) out.set(name, { day, at: at ?? cur?.at ?? null });
  };
  for (const rows of stampRows) for (const r of rows) if (r.at) put(r.trader, nyDate(new Date(r.at)), new Date(r.at));
  for (const r of tradeRows) if (r.d) put(r.trader, r.d, null);
  return out;
}

/** First tracked day (usage_events), null when nothing was tracked yet. */
export async function trackingStart(): Promise<string | null> {
  const { rows } = await pool.query<{ d: string | null }>(`SELECT MIN(ny_day) AS d FROM usage_events`).catch(() => ({ rows: [] as { d: string | null }[] }));
  return rows[0]?.d ?? null;
}

/**
 * «Не заходят 3+ торговых дня» for the given traders — the rule both admin screens use (lib/usage/funnel inactiveFrom).
 */
export async function inactiveTraders(names: readonly string[], today: string = nyDate()): Promise<ReturnType<typeof inactiveFrom> & { presence: Presence; trackedSince: string | null }> {
  const [presence, window, trackedSince] = await Promise.all([lastPresence(), lastTradingDays(today, INACTIVE_WINDOW), trackingStart()]);
  return { ...inactiveFrom(names, (n) => presence.get(n)?.day ?? null, window, today, trackedSince), presence, trackedSince };
}

export async function usageOverview(now: Date = new Date()): Promise<UsageOverview> {
  const today = nyDate(now);
  const first = addDays(today, -(ACTIVITY_DAYS - 1));
  const calendar = Array.from({ length: ACTIVITY_DAYS }, (_, i) => addDays(first, i));
  const [people, window, activityRows, d7, d30, a7, a30, seen, trackedSince] = await Promise.all([
    pool.query<Person>(
      `SELECT u.id, u.name, u.name_latin, l.tier FROM users u LEFT JOIN trader_risk_limits l ON l.trader = u.name
        WHERE u.active AND NOT COALESCE(u.banned, false) AND u.role = 'trader'`),
    lastTradingDays(today, INACTIVE_WINDOW),
    pool.query<{ day: string; user_id: number; role: string }>(`SELECT DISTINCT ny_day AS day, user_id, role FROM usage_events WHERE ny_day >= $1`, [addDays(first, -6)]),
    topKeys("view", addDays(today, -6), 25), topKeys("view", first, 25),
    topKeys("action", addDays(today, -6), 20), topKeys("action", first, 20),
    lastPresence(),
    trackingStart(),
  ]);
  const opened = await pool.query<{ key: string }>(
    `SELECT DISTINCT split_part(key, '?', 1) AS key FROM usage_events WHERE kind = 'view' AND role = 'trader' AND ny_day >= $1`,
    [addDays(today, -(OPENED_DAYS - 1))],
  );
  const pilot = parsePilot(String(setting("usage.pilotUsers") ?? ""), people.rows.map((p) => ({ name: p.name, nameLatin: p.name_latin })));
  const inPilot = new Set(pilot.names);
  const traders = [...people.rows].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name, "ru"));
  const days = window.slice(-FUNNEL_DAYS);
  const facts = days.length ? await funnelFacts(days[0]!, today, traders.map((t) => t.name)) : new Map<string, TraderFacts>();
  const funnel: FunnelTrader[] = traders.map((t) => {
    const cells = funnelRow(days, facts.get(t.name)!);
    return { name: t.name, tier: t.tier, pilot: inPilot.has(t.name), cells, totals: funnelTotals(cells) };
  });
  const tierOf = new Map(traders.map((t) => [t.name, t.tier]));
  const idle = inactiveFrom(traders.map((t) => t.name), (n) => seen.get(n)?.day ?? null, window, today, trackedSince);
  const inactive: InactiveTrader[] = idle.rows.map((r) => {
    const p = seen.get(r.name);
    return {
      name: r.name, tier: tierOf.get(r.name) ?? null, pilot: inPilot.has(r.name),
      lastSeen: p ? (p.at ? p.at.toISOString() : `${p.day}T12:00:00.000Z`) : null, missedDays: r.missedDays, capped: r.capped,
    };
  });
  inactive.sort((a, b) => b.missedDays - a.missedDays || tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name, "ru"));
  return {
    today,
    enabled: setting("usage.enabled"),
    retentionDays: setting("usage.retentionDays"),
    trackedSince,
    activity: activitySeries(calendar, activityRows.rows.map((r) => ({ day: r.day, userId: Number(r.user_id), role: r.role }))),
    screens: { d7, d30 },
    actions: { d7: a7, d30: a30 },
    funnel: { days, traders: funnel },
    inactive,
    inactiveLowData: idle.lowData,
    opened14: opened.rows.map((r) => r.key).sort(),
    pilot,
  };
}
