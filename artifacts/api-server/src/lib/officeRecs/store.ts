/**
 * I/O of «Рекомендации офису»: loads the desk's trades (the what-if loader), the latest edge-map LEAK rows, the
 * curator-attention facts and the readiness reports, runs the pure generators (build.ts) and caches the desk-wide
 * result: fresh for FRESH_MS, then served stale while one background rebuild runs (up to STALE_MAX_MS). The cached
 * result carries every $ and name; the route redacts it per viewer (redact.ts) before anything leaves the server.
 */
import { pool } from "@workspace/db";
import { addDays, nyDate } from "../tradingDate";
import { loadSimTrades } from "../whatIfLoader";
import { toEdgeTrade } from "../edgeMapStore";
import { setting } from "../settings/registry";
import { logger } from "../logger";
import type { EdgeTrade } from "../edgeMap";
import { regimeDaysMap } from "../marketRegime/store";
import { buildDeskRecs, type BuildResult } from "./build";
import { activeSince, type AttentionInput, type ReadinessRow } from "./people";

const FRESH_MS = 30 * 60_000;
const STALE_MAX_MS = 6 * 60 * 60_000;
/** Calendar days loaded to cover the 120-trading-day window (holidays included). */
const LOAD_CALENDAR_DAYS = 200;
const READINESS_CONCURRENCY = 4;

type Entry = { at: number; asOf: string; promise: Promise<BuildResult>; refreshing?: boolean };
let cache: Entry | null = null;

export function invalidateOfficeRecsCache(): void {
  cache = null;
}

const soft = async <T>(p: Promise<{ rows: T[] }>): Promise<T[]> => (await p.catch(() => ({ rows: [] as T[] }))).rows;

async function loadEdgeLeaks(): Promise<Map<string, string[]>> {
  const rows = await soft(pool.query<{ slice_key: string; trader: string }>(
    `SELECT m.slice_key, m.trader FROM edge_map m
       JOIN (SELECT trader, MAX(as_of) AS as_of FROM edge_map GROUP BY trader) l ON l.trader = m.trader AND l.as_of = m.as_of
      WHERE m.verdict = 'LEAK'`,
  ));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.slice_key, [...(out.get(r.slice_key) ?? []), r.trader]);
  return out;
}

const ymd = (v: unknown): string | null => {
  if (v == null) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Active traders (role trader, a closed trade in the last 20 weekdays), their last review / 1:1, their curator. */
async function loadAttention(today: string): Promise<AttentionInput> {
  const since = activeSince(today);
  const people = await soft(pool.query<{ name: string; curator: string | null }>(
    `SELECT u.name, NULLIF(TRIM(u.assigned_curator), '') AS curator FROM users u
      WHERE u.active = true AND COALESCE(u.banned, false) = false AND u.role = 'trader'
        AND EXISTS (SELECT 1 FROM trades t WHERE t.trader = u.name AND t.deleted_at IS NULL AND LEFT(COALESCE(t.exit_date, t.date), 10) >= $1)`,
    [since],
  ));
  const names = people.map((p) => p.name);
  const [eod, weekly, trade, ratings, meets] = await Promise.all([
    soft(pool.query(`SELECT trader, MAX(reviewed_at) AS at FROM eod_days WHERE reviewed_at IS NOT NULL AND trader = ANY($1) GROUP BY trader`, [names])),
    soft(pool.query(`SELECT trader, MAX(reviewed_at) AS at FROM weekly_reviews WHERE reviewed_at IS NOT NULL AND trader = ANY($1) GROUP BY trader`, [names])),
    soft(pool.query(`SELECT t.trader, MAX(r.created_at) AS at FROM trade_reviews r JOIN trades t ON t.id = r.trade_id WHERE t.trader = ANY($1) GROUP BY t.trader`, [names])),
    soft(pool.query(`SELECT trader, MAX(created_at) AS at FROM trader_ratings WHERE trader = ANY($1) GROUP BY trader`, [names])),
    soft(pool.query(`SELECT student AS trader, MAX(met_at) AS at FROM academy_one_on_ones WHERE archived_at IS NULL AND student = ANY($1) GROUP BY student`, [names])),
  ]);
  const latest = (lists: any[][]) => {
    const m = new Map<string, string>();
    for (const list of lists) for (const r of list) {
      const d = ymd(r.at);
      if (d && (!m.has(r.trader) || d > m.get(r.trader)!)) m.set(r.trader, d);
    }
    return m;
  };
  return {
    today, active: names,
    lastReview: latest([eod, weekly, trade, ratings]),
    lastOneOnOne: latest([meets]),
    curatorOf: new Map(people.map((p) => [p.name, p.curator])),
  };
}

/** Readiness reports of the active traders (the academy ladder scorecard), a few at a time. */
async function loadReadiness(traders: readonly string[], today: string): Promise<ReadinessRow[]> {
  const { readinessFor } = await import("../../routes/academy-path");
  const out: ReadinessRow[] = [];
  for (let i = 0; i < traders.length; i += READINESS_CONCURRENCY) {
    const part = await Promise.all(traders.slice(i, i + READINESS_CONCURRENCY).map((u) => readinessFor(u, today).catch(() => null)));
    for (const r of part) {
      if (!r) continue;
      out.push({ user: r.user, stage: r.stage?.key ?? null, nextStage: r.nextStage?.key ?? null, passed: r.passed, total: r.total, ready: r.ready, binding: r.bindingConstraint?.metric ?? null });
    }
  }
  return out;
}

async function build(asOf: string): Promise<BuildResult> {
  const t0 = Date.now();
  const sim = await loadSimTrades(null, addDays(asOf, -LOAD_CALENDAR_DAYS), asOf);
  const edge = sim.map(toEdgeTrade).filter((t): t is EdgeTrade => t != null);
  const [edgeLeaks, attention, regimes] = await Promise.all([
    loadEdgeLeaks(), loadAttention(asOf).catch(() => null),
    regimeDaysMap(addDays(asOf, -LOAD_CALENDAR_DAYS), asOf).catch(() => new Map<string, string>()),
  ]);
  const readiness = attention ? await loadReadiness(attention.active, asOf).catch(() => null) : null;
  const res = buildDeskRecs({
    asOf, sim, edge, edgeLeaks, attention, readiness, regimes,
    fee: { minTrades: setting("coach.feeBandMinTrades"), ratioMin: setting("coach.feeBandRatioMin") },
  });
  logger.info({ ms: Date.now() - t0, trades: sim.length, recs: res.recs.length }, "office-recs: built");
  return res;
}

/** The cached desk-wide result (every $ and name — redact before sending). */
export async function deskRecs(now = Date.now()): Promise<BuildResult & { computedAt: string }> {
  const asOf = nyDate();
  const stamp = (e: Entry) => e.promise.then((r) => ({ ...r, computedAt: new Date(e.at).toISOString() }));
  if (cache && cache.asOf === asOf && now - cache.at < STALE_MAX_MS) {
    if (now - cache.at >= FRESH_MS && !cache.refreshing) {
      const cur = cache;
      cur.refreshing = true;
      const next = build(asOf);
      next.then(() => { cache = { at: Date.now(), asOf, promise: next }; })
        .catch((err) => { cur.refreshing = false; logger.warn({ err }, "office-recs: rebuild failed"); });
    }
    return stamp(cache);
  }
  const entry: Entry = { at: now, asOf, promise: build(asOf) };
  cache = entry;
  entry.promise.catch(() => { if (cache === entry) cache = null; });
  return stamp(entry);
}
