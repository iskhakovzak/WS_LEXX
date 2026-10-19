/**
 * Tick SQL against a real (scratch) Postgres with migration 0220 applied: lease take/expire/release, cursors, outbox
 * enqueue de-duplication + drain + backoff, backfill one-running rule + cancel, trades_version bump.
 * Skips when the local Postgres is down. Never touches the dev database (a throw-away vitest_* database).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pgAvailable, createScratchDb } from "../../../db/__tests__/scratchDb";

const holder: { pool: any } = { pool: null };
vi.mock("@workspace/db", async (orig) => {
  const real = await orig<typeof import("@workspace/db")>();
  return { ...real, pool: { query: (...a: unknown[]) => holder.pool.query(...a), connect: () => holder.pool.connect() } };
});

const available = await pgAvailable();
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, "../../../db/migrations/0220_propreports_tick.sql"), "utf8");

describe.skipIf(!available)("tick SQL (scratch DB, migration 0220)", () => {
  let scratch: Awaited<ReturnType<typeof createScratchDb>>;
  beforeAll(async () => {
    scratch = await createScratchDb("pr_tick");
    holder.pool = scratch.pool;
    await scratch.pool.query(MIGRATION);
    await scratch.pool.query(MIGRATION); // idempotent
  }, 30_000);
  afterAll(async () => { await scratch?.drop(); });

  it("lease: one holder at a time, expires, release only by the holder", async () => {
    const { acquireLease, releaseLease, leaseInfo } = await import("../../propreports/tick/lease");
    expect(await acquireLease("t1", "a", 60)).toBe(true);
    expect(await acquireLease("t1", "b", 60)).toBe(false);
    await releaseLease("t1", "b"); // not the holder: no effect
    expect(await acquireLease("t1", "b", 60)).toBe(false);
    await releaseLease("t1", "a");
    expect(await acquireLease("t1", "b", 1)).toBe(true);
    expect((await leaseInfo("t1"))?.holder).toBe("b");
    await scratch.pool.query(`UPDATE propreports_tick_lease SET expires_at = NOW() - interval '1 second' WHERE name = 't1'`);
    expect(await acquireLease("t1", "c", 60)).toBe(true);
  });

  it("cursors: set / get / prefix", async () => {
    const { getCursor, getCursors, setCursor } = await import("../../propreports/tick/cursor");
    await setCursor("fills:acct:A_1", { fp: "x" });
    await setCursor("fills:acct:B", { fp: "y" });
    await setCursor("fills:acctX", { fp: "z" });
    await setCursor("fills:acct:A_1", { fp: "x2" });
    expect(await getCursor("fills:acct:A_1")).toEqual({ fp: "x2" });
    expect(await getCursor("nope")).toBeNull();
    expect([...(await getCursors("fills:acct:")).keys()].sort()).toEqual(["fills:acct:A_1", "fills:acct:B"]);
  });

  it("outbox: identical waiting rows are not duplicated; drain runs, retries with backoff", async () => {
    const { enqueueOutbox, drainOutbox } = await import("../../propreports/tick/outbox");
    await enqueueOutbox("rules.scan", { traders: ["A"] });
    await enqueueOutbox("rules.scan", { traders: ["A"] });
    await enqueueOutbox("rules.scan", { traders: ["B"] });
    await enqueueOutbox("bad.kind", { x: 1 });
    expect((await scratch.pool.query(`SELECT COUNT(*)::int AS n FROM propreports_outbox`)).rows[0].n).toBe(3);
    const seen: unknown[] = [];
    const r = await drainOutbox(Date.now() + 10_000, { handlers: { "rules.scan": async (p) => { seen.push(p); }, "bad.kind": async () => { throw new Error("boom"); } } });
    expect(r).toEqual({ processed: 2, failed: 1, remaining: 1 });
    expect(seen).toEqual([{ traders: ["A"] }, { traders: ["B"] }]);
    const bad = (await scratch.pool.query(`SELECT attempts, last_error, run_after > NOW() AS later, done_at FROM propreports_outbox WHERE kind = 'bad.kind'`)).rows[0];
    expect(bad).toMatchObject({ attempts: 1, last_error: "boom", later: true, done_at: null });
    // backed off: a second drain right away does not pick it
    expect((await drainOutbox(Date.now() + 5_000, { handlers: {} })).processed).toBe(0);
  });

  it("backfill: one running at a time, progress row, cancel", async () => {
    const { startBackfill, activeBackfill, cancelBackfill, BackfillConflictError, listBackfills } = await import("../../propreports/tick/backfill");
    const b = await startBackfill({ from: "2026-01-01", to: "2026-01-20", actor: "Антон" });
    expect(b).toMatchObject({ dateFrom: "2026-01-01", dateTo: "2026-01-20", cursor: "2026-01-01", status: "running", windowsTotal: 3, windowsDone: 0, percent: 0 });
    await expect(startBackfill({ from: "2026-02-01", to: "2026-02-02", actor: "x" })).rejects.toBeInstanceOf(BackfillConflictError);
    expect((await activeBackfill())?.id).toBe(b.id);
    expect((await cancelBackfill(b.id))?.status).toBe("cancelled");
    expect(await cancelBackfill(b.id)).toBeNull();
    expect(await activeBackfill()).toBeNull();
    expect((await listBackfills(5))[0].id).toBe(b.id);
  });

  it("trades_version bump increments the stamp", async () => {
    const { bumpTradesVersion } = await import("../../propreports/tradesVersion");
    const v1 = Number(await bumpTradesVersion());
    const v2 = Number(await bumpTradesVersion());
    expect(v2).toBe(v1 + 1);
  });
});
