/**
 * Durable side effects of a sync (table propreports_outbox: kind, payload, attempts, done_at, …).
 *
 * A writer enqueues inside its own transaction (applySync does, so a committed sync never loses its rule scan); the
 * tick drains the queue with the time left after its steps, and a classic server / a user-triggered sync also kicks a
 * best-effort drain right away (kickOutbox). A handler must be idempotent: a row can run again after a crash between
 * the handler and the done mark. A failing row is retried with backoff up to MAX_ATTEMPTS, then left with failed_at.
 *
 * OUTBOX_HANDLERS is the ONLY registry of kinds: RISK-LIVE / ACCURACY add theirs with a one-line import + entry.
 */
import { pool } from "@workspace/db";
import { logger } from "../../logger";
import type { OutboxHandler } from "./types";
import { riskAlertHandler } from "../../riskAlerts";
import {
  rulesScanHandler, ideasRelinkHandler, challengesRefreshHandler, structuresRefreshHandler, syncNotifyHandler, syncedEventHandler,
} from "../sideEffects";

export const OUTBOX_HANDLERS: Record<string, OutboxHandler> = {
  /** { traders: string[] } — re-check trading rules (violations right after the sync). */
  "rules.scan": rulesScanHandler,
  /** { traders: string[] } — link ideas to the new broker trades. */
  "ideas.relink": ideasRelinkHandler,
  /** { traders: string[] } — academy challenge status + pass/fail notices. */
  "challenges.refresh": challengesRefreshHandler,
  /** { tradeIds: number[] } (≤ 300 per row) — fill roles / re-entry links. */
  "structures.refresh": structuresRefreshHandler,
  /** { actor, actorIsStaff, kind: "import"|"sync", context, result, unmapped } — sync receipt + unmatched-accounts notice. */
  "notify.sync": syncNotifyHandler,
  /** { runId, source, dateFrom, dateTo, traders, inserted, updated, changed } — "propreports.synced" listeners. */
  "propreports.synced": syncedEventHandler,
  /** RiskAlertPayload (lib/riskAlerts) — red-day stop / near-stop alert: alert log + trader / staff notices (+ Telegram). */
  "risk.alert": riskAlertHandler,
};

export const MAX_ATTEMPTS = 5;
/** A claimed row is invisible to other drainers for this long (a frozen function's claim expires). */
const CLAIM_SECONDS = 120;

type Queryable = { query: (typeof pool)["query"] };

/**
 * Insert one outbox row; pass the transaction client to make it atomic with the caller's writes. An identical row
 * (same kind + payload) still waiting and unclaimed is not duplicated — a backfill enqueues the same rule scan per window.
 */
export async function enqueueOutbox(kind: string, payload: unknown, db: Queryable = pool): Promise<void> {
  if (!OUTBOX_HANDLERS[kind]) logger.warn({ kind }, "propreports outbox: enqueued a kind without a handler");
  await db.query(
    `INSERT INTO propreports_outbox (kind, payload)
     SELECT $1, $2::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM propreports_outbox
                         WHERE kind = $1 AND payload = $2::jsonb AND done_at IS NULL AND failed_at IS NULL AND locked_until IS NULL)`,
    [kind, JSON.stringify(payload ?? null)],
  );
}

export type DrainResult = { processed: number; failed: number; remaining: number };

/** Retry delay after the n-th failed attempt: 30 s, 2 min, 8 min, 32 min. */
export function backoffSeconds(attempts: number): number {
  return 30 * 4 ** Math.max(0, attempts - 1);
}

/**
 * Claim and run rows until `deadline` (epoch ms). Rows are claimed one batch at a time with FOR UPDATE SKIP LOCKED +
 * a claim window, so two drainers (a tick and a kick) never run the same row concurrently.
 */
export async function drainOutbox(deadline: number, opts: { batch?: number; handlers?: Record<string, OutboxHandler> } = {}): Promise<DrainResult> {
  const handlers = opts.handlers ?? OUTBOX_HANDLERS;
  const batch = opts.batch ?? 10;
  let processed = 0;
  let failed = 0;
  while (Date.now() < deadline - 500) {
    const { rows } = await pool.query(
      `UPDATE propreports_outbox o SET locked_until = NOW() + make_interval(secs => $2), attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT id FROM propreports_outbox
           WHERE done_at IS NULL AND failed_at IS NULL AND run_after <= NOW() AND (locked_until IS NULL OR locked_until < NOW())
           ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.kind, o.payload, o.attempts`,
      [batch, CLAIM_SECONDS],
    );
    if (!rows.length) break;
    for (const r of rows as Array<{ id: number | string; kind: string; payload: unknown; attempts: number }>) {
      const id = Number(r.id);
      if (Date.now() >= deadline - 500) {
        // out of time: give the claim back untouched (the attempt is not counted)
        await pool.query(`UPDATE propreports_outbox SET locked_until = NULL, attempts = GREATEST(attempts - 1, 0) WHERE id = $1`, [id]).catch(() => {});
        continue;
      }
      const handler = handlers[r.kind];
      try {
        if (!handler) throw new Error(`no handler for kind "${r.kind}"`);
        await handler(r.payload);
        await pool.query(`UPDATE propreports_outbox SET done_at = NOW(), locked_until = NULL, last_error = NULL WHERE id = $1`, [id]);
        processed++;
      } catch (e) {
        failed++;
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
        const attempts = Number(r.attempts);
        const giveUp = !handler || attempts >= MAX_ATTEMPTS;
        logger.warn({ kind: r.kind, id, attempts, err: msg }, "propreports outbox: handler failed");
        await pool.query(
          `UPDATE propreports_outbox SET last_error = $2, locked_until = NULL,
                  run_after = NOW() + make_interval(secs => $3), failed_at = CASE WHEN $4 THEN NOW() ELSE NULL END
            WHERE id = $1`,
          [id, msg, backoffSeconds(attempts), giveUp],
        ).catch(() => {});
      }
    }
  }
  const rem = await pool.query(`SELECT COUNT(*)::int AS n FROM propreports_outbox WHERE done_at IS NULL AND failed_at IS NULL`).catch(() => ({ rows: [{ n: -1 }] }));
  return { processed, failed, remaining: Number(rem.rows[0]?.n ?? 0) };
}

let kicking: Promise<unknown> | null = null;
/**
 * Best-effort drain right after a user-triggered write (classic server: completes; Vercel: may be frozen after the
 * response — the rows stay and the next tick runs them). Never throws, never runs twice at once in one process.
 */
export function kickOutbox(budgetMs = 25_000): void {
  if (kicking) return;
  kicking = drainOutbox(Date.now() + budgetMs)
    .catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "propreports outbox: kick failed"))
    .finally(() => { kicking = null; });
}
