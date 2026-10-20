/**
 * «Найди вход» — SQL (rules: drills.ts; service: drillService.ts). Tables trainer_drills / trainer_drill_attempts —
 * migration 0211_trainer.sql.
 *
 * Read by G-SERVER (lib/gamification mastery): drillMasteryCounts — first answers only, `passed` = score ≥
 * trainer.drillPassScore at answer time.
 */
import { pool } from "@workspace/db";
import { horizonSql, netPnlSql, signedRSql } from "../tradeMath";
import { eligibleTrades } from "./eligibility";
import { blockedTickerDays } from "./eligibilityStore";

const OFFICE = `COALESCE(p.space, CASE WHEN p.trader IS NULL THEN 'office' ELSE 'personal' END) = 'office'`;
const SIDE = `CASE WHEN lower(trim(COALESCE(t.side, ''))) LIKE 's%' THEN 'short' ELSE 'long' END`;
const FIRST_FILL = `CROSS JOIN LATERAL (
    SELECT x.executed_at, x.price FROM trade_executions x
     WHERE x.trade_id = t.id AND x.executed_at IS NOT NULL AND x.price > 0
     ORDER BY x.executed_at, x.sort_order, x.id LIMIT 1) f`;
const HAS_1M = `EXISTS (SELECT 1 FROM candle_archive a WHERE a.symbol = t.ticker AND a.day = left(t.date, 10)::date AND a.tf = '1m')`;
const TRADE_OK = `t.deleted_at IS NULL AND t.ticker ~ '^[A-Z]{1,5}$' AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND ${horizonSql("t")} = 'intraday'`;

const EXECS = `(SELECT COALESCE(json_agg(x.executed_at ORDER BY x.executed_at, x.sort_order, x.id), '[]'::json)
    FROM trade_executions x WHERE x.trade_id = t.id) AS execs`;
const CAND_COLS = `t.id AS trade_id, t.trader, t.ticker, left(t.date, 10) AS day, ${SIDE} AS side, f.executed_at, f.price, ${EXECS}`;

type DrillCand = {
  setup_id: number; trade_id: number; trader: string; ticker: string; day: string; side: "long" | "short";
  executed_at: Date | string; price: string; execs: (string | null)[] | null;
};

/** Trainer eligibility (lib/trainer/eligibility): no close-auction fill / ticker-day, held ≥ 25 min, every fill timed. */
function eligibleCands(rows: readonly DrillCand[], blocked: ReadonlySet<string>): DrillCand[] {
  return eligibleTrades(rows, (r) => ({ ticker: r.ticker, day: r.day, executions: (r.execs ?? []).map((at) => ({ at })) }), blocked);
}

async function insertDrills(rows: readonly DrillCand[], source: "playbook_example" | "desk_trade"): Promise<number> {
  if (!rows.length) return 0;
  const conflict = source === "playbook_example"
    ? `ON CONFLICT (trade_id) DO UPDATE SET source = 'playbook_example', setup_id = EXCLUDED.setup_id WHERE trainer_drills.source <> 'playbook_example'`
    : `ON CONFLICT (trade_id) DO NOTHING`;
  const r = await pool.query(
    `INSERT INTO trainer_drills (setup_id, source, trade_id, trader, ticker, day, side, entry_at, entry_price)
     SELECT u.setup_id, $1, u.trade_id, u.trader, u.ticker, u.day, u.side, u.entry_at, u.entry_price
       FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::numeric[])
            AS u(setup_id, trade_id, trader, ticker, day, side, entry_at, entry_price)
     ${conflict}`,
    [
      source, rows.map((x) => Number(x.setup_id)), rows.map((x) => Number(x.trade_id)), rows.map((x) => String(x.trader)),
      rows.map((x) => String(x.ticker)), rows.map((x) => String(x.day)), rows.map((x) => x.side),
      rows.map((x) => new Date(x.executed_at).toISOString()), rows.map((x) => String(x.price)),
    ],
  );
  return r.rowCount ?? 0;
}

/**
 * Desk trades to add, per setup in the given order (best R first): only setups with fewer than `minExamples` example
 * drills, and up to `maxPerSetup` drills per setup in total. Pure; `counts` = current (enabled) drills per setup.
 */
export function deskQuota<T extends { setup_id: number }>(
  cands: readonly T[], counts: ReadonlyMap<number, { ex: number; n: number }>, minExamples: number, maxPerSetup: number,
): T[] {
  const taken = new Map<number, number>();
  return cands.filter((c) => {
    const k = counts.get(Number(c.setup_id)) ?? { ex: 0, n: 0 };
    if (k.ex >= minExamples) return false;
    const used = taken.get(Number(c.setup_id)) ?? 0;
    if (used >= Math.max(0, maxPerSetup - k.n)) return false;
    taken.set(Number(c.setup_id), used + 1);
    return true;
  });
}

/**
 * Creates the missing drills: every playbook example of an office setup with 1-minute bars and a timed first fill;
 * then, for setups with fewer than `minExamples` example drills, desk trades linked to the setup with R ≥ 0 (best R
 * first) up to `maxPerSetup` drills. Only trainer-eligible trades (lib/trainer/eligibility: no fill at 15:50–16:00 NY
 * and no such fill by the desk on that ticker-day, held ≥ 25 min, every fill timed); drills built earlier stay.
 * Idempotent (one drill per trade). Returns how many rows were added.
 */
export async function ensureDrills(minExamples: number, maxPerSetup: number): Promise<number> {
  const blocked = await blockedTickerDays();
  const ex = await pool.query<DrillCand>(
    `SELECT DISTINCT ON (t.id) e.playbook_id AS setup_id, ${CAND_COLS}
       FROM playbook_examples e
       JOIN trades t ON t.id = e.trade_id
       JOIN playbook p ON p.id = e.playbook_id AND p.deleted_at IS NULL AND ${OFFICE}
       ${FIRST_FILL}
      WHERE e.deleted_at IS NULL AND ${TRADE_OK} AND ${HAS_1M}
        AND NOT EXISTS (SELECT 1 FROM trainer_drills d WHERE d.trade_id = t.id AND d.source = 'playbook_example')
      ORDER BY t.id, e.id`,
  );
  const added = await insertDrills(eligibleCands(ex.rows, blocked), "playbook_example");
  const counts = await pool.query<{ setup_id: number; ex: number; n: number }>(
    `SELECT setup_id, count(*) FILTER (WHERE source = 'playbook_example')::int AS ex, count(*)::int AS n
       FROM trainer_drills WHERE NOT disabled GROUP BY 1`,
  );
  const countMap = new Map(counts.rows.map((r) => [Number(r.setup_id), { ex: Number(r.ex), n: Number(r.n) }]));
  const full = [...countMap].filter(([, k]) => k.ex >= minExamples || k.n >= maxPerSetup).map(([id]) => id);
  const desk = await pool.query<DrillCand>(
    `SELECT t.playbook_id AS setup_id, ${CAND_COLS}
       FROM trades t
       JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL AND ${OFFICE}
       ${FIRST_FILL}
      WHERE ${TRADE_OK} AND ${HAS_1M}
        AND COALESCE(${signedRSql("t")}, CASE WHEN ${netPnlSql("t")} >= 0 THEN 0 ELSE -1 END) >= 0
        AND NOT EXISTS (SELECT 1 FROM trainer_drills d WHERE d.trade_id = t.id)
        AND NOT (t.playbook_id = ANY($1::int[]))
      ORDER BY t.playbook_id, ${signedRSql("t")} DESC NULLS LAST, t.id DESC`,
    [full],
  );
  return added + (await insertDrills(deskQuota(eligibleCands(desk.rows, blocked), countMap, minExamples, maxPerSetup), "desk_trade"));
}

export type DrillRow = {
  id: number; setupId: number; setupName: string; source: "playbook_example" | "desk_trade"; trader: string;
  ticker: string; day: string; side: "long" | "short"; entryAt: number; entryPrice: number;
};

type DbDrill = {
  id: number; setup_id: number; name: string; source: DrillRow["source"]; trader: string; ticker: string; day: string;
  side: DrillRow["side"]; entry_at: Date; entry_price: string;
};
const fromDb = (r: DbDrill): DrillRow => ({
  id: Number(r.id), setupId: Number(r.setup_id), setupName: String(r.name), source: r.source, trader: String(r.trader),
  ticker: String(r.ticker), day: String(r.day), side: r.side, entryAt: Math.floor(new Date(r.entry_at).getTime() / 1000), entryPrice: Number(r.entry_price),
});

const DRILL_SELECT = `SELECT d.id, d.setup_id, p.name, d.source, d.trader, d.ticker, d.day, d.side, d.entry_at, d.entry_price
  FROM trainer_drills d JOIN playbook p ON p.id = d.setup_id AND p.deleted_at IS NULL`;

export async function drillById(id: number): Promise<DrillRow | null> {
  const { rows } = await pool.query<DbDrill>(`${DRILL_SELECT} WHERE d.id = $1 AND NOT d.disabled`, [id]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export type ServableDrill = DrillRow & { answered: boolean; lastAnsweredAt: number | null };

/** Drills the viewer may get (never one of his own trades), with whether he answered each. */
export async function servableDrills(userId: number, trader: string, setupId: number | null): Promise<ServableDrill[]> {
  const { rows } = await pool.query<DbDrill & { last_at: Date | null }>(
    `SELECT d.id, d.setup_id, p.name, d.source, d.trader, d.ticker, d.day, d.side, d.entry_at, d.entry_price,
            (SELECT max(a.created_at) FROM trainer_drill_attempts a WHERE a.drill_id = d.id AND a.user_id = $1) AS last_at
       FROM trainer_drills d JOIN playbook p ON p.id = d.setup_id AND p.deleted_at IS NULL
      WHERE NOT d.disabled AND d.trader <> $2 AND ($3::int IS NULL OR d.setup_id = $3)`,
    [userId, trader, setupId],
  );
  return rows.map((r) => ({ ...fromDb(r), answered: r.last_at != null, lastAnsweredAt: r.last_at ? new Date(r.last_at).getTime() : null }));
}

/** The viewer's average first-answer score per setup (weak setups are served more). */
export async function avgScoreBySetup(userId: number): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ setup_id: number; s: string }>(
    `SELECT setup_id, avg(score) AS s FROM trainer_drill_attempts WHERE user_id = $1 AND first GROUP BY 1`,
    [userId],
  );
  return new Map(rows.map((r) => [Number(r.setup_id), Number(r.s)]));
}

export async function disableDrill(id: number): Promise<void> {
  await pool.query(`UPDATE trainer_drills SET disabled = true WHERE id = $1`, [id]);
}

/** Stores an answer; returns whether it is the user's first answer on that drill. */
export async function insertAttempt(a: {
  drillId: number; userId: number; trader: string; setupId: number; barIndex: number; price: number; score: number; passed: boolean;
}): Promise<boolean> {
  const sql = (first: string) => `INSERT INTO trainer_drill_attempts (drill_id, user_id, trader, setup_id, bar_index, price, score, first, passed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${first}, $8) RETURNING first`;
  const params = [a.drillId, a.userId, a.trader, a.setupId, a.barIndex, a.price, a.score, a.passed];
  try {
    const { rows } = await pool.query<{ first: boolean }>(
      sql(`NOT EXISTS (SELECT 1 FROM trainer_drill_attempts WHERE user_id = $2 AND drill_id = $1 AND first)`), params,
    );
    return !!rows[0]?.first;
  } catch (err) {
    if ((err as { code?: string })?.code !== "23505") throw err;
    await pool.query(sql("false"), params); // a concurrent first answer won the race
    return false;
  }
}

/** Setup mastery input (G-SERVER): first answers per setup and how many of them passed. */
export async function drillMasteryCounts(trader: string): Promise<Map<number, { passed: number; attempts: number }>> {
  const { rows } = await pool.query<{ setup_id: number; passed: number; attempts: number }>(
    `SELECT setup_id, count(*) FILTER (WHERE passed)::int AS passed, count(*)::int AS attempts
       FROM trainer_drill_attempts WHERE trader = $1 AND first GROUP BY 1`,
    [trader],
  );
  return new Map(rows.map((r) => [Number(r.setup_id), { passed: Number(r.passed), attempts: Number(r.attempts) }]));
}

/** Servable drills per office setup for the viewer (the trainer home list). */
export async function drillsPerSetup(trader: string): Promise<{ setupId: number; name: string; drills: number }[]> {
  const { rows } = await pool.query<{ setup_id: number; name: string; n: number }>(
    `SELECT d.setup_id, p.name, count(*)::int AS n
       FROM trainer_drills d JOIN playbook p ON p.id = d.setup_id AND p.deleted_at IS NULL
      WHERE NOT d.disabled AND d.trader <> $1 GROUP BY 1, 2 ORDER BY p.name`,
    [trader],
  );
  return rows.map((r) => ({ setupId: Number(r.setup_id), name: String(r.name), drills: Number(r.n) }));
}

/** NY days the user answered at least one drill (streak), newest first. */
export async function drillDays(userId: number, from: string): Promise<string[]> {
  const { rows } = await pool.query<{ d: string }>(
    `SELECT DISTINCT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d
       FROM trainer_drill_attempts WHERE user_id = $1 AND created_at >= ($2::date)::timestamp AT TIME ZONE 'America/New_York'
      ORDER BY 1 DESC`,
    [userId, from],
  );
  return rows.map((r) => String(r.d));
}
