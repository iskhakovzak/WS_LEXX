/**
 * SQL store of the honest what-if verdicts (table whatif_honesty_cache, migration 0244). One row per (trader, period,
 * data signature, engine version): queued → running → ready | failed. The route (GET /whatif/suggestions) reads and
 * queues rows; the job whatif.honesty (lib/whatIfHonestyJob) claims, computes and finishes them. Every function takes
 * the connection to use (the app pool, a test client) and runs parameterised SQL only.
 *
 * Privacy: a row holds one trader's own numbers. The route resolves the trader through scopeTrader BEFORE it reads a
 * row, so a member can only ever reach their own key; the result is the same for every viewer and language.
 */
import type { HonestyResult } from "./whatIfHonesty";

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type HonestyState = "queued" | "running" | "ready" | "failed";

export interface HonestyKey {
  trader: string;
  /** '' = open end (the request had no `from` / `to`). */
  from: string;
  to: string;
  sig: string;
  version: number;
}

export interface HonestyRow {
  id: number;
  trader: string;
  from: string;
  to: string;
  sig: string;
  version: number;
  state: HonestyState;
  result: HonestyResult | null;
  error: string | null;
  attempts: number;
  requestedAt: Date;
  usedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
}

const T = "whatif_honesty_cache";
const COLS = `id, trader, period_from, period_to, data_sig, engine_version, state, result, error, attempts, requested_at, used_at,
  started_at, finished_at, duration_ms`;
const KEY_WHERE = `trader = $1 AND period_from = $2 AND period_to = $3 AND data_sig = $4 AND engine_version = $5`;
const keyParams = (k: HonestyKey) => [k.trader, k.from, k.to, k.sig, k.version];

const asDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

function rowOf(r: Record<string, unknown>): HonestyRow {
  return {
    id: Number(r.id), trader: String(r.trader), from: String(r.period_from ?? ""), to: String(r.period_to ?? ""),
    sig: String(r.data_sig), version: Number(r.engine_version), state: r.state as HonestyState,
    result: (r.result as HonestyResult | null) ?? null, error: (r.error as string | null) ?? null, attempts: Number(r.attempts ?? 0),
    requestedAt: asDate(r.requested_at) as Date, usedAt: asDate(r.used_at) as Date, startedAt: asDate(r.started_at),
    finishedAt: asDate(r.finished_at), durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
  };
}

/** The row of this key, or null. */
export async function get(db: Queryable, k: HonestyKey): Promise<HonestyRow | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM ${T} WHERE ${KEY_WHERE}`, keyParams(k));
  return rows[0] ? rowOf(rows[0]) : null;
}

/**
 * Queue the key; true only when this call inserted it (the same work is never queued twice). A viewer's request marks
 * the key as used now. The job's evening precompute (`precompute`) is not a visit: the row inherits the period's last
 * real use (else −∞), so recentUse and the 14-day prune keep seeing only what viewers asked for — otherwise every
 * precomputed row would count as a fresh use and the nightly warm-up would keep itself going forever.
 */
export async function enqueue(db: Queryable, k: HonestyKey, opts: { precompute?: boolean } = {}): Promise<boolean> {
  const usedAt = opts.precompute
    ? `COALESCE((SELECT max(used_at) FROM ${T} WHERE trader = $1 AND period_from = $2 AND period_to = $3), '-infinity'::timestamptz)`
    : "now()";
  const { rows } = await db.query(
    `INSERT INTO ${T} (trader, period_from, period_to, data_sig, engine_version, used_at) VALUES ($1, $2, $3, $4, $5, ${usedAt})
     ON CONFLICT ON CONSTRAINT whatif_honesty_cache_key DO NOTHING RETURNING id`,
    keyParams(k),
  );
  return rows.length > 0;
}

/** Mark the key as asked for now (at most once an hour: one cheap UPDATE, no write on most requests). */
export async function touch(db: Queryable, id: number): Promise<void> {
  await db.query(`UPDATE ${T} SET used_at = now() WHERE id = $1 AND used_at < now() - interval '1 hour'`, [id]);
}

/** The oldest queued row of this engine version, now running (FIFO; rows locked by another worker are skipped). */
export async function claim(db: Queryable, version: number): Promise<HonestyRow | null> {
  const { rows } = await db.query(
    `UPDATE ${T} SET state = 'running', started_at = now(), finished_at = NULL, attempts = attempts + 1
      WHERE id = (SELECT id FROM ${T} WHERE state = 'queued' AND engine_version = $1 ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${COLS}`,
    [version],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Store the verdict; only a running row is finished (true when it was). */
export async function finish(db: Queryable, id: number, result: HonestyResult, ms: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE ${T} SET state = 'ready', result = $2::jsonb, error = NULL, finished_at = now(), duration_ms = $3 WHERE id = $1 AND state = 'running'`,
    [id, JSON.stringify(result), Math.max(0, Math.round(ms))],
  );
  return (rowCount ?? 0) > 0;
}

export async function fail(db: Queryable, id: number, error: string): Promise<void> {
  await db.query(`UPDATE ${T} SET state = 'failed', error = $2, finished_at = now() WHERE id = $1 AND state = 'running'`, [id, error.slice(0, 4000)]);
}

/** Back to the queue after an abort (a shutdown or the job timeout is not the row's fault: the attempt is given back). */
export async function release(db: Queryable, id: number): Promise<void> {
  await db.query(
    `UPDATE ${T} SET state = 'queued', started_at = NULL, attempts = GREATEST(attempts - 1, 0) WHERE id = $1 AND state = 'running'`,
    [id],
  );
}

/**
 * Rows left running by a crashed process: back to the queue, or failed after `maxAttempts`. The job calls it with
 * olderThanMs = 0 at the start of every run: it holds the job's advisory lock and the in-process guard then, so no
 * worker can still own a running row.
 */
export async function requeueStale(db: Queryable, olderThanMs = 30 * 60_000, maxAttempts = 3): Promise<{ requeued: number; failed: number }> {
  const { rows } = await db.query(
    `UPDATE ${T}
        SET state = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
            error = CASE WHEN attempts >= $2 THEN $3 ELSE error END,
            finished_at = CASE WHEN attempts >= $2 THEN now() ELSE NULL END,
            started_at = CASE WHEN attempts >= $2 THEN started_at ELSE NULL END
      WHERE state = 'running' AND started_at < now() - make_interval(secs => $1::double precision / 1000)
      RETURNING state`,
    [olderThanMs, maxAttempts, olderThanMs > 0 ? `stale: still running after ${Math.round(olderThanMs / 60_000)} min` : "stale: left running by a stopped run"],
  );
  return { requeued: rows.filter((r) => r.state === "queued").length, failed: rows.filter((r) => r.state === "failed").length };
}

/** Queue a failed row again when it has attempts left and failed more than `afterMs` ago (true when it was). */
export async function retryFailed(db: Queryable, id: number, maxAttempts = 3, afterMs = 6 * 3_600_000): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE ${T} SET state = 'queued', error = NULL, started_at = NULL, finished_at = NULL, requested_at = now(), used_at = now()
      WHERE id = $1 AND state = 'failed' AND attempts < $2
        AND (finished_at IS NULL OR finished_at < now() - make_interval(secs => $3::double precision / 1000))
      RETURNING id`,
    [id, maxAttempts, afterMs],
  );
  return rows.length > 0;
}

/**
 * The trades changed between the request and the run: the row takes the new signature, or is deleted when a row
 * with that signature already exists (it is computed, or will be, under its own key).
 */
export async function resign(db: Queryable, id: number, sig: string): Promise<"updated" | "deleted"> {
  try {
    const { rows } = await db.query(
      `UPDATE ${T} t SET data_sig = $2 WHERE t.id = $1 AND NOT EXISTS (
         SELECT 1 FROM ${T} o WHERE o.trader = t.trader AND o.period_from = t.period_from AND o.period_to = t.period_to
           AND o.engine_version = t.engine_version AND o.data_sig = $2 AND o.id <> t.id)
       RETURNING id`,
      [id, sig],
    );
    if (rows.length) return "updated";
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") throw err; // a concurrent enqueue of the same key won the race
  }
  await db.query(`DELETE FROM ${T} WHERE id = $1`, [id]);
  return "deleted";
}

/** Was this trader + period asked for in the last `days` days (the evening precompute warms only those). */
export async function recentUse(db: Queryable, trader: string, from: string, to: string, days = 14): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM ${T} WHERE trader = $1 AND period_from = $2 AND period_to = $3 AND used_at > now() - make_interval(days => $4::int) LIMIT 1`,
    [trader, from, to, days],
  );
  return rows.length > 0;
}

/** Drop rows of other engine versions and rows nobody asked for in `days` days (never a running one). */
export async function prune(db: Queryable, version: number, days = 14): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM ${T} WHERE state <> 'running' AND (engine_version <> $1 OR used_at < now() - make_interval(days => $2::int))`,
    [version, days],
  );
  return rowCount ?? 0;
}
