/**
 * lib/whatIfHonestyStore on the TEST database (TEST_DATABASE_URL / edge_tracker_test — never the dev DB): the 0244
 * table is created in a private schema of this run (search_path), so two connections can exercise SKIP LOCKED, and the
 * schema is dropped afterwards. Skipped when the local Postgres or the test database is unreachable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, pg } from "@workspace/db";
import * as store from "../whatIfHonestyStore";
import type { HonestyKey } from "../whatIfHonestyStore";
import type { HonestyResult } from "../whatIfHonesty";

const URL_ = process.env.DATABASE_URL as string; // test-setup: always a *_test database
const SCHEMA = `whatif_hc_${process.pid}_${Date.now()}`;
const MIGRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations/0244_whatif_honesty_cache.sql");

async function reachable(): Promise<boolean> {
  if (!/_test$/.test(new URL(URL_).pathname)) return false;
  const c = new pg.Client({ connectionString: URL_, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

const available = await reachable();
const key = (p: Partial<HonestyKey> = {}): HonestyKey => ({ trader: "T1", from: "", to: "", sig: "s1", version: 1, ...p });
const result = (n: number) => ({ version: 1, n, days: 10, cards: [], verdicts: [] }) as unknown as HonestyResult;

describe.skipIf(!available)("whatif_honesty_cache store (0244)", () => {
  let db: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();
    db = createPool(URL_, { max: 4, application_name: "vitest-whatif-store", options: `-c TimeZone=UTC -c search_path=${SCHEMA}` });
    await db.query(readFileSync(MIGRATION, "utf8"));
  });
  afterAll(async () => {
    await db?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
    await db?.end().catch(() => undefined);
  });
  beforeEach(async () => {
    await db.query(`TRUNCATE whatif_honesty_cache RESTART IDENTITY`);
  });

  it("enqueue twice → one row; the second call reports it inserted nothing", async () => {
    expect(await store.enqueue(db, key())).toBe(true);
    expect(await store.enqueue(db, key())).toBe(false);
    expect(await store.enqueue(db, key({ sig: "s2" }))).toBe(true);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM whatif_honesty_cache`);
    expect(rows[0].n).toBe(2);
    expect(await store.get(db, key())).toMatchObject({ trader: "T1", from: "", to: "", sig: "s1", version: 1, state: "queued", attempts: 0, result: null });
    expect(await store.get(db, key({ trader: "T2" }))).toBeNull();
  });

  it("claim is FIFO, skips a row locked by another worker, and only claims its engine version", async () => {
    await store.enqueue(db, key({ trader: "A" }));
    await store.enqueue(db, key({ trader: "B" }));
    await store.enqueue(db, key({ trader: "C", version: 2 }));
    const other = await db.connect();
    try {
      await other.query("BEGIN");
      await other.query(`SELECT id FROM whatif_honesty_cache WHERE trader = 'A' FOR UPDATE`);
      const first = await store.claim(db, 1);
      expect(first).toMatchObject({ trader: "B", state: "running", attempts: 1 });
      expect(first!.startedAt).toBeInstanceOf(Date);
      await other.query("ROLLBACK");
    } finally {
      other.release();
    }
    expect((await store.claim(db, 1))?.trader).toBe("A");
    expect(await store.claim(db, 1)).toBeNull();
    expect((await store.claim(db, 2))?.trader).toBe("C");
  });

  it("finish only from running; the result round-trips as JSON", async () => {
    await store.enqueue(db, key());
    const queued = (await store.get(db, key()))!;
    expect(await store.finish(db, queued.id, result(1), 5)).toBe(false);
    const row = (await store.claim(db, 1))!;
    expect(await store.finish(db, row.id, result(7), 1234.4)).toBe(true);
    expect(await store.finish(db, row.id, result(8), 1)).toBe(false);
    expect(await store.get(db, key())).toMatchObject({ state: "ready", result: result(7), durationMs: 1234, error: null });
    expect((await store.get(db, key()))!.finishedAt).toBeInstanceOf(Date);
  });

  it("release gives the attempt back; fail keeps the message", async () => {
    await store.enqueue(db, key());
    const row = (await store.claim(db, 1))!;
    await store.release(db, row.id);
    expect(await store.get(db, key())).toMatchObject({ state: "queued", attempts: 0, startedAt: null });
    const again = (await store.claim(db, 1))!;
    await store.fail(db, again.id, "x".repeat(5000));
    const failed = (await store.get(db, key()))!;
    expect(failed).toMatchObject({ state: "failed", attempts: 1 });
    expect(failed.error).toHaveLength(4000);
  });

  it("retryFailed: only after the pause and while attempts are left", async () => {
    await store.enqueue(db, key());
    const row = (await store.claim(db, 1))!;
    await store.fail(db, row.id, "boom");
    expect(await store.retryFailed(db, row.id)).toBe(false); // failed just now (< 6 h)
    expect(await store.retryFailed(db, row.id, 3, 0)).toBe(true);
    expect(await store.get(db, key())).toMatchObject({ state: "queued", error: null, attempts: 1 });
    await db.query(`UPDATE whatif_honesty_cache SET state = 'failed', attempts = 3, finished_at = now() - interval '7 hours'`);
    expect(await store.retryFailed(db, row.id)).toBe(false);
    await db.query(`UPDATE whatif_honesty_cache SET attempts = 2`);
    expect(await store.retryFailed(db, row.id)).toBe(true);
  });

  it("requeueStale: a running row older than 30 min goes back to the queue, or fails after 3 attempts", async () => {
    await store.enqueue(db, key({ trader: "A" }));
    await store.enqueue(db, key({ trader: "B" }));
    await store.enqueue(db, key({ trader: "C" }));
    for (let i = 0; i < 3; i++) await store.claim(db, 1);
    await db.query(`UPDATE whatif_honesty_cache SET started_at = now() - interval '31 minutes' WHERE trader IN ('A', 'B')`);
    await db.query(`UPDATE whatif_honesty_cache SET attempts = 3 WHERE trader = 'B'`);
    expect(await store.requeueStale(db)).toEqual({ requeued: 1, failed: 1 });
    expect(await store.get(db, key({ trader: "A" }))).toMatchObject({ state: "queued", startedAt: null });
    expect(await store.get(db, key({ trader: "B" }))).toMatchObject({ state: "failed" });
    expect((await store.get(db, key({ trader: "B" })))!.error).toMatch(/stale/);
    expect(await store.get(db, key({ trader: "C" }))).toMatchObject({ state: "running" });
  });

  it("resign: takes the new signature, or deletes the row when that key already exists", async () => {
    await store.enqueue(db, key({ sig: "old" }));
    await store.enqueue(db, key({ sig: "taken" }));
    const row = (await store.get(db, key({ sig: "old" })))!;
    expect(await store.resign(db, row.id, "fresh")).toBe("updated");
    expect(await store.get(db, key({ sig: "fresh" }))).toMatchObject({ id: row.id });
    expect(await store.resign(db, row.id, "taken")).toBe("deleted");
    expect(await store.get(db, key({ sig: "fresh" }))).toBeNull();
    expect(await store.get(db, key({ sig: "taken" }))).not.toBeNull();
  });

  it("recentUse and touch (at most once an hour)", async () => {
    await store.enqueue(db, key());
    expect(await store.recentUse(db, "T1", "", "")).toBe(true);
    expect(await store.recentUse(db, "T1", "2026-01-01", "")).toBe(false);
    await db.query(`UPDATE whatif_honesty_cache SET used_at = now() - interval '15 days'`);
    expect(await store.recentUse(db, "T1", "", "")).toBe(false);
    const row = (await store.get(db, key()))!;
    await store.touch(db, row.id);
    expect(await store.recentUse(db, "T1", "", "")).toBe(true);
    const touched = (await store.get(db, key()))!.usedAt.getTime();
    await store.touch(db, row.id); // within the hour: no write
    expect((await store.get(db, key()))!.usedAt.getTime()).toBe(touched);
  });

  it("a precompute enqueue is not a visit: it inherits the period's last real use and never makes recentUse true", async () => {
    // Nobody ever asked for this period: the warmed row stays unused.
    expect(await store.enqueue(db, key({ trader: "P", sig: "warm" }), { precompute: true })).toBe(true);
    expect(await store.recentUse(db, "P", "", "")).toBe(false);
    // A visit 13 days ago (sig a): the precomputed row (sig b) carries that same time, not now().
    await store.enqueue(db, key({ sig: "a" }));
    await db.query(`UPDATE whatif_honesty_cache SET used_at = now() - interval '13 days' WHERE data_sig = 'a'`);
    await store.enqueue(db, key({ sig: "b" }), { precompute: true });
    const { rows } = await db.query(`SELECT data_sig, used_at FROM whatif_honesty_cache WHERE trader = 'T1' ORDER BY data_sig`);
    expect(rows.map((r) => r.data_sig)).toEqual(["a", "b"]);
    expect(new Date(rows[1].used_at).getTime()).toBe(new Date(rows[0].used_at).getTime());
    expect(await store.recentUse(db, "T1", "", "")).toBe(true);
    // Two days later the visit is 15 days old: the warmed row does not keep the key alive.
    await db.query(`UPDATE whatif_honesty_cache SET used_at = used_at - interval '2 days' WHERE trader = 'T1'`);
    expect(await store.recentUse(db, "T1", "", "")).toBe(false);
    expect(await store.prune(db, 1)).toBe(3);
  });

  it("requeueStale(0) at the start of a run takes back every running row, however fresh", async () => {
    await store.enqueue(db, key({ trader: "A" }));
    await store.claim(db, 1);
    expect(await store.requeueStale(db)).toEqual({ requeued: 0, failed: 0 }); // the 30-min default leaves it
    expect(await store.requeueStale(db, 0)).toEqual({ requeued: 1, failed: 0 });
    expect(await store.get(db, key({ trader: "A" }))).toMatchObject({ state: "queued", startedAt: null, attempts: 1 });
  });

  it("prune: other engine versions and keys unused for 14 days go, a running row stays", async () => {
    await store.enqueue(db, key({ trader: "old-version", version: 0 }));
    await store.enqueue(db, key({ trader: "unused" }));
    await store.enqueue(db, key({ trader: "running" }));
    await store.enqueue(db, key({ trader: "fresh" }));
    await db.query(`UPDATE whatif_honesty_cache SET used_at = now() - interval '20 days' WHERE trader IN ('unused', 'running')`);
    await db.query(`UPDATE whatif_honesty_cache SET state = 'running' WHERE trader = 'running'`);
    expect(await store.prune(db, 1)).toBe(2);
    const { rows } = await db.query(`SELECT trader FROM whatif_honesty_cache ORDER BY trader`);
    expect(rows.map((r) => r.trader)).toEqual(["fresh", "running"]);
  });
});
