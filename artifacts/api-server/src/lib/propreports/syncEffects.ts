/**
 * Side effects of a sync, enqueued in its transaction (applySync, ./sync.ts): rule scan, idea relink, challenge
 * refresh (per changed trader), trade structures, and the "propreports.synced" event. Drained by the tick / kickOutbox
 * (tick/outbox.ts).
 */
import type { pool } from "@workspace/db";
import { enqueueOutbox } from "./tick/outbox";
import type { SyncPlan } from "./sync";

type PoolClient = { query: (typeof pool)["query"] };

const STRUCTURE_CHUNK = 300;

/**
 * Recompute the structure (roles, re-entry links) of the written trades — as outbox rows of ≤ STRUCTURE_CHUNK ids,
 * enqueued in the caller's transaction (the sync never waits for it and never fails because of it; the trade sheet
 * computes the structure live anyway). Chunks keep one handler run short and bounded.
 */
export async function enqueueStructures(db: Pick<PoolClient, "query">, tradeIds: number[]): Promise<void> {
  const ids = [...new Set(tradeIds)];
  for (let i = 0; i < ids.length; i += STRUCTURE_CHUNK) await enqueueOutbox("structures.refresh", { tradeIds: ids.slice(i, i + STRUCTURE_CHUNK) }, db);
}

/** Traders whose book an applied plan changed (insert / update / adopt), sorted. */
export function changedTraders(plan: SyncPlan): string[] {
  return [...new Set(plan.items.filter((it) => (it.action === "insert" || it.action === "update" || it.action === "adopt") && it.trader).map((it) => it.trader as string))].sort();
}

/**
 * Everything a committed sync owes its listeners (atomic with the trades: a committed sync never loses them).
 * `event` null = no "propreports.synced" row (the live loop enqueues a coalesced one itself, lib/propreports/live).
 */
export async function enqueueSyncEffects(db: Pick<PoolClient, "query">, plan: SyncPlan, writtenTrades: number[], event: Record<string, unknown> | null): Promise<void> {
  const traders = changedTraders(plan);
  if (traders.length) {
    await enqueueOutbox("rules.scan", { traders }, db);
    await enqueueOutbox("ideas.relink", { traders }, db);
    await enqueueOutbox("challenges.refresh", { traders }, db);
  }
  await enqueueStructures(db, writtenTrades);
  if (event) await enqueueOutbox("propreports.synced", { ...event, traders }, db);
}
