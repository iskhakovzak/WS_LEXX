import { describe, expect, it } from "vitest";
import { dedupeFileFills, fillsFromStoredTrade, mergeFills } from "../../propreports/import-continuity";
import { buildRoundTrips } from "../../propreports/round-trips";
import type { Fill, FillSide } from "../../propreports/types";

let line = 0;
const fill = (dateTime: string, side: FillSide, qty: number, price: number, extra: Partial<Fill> = {}): Fill => ({
  dateTime, account: "WS1", side, qty, symbol: "AAPL", price, route: null, fees: { ecn: qty * 0.001 },
  tradeDate: dateTime.slice(0, 10), orderId: null, fillId: null, propReportsId: null, status: null, line: line++, ...extra,
});

/** What sync stores for an open trip (trade_executions rows + context), read back as the loader would. */
function storedFromTrip(trip: ReturnType<typeof buildRoundTrips>["trips"][number]) {
  return fillsFromStoredTrade({
    account: trip.account, symbol: trip.symbol, date: trip.date, feesByType: trip.fees,
    executions: trip.executions.map((e) => ({
      at: e.at.replace("T", " "), qty: e.qty, price: e.price, orderId: e.orderId ?? null,
      note: `PropReports ${e.side}${e.fillId ? ` #${e.fillId}` : ""}${e.fees ? ` · fees ${Math.round(e.fees * 100) / 100}` : ""}`,
    })),
  });
}

describe("import continuity: a position split across two files", () => {
  const day1 = [fill("2026-10-15 09:31:00.120", "B", 100, 10), fill("2026-10-15 10:05:00.000", "B", 100, 11)]; // entry + add
  const day2 = [fill("2026-10-16 09:45:00.000", "S", 50, 12), fill("2026-10-16 11:00:00.000", "S", 150, 13)]; // trim + exit

  it("without the journal, the second file's exits are orphans", () => {
    const r = buildRoundTrips(day2);
    expect(r.trips).toHaveLength(0);
    expect(r.orphanFills).toHaveLength(2);
  });

  it("continues the open trade: same external id, entry/add/trim/exit, average-cost P&L", () => {
    const first = buildRoundTrips(day1).trips;
    expect(first).toHaveLength(1);
    expect(first[0]!.open).toBe(true);

    const merged = mergeFills(storedFromTrip(first[0]!), day2);
    const r = buildRoundTrips(merged.fills);
    expect(r.orphanFills).toHaveLength(0);
    expect(r.trips).toHaveLength(1);
    const t = r.trips[0]!;
    expect(t.externalId).toBe(first[0]!.externalId);
    expect(t.open).toBe(false);
    expect(t.executions.map((e) => e.kind)).toEqual(["entry", "add", "trim", "exit"]);
    expect(t.qty).toBe(200);
    expect(t.avgEntry).toBe(10.5);
    // 50 × (12 − 10.5) + 150 × (13 − 10.5)
    expect(t.grossPnl).toBe(450);
    expect(t.exitDate).toBe("2026-10-16");
  });

  it("an overlapping file (both days) does not double the stored fills", () => {
    const first = buildRoundTrips(day1).trips;
    const both = [...day1.map((f) => ({ ...f })), ...day2];
    const merged = mergeFills(storedFromTrip(first[0]!), both);
    expect(merged.duplicates).toBe(2);
    const t = buildRoundTrips(merged.fills).trips;
    expect(t).toHaveLength(1);
    expect(t[0]!.qty).toBe(200);
    expect(t[0]!.grossPnl).toBe(450);
  });

  it("spreads the stored fee split over the executions", () => {
    const first = buildRoundTrips(day1).trips[0]!;
    const back = storedFromTrip(first);
    const total = back.reduce((s, f) => s + (f.fees.ecn ?? 0), 0);
    expect(total).toBeCloseTo(first.fees.ecn!, 2);
  });

  it("leaves hand-edited executions alone", () => {
    expect(fillsFromStoredTrade({ account: "WS1", symbol: "AAPL", date: "2026-10-15", feesByType: {}, executions: [{ at: "2026-10-15 09:31:00", qty: 1, price: 1, note: "manual", orderId: null }] })).toEqual([]);
  });
});

describe("repeats", () => {
  it("same fill id twice in one file counts once", () => {
    const a = fill("2026-10-15 09:31:00", "B", 100, 10, { fillId: "77" });
    const r = dedupeFileFills([a, { ...a, line: 99 }, fill("2026-10-15 09:32:00", "S", 100, 11, { fillId: "78" })]);
    expect(r.duplicates).toBe(1);
    expect(r.fills).toHaveLength(2);
  });

  it("two genuine identical fills without ids both survive", () => {
    const a = fill("2026-10-15 09:31:00", "B", 100, 10);
    expect(dedupeFileFills([a, { ...a, line: 5 }]).fills).toHaveLength(2);
  });

  it("stored fills matched by shape as a multiset", () => {
    const a = fill("2026-10-15 09:31:00", "B", 100, 10);
    const stored = [{ ...a, line: -1 }, { ...a, line: -1 }];
    const r = mergeFills(stored, [{ ...a, dateTime: "2026-10-15 09:31:00.500" }]);
    expect(r.duplicates).toBe(1);
    expect(r.fills).toHaveLength(2);
  });
});
