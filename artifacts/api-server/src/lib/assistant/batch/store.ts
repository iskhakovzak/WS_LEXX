/**
 * Nightly AI review batches — storage (migration 0262: ai_batches, ai_batch_items) and the desk reads the job needs.
 * Raw SQL on the shared pool; every function takes an optional Queryable so the scratch-DB test can run it as is.
 */
import { pool } from "@workspace/db";
import { isLang, type Lang } from "../../../i18n";
import type { DayFacts } from "../review/gather";
import type { AssistantModel, Usage } from "../models";

type Queryable = { query: <R = any>(text: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount?: number | null }> };
const db = (): Queryable => pool as unknown as Queryable;

export type BatchKind = "day" | "week" | "month";
export type BatchStatus = "submitting" | "in_progress" | "ended" | "failed" | "expired" | "canceled";
export type ItemStatus = "pending" | "stored" | "invalid" | "errored" | "expired" | "canceled" | "refused";

// ─── desk reads ─────────────────────────────────────────────────────────────

export type TraderDay = { trader: string; userId: number; role: string; lang: Lang; trades: number };

/** Active members (with a users row) who have trades between two NY days, with their language and trade count. */
export async function tradersWithTrades(from: string, to: string, q: Queryable = db()): Promise<TraderDay[]> {
  const { rows } = await q.query<{ trader: string; id: number; role: string; locale: string | null; trades: string }>(
    `SELECT t.trader, u.id, u.role, u.locale, COUNT(*)::text AS trades
       FROM trades t JOIN users u ON u.name = t.trader AND u.active AND NOT u.banned
      WHERE t.date BETWEEN $1 AND $2 AND t.deleted_at IS NULL AND t.trader IS NOT NULL
      GROUP BY t.trader, u.id, u.role, u.locale ORDER BY t.trader`,
    [from, to],
  );
  return rows.map((r) => ({ trader: r.trader, userId: Number(r.id), role: r.role, lang: isLang(r.locale) ? r.locale : "ru", trades: Number(r.trades) || 0 }));
}

/** Traders (of `traders`) whose EOD of `day` is closed. */
export async function eodClosed(day: string, traders: readonly string[], q: Queryable = db()): Promise<Set<string>> {
  if (!traders.length) return new Set();
  const { rows } = await q.query<{ trader: string }>(
    `SELECT trader FROM eod_days WHERE date = $1 AND closed_at IS NOT NULL AND trader = ANY($2::text[])`, [day, traders],
  );
  return new Set(rows.map((r) => r.trader));
}

/** Traders already submitted for this kind and period (any status: never twice). */
export async function submittedTraders(kind: BatchKind, period: string, traders: readonly string[], q: Queryable = db()): Promise<Set<string>> {
  if (!traders.length) return new Set();
  const { rows } = await q.query<{ trader: string }>(
    `SELECT trader FROM ai_batch_items WHERE kind = $1 AND period = $2 AND trader = ANY($3::text[])`, [kind, period, traders],
  );
  return new Set(rows.map((r) => r.trader));
}

/** Units already committed to a night: actual units of ended batches, the estimate of the open ones. */
export async function nightUnits(night: string, q: Queryable = db()): Promise<number> {
  const { rows } = await q.query<{ n: string | null }>(
    `SELECT SUM(CASE WHEN status IN ('submitting', 'in_progress') THEN est_units ELSE units END)::text AS n FROM ai_batches WHERE night = $1`, [night],
  );
  return Number(rows[0]?.n) || 0;
}

/** Failed submissions of a night (the job stops trying after a few). */
export async function failedSubmissions(night: string, q: Queryable = db()): Promise<number> {
  const { rows } = await q.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ai_batches WHERE night = $1 AND status = 'failed' AND provider_id IS NULL`, [night]);
  return Number(rows[0]?.n) || 0;
}

/** Average units of recent stored reviews of a kind with this model / advisor (null below 3 samples): the estimate. */
export async function recentAverageUnits(kind: BatchKind, model: string, advisor: string | null, q: Queryable = db()): Promise<number | null> {
  const { rows } = await q.query<{ n: string; avg: string | null }>(
    `SELECT COUNT(*)::text AS n, AVG(i.units)::text AS avg FROM (
       SELECT i.units FROM ai_batch_items i JOIN ai_batches b ON b.id = i.batch_id
        WHERE i.kind = $1 AND i.status = 'stored' AND b.model = $2 AND b.advisor IS NOT DISTINCT FROM $3 AND i.finished_at > now() - interval '30 days'
        ORDER BY i.finished_at DESC LIMIT 50) i`,
    [kind, model, advisor],
  );
  return Number(rows[0]?.n) >= 3 && rows[0]?.avg != null ? Number(rows[0].avg) : null;
}

// ─── batches ────────────────────────────────────────────────────────────────

export type NewItem = { kind: BatchKind; trader: string; period: string; lang: Lang; inputHash: string; facts: DayFacts | null; estUnits: number };

/**
 * Inserts the batch (status submitting) and its items in one transaction BEFORE the provider call. Returns the batch
 * id and the item ids in input order; an item that already exists (UNIQUE kind, trader, period) is dropped (null id).
 */
export async function createBatch(
  a: { night: string; model: AssistantModel; advisor: AssistantModel | null; kinds: BatchKind[]; skippedBudget: number; createdBy: string; items: NewItem[] },
): Promise<{ batchId: number; itemIds: (number | null)[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const est = a.items.reduce((s, i) => s + i.estUnits, 0);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ai_batches (night, status, model, advisor, kinds, requests, skipped_budget, est_units, created_by)
       VALUES ($1, 'submitting', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [a.night, a.model, a.advisor, a.kinds, a.items.length, a.skippedBudget, Math.round(est), a.createdBy],
    );
    const batchId = Number(rows[0]!.id);
    const itemIds: (number | null)[] = [];
    for (const i of a.items) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO ai_batch_items (batch_id, kind, trader, period, lang, input_hash, facts, est_units)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (kind, trader, period) DO NOTHING RETURNING id`,
        [batchId, i.kind, i.trader, i.period, i.lang, i.inputHash, i.facts ? JSON.stringify(i.facts) : null, Math.round(i.estUnits)],
      );
      itemIds.push(r.rows[0] ? Number(r.rows[0].id) : null);
    }
    const kept = itemIds.filter((x) => x != null).length;
    if (kept !== a.items.length) {
      const keptEst = a.items.reduce((s, it, k) => s + (itemIds[k] != null ? it.estUnits : 0), 0);
      await client.query(`UPDATE ai_batches SET requests = $2, est_units = $3 WHERE id = $1`, [batchId, kept, Math.round(keptEst)]);
    }
    await client.query("COMMIT");
    return { batchId, itemIds };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function markSubmitted(batchId: number, providerId: string, nextPollAt: Date, q: Queryable = db()): Promise<void> {
  await q.query(`UPDATE ai_batches SET provider_id = $2, status = 'in_progress', next_poll_at = $3 WHERE id = $1`, [batchId, providerId, nextPollAt]);
}

/**
 * The provider refused the batch (an HTTP answer: nothing was created) → the batch is failed and its items are deleted,
 * so the same trader-days may be submitted again later. `keepItems` = the outcome is unknown (a timeout): the items
 * stay, so they are never submitted twice.
 */
export async function markSubmitFailed(batchId: number, error: string, keepItems: boolean, q: Queryable = db()): Promise<void> {
  if (!keepItems) await q.query(`DELETE FROM ai_batch_items WHERE batch_id = $1`, [batchId]);
  await q.query(`UPDATE ai_batches SET status = 'failed', error = $2, ended_at = now(), next_poll_at = NULL WHERE id = $1`, [batchId, error.slice(0, 2000)]);
}

export type OpenBatch = { id: number; providerId: string | null; status: BatchStatus; night: string; model: AssistantModel; advisor: AssistantModel | null; pollCount: number; createdAt: Date };

/** Batches to look at now: in progress and due for a poll, or stuck in «submitting». */
export async function dueBatches(now: Date, q: Queryable = db()): Promise<OpenBatch[]> {
  const { rows } = await q.query<{ id: string; provider_id: string | null; status: BatchStatus; night: string; model: AssistantModel; advisor: AssistantModel | null; poll_count: number; created_at: Date }>(
    `SELECT id, provider_id, status, night, model, advisor, poll_count, created_at FROM ai_batches
      WHERE (status = 'in_progress' AND (next_poll_at IS NULL OR next_poll_at <= $1)) OR status = 'submitting'
      ORDER BY id`,
    [now],
  );
  return rows.map((r) => ({
    id: Number(r.id), providerId: r.provider_id, status: r.status, night: r.night, model: r.model, advisor: r.advisor,
    pollCount: Number(r.poll_count) || 0, createdAt: new Date(r.created_at),
  }));
}

export async function bumpPoll(batchId: number, nextPollAt: Date, error: string | null, q: Queryable = db()): Promise<void> {
  await q.query(`UPDATE ai_batches SET poll_count = poll_count + 1, next_poll_at = $2, error = $3 WHERE id = $1`, [batchId, nextPollAt, error?.slice(0, 2000) ?? null]);
}

/** A batch that will never give results (expired, gone, interrupted): its pending items take `itemStatus`. */
export async function markBatchFailed(batchId: number, status: Extract<BatchStatus, "failed" | "expired" | "canceled">, error: string, itemStatus: ItemStatus, q: Queryable = db()): Promise<void> {
  await q.query(`UPDATE ai_batch_items SET status = $2, error = $3, finished_at = now() WHERE batch_id = $1 AND status = 'pending'`, [batchId, itemStatus, error.slice(0, 500)]);
  await q.query(`UPDATE ai_batches SET status = $2, error = $3, ended_at = now(), next_poll_at = NULL WHERE id = $1`, [batchId, status, error.slice(0, 2000)]);
}

export type PendingItem = { id: number; kind: BatchKind; trader: string; period: string; lang: Lang; inputHash: string; facts: DayFacts | null };

export async function pendingItems(batchId: number, q: Queryable = db()): Promise<PendingItem[]> {
  const { rows } = await q.query<{ id: string; kind: BatchKind; trader: string; period: string; lang: Lang; input_hash: string; facts: DayFacts | null }>(
    `SELECT id, kind, trader, period, lang, input_hash, facts FROM ai_batch_items WHERE batch_id = $1 AND status = 'pending' ORDER BY id`, [batchId],
  );
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, trader: r.trader, period: r.period, lang: r.lang, inputHash: r.input_hash, facts: r.facts ?? null }));
}

export async function finishItem(
  a: { id: number; status: ItemStatus; error?: string | null; units?: number; costUsd?: number; reviewId?: number | null }, q: Queryable = db(),
): Promise<void> {
  await q.query(
    `UPDATE ai_batch_items SET status = $2, error = $3, units = $4, cost_usd = $5, review_id = $6, finished_at = now() WHERE id = $1 AND status = 'pending'`,
    [a.id, a.status, a.error?.slice(0, 500) ?? null, Math.round(a.units ?? 0), a.costUsd ?? 0, a.reviewId ?? null],
  );
}

export type BatchTotals = { succeeded: number; invalid: number; errored: number; expired: number; canceled: number; units: number; usage: Usage; costUsd: number };

export async function finishBatch(batchId: number, status: Extract<BatchStatus, "ended" | "expired" | "canceled">, t: BatchTotals, error: string | null, q: Queryable = db()): Promise<void> {
  await q.query(
    `UPDATE ai_batches SET status = $2, succeeded = $3, invalid = $4, errored = $5, expired = $6, canceled = $7, units = $8,
            input_tokens = $9, output_tokens = $10, cache_read_tokens = $11, cache_write_tokens = $12, cost_usd = $13, error = $14,
            ended_at = now(), next_poll_at = NULL
      WHERE id = $1`,
    [batchId, status, t.succeeded, t.invalid, t.errored, t.expired, t.canceled, Math.round(t.units), t.usage.input, t.usage.output, t.usage.cacheRead, t.usage.cacheWrite, t.costUsd, error],
  );
}

// ─── notifications ──────────────────────────────────────────────────────────

export type ReadyItem = { id: number; kind: BatchKind; trader: string; period: string };

/** Stored reviews nobody was told about yet (finished in the last 3 days; older ones are not announced late). */
export async function unnotifiedItems(q: Queryable = db()): Promise<ReadyItem[]> {
  const { rows } = await q.query<{ id: string; kind: BatchKind; trader: string; period: string }>(
    `SELECT id, kind, trader, period FROM ai_batch_items
      WHERE status = 'stored' AND notified_at IS NULL AND finished_at > now() - interval '3 days' ORDER BY id`,
  );
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, trader: r.trader, period: r.period }));
}

export async function markNotified(ids: readonly number[], q: Queryable = db()): Promise<void> {
  if (ids.length) await q.query(`UPDATE ai_batch_items SET notified_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
}

// ─── due state (the job's enabled() getter) ─────────────────────────────────

export type DueState = { nextPollAt: Date | null; unnotified: number };

export async function dueState(q: Queryable = db()): Promise<DueState> {
  const { rows } = await q.query<{ next: Date | null; stuck: string; unnotified: string }>(
    `SELECT (SELECT MIN(COALESCE(next_poll_at, created_at)) FROM ai_batches WHERE status IN ('in_progress', 'submitting')) AS next,
            (SELECT COUNT(*) FROM ai_batch_items WHERE status = 'stored' AND notified_at IS NULL AND finished_at > now() - interval '3 days')::text AS unnotified`,
  );
  const r = rows[0];
  return { nextPollAt: r?.next ? new Date(r.next) : null, unnotified: Number(r?.unnotified) || 0 };
}

// ─── admin view ─────────────────────────────────────────────────────────────

export type BatchRow = {
  id: number; night: string; status: BatchStatus; model: string; advisor: string | null; kinds: string[];
  requests: number; succeeded: number; invalid: number; errored: number; expired: number; canceled: number; skippedBudget: number;
  estUnits: number; units: number; tokens: Usage; costUsd: number; pollCount: number; error: string | null;
  createdBy: string; createdAt: string; endedAt: string | null;
};

export async function recentBatches(limit: number, q: Queryable = db()): Promise<BatchRow[]> {
  const { rows } = await q.query<Record<string, any>>(
    `SELECT id, night, status, model, advisor, kinds, requests, succeeded, invalid, errored, expired, canceled, skipped_budget, est_units, units,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, poll_count, error, created_by, created_at, ended_at
       FROM ai_batches ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  const n = (v: unknown) => Number(v) || 0;
  return rows.map((r) => ({
    id: n(r.id), night: r.night, status: r.status, model: r.model, advisor: r.advisor ?? null, kinds: r.kinds ?? [],
    requests: n(r.requests), succeeded: n(r.succeeded), invalid: n(r.invalid), errored: n(r.errored), expired: n(r.expired), canceled: n(r.canceled),
    skippedBudget: n(r.skipped_budget), estUnits: n(r.est_units), units: n(r.units),
    tokens: { input: n(r.input_tokens), output: n(r.output_tokens), cacheRead: n(r.cache_read_tokens), cacheWrite: n(r.cache_write_tokens) },
    costUsd: n(r.cost_usd), pollCount: n(r.poll_count), error: r.error ?? null, createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(), endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  }));
}
