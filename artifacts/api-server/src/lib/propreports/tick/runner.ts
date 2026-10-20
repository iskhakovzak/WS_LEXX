/**
 * Tick runner: lease → due steps in TICK_STEPS order until the budget is spent → outbox drain → release.
 * Called by the API's jobs "propreports.sync" / "propreports.tick-hourly" (lib/propreports/scheduler), POST
 * /api/propreports/tick/run (staff «Run now») and the optional external heartbeat POST /api/cron/tick. Never throws:
 * the summary carries the errors.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../../logger";
import { createTickClient, PropReportsError, type PropReportsClient } from "../client";
import { TICK_STEPS } from "./steps";
import { drainOutbox, enqueueOutbox, type DrainResult } from "./outbox";
import { acquireLease, releaseLease, TICK_LEASE } from "./lease";
import { setCursor } from "./cursor";
import type { TickStep, TickStepState, TickSummary } from "./types";

/** Steps + outbox stop at 45 s: a tick stays short (an HTTP caller gets its answer within a minute) and leaves room for DB bookkeeping. */
export const TICK_BUDGET_MS = 45_000;
/** Steps do not start with less than this left (the outbox gets the rest). */
const STEP_MIN_MS = 3_000;
/** The lease outlives the budget by 30 s (a crashed holder blocks at most that long). */
const LEASE_EXTRA_S = 30;

export type RunTickOptions = {
  trigger: "cron" | "manual" | "scheduler";
  budgetMs?: number;
  /** Tests: inject steps / client / outbox drain. */
  steps?: TickStep[];
  client?: PropReportsClient | null;
  drain?: (deadline: number) => Promise<DrainResult>;
};

type Queryable = { query: (typeof pool)["query"] };

export async function loadStepStates(db: Queryable = pool): Promise<Map<string, TickStepState>> {
  const { rows } = await db.query(`SELECT * FROM propreports_tick_steps`);
  return new Map(rows.map((r: any) => [String(r.name), stepStateView(r)]));
}

export function stepStateView(r: any): TickStepState {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    name: String(r.name),
    lastRunAt: iso(r.last_run_at),
    lastOkAt: iso(r.last_ok_at),
    lastDone: r.last_done == null ? null : !!r.last_done,
    lastNote: r.last_note ?? null,
    lastError: r.last_error ?? null,
    lastMs: r.last_ms == null ? null : Number(r.last_ms),
    runs: Number(r.runs ?? 0),
  };
}

/** Run the step this tick? Due by its own cadence, or resuming unfinished work, or retrying a failure. */
export function shouldRun(step: TickStep, now: Date, state: TickStepState | undefined): boolean {
  if (state && (state.lastError || state.lastDone === false)) return true;
  const last = state?.lastRunAt ? new Date(state.lastRunAt) : null;
  return step.due(now, last);
}

async function recordStep(name: string, startedAt: Date, ms: number, res: { done?: boolean; note?: string; error?: string }): Promise<void> {
  await pool.query(
    `INSERT INTO propreports_tick_steps (name, last_run_at, last_ok_at, last_done, last_note, last_error, last_ms, runs)
     VALUES ($1, $2, CASE WHEN $5::text IS NULL THEN $2 ELSE NULL END, $3, $4, $5, $6, 1)
     ON CONFLICT (name) DO UPDATE SET
       last_run_at = EXCLUDED.last_run_at,
       last_ok_at = COALESCE(EXCLUDED.last_ok_at, propreports_tick_steps.last_ok_at),
       last_done = EXCLUDED.last_done, last_note = EXCLUDED.last_note, last_error = EXCLUDED.last_error,
       last_ms = EXCLUDED.last_ms, runs = propreports_tick_steps.runs + 1`,
    [name, startedAt, res.done ?? null, res.note?.slice(0, 500) ?? null, res.error?.slice(0, 1000) ?? null, ms],
  ).catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e), step: name }, "tick: could not record step"));
}

export async function runTick(opts: RunTickOptions): Promise<TickSummary> {
  const t0 = Date.now();
  const startedAt = new Date(t0);
  const deadline = t0 + (opts.budgetMs ?? TICK_BUDGET_MS);
  const summary: TickSummary = { ok: true, startedAt: startedAt.toISOString(), ms: 0, steps: [], outbox: { processed: 0, failed: 0, remaining: 0 } };
  const holder = `${opts.trigger}:${randomUUID()}`;
  let leased = false;
  try {
    leased = await acquireLease(TICK_LEASE, holder, Math.ceil((deadline - t0) / 1000) + LEASE_EXTRA_S);
  } catch (e) {
    summary.ok = false;
    summary.steps.push({ name: "lease", ran: false, error: e instanceof Error ? e.message : String(e) });
    summary.ms = Date.now() - t0;
    return summary;
  }
  if (!leased) {
    summary.skipped = "lease";
    summary.ms = Date.now() - t0;
    return summary;
  }
  const log = logger.child({ tick: holder });
  try {
    const client = opts.client !== undefined ? opts.client : await createTickClient({ deadline });
    if (!client) {
      summary.skipped = "not-configured";
    } else {
      const states = await loadStepStates().catch(() => new Map<string, TickStepState>());
      for (const step of opts.steps ?? TICK_STEPS) {
        const now = new Date();
        if (Date.now() > deadline - STEP_MIN_MS) { summary.steps.push({ name: step.name, ran: false, note: "budget" }); continue; }
        if (!shouldRun(step, now, states.get(step.name))) { summary.steps.push({ name: step.name, ran: false }); continue; }
        const s0 = Date.now();
        try {
          const res = await step.run({ now, deadline, client, log, enqueue: (kind, payload) => enqueueOutbox(kind, payload) });
          const ms = Date.now() - s0;
          summary.steps.push({ name: step.name, ran: true, done: res.done, note: res.note, ms });
          await recordStep(step.name, now, ms, res);
        } catch (e) {
          const ms = Date.now() - s0;
          if (e instanceof PropReportsError && e.key === "conn.deadline") {
            summary.steps.push({ name: step.name, ran: true, done: false, note: "deadline", ms });
            await recordStep(step.name, now, ms, { done: false, note: "deadline" });
            continue;
          }
          const error = e instanceof Error ? e.message : String(e);
          summary.ok = false;
          summary.steps.push({ name: step.name, ran: true, error, ms });
          log.warn({ step: step.name, err: error }, "tick: step failed");
          await recordStep(step.name, now, ms, { error });
        }
      }
    }
    try {
      summary.outbox = await (opts.drain ?? drainOutbox)(deadline);
    } catch (e) {
      summary.ok = false;
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "tick: outbox drain failed");
    }
  } finally {
    summary.ms = Date.now() - t0;
    await setCursor("tick:last", { ...summary, trigger: opts.trigger }).catch(() => {});
    await releaseLease(TICK_LEASE, holder).catch(() => {});
  }
  return summary;
}
