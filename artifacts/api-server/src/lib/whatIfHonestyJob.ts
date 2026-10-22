/**
 * Runner of the job whatif.honesty (registered by lib/whatIfHonestyJobDefs): drains the queue of honest what-if
 * verdicts (table whatif_honesty_cache, lib/whatIfHonestyStore), one trader key at a time.
 *
 *   1. rows left running by a stopped or crashed process go back to the queue (or fail after 3 attempts) — every one of
 *      them, at once: this run holds the job's advisory lock and the in-process guard, so nobody else can own a running
 *      row; stale rows are pruned;
 *   2. evening precompute — on a PropReports sync outside the regular session (NY weekend, or a weekday from 16:15 to
 *      09:00) the «всё время» key of every synced trader who used the page in the last 14 days is queued, so the
 *      verdict is ready before the next visit (during the session the request path queues it). A precomputed row is
 *      not a visit (store enqueue `precompute`), so a trader who stopped coming is not warmed up forever;
 *   3. drain: claim the oldest queued row, load the trades fresh, re-sign the row when they changed since the request
 *      (or drop it when that key already exists), compute (computeHonestyAsync yields to the event loop: the API is one
 *      process), finish. An abort (the run's timeout, or the scheduler stopping for a shutdown) gives the row back to
 *      the queue and claims nothing more.
 * Idempotent: one row per key, SKIP LOCKED plus the registry's advisory lock, finish only from running, and the
 * deterministic engine writes the same JSON on a recompute. Reads only the local DB.
 */
import { pool } from "@workspace/db";
import { type JobContext, schedulerStopSignal } from "../jobs/registry";
import { nyParts } from "../jobs/cron";
import { HONESTY, type HonestyResult, computeHonestyAsync } from "./whatIfHonesty";
import * as honestyStore from "./whatIfHonestyStore";
import type { Queryable } from "./whatIfHonestyStore";
import { querySimTrades } from "./whatIfLoader";
import { tradesSignature } from "./whatIfSignature";
import type { SimTrade } from "./whatIfTypes";

export type HonestyStoreApi = Pick<typeof honestyStore, "claim" | "finish" | "fail" | "release" | "requeueStale" | "resign" | "recentUse" | "enqueue" | "prune">;

export interface HonestyJobDeps {
  db: Queryable;
  store: HonestyStoreApi;
  /** Trades of one trader for a period (uncached: the signature must see the trades as they are now). */
  load: (trader: string, from?: string, to?: string) => Promise<SimTrade[]>;
  compute: (trades: SimTrade[], run: { signal?: AbortSignal }) => Promise<HonestyResult>;
  now: () => Date;
  /** Stop claiming new rows after this long (the job timeout is 15 min). */
  budgetMs: number;
  version: number;
  /** Aborted when the scheduler stops (a shutdown): give the row back, claim nothing more. */
  stop: AbortSignal;
}

export interface HonestyJobDetails {
  done: number;
  failed: number;
  superseded: number;
  requeuedStale: number;
  failedStale: number;
  precomputed: number;
  pruned: number;
  stoppedBy: "empty" | "budget" | "abort";
}

const defaultDeps = (): HonestyJobDeps => ({
  db: pool as unknown as Queryable,
  store: honestyStore,
  load: (trader, from, to) => querySimTrades(trader, from, to),
  compute: (trades, run) => computeHonestyAsync(trades, {}, run),
  now: () => new Date(),
  budgetMs: 12 * 60_000,
  version: HONESTY.version,
  stop: schedulerStopSignal(),
});

/** Outside the regular session: NY weekend, or a weekday from 16:15 (the post-close sync is in) to 09:00. */
export function quietHours(d: Date): boolean {
  const p = nyParts(d);
  if (p.weekday === 0 || p.weekday === 6) return true;
  const m = p.hour * 60 + p.minute;
  return m >= 16 * 60 + 15 || m < 9 * 60;
}

function payloadTraders(payload: unknown): string[] {
  const t = (payload as { traders?: unknown } | null | undefined)?.traders;
  return Array.isArray(t) ? [...new Set(t.filter((x): x is string => typeof x === "string" && x.trim() !== ""))] : [];
}

const isAbort = (err: unknown, signal: AbortSignal) => signal.aborted || (err as { name?: string } | null)?.name === "AbortError";

export async function runHonestyQueue(ctx: Pick<JobContext, "signal" | "trigger" | "payload" | "logger">, over: Partial<HonestyJobDeps> = {}): Promise<HonestyJobDetails> {
  const d: HonestyJobDeps = { ...defaultDeps(), ...over };
  const { db, store } = d;
  const signal = AbortSignal.any([ctx.signal, d.stop]);
  const out: HonestyJobDetails = { done: 0, failed: 0, superseded: 0, requeuedStale: 0, failedStale: 0, precomputed: 0, pruned: 0, stoppedBy: "empty" };
  const t0 = d.now().getTime();

  const stale = await store.requeueStale(db, 0);
  out.requeuedStale = stale.requeued;
  out.failedStale = stale.failed;
  out.pruned = await store.prune(db, d.version);

  if (ctx.trigger === "event" && quietHours(d.now())) {
    for (const trader of payloadTraders(ctx.payload)) {
      if (signal.aborted) break;
      if (!(await store.recentUse(db, trader, "", ""))) continue;
      const sig = tradesSignature(await d.load(trader));
      if (await store.enqueue(db, { trader, from: "", to: "", sig, version: d.version }, { precompute: true })) out.precomputed++;
    }
  }

  for (;;) {
    if (signal.aborted) { out.stoppedBy = "abort"; break; }
    if (d.now().getTime() - t0 >= d.budgetMs) { out.stoppedBy = "budget"; break; }
    const row = await store.claim(db, d.version);
    if (!row) break;
    const started = d.now().getTime();
    try {
      const trades = await d.load(row.trader, row.from || undefined, row.to || undefined);
      const sig = tradesSignature(trades);
      if (sig !== row.sig && (await store.resign(db, row.id, sig)) === "deleted") {
        out.superseded++;
        continue;
      }
      const result = await d.compute(trades, { signal });
      await store.finish(db, row.id, result, d.now().getTime() - started);
      out.done++;
    } catch (err) {
      if (isAbort(err, signal)) {
        await store.release(db, row.id);
        out.stoppedBy = "abort";
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.warn({ err, trader: row.trader, id: row.id }, "whatif.honesty: verdict failed");
      await store.fail(db, row.id, msg.slice(0, 4000));
      out.failed++;
    }
  }
  return out;
}
