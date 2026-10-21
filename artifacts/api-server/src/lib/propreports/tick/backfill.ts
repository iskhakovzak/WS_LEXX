/**
 * Resumable history backfill (table propreports_backfills): a curator asks for [from, to]; every tick the step
 * "backfill.history" pulls consecutive 7-day windows, oldest first, until its time is up, and moves `cursor` forward
 * after each applied window. A window fails → retried on the next tick; MAX_WINDOW_ATTEMPTS failures of the same window
 * → status "error" (the curator can start again from that date).
 *
 * Carries: each window is fetched from up to OVERLAP_DAYS before its start (never before `from`), so a position opened
 * at the end of the previous window pairs with its exit; re-applying the overlap is idempotent (same external ids).
 */
import { pool } from "@workspace/db";
import { addDays } from "../../tradingDate";
import { buildRoundTrips } from "../round-trips";
import { applySync, planSync } from "../sync";
import { canonicalizeFillIds } from "../replacement";
import { fetchFillsBounded } from "./fillsStep";
import { always, remainingMs } from "./due";
import { PropReportsError, type PropReportsClient } from "../client";
import type { TickCtx, TickStep, TickStepResult } from "./types";

export const WINDOW_DAYS = 7;
export const OVERLAP_DAYS = 3;
export const MAX_RANGE_DAYS = 3 * 366;
const MAX_WINDOW_ATTEMPTS = 3;
/** A window is not started with less than this left in the tick. */
const WINDOW_MIN_MS = 15_000;

export type BackfillStatus = "running" | "done" | "cancelled" | "error";

export interface Backfill {
  id: number;
  dateFrom: string;
  dateTo: string;
  /** First day of the next window to pull (> dateTo when finished). */
  cursor: string;
  status: BackfillStatus;
  windowsTotal: number;
  windowsDone: number;
  /** 0–100, by windows. */
  percent: number;
  inserted: number;
  updated: number;
  conflicts: number;
  errors: number;
  fills: number;
  attempts: number;
  lastError: string | null;
  actor: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

type Queryable = { query: (typeof pool)["query"] };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Number of WINDOW_DAYS windows covering [from, to] (inclusive). */
export function windowsFor(from: string, to: string): number {
  return Math.max(1, Math.ceil((daysBetween(from, to) + 1) / WINDOW_DAYS));
}

/** The next window [start, end] and the fetch start (with overlap, clamped to `from`). */
export function nextWindow(b: Pick<Backfill, "dateFrom" | "dateTo" | "cursor">): { start: string; end: string; fetchFrom: string } | null {
  if (b.cursor > b.dateTo) return null;
  const end = addDays(b.cursor, WINDOW_DAYS - 1);
  const overlap = addDays(b.cursor, -OVERLAP_DAYS);
  return { start: b.cursor, end: end > b.dateTo ? b.dateTo : end, fetchFrom: overlap < b.dateFrom ? b.dateFrom : overlap };
}

export function backfillView(r: any): Backfill {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const total = Number(r.windows_total ?? 0);
  const done = Number(r.windows_done ?? 0);
  return {
    id: Number(r.id),
    dateFrom: String(r.date_from),
    dateTo: String(r.date_to),
    cursor: String(r.cursor),
    status: r.status as BackfillStatus,
    windowsTotal: total,
    windowsDone: done,
    percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    conflicts: Number(r.conflicts ?? 0),
    errors: Number(r.errors ?? 0),
    fills: Number(r.fills ?? 0),
    attempts: Number(r.attempts ?? 0),
    lastError: r.last_error ?? null,
    actor: r.actor ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    finishedAt: iso(r.finished_at),
  };
}

export class BackfillConflictError extends Error {
  constructor(public readonly active: Backfill) { super("a backfill is already running"); }
}

/** Queue a backfill; only one may run at a time (BackfillConflictError otherwise). */
export async function startBackfill(input: { from: string; to: string; actor: string }, db: Queryable = pool): Promise<Backfill> {
  const active = await activeBackfill(db);
  if (active) throw new BackfillConflictError(active);
  const { rows } = await db.query(
    `INSERT INTO propreports_backfills (date_from, date_to, cursor, status, windows_total, actor)
     VALUES ($1, $2, $1, 'running', $3, $4) RETURNING *`,
    [input.from, input.to, windowsFor(input.from, input.to), input.actor],
  );
  return backfillView(rows[0]);
}

export async function activeBackfill(db: Queryable = pool): Promise<Backfill | null> {
  const { rows } = await db.query(`SELECT * FROM propreports_backfills WHERE status = 'running' ORDER BY id ASC LIMIT 1`);
  return rows[0] ? backfillView(rows[0]) : null;
}

export async function listBackfills(limit = 10, db: Queryable = pool): Promise<Backfill[]> {
  const { rows } = await db.query(`SELECT * FROM propreports_backfills ORDER BY id DESC LIMIT $1`, [limit]);
  return rows.map(backfillView);
}

/** Stop a running backfill (data already pulled stays). Returns the row, or null when it was not running. */
export async function cancelBackfill(id: number, db: Queryable = pool): Promise<Backfill | null> {
  const { rows } = await db.query(
    `UPDATE propreports_backfills SET status = 'cancelled', finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'running' RETURNING *`,
    [id],
  );
  return rows[0] ? backfillView(rows[0]) : null;
}

/** Pull + apply one window. Returns false when the deadline cut the fetch (nothing applied, cursor unchanged). */
export async function runBackfillWindow(b: Backfill, client: PropReportsClient, deadline: number): Promise<boolean> {
  const w = nextWindow(b);
  if (!w) return true;
  const fetched = await fetchFillsBounded(client, w.fetchFrom, w.end, deadline, 100);
  if (!fetched.complete) {
    if (fetched.total > 100) throw new Error(`window ${w.start}…${w.end}: ${fetched.total} pages (> 100)`);
    return false;
  }
  const { fills } = await canonicalizeFillIds(fetched.fills);
  const { trips } = buildRoundTrips(fills);
  const plan = await planSync(trips);
  const writes = plan.counts.insert + plan.counts.update + plan.counts.adopt + plan.counts.conflict;
  let inserted = 0, updated = 0, conflicts = 0, errors = 0;
  if (writes > 0) {
    const res = await applySync(plan, {
      actor: b.actor ?? "backfill", source: "api", dateFrom: w.fetchFrom, dateTo: w.end, feeColumns: fetched.feeColumns, kick: false,
      details: { backfillId: b.id, window: [w.start, w.end], fills: fills.length },
    });
    if (res.errors && !res.inserted && !res.updated) throw new Error((res.errorText ?? "apply failed").slice(0, 500));
    ({ inserted, updated, conflicts, errors } = res);
  }
  const next = addDays(w.end, 1);
  const finished = next > b.dateTo;
  const upd = await pool.query(
    `UPDATE propreports_backfills
        SET cursor = $2, windows_done = windows_done + 1, inserted = inserted + $3, updated = updated + $4, conflicts = conflicts + $5,
            errors = errors + $6, fills = fills + $7, attempts = 0, last_error = NULL, updated_at = NOW(),
            status = CASE WHEN $8 THEN 'done' ELSE status END, finished_at = CASE WHEN $8 THEN NOW() ELSE finished_at END
      WHERE id = $1 AND status = 'running'`,
    [b.id, next, inserted, updated, conflicts, errors, fills.length, finished],
  );
  // 0 rows: the backfill stopped meanwhile (cancelled by a curator) — the window's data stays, the loop ends here
  if (!upd.rowCount) {
    b.status = "cancelled";
    return true;
  }
  Object.assign(b, { cursor: next, windowsDone: b.windowsDone + 1, status: finished ? "done" : b.status });
  return true;
}

async function recordFailure(b: Backfill, error: string): Promise<void> {
  await pool.query(
    `UPDATE propreports_backfills SET attempts = attempts + 1, last_error = $2, updated_at = NOW(),
            status = CASE WHEN attempts + 1 >= $3 THEN 'error' ELSE status END,
            finished_at = CASE WHEN attempts + 1 >= $3 THEN NOW() ELSE finished_at END
      WHERE id = $1 AND status = 'running'`,
    [b.id, error.slice(0, 1000), MAX_WINDOW_ATTEMPTS],
  );
}

export async function runBackfill(ctx: TickCtx): Promise<TickStepResult> {
  const b = await activeBackfill();
  if (!b) return { done: true, note: "idle" };
  let windows = 0;
  while (b.status === "running" && remainingMs(ctx.deadline) >= WINDOW_MIN_MS) {
    try {
      const applied = await runBackfillWindow(b, ctx.client, ctx.deadline);
      if (!applied) break;
      windows++;
    } catch (e) {
      if (e instanceof PropReportsError && e.key === "conn.deadline") break; // out of time, not a failure
      const msg = e instanceof Error ? e.message : String(e);
      await recordFailure(b, msg);
      throw e;
    }
  }
  const finished = b.status !== "running";
  return { done: finished, note: `#${b.id}: ${windows} window(s) this tick, ${b.windowsDone}/${b.windowsTotal}${finished ? ` — ${b.status}` : `, next ${b.cursor}`}` };
}

export const backfillStep: TickStep = {
  name: "backfill.history",
  due: always,
  run: runBackfill,
};
