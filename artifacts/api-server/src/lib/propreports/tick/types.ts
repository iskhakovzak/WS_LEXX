/**
 * PropReports tick — shared contract (CORE owns this file; RISK-LIVE / ACCURACY build steps against it).
 *
 * One HTTP tick (POST /api/cron/tick, every 5 min in market hours, hourly otherwise — docs/PROPREPORTS_CRON.sql) takes
 * a DB lease, runs every DUE step of TICK_STEPS (tick/steps.ts) in order until ~45 s are spent, records each step's
 * last run / result (propreports_tick_steps), then drains the outbox (tick/outbox.ts) with the remaining time.
 *
 * Step rules:
 *   - idempotent and resumable: progress lives in DB cursors (tick/cursor.ts), never in module memory
 *     (a Vercel function instance may be new on every tick);
 *   - respect `ctx.deadline` (epoch ms): stop before it and return `{ done: false }` — the runner then treats the step
 *     as due on the next tick regardless of `due()`;
 *   - side effects that are not the step's own data (notifications, rule scans, …) go through `ctx.enqueue(kind, payload)`
 *     with a kind registered in OUTBOX_HANDLERS — never fire-and-forget promises (a frozen function loses them);
 *   - throw on failure: the runner records the error text, the next tick retries (due() sees `last` = the failed run).
 */
import type { Logger } from "pino";
import type { PropReportsClient } from "../client";

export type TickCtx = {
  now: Date;
  /** Epoch ms after which the step must have returned. */
  deadline: number;
  /** A client built for this tick (its HTTP timeouts are capped by `deadline`). */
  client: PropReportsClient;
  /** Durable side effect: a row in propreports_outbox, handled by OUTBOX_HANDLERS[kind] (tick/outbox.ts). */
  enqueue: (kind: string, payload: unknown) => Promise<void>;
  log: Logger;
};

export type TickStepResult = { done: boolean; note?: string };

export type TickStep = {
  /** Stable id (stored in propreports_tick_steps.name); e.g. "fills.recent", "positions.live". */
  name: string;
  /** Run this tick? `last` = start of the previous run (null = never ran). Pure — no I/O. See tick/due.ts helpers. */
  due(now: Date, last: Date | null): boolean;
  run(ctx: TickCtx): Promise<TickStepResult>;
};

export type OutboxHandler = (payload: unknown) => Promise<void>;

/** Per-step state as recorded by the runner (GET /api/propreports/tick exposes it). */
export type TickStepState = {
  name: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastDone: boolean | null;
  lastNote: string | null;
  lastError: string | null;
  lastMs: number | null;
  runs: number;
};

export type TickSummary = {
  ok: boolean;
  /** Why nothing ran: "lease" (another tick holds it) or "not-configured" (steps skipped; outbox still drained). */
  skipped?: "lease" | "not-configured";
  startedAt: string;
  ms: number;
  steps: Array<{ name: string; ran: boolean; done?: boolean; note?: string; error?: string; ms?: number }>;
  outbox: { processed: number; failed: number; remaining: number };
};
