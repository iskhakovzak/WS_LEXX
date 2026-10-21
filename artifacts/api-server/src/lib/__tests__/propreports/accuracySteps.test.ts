/**
 * Accounts step (closed accounts → mapping deactivated, new ones → unmatched list) and the adjustments step's daily
 * window + resumable backfill (phase 3 ACCURACY).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cursors = vi.hoisted(() => new Map<string, unknown>());
const stored = vi.hoisted(() => [] as Array<{ rows: unknown[]; w: { scope: string; from: string; to: string } }>);
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../propreports/tick/cursor", () => ({
  getCursor: vi.fn(async (k: string) => (cursors.has(k) ? structuredClone(cursors.get(k)) : null)),
  setCursor: vi.fn(async (k: string, v: unknown) => { cursors.set(k, structuredClone(v)); }),
}));
vi.mock("../../propreports/adjustments", () => ({
  storeAdjustments: vi.fn(async (rows: unknown[], w: any) => { stored.push({ rows, w }); return { inserted: rows.length, updated: 0, replaced: 0, archived: 0 }; }),
  relinkAdjustmentTraders: vi.fn(async () => 0),
}));

const { isClosedAccount, planAccounts } = await import("../../propreports/steps/accounts");
const { adjustmentsStep, dailyDue, requestAdjustmentsBackfill, scopeKey } = await import("../../propreports/steps/adjustments");
type PropReportsAccount = import("../../propreports/client").PropReportsAccount;
type AccountMapping = import("../../propreports/sync").AccountMapping;

const acc = (o: Partial<PropReportsAccount>): PropReportsAccount => ({
  accountId: "77", account: "WSL007", accountName: null, groups: [], firstTraded: null, lastTraded: null, currency: "USD",
  status: "active", closeDate: null, deactivationDate: null, ...o,
});
const map = (o: Partial<AccountMapping>): AccountMapping => ({
  id: 1, account: "WSL007", accountId: "77", accountName: null, trader: "Кирилл Б.", active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null, ...o,
});

describe("isClosedAccount", () => {
  it("status words and past close / deactivation dates", () => {
    expect(isClosedAccount(acc({ status: "closed" }), "2026-10-19")).toBe(true);
    expect(isClosedAccount(acc({ status: "Inactive" }), "2026-10-19")).toBe(true);
    expect(isClosedAccount(acc({ closeDate: "2026-10-19" }), "2026-10-19")).toBe(true);
    expect(isClosedAccount(acc({ deactivationDate: "2026-11-01" }), "2026-10-19")).toBe(false);
    expect(isClosedAccount(acc({}), "2026-10-19")).toBe(false);
  });
});

describe("planAccounts", () => {
  const today = "2026-10-19";

  it("deactivates the mapping of a closed account and records broker metadata", () => {
    const p = planAccounts([acc({ status: "closed" })], [map({})], new Set(), [], today);
    expect(p.deactivate).toEqual([{ id: 1, account: "WSL007", reason: "closed" }]);
    expect(p.metadata[0]).toMatchObject({ id: 1, status: "closed" });
  });

  it("re-activates only mappings this step deactivated", () => {
    expect(planAccounts([acc({})], [map({ active: false })], new Set([1]), [], today).reactivate).toEqual([{ id: 1, account: "WSL007" }]);
    expect(planAccounts([acc({})], [map({ active: false })], new Set(), [], today).reactivate).toEqual([]);
  });

  it("new open accounts join the unmatched list; closed ones leave it; mapped names drop out", () => {
    const p = planAccounts(
      [acc({ account: "WSL099", accountId: "99" }), acc({ account: "WSL050", accountId: "50", status: "closed" })],
      [map({})],
      new Set(),
      ["WSL050", "WSL007", "OLD1"],
      today,
    );
    expect(p.unmatched).toEqual(["OLD1", "WSL099"]);
    expect(p.newUnmatched).toEqual(["WSL099"]);
  });

  it("matches by broker account id or alias too", () => {
    const p = planAccounts([acc({ account: "Renamed", accountId: "77", status: "closed" })], [map({})], new Set(), [], today);
    expect(p.deactivate).toHaveLength(1);
    expect(p.unmatched).toEqual([]);
  });
});

describe("adjustments step", () => {
  const log = { warn: vi.fn(), info: vi.fn() } as any;
  const client = {
    scopeParams: () => ({ groupId: "-4" }),
    adjustments: vi.fn(async () => ({ adjustments: [{ date: "2026-10-16", account: "WSL007", category: "Software Fee", amount: -45, comment: null, qty: null, symbol: null, price: null, propReportsId: "A1", line: 0 }], table: { header: [], rows: [], page: null } })),
  };

  beforeEach(() => { cursors.clear(); stored.length = 0; client.adjustments.mockClear(); });

  it("dailyDue: never ran → now; else once per NY date after 19:00 ET", () => {
    expect(dailyDue(new Date("2026-10-16T14:00:00Z"), null)).toBe(true);
    expect(dailyDue(new Date("2026-10-16T22:00:00Z"), { date: "2026-10-15", at: "" })).toBe(false); // 18:00 ET
    expect(dailyDue(new Date("2026-10-16T23:30:00Z"), { date: "2026-10-15", at: "" })).toBe(true); // 19:30 ET
    expect(dailyDue(new Date("2026-10-16T23:30:00Z"), { date: "2026-10-16", at: "" })).toBe(false);
  });

  it("scopeKey", () => {
    expect(scopeKey({ scopeParams: () => ({ accountId: "1,2" }) } as any)).toBe("accountId:1,2");
  });

  it("fetches the last 7 days once, then a queued backfill in ≤ 31-day chunks", async () => {
    const ctx = { now: new Date("2026-10-16T23:30:00Z"), deadline: Date.now() + 60_000, client, enqueue: vi.fn(), log } as any;
    await requestAdjustmentsBackfill("2026-08-01", "2026-09-15", "Админ");
    const r = await adjustmentsStep.run(ctx);
    expect(r.done).toBe(true);
    expect(client.adjustments.mock.calls.map((c: any) => [c[0].startDate, c[0].endDate])).toEqual([
      ["2026-10-10", "2026-10-16"],
      ["2026-08-01", "2026-08-31"],
      ["2026-09-01", "2026-09-15"],
    ]);
    expect(stored[0]!.w).toMatchObject({ scope: "groupId:-4", from: "2026-10-10", to: "2026-10-16" });
    const again = await adjustmentsStep.run(ctx);
    expect(again.note).toBe("nothing due");
    expect(client.adjustments).toHaveBeenCalledTimes(3);
  });

  it("a short deadline pauses the backfill (done: false) and keeps its place", async () => {
    cursors.set("adjustments:daily", { date: "2026-10-16", at: "" });
    await requestAdjustmentsBackfill("2026-08-01", "2026-09-15", null);
    const ctx = { now: new Date("2026-10-16T23:30:00Z"), deadline: Date.now() + 1_000, client, enqueue: vi.fn(), log } as any;
    const r = await adjustmentsStep.run(ctx);
    expect(r.done).toBe(false);
    expect(client.adjustments).not.toHaveBeenCalled();
    expect((cursors.get("adjustments:backfill") as any).next).toBe("2026-08-01");
  });
});
