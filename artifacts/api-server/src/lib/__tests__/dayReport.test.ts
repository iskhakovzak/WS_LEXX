/**
 * «Разбор дня»: size-up compares $ notional like behaviorEngine (DENIS-10), one leak shows one number in the header and
 * in its row (DENIS-11), and «setups not given» only fires when no trade has a strategy name or playbook setup.
 */
import { describe, expect, it } from "vitest";
import { buildDayReport, type DayTrade } from "../dayReport";
import { isOpeningDay } from "../dayReportRules";

/** Trade on 2026-09-16 entered at NY 09:30 + `inMin` (EDT), held `hold` minutes. */
function dt(id: number, ticker: string, qty: number, entry: number, net: number, inMin: number, hold = 2, over: Partial<DayTrade> = {}): DayTrade {
  const entryAt = Date.UTC(2026, 8, 16, 13, 30) + inMin * 60000;
  return {
    id, ticker, side: "long", setup: null, playbookId: null, result: net > 0 ? "win" : net < 0 ? "loss" : "be",
    gross: net, fees: 0, net, qty, entry, exit: entry, entryAt, exitAt: entryAt + hold * 60000, timeSource: "executions", ...over,
  };
}

const report = (trades: DayTrade[]) => buildDayReport({ trader: "t", date: "2026-09-16", trades, history: [], dailyLossLimit: null });

describe("day report — size-up after a loss", () => {
  it("more shares of a cheaper ticker is not a size-up ($ notional, ×1.3)", () => {
    // RGTI 1 050 × $15 = $15 750 loss, then PLUG 2 500 × $2 = $5 000 → smaller position.
    const r = report([dt(1, "RGTI", 1050, 15, -81, 0), dt(2, "PLUG", 2500, 2, -4, 10)]);
    expect(r.leaks.find((l) => l.kind === "size_up")).toBeUndefined();
  });

  it("a bigger $ position after a closed loss is flagged", () => {
    const r = report([dt(1, "INTC", 50, 20, -20, 0), dt(2, "NIO", 2500, 5, -4, 10)]);
    expect(r.leaks.find((l) => l.kind === "size_up")?.tradeIds).toEqual([2]);
  });
});

describe("day report — one leak, one number", () => {
  it("size-up cost = losses of the flagged trades = the header total; net is shown separately", () => {
    const r = report([
      dt(1, "MARA", 100, 10, -14, 0), dt(2, "OKLO", 250, 10, -43, 10),
      dt(3, "MARA", 450, 10, -8, 20), dt(4, "MARA", 750, 10, 43, 30),
    ]);
    const leak = r.leaks.find((l) => l.kind === "size_up")!;
    expect(leak.tradeIds).toEqual([2, 3, 4]);
    expect(leak.netUsd).toBe(-8);
    expect(leak.costUsd).toBe(51);
    expect(r.leaks).toHaveLength(1);
    expect(r.leaksTotalUsd).toBe(leak.costUsd);
  });
});

describe("day report — setups", () => {
  it("counts trades that carry the broker strategy name, even when no setup had an edge", () => {
    const r = report([dt(1, "A", 100, 10, -5, 0, 2, { setup: "Gap and Go" }), dt(2, "B", 100, 10, -3, 30, 2, { setup: "ORB" })]);
    expect(r.strengths.setups).toEqual([]);
    expect(r.strengths.setupTrades).toBe(2);
  });

  it("0 when no trade has a strategy name or playbook setup", () => {
    expect(report([dt(1, "A", 100, 10, 5, 0)]).strengths.setupTrades).toBe(0);
    expect(report([dt(1, "A", 100, 10, 5, 0, 2, { playbookId: 7 })]).strengths.setupTrades).toBe(1);
  });
});

describe("isOpeningDay (ROMAN-24)", () => {
  const row = (entryTime: string | null, net: number | null) => ({ entryTime, net });
  it("≥ 70 % of entries in 09:30–09:45 ET and the open did not lose", () => {
    expect(isOpeningDay([row("09:30:00", 20), row("09:30:05", -5), row("09:31:10", 3), row("11:02:00", -40)])).toBe(true);
  });
  it("not when the open lost, or most entries are later, or too few timed trades", () => {
    expect(isOpeningDay([row("09:30:00", -20), row("09:30:05", -5), row("09:31:10", 3)])).toBe(false);
    expect(isOpeningDay([row("09:30:00", 20), row("10:30:05", 5), row("11:31:10", 3)])).toBe(false);
    expect(isOpeningDay([row("09:30:00", 20), row(null, 5)])).toBe(false);
  });
});
