/**
 * Tick step fills.recent when only some trades fail to apply: no throw (the step does not turn into an endless
 * error), the committed accounts get their cursor, the failing account does not (re-planned next tick); a run that
 * failed as a whole still throws. Sync / cursors / the client are stubs — no Postgres, never a real PropReports host.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  apply: null as null | ((plan: any, opts: any) => Promise<any>),
  cursors: [] as string[],
}));

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), connect: vi.fn() } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
vi.mock("../../propreports/scheduler", () => ({ fetchStartFor: vi.fn(async () => new Date("2026-10-19T00:00:00Z")) }));
vi.mock("../../propreports/replacement", () => ({ canonicalizeFillIds: vi.fn(async (fills: unknown[]) => ({ fills })) }));
vi.mock("../../propreports/round-trips", () => ({
  buildRoundTrips: vi.fn((fills: Array<{ account: string; symbol: string }>) => ({
    trips: fills.map((f) => ({ externalId: `${f.account}|${f.symbol}`, account: f.account, symbol: f.symbol })), orphanFills: [],
  })),
}));
vi.mock("../../propreports/tick/cursor", () => ({
  getCursors: vi.fn(async () => new Map()),
  setCursor: vi.fn(async (key: string) => { state.cursors.push(key); }),
}));
vi.mock("../../propreports/sync", () => ({
  planSync: vi.fn(async (trips: Array<{ externalId: string; account: string }>) => ({
    items: trips.map((t) => ({ externalId: t.externalId, action: "insert", trader: "Anna", account: t.account, trip: t })),
    counts: { insert: trips.length, update: 0, unchanged: 0, adopt: 0, conflict: 0, skip: 0 },
    unmappedAccounts: [], inactiveAccounts: [],
  })),
  applySync: vi.fn((plan: unknown, opts: unknown) => state.apply!(plan, opts)),
  rememberSeen: vi.fn(async () => {}),
}));

const { syncRecentFills } = await import("../../propreports/tick/fillsStep");
const { runBackfill } = await import("../../propreports/tick/backfill");
const { pool } = await import("@workspace/db");

const fill = (account: string, symbol: string, id: string) => ({
  dateTime: "2026-10-20 10:00:00", account, side: "B", qty: 100, symbol, price: 10, route: null, fees: {}, tradeDate: "2026-10-20",
  orderId: null, fillId: null, propReportsId: id, status: null, line: 0,
});
const client = {
  fillsPage: vi.fn(async () => ({ fills: [fill("A1", "AAA", "1"), fill("B2", "BAD", "2")], table: {}, page: { current: 1, total: 1 }, issues: [], feeColumns: [] })),
} as any;
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
const ctx = () => ({ now: new Date("2026-10-20T15:00:00Z"), deadline: Date.now() + 60_000, client, log, enqueue: vi.fn() });

beforeEach(() => { state.cursors = []; log.warn.mockClear(); });

describe("fills.recent with a partly failed apply", () => {
  it("some trades failed: no throw, cursor only for the clean account, a warning with the failing account", async () => {
    state.apply = async (plan, opts) => {
      for (const it of plan.items) if (it.trip.symbol === "BAD") opts.onItemError(it, new Error("boom"));
      return { runId: 1, inserted: 1, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, errors: 1, errorText: "B2|BAD: boom" };
    };
    const res = await syncRecentFills(ctx());
    expect(res.done).toBe(true);
    expect(res.note).toMatch(/\+1 ~0 \?0 !1 failed/);
    expect(state.cursors).toEqual(["fills:acct:A1"]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ errors: 1, accounts: ["B2"] }), expect.any(String));
  });

  it("every trade failed one by one: still no throw (re-planned next tick), no cursor at all", async () => {
    state.apply = async (plan, opts) => {
      for (const it of plan.items) opts.onItemError(it, new Error("boom"));
      return { runId: 1, inserted: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, errors: 2, errorText: "boom" };
    };
    await expect(syncRecentFills(ctx())).resolves.toMatchObject({ done: true });
    expect(state.cursors).toEqual([]);
  });

  it("the run failed as a whole (rolled back): throws, no cursor", async () => {
    state.apply = async () => ({ runId: 1, inserted: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, errors: 1, errorText: "connection lost" });
    await expect(syncRecentFills(ctx())).rejects.toThrow(/apply failed: connection lost/);
    expect(state.cursors).toEqual([]);
  });
});

describe("backfill: the window's cursor update finds the backfill no longer running", () => {
  it("0 rows updated (cancelled meanwhile) → status cancelled, the loop stops after that window", async () => {
    const running = { id: 3, date_from: "2026-09-01", date_to: "2026-10-31", cursor: "2026-09-01", status: "running", windows_total: 9, windows_done: 0, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" };
    vi.mocked(pool.query).mockImplementation((async (sql: string) =>
      /FROM propreports_backfills WHERE status = 'running'/.test(sql) ? { rows: [running], rowCount: 1 } : { rows: [], rowCount: 0 }) as never);
    state.apply = async () => ({ runId: 1, inserted: 2, updated: 0, unchanged: 0, skipped: 0, conflicts: 0, errors: 0, errorText: null });
    client.fillsPage.mockClear();
    const res = await runBackfill(ctx());
    expect(res.done).toBe(true);
    expect(res.note).toMatch(/— cancelled$/);
    expect(client.fillsPage).toHaveBeenCalledTimes(1); // one window, not every window until the deadline
    expect(vi.mocked(pool.query).mock.calls.filter(([sql]) => /UPDATE propreports_backfills\s+SET cursor/.test(String(sql)))).toHaveLength(1);
  });
});
