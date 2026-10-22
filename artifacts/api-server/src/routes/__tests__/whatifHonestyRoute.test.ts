/**
 * GET /whatif/suggestions flow (routes/whatif.ts) with the trades loader, the honesty store and the job registry mocked:
 * a member only ever reaches their own key (scopeTrader with a mocked req.authUser — no login), a missing verdict is
 * queued once and the job woken, a ready one is served at once, a failed one is retried when allowed, the store or the
 * job being unavailable falls back to the fast path, and team scope never touches the store. Only a growing period
 * (all time, a Jan 1 start with an open end) takes the honest path: each test uses its own Jan 1, so the route's
 * in-memory caches never carry a body from one test into another.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { HonestyKey, HonestyRow } from "../../lib/whatIfHonestyStore";
import type { HonestyResult } from "../../lib/whatIfHonesty";

type Who = { id: number; name: string; role: "trader" | "curator" };
const TRADER: Who = { id: 130, name: "T0", role: "trader" };
const CURATOR: Who = { id: 123, name: "Staff", role: "curator" };
let who: Who = TRADER;

vi.mock("@workspace/db", () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => undefined })) } };
});
const m = vi.hoisted(() => ({
  trades: [] as unknown[],
  /** What an uncached reload returns (a sync landed after the 60 s snapshot); null = the same as `trades`. */
  fresh: null as unknown[] | null,
  row: null as HonestyRow | null,
  getError: null as Error | null,
  jobs: [{ name: "whatif.honesty" }] as { name: string }[],
}));
const loadSimTrades = vi.hoisted(() => vi.fn(async (_scope: string | null, _from?: string, _to?: string) => m.trades.slice()));
const freshSimTrades = vi.hoisted(() => vi.fn(async (_scope: string | null, _from?: string, _to?: string) => (m.fresh ?? m.trades).slice()));
const store = vi.hoisted(() => ({
  get: vi.fn(async (_db: unknown, _k: HonestyKey): Promise<HonestyRow | null> => {
    if (m.getError) throw m.getError;
    return m.row;
  }),
  enqueue: vi.fn(async (_db: unknown, _k: HonestyKey) => true),
  touch: vi.fn(async () => undefined),
  retryFailed: vi.fn(async () => true),
}));
const emitJobEvent = vi.hoisted(() => vi.fn());
vi.mock("../../lib/whatIfLoader", async (orig) => ({ ...(await orig<object>()), loadSimTrades, freshSimTrades }));
vi.mock("../../lib/whatIfHonestyStore", async (orig) => ({ ...(await orig<object>()), ...store }));
vi.mock("../../jobs/registry", async (orig) => ({ ...(await orig<object>()), emitJobEvent, listJobs: () => m.jobs }));

process.env.JWT_SECRET ??= "vitest-only-secret";
const { default: router, suggestionsCacheSize } = await import("../whatif");
const { errorMiddleware } = await import("../../lib/http");
const { computeHonesty, HONESTY } = await import("../../lib/whatIfHonesty");
const { noise, plant } = await import("../../lib/__tests__/whatIfHonestyFixtures");
const { tradesSignature } = await import("../../lib/whatIfSignature");

const TRADES = plant(noise(1, 220), { seed: 1001, ticker: "BAD" }).map((t) => ({ ...t, trader: "T0" }));
const SIG = tradesSignature(TRADES);
let honest: HonestyResult;

let server: http.Server;
let base = "";
beforeAll(async () => {
  honest = computeHonesty(TRADES, { iters: 300, perms: 100 });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { authUser: unknown }).authUser = { id: who.id, name: who.name, role: who.role };
    (req as unknown as { permActor: unknown }).permActor = { id: who.id, name: who.name, role: who.role, guest: false, wards: [] };
    next();
  });
  app.use("/api", router);
  app.use(errorMiddleware);
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  who = TRADER;
  m.trades = TRADES;
  m.fresh = null;
  m.row = null;
  m.getError = null;
  m.jobs = [{ name: "whatif.honesty" }];
  for (const f of [loadSimTrades, freshSimTrades, emitJobEvent, ...Object.values(store)]) f.mockClear();
  store.enqueue.mockImplementation(async () => true);
  store.retryFailed.mockImplementation(async () => true);
});

const row = (p: Partial<HonestyRow>): HonestyRow => ({
  id: 7, trader: "T0", from: "", to: "", sig: SIG, version: HONESTY.version, state: "queued", result: null, error: null, attempts: 0,
  requestedAt: new Date(), usedAt: new Date(), startedAt: null, finishedAt: null, durationMs: null, ...p,
});
/** Each test its own period (a Jan 1 start: a growing period), so the in-memory caches never carry a body over. */
async function get(query: string): Promise<{ status: number; json: any }> {
  const r = await fetch(`${base}/api/whatif/suggestions?${query}`);
  return { status: r.status, json: await r.json() };
}

describe("GET /whatif/suggestions — honest path", () => {
  it("a member asking for another trader gets their own key; the verdict is queued once and the job woken", async () => {
    const r = await get("trader=Other&from=2026-01-01");
    expect(r.status).toBe(200);
    expect(loadSimTrades).toHaveBeenCalledWith("T0", "2026-01-01", undefined, undefined); // no «Разрезы» selection
    expect(store.get.mock.calls[0][1]).toEqual({ trader: "T0", from: "2026-01-01", to: "", sig: SIG, version: HONESTY.version });
    expect(store.enqueue.mock.calls[0][1]).toEqual({ trader: "T0", from: "2026-01-01", to: "", sig: SIG, version: HONESTY.version });
    expect(emitJobEvent).toHaveBeenCalledWith("whatif.honesty.requested", { trader: "T0" });
    expect(r.json.scope).toBe("T0");
    expect(r.json.honesty).toMatchObject({ state: "queued", pollMs: 4000 });
    expect(r.json.suggestions.length).toBeGreaterThan(0);
    expect(r.json.suggestions.every((s: { status: string }) => s.status === "preliminary")).toBe(true);

    // Already queued by someone else: nothing new is inserted, nobody is woken twice.
    store.enqueue.mockImplementation(async () => false);
    emitJobEvent.mockClear();
    const again = await get("trader=Other&from=2026-01-01");
    expect(again.json.honesty.state).toBe("queued");
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it("a running row: the fast cards, no new queue entry", async () => {
    m.row = row({ state: "running" });
    const r = await get("from=2025-01-01");
    expect(r.json.honesty).toMatchObject({ state: "running", pollMs: 4000 });
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it("a ready verdict is served at once (then from the in-memory cache) and marks the key as used", async () => {
    m.row = row({ state: "ready", result: honest, finishedAt: new Date("2026-10-21T22:00:00Z") });
    const r = await get("from=2024-01-01");
    expect(r.json.honesty).toMatchObject({ state: "ready", pollMs: null, computedAt: "2026-10-21T22:00:00.000Z", confirmed: honest.confirmed });
    expect(r.json.suggestions.map((s: { rule: unknown }) => s.rule)).toEqual(honest.cards.map((c) => c.rule));
    expect(r.json.suggestions[0]).toMatchObject({ status: "confirmed", robust: true, timing: "exante", holdout: null });
    expect(r.json.tested).toBe(honest.tested);
    expect(store.touch).toHaveBeenCalledWith(expect.anything(), 7);
    expect(store.enqueue).not.toHaveBeenCalled();
    store.get.mockClear();
    const cached = await get("from=2024-01-01");
    expect(cached.json.suggestions).toEqual(r.json.suggestions);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("new trades give a new signature: the old ready verdict is not reused", async () => {
    m.row = null;
    m.trades = TRADES.slice(1);
    const r = await get("from=2023-01-01");
    expect(store.get.mock.calls[0][1].sig).toBe(tradesSignature(TRADES.slice(1)));
    expect(store.get.mock.calls[0][1].sig).not.toBe(SIG);
    expect(r.json.honesty.state).toBe("queued");
  });

  it("a failed row is retried when allowed; otherwise it stays failed (no polling)", async () => {
    m.row = row({ state: "failed", attempts: 1 });
    const retried = await get("from=2022-01-01");
    expect(store.retryFailed).toHaveBeenCalledWith(expect.anything(), 7);
    expect(emitJobEvent).toHaveBeenCalledOnce();
    expect(retried.json.honesty).toMatchObject({ state: "queued", pollMs: 4000 });
    store.retryFailed.mockImplementation(async () => false);
    emitJobEvent.mockClear();
    const stays = await get("from=2021-01-01");
    expect(stays.json.honesty).toMatchObject({ state: "failed", pollMs: null });
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it("the table missing or the job off → unavailable, the fast cards, nothing queued", async () => {
    m.getError = new Error('relation "whatif_honesty_cache" does not exist');
    const noTable = await get("from=2020-01-01");
    expect(noTable.status).toBe(200);
    expect(noTable.json.honesty).toMatchObject({ state: "unavailable", pollMs: null });
    expect(noTable.json.suggestions.every((s: { status: string }) => s.status === "preliminary")).toBe(true);
    m.getError = null;
    m.jobs = [];
    const jobsOff = await get("from=2019-01-01");
    expect(jobsOff.json.honesty.state).toBe("unavailable");
    expect(store.enqueue).not.toHaveBeenCalled();
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it("team scope (staff, no trader): the fast path only, the store is never read", async () => {
    who = CURATOR;
    const r = await get("from=2018-01-01");
    expect(loadSimTrades).toHaveBeenCalledWith(null, "2018-01-01", undefined, undefined);
    expect(r.json.scope).toBeNull();
    expect(r.json.honesty).toMatchObject({ state: "team" });
    expect(r.json.suggestions.every((s: { status?: string; timing: string }) => s.status === undefined && !!s.timing)).toBe(true);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it("a sync after the 60 s snapshot: no row for the stale signature → reload uncached, find the job's row, queue nothing", async () => {
    m.fresh = TRADES.slice(2); // the job already moved the row to the trades as they are now
    const freshSig = tradesSignature(TRADES.slice(2));
    store.get.mockImplementation(async (_db, k) => (k.sig === freshSig ? row({ sig: freshSig, state: "running" }) : null));
    const r = await get("from=2016-01-01");
    expect(store.get.mock.calls.map((c) => c[1].sig)).toEqual([SIG, freshSig]);
    expect(freshSimTrades).toHaveBeenCalledWith("T0", "2016-01-01", undefined);
    expect(store.enqueue).not.toHaveBeenCalled();
    expect(r.json.honesty.state).toBe("running");
    expect(r.json.trades).toBe(TRADES.length - 2);
    store.get.mockImplementation(async () => (m.getError ? Promise.reject(m.getError) : m.row));
  });

  it("pending for a while: polls back off to 30 s and the body says how long it has been", async () => {
    m.row = row({ state: "running", requestedAt: new Date(Date.now() - 5 * 60_000) });
    const r = await get("from=2015-01-01");
    expect(r.json.honesty).toMatchObject({ state: "running", pollMs: 30_000 });
    expect(r.json.honesty.pendingMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(store.touch).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("the cache keeps one entry per period, whatever the signature (no leak per sync)", async () => {
    m.row = row({ state: "ready", result: honest, finishedAt: new Date() });
    await get("from=2014-01-01");
    const size = suggestionsCacheSize();
    for (let i = 1; i <= 3; i++) {
      m.trades = TRADES.slice(i); // every sync: a new signature
      m.row = row({ sig: tradesSignature(TRADES.slice(i)), state: "ready", result: honest, finishedAt: new Date() });
      await get("from=2014-01-01");
    }
    expect(suggestionsCacheSize()).toBe(size);
  });

  it("a rolling 30 / 90-day window or a closed range (the weekly review): the fast cards, state «window», nothing queued", async () => {
    for (const query of ["from=2026-09-22&window=rolling", "from=2026-07-24", "from=2026-08-24&to=2026-10-16"]) {
      store.get.mockClear();
      const r = await get(query);
      expect(r.status, query).toBe(200);
      expect(r.json.honesty, query).toMatchObject({ state: "window", pollMs: null });
      expect(r.json.suggestions.length, query).toBeGreaterThan(0);
      expect(r.json.suggestions.every((s: { status?: string }) => s.status === undefined), query).toBe(true);
      expect(store.get, query).not.toHaveBeenCalled();
    }
    expect(store.enqueue).not.toHaveBeenCalled();
    expect(emitJobEvent).not.toHaveBeenCalled();
  });

  it("staff looking at a trader share that trader's key", async () => {
    who = CURATOR;
    await get("trader=T0&from=2017-01-01");
    expect(store.get.mock.calls[0][1]).toMatchObject({ trader: "T0", from: "2017-01-01" });
  });
});
