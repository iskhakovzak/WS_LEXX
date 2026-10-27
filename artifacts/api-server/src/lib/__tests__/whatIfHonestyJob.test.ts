/**
 * The job whatif.honesty (lib/whatIfHonestyJob runHonestyQueue) against an in-memory store with the same interface as
 * lib/whatIfHonestyStore, a fake loader and an injected clock: FIFO drain, idempotent re-run, superseded signatures,
 * abort, the scheduler stopping, orphaned running rows, the time budget, the evening precompute (which is not a visit),
 * failures, and the details stored in job_runs. No DB, no network.
 */
import { describe, expect, it, vi } from "vitest";
import type { JobDef } from "../../jobs/registry";
import { type HonestyResult, computeHonesty, computeHonestyAsync } from "../whatIfHonesty";
import type { HonestyJobDeps, HonestyStoreApi } from "../whatIfHonestyJob";
import { quietHours, runHonestyQueue } from "../whatIfHonestyJob";
import { WHATIF_HONESTY_JOB, WHATIF_HONESTY_REQUESTED, registerWhatIfHonestyJobs } from "../whatIfHonestyJobDefs";
import type { HonestyKey, HonestyRow } from "../whatIfHonestyStore";
import { tradesSignature } from "../whatIfSignature";
import type { SimTrade } from "../whatIfTypes";
import { noise } from "./whatIfHonestyFixtures";

const QUICK = { iters: 200, perms: 50 };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const DAY = 86_400_000;

/**
 * In-memory twin of lib/whatIfHonestyStore (same semantics, no SQL). `recent` traders asked for «всё время» a day
 * before `clock()` (their older rows: `uses`); used_at follows the store: a viewer's enqueue is a use now, a precompute
 * inherits the key's last real use.
 */
function memoryStore(recent: string[] = [], clock: () => Date = () => new Date("2026-10-20T21:00:00Z")) {
  const rows: HonestyRow[] = [];
  const uses = new Map<string, Date>(recent.map((t) => [t, new Date(clock().getTime() - DAY)]));
  const stale: number[] = [];
  let seq = 0;
  const same = (r: HonestyRow, k: HonestyKey) => r.trader === k.trader && r.from === k.from && r.to === k.to && r.sig === k.sig && r.version === k.version;
  const byId = (id: number) => rows.find((r) => r.id === id);
  const lastUse = (trader: string, from: string, to: string) => {
    const t = [...rows.filter((r) => r.trader === trader && r.from === from && r.to === to).map((r) => r.usedAt.getTime()),
      from === "" && to === "" ? uses.get(trader)?.getTime() ?? -Infinity : -Infinity];
    return Math.max(...t);
  };
  const api: HonestyStoreApi = {
    async enqueue(_db, k, opts = {}) {
      if (rows.some((r) => same(r, k))) return false;
      seq++;
      rows.push({
        id: seq, trader: k.trader, from: k.from, to: k.to, sig: k.sig, version: k.version, state: "queued", result: null, error: null, attempts: 0,
        requestedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)), usedAt: new Date(opts.precompute ? lastUse(k.trader, k.from, k.to) : clock().getTime()),
        startedAt: null, finishedAt: null, durationMs: null,
      });
      return true;
    },
    async claim(_db, version) {
      const r = rows.filter((x) => x.state === "queued" && x.version === version).sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime() || a.id - b.id)[0];
      if (!r) return null;
      Object.assign(r, { state: "running", attempts: r.attempts + 1, startedAt: new Date() });
      return { ...r };
    },
    async finish(_db, id, result, ms) {
      const r = byId(id);
      if (r?.state !== "running") return false;
      Object.assign(r, { state: "ready", result: JSON.parse(JSON.stringify(result)), durationMs: Math.round(ms), finishedAt: new Date() });
      return true;
    },
    async fail(_db, id, error) {
      const r = byId(id);
      if (r?.state === "running") Object.assign(r, { state: "failed", error, finishedAt: new Date() });
    },
    async release(_db, id) {
      const r = byId(id);
      if (r?.state === "running") Object.assign(r, { state: "queued", startedAt: null, attempts: Math.max(0, r.attempts - 1) });
    },
    async requeueStale(_db, olderThanMs = 30 * 60_000) {
      stale.push(olderThanMs);
      // olderThanMs = 0: every running row (the run holds the lock, so nobody owns one).
      const hit = rows.filter((r) => r.state === "running" && (olderThanMs === 0 || clock().getTime() - (r.startedAt?.getTime() ?? 0) > olderThanMs));
      for (const r of hit) Object.assign(r, { state: "queued", startedAt: null });
      return { requeued: hit.length, failed: 0 };
    },
    async resign(_db, id, sig) {
      const r = byId(id)!;
      if (rows.some((o) => o.id !== id && same(o, { ...r, sig }))) {
        rows.splice(rows.indexOf(r), 1);
        return "deleted";
      }
      r.sig = sig;
      return "updated";
    },
    async recentUse(_db, trader, from, to, days = 14) { return lastUse(trader, from, to) > clock().getTime() - days * DAY; },
    async prune() { return 0; },
  };
  return { rows, api, uses, stale };
}

const tradesOf: Record<string, SimTrade[]> = { A: noise(1, 60, 4), B: noise(2, 60, 4), C: noise(3, 60, 4) };
const fakeResult = (trades: SimTrade[]) => ({ version: 1, n: trades.length, cards: [], verdicts: [] }) as unknown as HonestyResult;

function deps(store: ReturnType<typeof memoryStore>, over: Partial<HonestyJobDeps> = {}): Partial<HonestyJobDeps> {
  return {
    db: { query: async () => ({ rows: [], rowCount: 0 }) },
    store: store.api,
    load: async (trader) => tradesOf[trader] ?? [],
    compute: async (trades) => fakeResult(trades),
    now: () => new Date("2026-10-20T15:00:00Z"), // Tuesday 11:00 NY (regular session)
    budgetMs: 12 * 60_000,
    version: 1,
    stop: new AbortController().signal,
    ...over,
  };
}
const ctx = (p: { trigger?: "schedule" | "event" | "manual" | "startup"; payload?: unknown; signal?: AbortSignal } = {}) => ({
  signal: p.signal ?? new AbortController().signal, trigger: p.trigger ?? "schedule", payload: p.payload, logger,
});
const enqueue = (s: ReturnType<typeof memoryStore>, trader: string, sig = tradesSignature(tradesOf[trader])) =>
  s.api.enqueue({ query: async () => ({ rows: [], rowCount: 0 }) }, { trader, from: "", to: "", sig, version: 1 });

describe("registration", () => {
  it("whatif.honesty: on request and after every sync, a 2-minute fallback drain, after boot, 15 min timeout", () => {
    const defs: JobDef[] = [];
    registerWhatIfHonestyJobs((d) => defs.push(d));
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: WHATIF_HONESTY_JOB, on: [WHATIF_HONESTY_REQUESTED, "propreports.synced"], cron: "*/2 * * * *", runOnStartMs: 60_000, timeoutMs: 15 * 60_000 });
  });
});

describe("drain", () => {
  it("FIFO; a second run is a no-op; the stored JSON equals a direct computeHonesty", async () => {
    const s = memoryStore();
    await enqueue(s, "B");
    await enqueue(s, "A");
    const order: string[] = [];
    const compute = async (trades: SimTrade[], run: { signal?: AbortSignal }) => {
      order.push(trades === tradesOf.B ? "B" : "A");
      return computeHonestyAsync(trades, QUICK, { ...run, yieldMs: 0 });
    };
    const out = await runHonestyQueue(ctx(), deps(s, { compute }));
    expect(out).toEqual({ done: 2, failed: 0, superseded: 0, requeuedStale: 0, failedStale: 0, precomputed: 0, pruned: 0, stoppedBy: "empty" });
    expect(order).toEqual(["B", "A"]);
    expect(s.rows.map((r) => r.state)).toEqual(["ready", "ready"]);
    expect(s.rows.find((r) => r.trader === "A")!.result).toEqual(JSON.parse(JSON.stringify(computeHonesty(tradesOf.A, QUICK))));
    const again = await runHonestyQueue(ctx(), deps(s, { compute }));
    expect(again.done).toBe(0);
    expect(s.rows).toHaveLength(2);
  });

  it("the trades changed since the request: the row is re-signed, or dropped when the new key exists", async () => {
    const s = memoryStore();
    await enqueue(s, "A", "stale-sig");
    let out = await runHonestyQueue(ctx(), deps(s));
    expect(out).toMatchObject({ done: 1, superseded: 0 });
    expect(s.rows[0]).toMatchObject({ sig: tradesSignature(tradesOf.A), state: "ready" });

    const t = memoryStore();
    await enqueue(t, "A", "stale-sig");
    await enqueue(t, "A"); // the current key is already queued
    out = await runHonestyQueue(ctx(), deps(t));
    expect(out).toMatchObject({ done: 1, superseded: 1 });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ sig: tradesSignature(tradesOf.A), state: "ready" });
  });

  it("an abort gives the row back to the queue with its attempt; nothing else is claimed", async () => {
    const s = memoryStore();
    await enqueue(s, "A");
    await enqueue(s, "B");
    const ac = new AbortController();
    const compute = async () => {
      ac.abort();
      throw new DOMException("aborted", "AbortError");
    };
    const out = await runHonestyQueue(ctx({ signal: ac.signal }), deps(s, { compute }));
    expect(out).toMatchObject({ done: 0, failed: 0, stoppedBy: "abort" });
    expect(s.rows.map((r) => [r.trader, r.state, r.attempts])).toEqual([["A", "queued", 0], ["B", "queued", 0]]);
  });

  it("the scheduler stopping (shutdown) aborts the computation: the row goes back to the queue, nothing else is claimed", async () => {
    const s = memoryStore();
    await enqueue(s, "A");
    await enqueue(s, "B");
    const stop = new AbortController();
    const compute = async (trades: SimTrade[], run: { signal?: AbortSignal }) => {
      stop.abort(); // SIGTERM arrives mid-run; the run's own signal (its timeout) never fires
      return computeHonestyAsync(trades, QUICK, { ...run, yieldMs: 0 });
    };
    const out = await runHonestyQueue(ctx(), deps(s, { compute, stop: stop.signal }));
    expect(out).toMatchObject({ done: 0, failed: 0, stoppedBy: "abort" });
    expect(s.rows.map((r) => [r.trader, r.state, r.attempts])).toEqual([["A", "queued", 0], ["B", "queued", 0]]);
    // Already stopping before the run: nothing is claimed at all.
    const none = await runHonestyQueue(ctx(), deps(s, { stop: stop.signal }));
    expect(none).toMatchObject({ done: 0, stoppedBy: "abort" });
  });

  it("a row left running by a restart is requeued at the start of the very next run (not 30 min later) and computed", async () => {
    const s = memoryStore();
    await enqueue(s, "A");
    Object.assign(s.rows[0], { state: "running", attempts: 1, startedAt: new Date("2026-10-20T20:59:00Z") }); // 1 min ago
    const out = await runHonestyQueue(ctx({ trigger: "startup" }), deps(s));
    expect(s.stale).toEqual([0]);
    expect(out).toMatchObject({ requeuedStale: 1, done: 1 });
    expect(s.rows[0].state).toBe("ready");
  });

  it("the time budget stops claiming; the rest waits for the next run", async () => {
    const s = memoryStore();
    for (const t of ["A", "B", "C"]) await enqueue(s, t);
    let t0 = Date.parse("2026-10-20T15:00:00Z");
    const now = () => new Date((t0 += 5 * 60_000)); // every reading of the clock is 5 min later
    const out = await runHonestyQueue(ctx(), deps(s, { now, budgetMs: 12 * 60_000 }));
    expect(out.stoppedBy).toBe("budget");
    expect(out.done).toBe(1);
    expect(s.rows.filter((r) => r.state === "queued")).toHaveLength(2);
  });

  it("a failing computation marks the row failed and the drain goes on", async () => {
    const s = memoryStore();
    await enqueue(s, "A");
    await enqueue(s, "B");
    const compute = async (trades: SimTrade[]) => {
      if (trades === tradesOf.A) throw new Error("boom");
      return fakeResult(trades);
    };
    const out = await runHonestyQueue(ctx(), deps(s, { compute }));
    expect(out).toMatchObject({ done: 1, failed: 1, stoppedBy: "empty" });
    expect(s.rows.find((r) => r.trader === "A")).toMatchObject({ state: "failed", error: "boom" });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("evening precompute", () => {
  const synced = { trigger: "event" as const, payload: { traders: ["A", "B", "C", "A"] } };

  it("after the close, only the payload traders who used the page get their «всё время» key queued (and computed)", async () => {
    const s = memoryStore(["A", "C"]);
    const out = await runHonestyQueue(ctx(synced), deps(s, { now: () => new Date("2026-10-20T21:00:00Z") })); // Tue 17:00 NY
    expect(out).toMatchObject({ precomputed: 2, done: 2 });
    expect(s.rows.map((r) => [r.trader, r.from, r.to, r.sig, r.state])).toEqual([
      ["A", "", "", tradesSignature(tradesOf.A), "ready"],
      ["C", "", "", tradesSignature(tradesOf.C), "ready"],
    ]);
  });

  it("not during the session, not on a schedule run, and not twice for the same signature", async () => {
    const s = memoryStore(["A", "C"]);
    expect((await runHonestyQueue(ctx(synced), deps(s))).precomputed).toBe(0); // Tue 11:00 NY
    const evening = () => new Date("2026-10-20T21:00:00Z");
    expect((await runHonestyQueue(ctx(), deps(s, { now: evening }))).precomputed).toBe(0);
    expect((await runHonestyQueue(ctx(synced), deps(s, { now: evening }))).precomputed).toBe(2);
    expect((await runHonestyQueue(ctx(synced), deps(s, { now: evening }))).precomputed).toBe(0);
  });

  it("a precomputed row is not a visit: a trader who stopped coming is not warmed up night after night", async () => {
    let now = new Date("2026-10-20T21:00:00Z"); // Tue 17:00 NY
    const s = memoryStore([], () => now);
    s.uses.set("A", new Date("2026-10-08T21:00:00Z")); // the last visit, 12 days ago
    const evening = { trigger: "event" as const, payload: { traders: ["A"] } };
    const first = await runHonestyQueue(ctx(evening), deps(s, { now: () => now }));
    expect(first).toMatchObject({ precomputed: 1, done: 1 });
    expect(s.rows[0].usedAt.toISOString()).toBe("2026-10-08T21:00:00.000Z");
    // Three days later the trades changed (a new signature), but the last real visit is 15 days old: no warm-up.
    now = new Date("2026-10-23T21:00:00Z");
    const changed = noise(4, 60, 4);
    const second = await runHonestyQueue(ctx(evening), deps(s, { now: () => now, load: async () => changed }));
    expect(second).toMatchObject({ precomputed: 0, done: 0 });
    expect(s.rows).toHaveLength(1);
  });

  it("quiet hours = NY weekend, or a weekday from 16:15 to 09:00", () => {
    expect(quietHours(new Date("2026-10-24T16:00:00Z"))).toBe(true); // Sat 12:00
    expect(quietHours(new Date("2026-10-20T20:14:00Z"))).toBe(false); // Tue 16:14
    expect(quietHours(new Date("2026-10-20T20:15:00Z"))).toBe(true); // Tue 16:15
    expect(quietHours(new Date("2026-10-20T12:59:00Z"))).toBe(true); // Tue 08:59
    expect(quietHours(new Date("2026-10-20T13:00:00Z"))).toBe(false); // Tue 09:00
  });
});
