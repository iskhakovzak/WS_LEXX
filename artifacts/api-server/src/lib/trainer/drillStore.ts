/**
 * «Найди вход» — SQL (rules: drills.ts; service: drillService.ts). Tables trainer_drills / trainer_drill_attempts —
 * migration 0211_trainer.sql.
 *
 * Read by G-SERVER (lib/gamification mastery): drillMasteryCounts — first answers only, `passed` = score ≥
 * trainer.drillPassScore at answer time.
 */
import { pool } from "@workspace/db";
import { horizonSql, netPnlSql, signedRSql } from "../tradeMath";

const OFFICE = `COALESCE(p.space, CASE WHEN p.trader IS NULL THEN 'office' ELSE 'personal' END) = 'office'`;
const SIDE = `CASE WHEN lower(trim(COALESCE(t.side, ''))) LIKE 's%' THEN 'short' ELSE 'long' END`;
const FIRST_FILL = `CROSS JOIN LATERAL (
    SELECT x.executed_at, x.price FROM trade_executions x
     WHERE x.trade_id = t.id AND x.executed_at IS NOT NULL AND x.price > 0
     ORDER BY x.executed_at, x.sort_order, x.id LIMIT 1) f`;
const HAS_1M = `EXISTS (SELECT 1 FROM candle_archive a WHERE a.symbol = t.ticker AND a.day = left(t.date, 10)::date AND a.tf = '1m')`;
const TRADE_OK = `t.deleted_at IS NULL AND t.ticker ~ '^[A-Z]{1,5}$' AND t.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND ${horizonSql("t")} = 'intraday'`;

/**
 * Creates the missing drills: every playbook example of an office setup with 1-minute bars and a timed first fill;
 * then, for setups with fewer than `minExamples` example drills, desk trades linked to the setup with R ≥ 0 (best R
 * first) up to `maxPerSetup` drills. Idempotent (one drill per trade). Returns how many rows were added.
 */
export async function ensureDrills(minExamples: number, maxPerSetup: number): Promise<number> {
  const ex = await pool.query(
    `INSERT INTO trainer_drills (setup_id, source, trade_id, trader, ticker, day, side, entry_at, entry_price)
     SELECT DISTINCT ON (t.id) e.playbook_id, 'playbook_example', t.id, t.trader, t.ticker, left(t.date, 10), ${SIDE}, f.executed_at, f.price
       FROM playbook_examples e
       JOIN trades t ON t.id = e.trade_id
       JOIN playbook p ON p.id = e.playbook_id AND p.deleted_at IS NULL AND ${OFFICE}
       ${FIRST_FILL}
      WHERE e.deleted_at IS NULL AND ${TRADE_OK} AND ${HAS_1M}
      ORDER BY t.id, e.id
     ON CONFLICT (trade_id) DO UPDATE SET source = 'playbook_example', setup_id = EXCLUDED.setup_id
       WHERE trainer_drills.source <> 'playbook_example'`,
  );
  const desk = await pool.query(
    `WITH counts AS (
       SELECT setup_id, count(*) FILTER (WHERE source = 'playbook_example') AS ex, count(*) AS n
         FROM trainer_drills WHERE NOT disabled GROUP BY 1),
     cand AS (
       SELECT t.playbook_id AS setup_id, t.id, t.trader, t.ticker, left(t.date, 10) AS day, ${SIDE} AS side, f.executed_at, f.price,
              row_number() OVER (PARTITION BY t.playbook_id ORDER BY ${signedRSql("t")} DESC NULLS LAST, t.id DESC) AS rn
         FROM trades t
         JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL AND ${OFFICE}
         ${FIRST_FILL}
        WHERE ${TRADE_OK} AND ${HAS_1M}
          AND COALESCE(${signedRSql("t")}, CASE WHEN ${netPnlSql("t")} >= 0 THEN 0 ELSE -1 END) >= 0
          AND NOT EXISTS (SELECT 1 FROM trainer_drills d WHERE d.trade_id = t.id))
     INSERT INTO trainer_drills (setup_id, source, trade_id, trader, ticker, day, side, entry_at, entry_price)
     SELECT c.setup_id, 'desk_trade', c.id, c.trader, c.ticker, c.day, c.side, c.executed_at, c.price
       FROM cand c LEFT JOIN counts k ON k.setup_id = c.setup_id
      WHERE COALESCE(k.ex, 0) < $1 AND c.rn <= GREATEST(0, $2 - COALESCE(k.n, 0))
     ON CONFLICT (trade_id) DO NOTHING`,
    [minExamples, maxPerSetup],
  );
  return (ex.rowCount ?? 0) + (desk.rowCount ?? 0);
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
