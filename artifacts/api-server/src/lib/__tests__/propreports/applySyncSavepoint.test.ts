/**
 * applySync: one failing trade must not poison the run. The client is a fake with Postgres' transaction semantics
 * (after a failed statement every statement fails until ROLLBACK [TO SAVEPOINT]; COMMIT keeps what is pending), so
 * without a savepoint per trade the trades after the failing one would be lost. No Postgres, no PropReports host.
 */
import { describe, expect, it, vi } from "vitest";
import type { RoundTrip } from "../../propreports/types";

type Row = { table: string; ticker?: unknown };
const tx = vi.hoisted(() => ({ committed: [] as Row[], pending: [] as Row[], marks: [] as number[], aborted: false, nextId: 100, log: [] as string[] }));

function fakeClient() {
  return {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const head = sql.trim().split(/\s+/).slice(0, 3).join(" ");
      tx.log.push(head);
      if (/^ROLLBACK TO SAVEPOINT/.test(sql)) { tx.pending.length = tx.marks.at(-1) ?? 0; tx.aborted = false; return { rows: [], rowCount: 0 }; }
      if (/^ROLLBACK/.test(sql)) { tx.pending = []; tx.marks = []; tx.aborted = false; return { rows: [], rowCount: 0 }; }
      if (tx.aborted) throw new Error("current transaction is aborted, commands ignored until end of transaction block");
      if (/^BEGIN/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^SAVEPOINT/.test(sql)) { tx.marks.push(tx.pending.length); return { rows: [], rowCount: 0 }; }
      if (/^RELEASE SAVEPOINT/.test(sql)) { tx.marks.pop(); return { rows: [], rowCount: 0 }; }
      if (/^COMMIT/.test(sql)) { tx.committed.push(...tx.pending); tx.pending = []; tx.marks = []; return { rows: [], rowCount: 0 }; }
      if (/INSERT INTO propreports_sync_runs/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/INSERT INTO trades/.test(sql)) {
        if (params[0] === "BAD") { tx.aborted = true; throw new Error('null value in column "x" violates not-null constraint'); }
        tx.pending.push({ table: "trades", ticker: params[0] });
        return { rows: [{ id: tx.nextId++ }], rowCount: 1 };
      }
      const m = /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/.exec(sql);
      if (m) tx.pending.push({ table: m[1]! });
      return { rows: [], rowCount: 0 };
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => fakeClient()),
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

const { applySync } = await import("../../propreports/sync");
import type { PlanItem, SyncPlan } from "../../propreports/sync";

const trip = (symbol: string): RoundTrip => ({
  externalId: `ACC|${symbol}|2026-10-20T10:00:00|Long`, account: "ACC", symbol, side: "Long",
  openedAt: "2026-10-20T10:00:00", closedAt: "2026-10-20T10:30:00", date: "2026-10-20", exitDate: null,
  horizon: "intraday", session: "regular", qty: 100, closedQty: 100, openQty: 0, avgEntry: 10, avgExit: 11,
  grossPnl: 100, fees: {}, totalFees: 1, netPnl: 99, result: "win", holdTime: "00:30:00", holdSeconds: 1800,
  executions: [], fillCount: 2,
} as unknown as RoundTrip);

const insert = (symbol: string): PlanItem => ({
  externalId: `ACC|${symbol}`, action: "insert", trader: "Anna", account: "ACC", tradeId: null, pendingId: null, changes: [], candidates: [], trip: trip(symbol),
});

const plan = (items: PlanItem[]): SyncPlan => ({
  items, counts: { insert: items.length, update: 0, unchanged: 0, adopt: 0, conflict: 0, skip: 0 },
  unmappedAccounts: [], inactiveAccounts: [], dateFrom: "2026-10-20", dateTo: "2026-10-20", feeColumns: [], resolvedAccounts: {},
});

describe("applySync: a savepoint per trade", () => {
  it("a failing trade is rolled back alone; the trades after it still commit, with their side effects", async () => {
    const failed: string[] = [];
    const res = await applySync(plan([insert("AAA"), insert("BAD"), insert("CCC")]), {
      actor: "test", source: "api", kick: false, onItemError: (it) => failed.push(it.trip.symbol),
    });
    expect(res).toMatchObject({ inserted: 2, updated: 0, errors: 1 });
    expect(res.errorText).toMatch(/^ACC\|BAD: null value/);
    expect(failed).toEqual(["BAD"]);
    expect(tx.committed.filter((r) => r.table === "trades").map((r) => r.ticker)).toEqual(["AAA", "CCC"]);
    // the account bookkeeping + outbox (rule scan, structures, "synced") committed with them
    expect(tx.committed.some((r) => r.table === "propreports_accounts")).toBe(true);
    expect(tx.committed.some((r) => r.table === "propreports_outbox")).toBe(true);
    expect(tx.log.filter((h) => h.startsWith("ROLLBACK TO SAVEPOINT"))).toHaveLength(1);
    expect(tx.log).toContain("COMMIT");
  });
});
