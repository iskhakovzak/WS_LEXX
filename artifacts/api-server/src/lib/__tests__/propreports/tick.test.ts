/**
 * PropReports tick (phase 1): cadence helpers, runner (lease, due/resume/retry, budget, outbox), outbox drain (success,
 * retry with backoff, give up), fills-step fingerprints and bounded paging, backfill windows, trades_version stamp.
 * The DB is a scripted mock (no Postgres); the client is a stub — never a real PropReports host.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Q = { sql: string; params: unknown[] };
const calls: Q[] = [];
let handler: (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } = () => ({ rows: [] });

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return handler(sql, params); }),
    connect: vi.fn(),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

const { isDeskHours, everyMinutes, deskCadence } = await import("../../propreports/tick/due");
const { runTick, shouldRun } = await import("../../propreports/tick/runner");
const { drainOutbox, backoffSeconds, HEARTBEAT_MS, MAX_ATTEMPTS } = await import("../../propreports/tick/outbox");
const { accountFingerprint, changedAccounts, groupByAccount, fetchFillsBounded } = await import("../../propreports/tick/fillsStep");
const { windowsFor, nextWindow } = await import("../../propreports/tick/backfill");
const { checkTradesVersion, __resetTradesVersionForTests } = await import("../../propreports/tradesVersion");
const { dashboardCache } = await import("../../hotCache");
import type { TickStep } from "../../propreports/tick/types";
import type { Fill } from "../../propreports/types";

beforeEach(() => { calls.length = 0; handler = () => ({ rows: [] }); });

describe("due helpers", () => {
  it("desk hours = 13:00–21:59 UTC Mon–Fri", () => {
    expect(isDeskHours(new Date("2026-10-19T13:00:00Z"))).toBe(true); // Monday
    expect(isDeskHours(new Date("2026-10-19T21:59:00Z"))).toBe(true);
    expect(isDeskHours(new Date("2026-10-19T22:00:00Z"))).toBe(false);
    expect(isDeskHours(new Date("2026-10-18T15:00:00Z"))).toBe(false); // Sunday
  });
  it("everyMinutes tolerates a heartbeat a few seconds early", () => {
    const due = everyMinutes(5);
    const now = new Date("2026-10-19T15:00:00Z");
    expect(due(now, null)).toBe(true);
    expect(due(now, new Date(now.getTime() - 4 * 60_000 - 50_000))).toBe(true);
    expect(due(now, new Date(now.getTime() - 3 * 60_000))).toBe(false);
  });
  it("deskCadence: 5 min in desk hours, hourly otherwise", () => {
    const due = deskCadence(5, 60);
    const desk = new Date("2026-10-19T15:00:00Z");
    const night = new Date("2026-10-19T02:00:00Z");
    expect(due(desk, new Date(desk.getTime() - 5 * 60_000))).toBe(true);
    expect(due(night, new Date(night.getTime() - 5 * 60_000))).toBe(false);
    expect(due(night, new Date(night.getTime() - 60 * 60_000))).toBe(true);
  });
});

describe("runner", () => {
  const step = (name: string, run: TickStep["run"], due = true): TickStep => ({ name, due: () => due, run });
  const fakeClient = {} as any;
  const drain = vi.fn(async () => ({ processed: 2, failed: 0, remaining: 0 }));

  it("shouldRun: own cadence, resume after done:false, retry after an error", () => {
    const s = step("a", async () => ({ done: true }), false);
    const now = new Date();
    expect(shouldRun(s, now, undefined)).toBe(false);
    expect(shouldRun(s, now, { name: "a", lastRunAt: now.toISOString(), lastOkAt: null, lastDone: false, lastNote: null, lastError: null, lastMs: 1, runs: 1 })).toBe(true);
    expect(shouldRun(s, now, { name: "a", lastRunAt: now.toISOString(), lastOkAt: null, lastDone: null, lastNote: null, lastError: "boom", lastMs: 1, runs: 1 })).toBe(true);
  });

  it("lease held elsewhere → skipped, nothing runs", async () => {
    handler = (sql) => (/INSERT INTO propreports_tick_lease/.test(sql) ? { rows: [] } : { rows: [] });
    const run = vi.fn(async () => ({ done: true }));
    const s = await runTick({ trigger: "cron", steps: [step("a", run)], client: fakeClient, drain });
    expect(s.skipped).toBe("lease");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs due steps in order, records each, keeps going after a failure, drains the outbox, releases the lease", async () => {
    handler = (sql, params) => (/INSERT INTO propreports_tick_lease/.test(sql) ? { rows: [{ holder: params[1] }] } : { rows: [] });
    const order: string[] = [];
    const steps = [
      step("first", async () => { order.push("first"); return { done: true, note: "ok" }; }),
      step("broken", async () => { order.push("broken"); throw new Error("upstream down"); }),
      step("notDue", async () => { order.push("notDue"); return { done: true }; }, false),
      step("last", async (ctx) => { order.push("last"); expect(ctx.deadline).toBeGreaterThan(Date.now()); return { done: false, note: "more" }; }),
    ];
    const s = await runTick({ trigger: "manual", steps, client: fakeClient, drain });
    expect(order).toEqual(["first", "broken", "last"]);
    expect(s.ok).toBe(false);
    expect(s.steps.find((x) => x.name === "broken")?.error).toBe("upstream down");
    expect(s.steps.find((x) => x.name === "notDue")?.ran).toBe(false);
    expect(s.outbox.processed).toBe(2);
    expect(calls.filter((c) => /INSERT INTO propreports_tick_steps/.test(c.sql))).toHaveLength(3);
    expect(calls.some((c) => /UPDATE propreports_tick_lease SET expires_at = NOW\(\)/.test(c.sql))).toBe(true);
  });

  it("not configured → steps skipped, outbox still drained", async () => {
    handler = (sql, params) => (/INSERT INTO propreports_tick_lease/.test(sql) ? { rows: [{ holder: params[1] }] } : { rows: [] });
    const run = vi.fn(async () => ({ done: true }));
    const d = vi.fn(async () => ({ processed: 0, failed: 0, remaining: 0 }));
    const s = await runTick({ trigger: "cron", steps: [step("a", run)], client: null, drain: d });
    expect(s.skipped).toBe("not-configured");
    expect(run).not.toHaveBeenCalled();
    expect(d).toHaveBeenCalled();
  });

  it("the client cannot be built → ok:false, steps skipped, outbox still drained, lease released", async () => {
    handler = (sql, params) => (/INSERT INTO propreports_tick_lease/.test(sql) ? { rows: [{ holder: params[1] }] } : { rows: [] });
    const run = vi.fn(async () => ({ done: true }));
    const d = vi.fn(async () => ({ processed: 1, failed: 0, remaining: 0 }));
    const s = await runTick({ trigger: "cron", steps: [step("a", run)], makeClient: async () => { throw new Error("settings unreadable"); }, drain: d });
    expect(s.ok).toBe(false);
    expect(s.steps).toEqual([{ name: "client", ran: false, error: "settings unreadable" }]);
    expect(run).not.toHaveBeenCalled();
    expect(d).toHaveBeenCalled();
    expect(s.outbox.processed).toBe(1);
    expect(calls.some((c) => /UPDATE propreports_tick_lease SET expires_at = NOW\(\)/.test(c.sql))).toBe(true);
  });

  it("stops starting steps when the budget is spent", async () => {
    handler = (sql, params) => (/INSERT INTO propreports_tick_lease/.test(sql) ? { rows: [{ holder: params[1] }] } : { rows: [] });
    const run = vi.fn(async () => ({ done: true }));
    const s = await runTick({ trigger: "cron", budgetMs: 1000, steps: [step("a", run)], client: fakeClient, drain });
    expect(run).not.toHaveBeenCalled();
    expect(s.steps[0]).toMatchObject({ name: "a", ran: false, note: "budget" });
  });
});

describe("outbox drain", () => {
  it("runs claimed rows, marks done, retries a failure with backoff, gives up after MAX_ATTEMPTS", async () => {
    let claimed = false;
    handler = (sql) => {
      if (/UPDATE propreports_outbox o SET locked_until/.test(sql)) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [
          { id: 1, kind: "ok.kind", payload: { a: 1 }, attempts: 1 },
          { id: 2, kind: "bad.kind", payload: null, attempts: 1 },
          { id: 3, kind: "bad.kind", payload: null, attempts: MAX_ATTEMPTS },
          { id: 4, kind: "unknown.kind", payload: null, attempts: 1 },
        ] };
      }
      if (/SELECT COUNT/.test(sql)) return { rows: [{ n: 3 }] };
      return { rows: [] };
    };
    const ok = vi.fn(async () => {});
    const bad = vi.fn(async () => { throw new Error("nope"); });
    const r = await drainOutbox(Date.now() + 10_000, { handlers: { "ok.kind": ok, "bad.kind": bad } });
    expect(ok).toHaveBeenCalledWith({ a: 1 });
    expect(r).toEqual({ processed: 1, failed: 3, remaining: 3 });
    const done = calls.find((c) => /SET done_at = NOW\(\)/.test(c.sql));
    expect(done?.params).toEqual([1]);
    const fails = calls.filter((c) => /SET last_error = \$2/.test(c.sql));
    expect(fails.map((c) => [c.params[0], c.params[3]])).toEqual([[2, false], [3, true], [4, true]]);
    expect(fails[0].params[2]).toBe(backoffSeconds(1));
  });
  it("heartbeat: a handler slower than the claim window keeps its batch claimed (never re-claimed and run twice)", async () => {
    vi.useFakeTimers();
    try {
      let claimed = false;
      handler = (sql) => {
        if (/UPDATE propreports_outbox o SET locked_until/.test(sql)) {
          if (claimed) return { rows: [] };
          claimed = true;
          return { rows: [{ id: 7, kind: "slow.kind", payload: null, attempts: 1 }, { id: 8, kind: "slow.kind", payload: null, attempts: 1 }] };
        }
        if (/SELECT COUNT/.test(sql)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      };
      const slow = vi.fn(() => new Promise<void>((r) => setTimeout(r, 150_000))); // > CLAIM_SECONDS (120 s)
      const drained = drainOutbox(Date.now() + 600_000, { handlers: { "slow.kind": slow } });
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4 + 1_000); // 121 s: row 7 still running, past its 120 s claim
      const beats = () => calls.filter((c) => /WHERE id = ANY\(\$1::bigint\[\]\) AND done_at IS NULL AND locked_until IS NOT NULL/.test(c.sql));
      expect(beats()).toHaveLength(4);
      expect(beats()[0]!.params).toEqual([[7, 8], 120]); // the waiting row 8 is held too
      await vi.advanceTimersByTimeAsync(150_000); // row 7 done (dropped from the beat), row 8 running
      expect(beats().at(-1)!.params[0]).toEqual([8]);
      await vi.advanceTimersByTimeAsync(150_000);
      expect(await drained).toEqual({ processed: 2, failed: 0, remaining: 0 });
      const n = beats().length;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
      expect(beats()).toHaveLength(n); // the interval is cleared when the batch ends
    } finally {
      vi.useRealTimers();
    }
  });
  it("backoff grows 30 s × 4^(n−1)", () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([30, 120, 480]);
  });
});

const fill = (o: Partial<Fill>): Fill => ({
  dateTime: "2026-10-19 09:30:00", account: "A1", side: "B", qty: 100, symbol: "AAPL", price: 10, route: null, fees: {},
  tradeDate: "2026-10-19", orderId: null, fillId: null, propReportsId: null, status: null, line: 0, ...o,
});

describe("fills step", () => {
  it("fingerprint is order-independent and depends on the window start", () => {
    const a = fill({ propReportsId: "1" }), b = fill({ propReportsId: "2", side: "S" });
    expect(accountFingerprint([a, b], "2026-10-18")).toBe(accountFingerprint([b, a], "2026-10-18"));
    expect(accountFingerprint([a, b], "2026-10-18")).not.toBe(accountFingerprint([a, b], "2026-10-17"));
    expect(accountFingerprint([a], "2026-10-18")).not.toBe(accountFingerprint([a, b], "2026-10-18"));
  });
  it("only accounts whose fills changed are re-planned", () => {
    const fills = [fill({ account: "A1", propReportsId: "1" }), fill({ account: "B2", propReportsId: "2" })];
    const by = groupByAccount(fills);
    const cursors = new Map([["fills:acct:A1", { fp: accountFingerprint(by.get("A1")!, "2026-10-18"), from: "2026-10-18", fills: 1, lastFillAt: null, syncedAt: "" }]]);
    expect(changedAccounts(by, "2026-10-18", cursors).map((c) => c.account)).toEqual(["B2"]);
  });
  it("fetchFillsBounded pages until Page Y/Y and reports an incomplete fetch near the deadline", async () => {
    const pages = vi.fn(async (_f: string, _t: string, page: number) => ({ fills: [fill({ propReportsId: String(page) })], table: {} as any, page: { current: page, total: 3 }, issues: [], feeColumns: [{ key: "comm", header: "Comm", known: true, heuristic: false }] }));
    const client = { fillsPage: pages } as any;
    const full = await fetchFillsBounded(client, "2026-10-18", "2026-10-19", Date.now() + 60_000);
    expect(full).toMatchObject({ pages: 3, total: 3, complete: true });
    expect(full.fills).toHaveLength(3);
    expect(full.feeColumns).toHaveLength(1);
    const cut = await fetchFillsBounded(client, "2026-10-18", "2026-10-19", Date.now() + 1000);
    expect(cut.complete).toBe(false);
    const capped = await fetchFillsBounded(client, "2026-10-18", "2026-10-19", Date.now() + 60_000, 2);
    expect(capped.complete).toBe(false);
  });
});

describe("backfill windows", () => {
  it("7-day windows, overlap clamped to the start", () => {
    expect(windowsFor("2026-01-01", "2026-01-07")).toBe(1);
    expect(windowsFor("2026-01-01", "2026-01-08")).toBe(2);
    expect(nextWindow({ dateFrom: "2026-01-01", dateTo: "2026-01-20", cursor: "2026-01-01" })).toEqual({ start: "2026-01-01", end: "2026-01-07", fetchFrom: "2026-01-01" });
    expect(nextWindow({ dateFrom: "2026-01-01", dateTo: "2026-01-20", cursor: "2026-01-15" })).toEqual({ start: "2026-01-15", end: "2026-01-20", fetchFrom: "2026-01-12" });
    expect(nextWindow({ dateFrom: "2026-01-01", dateTo: "2026-01-20", cursor: "2026-01-21" })).toBeNull();
  });
});

describe("trades_version stamp", () => {
  it("another instance's bump clears this instance's trade caches; same version keeps them", async () => {
    __resetTradesVersionForTests();
    let version = "5";
    handler = (sql) => (/FROM cache_versions/.test(sql) ? { rows: [{ v: version }] } : { rows: [] });
    await checkTradesVersion(1_000_000);
    dashboardCache.set("k", 1);

    await checkTradesVersion(2_000_000);
    expect(dashboardCache.get("k")).toBe(1); // unchanged version
    version = "6";

    await checkTradesVersion(3_000_000);
    expect(dashboardCache.get("k")).toBeUndefined();
  });
  it("is checked at most once per TTL", async () => {
    __resetTradesVersionForTests();
    handler = () => ({ rows: [{ v: "1" }] });
    await checkTradesVersion(Date.now());
    const n = calls.length;
    await checkTradesVersion(Date.now());
    expect(calls.length).toBe(n);
  });
});


describe("classic-server schedule", () => {
  it("desk cron = every 5 min 09:00–16:55 NY Mon–Fri; off-hours cron = hourly", async () => {
    const { DESK_TICK_CRON, OFF_HOURS_CRON } = await import("../../propreports/scheduler");
    const { parseCron, cronMatches } = await import("../../../jobs/cron");
    const desk = parseCron(DESK_TICK_CRON);
    const off = parseCron(OFF_HOURS_CRON);
    // 2026-10-19 is a Monday; 14:05 UTC = 10:05 New York (EDT)
    expect(cronMatches(desk, new Date("2026-10-19T14:05:00Z"))).toBe(true);
    expect(cronMatches(desk, new Date("2026-10-19T14:07:00Z"))).toBe(false);
    expect(cronMatches(desk, new Date("2026-10-19T21:05:00Z"))).toBe(false); // 17:05 NY
    expect(cronMatches(desk, new Date("2026-10-18T14:05:00Z"))).toBe(false); // Sunday
    expect(cronMatches(off, new Date("2026-10-18T03:00:00Z"))).toBe(true);
    expect(cronMatches(off, new Date("2026-10-18T03:05:00Z"))).toBe(false);
  });
});
