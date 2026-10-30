/**
 * Live PropReports fills (lib/propreports/live): cadence / budget / backoff rules, the cycle's request count (one call
 * for the whole desk however many accounts; one more only for a carried position), the loop's timers, and the direct
 * risk-signals kick (in-process, at once, never stalling the loop). The client
 * and every DB dependency are fakes — no Postgres, never a real PropReports host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), connect: vi.fn() } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

const policy = await import("../../propreports/live/policy");
const { runLiveCycle, fetchLivePages, fillLagSec, LIVE_CURSOR_PREFIX } = await import("../../propreports/live/cycle");
const { LiveLoop } = await import("../../propreports/live/loop");
const { PropReportsError } = await import("../../propreports/client");
const { LiveScanKicker } = await import("../../riskSignals/live");

const TODAY = "2026-10-20";
const NOW = new Date("2026-10-20T15:00:30Z"); // 11:00:30 New York

const fill = (account: string, side: "B" | "S", id: string, time = "10:59:00", date = TODAY) => ({
  dateTime: `${date} ${time}`, account, side, qty: 100, symbol: "AAA", price: 10, route: null, fees: {}, tradeDate: date,
  orderId: null, fillId: null, propReportsId: id, status: null, line: 0,
});
const mapping = (account: string, accountId: string | null = null) => ({
  id: 1, account, accountId, accountName: null, trader: `T-${account}`, active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null,
});
const page = (fills: unknown[], total = 1) => ({ fills, table: {}, page: { current: 1, total }, issues: [], feeColumns: [] });
const log = { warn: vi.fn(), info: vi.fn() } as any;

function deps(over: Record<string, unknown> = {}) {
  const cursors = new Map<string, any>();
  const d = {
    cursors,
    loadMappings: vi.fn(async () => Array.from({ length: 60 }, (_, i) => mapping(`A${i}`, String(100 + i)))),
    getCursors: vi.fn(async () => cursors),
    setCursor: vi.fn(async (k: string, v: unknown) => { cursors.set(k, v); }),
    carryStarts: vi.fn(async () => new Map<string, string>()),
    canonicalize: vi.fn(async (f: any[]) => f),
    plan: vi.fn(async (trips: any[]) => ({
      items: trips.map((t) => ({ externalId: t.externalId, action: "insert", trader: `T-${t.account}`, account: t.account, trip: t })),
      counts: { insert: trips.length, update: 0, unchanged: 0, adopt: 0, conflict: 0, skip: 0 },
      unmappedAccounts: [], inactiveAccounts: [], dateFrom: TODAY, dateTo: TODAY, feeColumns: [], resolvedAccounts: {},
    })),
    apply: vi.fn(async (plan: any, _opts?: any) => ({ runId: 1, inserted: plan.items.length, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, errors: 0, errorText: null })),
    ...over,
  };
  return d;
}

describe("live policy", () => {
  it("budget is 60 % of 40 req / 4 s; the interval is the floor unless the budget or the cap needs more", () => {
    expect(policy.liveBudgetPerSec()).toBe(6);
    expect(policy.liveIntervalMs(1, 2)).toBe(2_000);
    expect(policy.liveIntervalMs(1, 15)).toBe(15_000);
    expect(policy.liveIntervalMs(18, 2)).toBe(3_000); // 18 calls at 6 / s
    expect(policy.liveIntervalMs(0, 0)).toBe(policy.LIVE_FLOOR_MS);
  });

  it("backs off exponentially, one step more on 429, capped", () => {
    expect(policy.liveBackoffMs(2_000, 0)).toBe(2_000);
    expect(policy.liveBackoffMs(2_000, 1)).toBe(4_000);
    expect(policy.liveBackoffMs(2_000, 3)).toBe(16_000);
    expect(policy.liveBackoffMs(2_000, 1, true)).toBe(8_000);
    expect(policy.liveBackoffMs(2_000, 50)).toBe(policy.LIVE_MAX_BACKOFF_MS);
  });

  it("window: trading days, 09:00 New York to an hour after the close", () => {
    const day = { closed: false, closeMin: 16 * 60 };
    expect(policy.inLiveWindow(8 * 60 + 59, day)).toBe(false);
    expect(policy.inLiveWindow(9 * 60, day)).toBe(true);
    expect(policy.inLiveWindow(16 * 60 + 59, day)).toBe(true);
    expect(policy.inLiveWindow(17 * 60, day)).toBe(false);
    expect(policy.inLiveWindow(13 * 60 + 30, { closed: false, closeMin: 13 * 60 })).toBe(true);
    expect(policy.inLiveWindow(14 * 60, { closed: false, closeMin: 13 * 60 })).toBe(false);
    expect(policy.inLiveWindow(11 * 60, { closed: true, closeMin: 16 * 60 })).toBe(false);
  });
});

describe("live cycle", () => {
  it("pages stop at the cycle budget (a partial day is reported incomplete)", async () => {
    const client = { fillsPage: vi.fn(async () => page([fill("A0", "B", "1")], 5)) };
    const r = await fetchLivePages(client as any, TODAY, TODAY, {}, new policy.RequestBudget(2), Date.now() + 60_000);
    expect(client.fillsPage).toHaveBeenCalledTimes(2);
    expect(r.complete).toBe(false);
  });

  it("60 accounts cost ONE call; a quiet repeat writes nothing; only active mapped accounts are looked at", async () => {
    const fills = [fill("A1", "B", "1"), fill("A1", "S", "2", "10:59:30"), fill("A7", "B", "3"), fill("UNMAPPED", "B", "4")];
    const client = { fillsPage: vi.fn(async () => page(fills)) };
    const d = deps();
    const r = await runLiveCycle({ now: NOW, deadline: Date.now() + 60_000, client: client as any, log }, d as any);
    expect(client.fillsPage).toHaveBeenCalledTimes(1);
    expect(client.fillsPage.mock.calls[0]).toEqual([TODAY, TODAY, 1, {}]); // the tick's own scope (group), today only
    expect(r).toMatchObject({ requests: 1, changed: 2, inserted: 2, deferred: 0 });
    expect(r.traders).toEqual(["T-A1", "T-A7"]);
    expect(r.lagSec).toBe(60); // newest fill 10:59:30 → 11:00:30
    expect(d.apply.mock.calls[0][1]).toMatchObject({ actor: "live", syncedEvent: false, audit: false });
    expect([...d.cursors.keys()].sort()).toEqual([`${LIVE_CURSOR_PREFIX}A1`, `${LIVE_CURSOR_PREFIX}A7`]);

    const again = await runLiveCycle({ now: NOW, deadline: Date.now() + 60_000, client: client as any, log }, d as any);
    expect(again).toMatchObject({ requests: 1, changed: 0, inserted: 0 });
    expect(d.plan).toHaveBeenCalledTimes(1);
  });

  it("a carried position: one more call scoped to its account id over [oldest open day, today]", async () => {
    const client = {
      fillsPage: vi.fn(async (from: string) => (from === TODAY
        ? page([fill("A2", "S", "9")])
        : page([fill("A2", "B", "8", "15:00:00", "2026-10-19"), fill("A2", "S", "9")]))),
    };
    const d = deps({ carryStarts: vi.fn(async () => new Map([["A2", "2026-10-19"]])) });
    const r = await runLiveCycle({ now: NOW, deadline: Date.now() + 60_000, client: client as any, log }, d as any);
    expect(client.fillsPage).toHaveBeenCalledTimes(2);
    expect(client.fillsPage.mock.calls[1]).toEqual(["2026-10-19", TODAY, 1, { accountIds: ["102"] }]);
    expect(r).toMatchObject({ requests: 2, inserted: 1, deferred: 0 });
  });

  it("a fill closing a position not opened in the data (no account id to fetch) is left to the full sync", async () => {
    const client = { fillsPage: vi.fn(async () => page([fill("A3", "S", "5")])) };
    const d = deps({ loadMappings: vi.fn(async () => [mapping("A3")]) });
    const r = await runLiveCycle({ now: NOW, deadline: Date.now() + 60_000, client: client as any, log }, d as any);
    expect(r).toMatchObject({ requests: 1, changed: 1, deferred: 1, inserted: 0 });
    expect(d.plan).not.toHaveBeenCalled();
    expect(d.cursors.size).toBe(0); // looked at again next cycle
  });

  it("lag is null without fills from today", () => {
    expect(fillLagSec([fill("A", "B", "1", "10:00:00", "2026-10-19")] as any, NOW)).toBeNull();
  });
});

describe("live loop timers", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const result = (over = {}) => ({ requests: 1, fills: 0, changed: 0, deferred: 0, inserted: 0, updated: 0, traders: [], lagSec: null, note: "ok", ...over });

  it("runs every 2 s at the floor, honours the cap, backs off on errors and stops cleanly", async () => {
    let cap = 2;
    let fail = 0;
    const cycle = vi.fn(async () => {
      if (fail > 0) { fail--; throw new PropReportsError("rate limited", 429); }
      return result();
    });
    const loop = new LiveLoop({ now: () => new Date(), gate: async () => ({ run: true }), cycle, capSec: () => cap, emitSynced: vi.fn(async () => {}) });
    loop.start(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cycle).toHaveBeenCalledTimes(2);
    cap = 10;
    await vi.advanceTimersByTimeAsync(2_000); // the gap after cycle 2 was decided with cap 2
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cycle).toHaveBeenCalledTimes(4);

    cap = 2;
    fail = 2; // next two cycles fail with 429 → 2 s × 2^(1+1) = 8 s, then 2 s × 2^(2+1) = 16 s
    await vi.advanceTimersByTimeAsync(10_000); // the gap after cycle 4 was decided with cap 10
    expect(cycle).toHaveBeenCalledTimes(5);
    expect(loop.status.failures).toBe(1);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(cycle).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(6);
    expect(loop.status.intervalMs).toBe(16_000);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(cycle).toHaveBeenCalledTimes(7);
    expect(loop.status.failures).toBe(0);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cycle).toHaveBeenCalledTimes(7);
  });

  it("outside desk hours it only checks the gate once a minute; written traders go out as one coalesced event", async () => {
    let open = false;
    const emitSynced = vi.fn(async () => {});
    const cycle = vi.fn(async () => result({ inserted: 1, traders: ["Anna"] }));
    const loop = new LiveLoop({ now: () => new Date(), gate: async () => (open ? { run: true } : { run: false, reason: "closed" }), cycle, capSec: () => 2, emitSynced });
    loop.start(0);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(cycle).not.toHaveBeenCalled();
    expect(loop.status.active).toBe(false);
    open = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cycle).toHaveBeenCalledTimes(6);
    expect(emitSynced).toHaveBeenCalledTimes(1); // first write at once, the next ones wait for the minute
    await loop.stop();
    expect(emitSynced).toHaveBeenCalledTimes(2); // the rest is flushed on stop
    expect(emitSynced.mock.calls[1]).toEqual([["Anna"]]);
  });
  it("a cycle that wrote trades kicks the risk scan for its traders at once — not after the coalesced minute", async () => {
    const emitSynced = vi.fn(async () => {});
    const scanTraders = vi.fn();
    let n = 0;
    const cycle = vi.fn(async () => (++n === 2 ? result({ inserted: 1, traders: ["Anna", "Boris"] }) : result()));
    const loop = new LiveLoop({ now: () => new Date(), gate: async () => ({ run: true }), cycle, capSec: () => 2, emitSynced, scanTraders });
    loop.start(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(scanTraders).not.toHaveBeenCalled(); // a quiet cycle scans nothing
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(scanTraders).toHaveBeenCalledTimes(1);
    expect(scanTraders).toHaveBeenCalledWith(["Anna", "Boris"]);
    await loop.stop();
  });

  it("a hanging or failing risk scan never stalls the sync loop; single-flight holds across cycles", async () => {
    const hang = new Promise<void>(() => {});
    const run = vi.fn(() => hang);
    const kicker = new LiveScanKicker(run, { warn: vi.fn() } as any);
    const cycle = vi.fn(async () => result({ updated: 1, traders: ["Anna"] }));
    const loop = new LiveLoop({
      now: () => new Date(), gate: async () => ({ run: true }), cycle, capSec: () => 2, emitSynced: vi.fn(async () => {}),
      scanTraders: (t) => kicker.kick(t),
    });
    loop.start(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cycle).toHaveBeenCalledTimes(6); // every 2 s as usual
    expect(run).toHaveBeenCalledTimes(1); // Anna's scan is still running: later writes only mark one catch-up
    await loop.stop();

    const throwing = new LiveLoop({
      now: () => new Date(), gate: async () => ({ run: true }), cycle, capSec: () => 2, emitSynced: vi.fn(async () => {}),
      scanTraders: () => { throw new Error("scan module failed to load"); },
    });
    cycle.mockClear();
    throwing.start(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cycle).toHaveBeenCalledTimes(3);
    expect(throwing.status.failures).toBe(0);
    expect(throwing.status.lastError).toBeNull();
    await throwing.stop();
  });
});
