/**
 * Broker adjustments: classification, identity (propReportsId / fingerprint + occurrence), re-import replacement,
 * archive instead of delete, per-day totals for net P&L and equity (phase 3 ACCURACY).
 */
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
const existingRows = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM propreports_adjustments") && sql.includes("FOR UPDATE")) return { rows: existingRows.rows, rowCount: existingRows.rows.length };
    return { rows: [], rowCount: 1 };
  });
  return { db: {}, pool: { query, connect: vi.fn(async () => ({ query, release: () => {} })) } };
});

const { adjustmentKind, toAdjustmentRows, sumByKind, normYmd } = await import("../../propreports/adjustments-parse");
const { planAdjustmentWrites, mergeAdjustmentDays, storeAdjustments } = await import("../../propreports/adjustments");
type RawAdjustment = import("../../propreports/adjustments-parse").RawAdjustment;
type ExistingAdjustment = import("../../propreports/adjustments").ExistingAdjustment;

const raw = (o: Partial<RawAdjustment> = {}): RawAdjustment => ({
  date: "2026-10-15", account: "WSL007", category: "Software Fee", amount: -45, comment: "DAS", qty: null, symbol: null, price: null, propReportsId: "A1", ...o,
});

describe("adjustmentKind", () => {
  it.each([
    ["Software Fee", null, "fee"],
    ["Market Data", null, "fee"],
    ["Locate", null, "fee"],
    ["Wire Fee", null, "fee"],
    ["Deposit", null, "transfer"],
    ["Withdrawal", null, "transfer"],
    ["Transfer", null, "transfer"],
    ["Profit Split", null, "transfer"],
    ["Dividend", null, "other"],
    ["Adjustment", "monthly platform fee", "fee"],
    ["Adjustment", "wire out", "transfer"],
    ["Correction", null, "other"],
  ] as const)("%s (%s) → %s", (cat, comment, kind) => {
    expect(adjustmentKind(cat, comment)).toBe(kind);
  });
});

describe("toAdjustmentRows", () => {
  it("normalises, classifies and numbers identical twins", () => {
    const { rows, issues } = toAdjustmentRows([
      raw({ propReportsId: null }),
      raw({ propReportsId: null }),
      raw({ date: "10/16/2026", category: "Deposit", amount: 5000, propReportsId: "A2", comment: null }),
      raw({ account: "", propReportsId: "A3" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(rows.map((r) => [r.date, r.kind, r.occurrence])).toEqual([["2026-10-15", "fee", 1], ["2026-10-15", "fee", 2], ["2026-10-16", "transfer", 1]]);
    expect(rows[0]!.fingerprint).toBe(rows[1]!.fingerprint);
  });

  it("a + and − pair inside the scope is kept as two rows that cancel", () => {
    const { rows } = toAdjustmentRows([raw({ amount: -100, propReportsId: "X1" }), raw({ amount: 100, propReportsId: "X2" })]);
    expect(rows).toHaveLength(2);
    expect(sumByKind(rows).fees).toBe(0);
  });

  it("normYmd", () => {
    expect(normYmd("2026-1-5")).toBe("2026-01-05");
    expect(normYmd("1/5/26")).toBe("2026-01-05");
    expect(normYmd("Total")).toBeNull();
  });
});

const ex = (o: Partial<ExistingAdjustment>): ExistingAdjustment => ({ id: 1, account: "WSL007", propReportsId: "A1", fingerprint: "fp", occurrence: 1, archived: false, inWindow: true, ...o });

describe("planAdjustmentWrites", () => {
  const [row] = toAdjustmentRows([raw()]).rows;

  it("same propReportsId → touch (no duplicate)", () => {
    const p = planAdjustmentWrites([ex({ id: 7, fingerprint: row!.fingerprint })], [row!]);
    expect(p.touch.map((t) => t.id)).toEqual([7]);
    expect(p.insert).toEqual([]);
    expect(p.archive).toEqual([]);
  });

  it("re-imported (new id, same data) → the existing row takes the new id", () => {
    const p = planAdjustmentWrites([ex({ id: 7, propReportsId: "OLD", fingerprint: row!.fingerprint })], [row!]);
    expect(p.replace).toEqual([{ id: 7, oldId: "OLD", row }]);
    expect(p.insert).toEqual([]);
    expect(p.archive).toEqual([]);
  });

  it("vanished upstream → archived, never deleted; new → inserted", () => {
    const p = planAdjustmentWrites([ex({ id: 7, propReportsId: "GONE", fingerprint: "other" })], [row!]);
    expect(p.archive).toEqual([7]);
    expect(p.insert).toEqual([row]);
  });

  it("rows outside the window are never archived", () => {
    const p = planAdjustmentWrites([ex({ id: 7, propReportsId: "OLD", fingerprint: "other", inWindow: false })], []);
    expect(p.archive).toEqual([]);
  });

  it("an archived row whose id returns is touched (un-archived)", () => {
    const p = planAdjustmentWrites([ex({ id: 9, archived: true, inWindow: false })], [row!]);
    expect(p.touch.map((t) => t.id)).toEqual([9]);
  });

  it("rows without ids match by fingerprint + occurrence", () => {
    const rows = toAdjustmentRows([raw({ propReportsId: null }), raw({ propReportsId: null })]).rows;
    const fp = rows[0]!.fingerprint;
    const p = planAdjustmentWrites([ex({ id: 1, propReportsId: null, fingerprint: fp, occurrence: 1 }), ex({ id: 2, propReportsId: null, fingerprint: fp, occurrence: 2 })], rows);
    expect(p.touch.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(p.insert).toEqual([]);
  });
});

describe("mergeAdjustmentDays", () => {
  it("net with adjustments = trade net + fees + other; equity also moves with transfers", () => {
    const { days, totals } = mergeAdjustmentDays(
      [{ date: "2026-10-15", net: 250 }, { date: "2026-10-16", net: -40 }],
      [{ date: "2026-10-15", fees: -45, transfers: 0, other: 5, count: 2 }, { date: "2026-10-17", fees: 0, transfers: -1000, other: 0, count: 1 }],
    );
    expect(days.map((d) => [d.date, d.netWithAdjustments, d.equityDelta])).toEqual([
      ["2026-10-15", 210, 210],
      ["2026-10-16", -40, -40],
      ["2026-10-17", 0, -1000],
    ]);
    expect(totals).toMatchObject({ tradeNet: 210, fees: -45, transfers: -1000, other: 5, count: 3, netWithAdjustments: 170, equityDelta: -830 });
  });
});

describe("storeAdjustments", () => {
  it("one transaction: re-import updates the row and keeps the old id; vanished rows are archived", async () => {
    calls.length = 0;
    const rows = toAdjustmentRows([raw({ propReportsId: "NEW" })]).rows;
    existingRows.rows = [
      { id: 5, account: "WSL007", propreports_id: "OLD", fingerprint: rows[0]!.fingerprint, occurrence: 1, archived_at: null, scope: "groupId:-4", date: "2026-10-15" },
      { id: 6, account: "WSL007", propreports_id: "GONE", fingerprint: "zzz", occurrence: 1, archived_at: null, scope: "groupId:-4", date: "2026-10-14" },
    ];
    const mappings = [{ id: 1, account: "WSL007", accountId: "77", accountName: null, trader: "Кирилл Б.", active: true, notes: null, aliases: [], lastSyncedAt: null, lastFillAt: null }];
    const res = await storeAdjustments(rows, { scope: "groupId:-4", from: "2026-10-10", to: "2026-10-16", mappings });
    expect(res).toMatchObject({ inserted: 0, replaced: 1, archived: 1 });
    expect(calls[0]!.sql).toBe("BEGIN");
    const upd = calls.find((c) => c.sql.includes("UPDATE propreports_adjustments SET") && c.params[0] === 5)!;
    expect(upd.params[3]).toBe("Кирилл Б.");
    expect(upd.params[11]).toBe("NEW");
    expect(upd.params[15]).toBe("OLD");
    expect(calls.find((c) => c.sql.includes("archived_at = NOW()"))!.params[0]).toEqual([6]);
    expect(calls.some((c) => /DELETE/i.test(c.sql))).toBe(false);
    expect(calls.at(-1)!.sql).toBe("COMMIT");
  });
});
