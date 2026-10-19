/**
 * Nightly broker reconciliation: report parsing, per-day comparison (> $1), carry days, store, the tick step's
 * resumable progress (phase 3 ACCURACY).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
const cursors = vi.hoisted(() => new Map<string, unknown>());
const mappingsRef = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }),
  },
}));
vi.mock("../../propreports/tick/cursor", () => ({
  getCursor: vi.fn(async (k: string) => (cursors.has(k) ? structuredClone(cursors.get(k)) : null)),
  setCursor: vi.fn(async (k: string, v: unknown) => { cursors.set(k, structuredClone(v)); }),
}));
vi.mock("../../propreports/sync", () => ({ loadAccountMappings: vi.fn(async () => mappingsRef.list) }));

const { parseSummaryByDate, compareDays, carryDays } = await import("../../propreports/reconcile-broker");
const { saveComparisons, accountNames } = await import("../../propreports/reconcile-broker-store");
const { reconcileStep, reconcileTarget, reconcilableAccounts } = await import("../../propreports/steps/reconcile");

const SUMMARY = [
  "Date,Type,Orders,Fills,Qty,Gross,Comm,Ecn Fee,SEC,Trade Fees,Net,Adj Fees,Adj Net,Transfer,End Balance",
  "2026-10-14,Eq,10,12,1200,250.00,3.00,1.10,0.40,4.50,245.50,0.00,245.50,0.00,10245.50",
  "2026-10-15,Eq,4,4,400,-80.00,1.00,0.50,0.00,1.50,-81.50,-45.00,-126.50,0.00,10119.00",
  "2026-10-15,Opt,1,1,1,20.00,0.65,0.00,0.00,0.65,19.35,0.00,19.35,0.00,10138.35",
  "Total,,15,17,1601,190.00,4.65,1.60,0.40,6.65,183.35,-45.00,138.35,0.00,",
  "Page 1/1",
].join("\n");

describe("parseSummaryByDate", () => {
  it("sums Type rows per date, skips totals and the page trailer, keeps adjustments / transfers", () => {
    const { days, columns } = parseSummaryByDate(SUMMARY);
    expect(columns[0]).toBe("Date");
    expect(days).toEqual([
      { date: "2026-10-14", gross: 250, fees: 4.5, net: 245.5, fills: 12, adjFees: 0, transfers: 0 },
      { date: "2026-10-15", gross: -60, fees: 2.15, net: -62.15, fills: 5, adjFees: -45, transfers: 0 },
    ]);
  });

  it("several sections, US dates, no fee column (fees = gross − net)", () => {
    const text = ["Account WSL007", "Date,Gross,Net", "10/14/2026,100,98", "", "Date,Gross,Net", "10/15/2026,(10.00),(11.00)"].join("\n");
    expect(parseSummaryByDate(text).days).toEqual([
      { date: "2026-10-14", gross: 100, fees: 2, net: 98, fills: null, adjFees: null, transfers: null },
      { date: "2026-10-15", gross: -10, fees: 1, net: -11, fills: null, adjFees: null, transfers: null },
    ]);
  });

  it("an unrelated body yields no columns", () => {
    expect(parseSummaryByDate("Error: unknown report").columns).toEqual([]);
  });
});

describe("compareDays", () => {
  const our = (date: string, net: number, trades = 2) => ({ date, trades, gross: net, fees: 0, net });
  const br = (date: string, net: number) => ({ date, gross: net, fees: 0, net, fills: 2, adjFees: null, transfers: null });

  it("ok within $1, mismatch beyond, missing on either side", () => {
    const rows = compareDays(
      [our("2026-10-13", 100), our("2026-10-14", 245.0), our("2026-10-15", -50), our("2026-10-16", 30)],
      [br("2026-10-13", 100.99), br("2026-10-14", 245.5), br("2026-10-15", -62.15), br("2026-10-17", 12)],
    );
    expect(rows.map((r) => [r.date, r.status, r.diff])).toEqual([
      ["2026-10-13", "ok", -0.99],
      ["2026-10-14", "ok", -0.5],
      ["2026-10-15", "mismatch", 12.15],
      ["2026-10-16", "missing_broker", 30],
      ["2026-10-17", "missing_ours", -12],
    ]);
  });

  it("a day with only adjustments on our side is 'missing ours' when the broker booked trades", () => {
    const rows = compareDays([{ date: "2026-10-15", trades: 0, gross: 0, fees: 0, net: 0, adjFees: -45, transfers: 0 }], [br("2026-10-15", -62)]);
    expect(rows[0]!.status).toBe("missing_ours");
  });

  it("carry days are flagged; adjustment diffs are informative only", () => {
    const rows = compareDays(
      [{ ...our("2026-10-15", -62.15), adjFees: -40, transfers: 0 }],
      [{ ...br("2026-10-15", -62.15), adjFees: -45, transfers: 0 }],
      { carry: new Set(["2026-10-15"]) },
    );
    expect(rows[0]).toMatchObject({ status: "ok", carry: true, adjDiff: 5, transferDiff: 0 });
  });

  it("carryDays spans multi-day and open trades inside the window", () => {
    const s = carryDays([
      { date: "2026-10-13", closeDate: "2026-10-15", open: false },
      { date: "2026-10-16", closeDate: null, open: true },
      { date: "2026-10-14", closeDate: "2026-10-14", open: false },
    ], "2026-10-14", "2026-10-17");
    expect([...s].sort()).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
  });
});

describe("store", () => {
  beforeEach(() => { calls.length = 0; });

  it("accountNames covers name, id and aliases", () => {
    expect(accountNames({ account: "WSL007", accountName: "John", accountId: "77", aliases: ["wsl-7", "WSL007"] })).toEqual(["WSL007", "John", "77", "wsl-7"]);
  });

  it("upserts per (account, date) and re-opens an acknowledgement when the diff moved > $1", async () => {
    const rows = compareDays([{ date: "2026-10-15", trades: 2, gross: -50, fees: 0, net: -50 }], [{ date: "2026-10-15", gross: -60, fees: 2, net: -62.15, fills: 5, adjFees: null, transfers: null }]);
    const r = await saveComparisons({ account: "WSL007", accountId: "77", trader: "Кирилл Б." }, rows);
    expect(r).toEqual({ saved: 1, mismatches: 1 });
    expect(calls[0]!.sql).toContain("ON CONFLICT (account, date) DO UPDATE");
    expect(calls[0]!.sql).toContain("acknowledged_diff");
    expect(calls[0]!.params.slice(0, 8)).toEqual(["WSL007", "77", "Кирилл Б.", "2026-10-15", "mismatch", -50, -62.15, 12.15]);
  });
});

describe("reconcile step", () => {
  const mapping = (o: Record<string, unknown>) => ({ id: 1, account: "WSL007", accountId: "77", accountName: null, trader: "Кирилл Б.", active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null, ...o });
  const log = { warn: vi.fn(), info: vi.fn() } as any;

  beforeEach(() => { cursors.clear(); calls.length = 0; });

  it("target: today from 20:00 ET, else yesterday", () => {
    expect(reconcileTarget(new Date("2026-10-16T23:30:00Z"))).toBe("2026-10-15"); // 19:30 ET
    expect(reconcileTarget(new Date("2026-10-17T00:30:00Z"))).toBe("2026-10-16"); // 20:30 ET
  });

  it("only active mapped accounts with a broker id are asked for", () => {
    const r = reconcilableAccounts([mapping({}), mapping({ id: 2, accountId: null }), mapping({ id: 3, active: false }), mapping({ id: 4, trader: null })] as any);
    expect(r.accounts.map((m) => m.id)).toEqual([1]);
    expect(r.skipped).toBe(1);
  });

  it("one report per account, resumable under the deadline, then done for the night", async () => {
    mappingsRef.list = [mapping({}), mapping({ id: 2, account: "WSL008", accountId: "78" })];
    const report = vi.fn(async () => SUMMARY);
    const now = new Date("2026-10-17T00:30:00Z");
    // first tick: time for one account only
    let clock = 0;
    const deadline = Date.now() + 6_000;
    const ctx = { now, deadline, client: { report }, enqueue: vi.fn(), log } as any;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (clock++ === 0 ? deadline - 10_000 : deadline - 1_000));
    const r1 = await reconcileStep.run(ctx);
    spy.mockRestore();
    expect(r1.done).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("summary", "2026-10-12", "2026-10-16", { accountId: "77" });
    // next tick finishes the second account
    const r2 = await reconcileStep.run({ ...ctx, deadline: Date.now() + 60_000 });
    expect(r2.done).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith("summary", "2026-10-12", "2026-10-16", { accountId: "78" });
    // same evening again: nothing to do
    const r3 = await reconcileStep.run({ ...ctx, deadline: Date.now() + 60_000 });
    expect(r3.note).toContain("already reconciled");
    expect(report).toHaveBeenCalledTimes(2);
  });
});
