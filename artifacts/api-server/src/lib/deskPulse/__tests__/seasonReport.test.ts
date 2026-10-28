/**
 * Season report (lib/deskPulse/seasonReport): its numbers are the core metrics of the same trades — the net is
 * Σ (pnl − |fees|), the win rate is winRateOf(wins, losses), the rows add up to the totals — and the season calendar.
 */
import { describe, expect, it } from "vitest";
import { netPnl, winRateOf } from "../../coreMetrics";
import type { FlowTrade } from "../../sessionFlow/types";
import { seasonOfDay, seasonReport, previousSeason } from "../seasonReport";

let id = 0;
const T0 = Date.parse("2026-10-20T13:35:00Z");
function tr(day: string, ticker: string, pnl: number, o: Partial<FlowTrade> = {}): FlowTrade {
  const i = ++id;
  return {
    id: i, trader: "t", day, ticker, side: "long", result: pnl > 0 ? "win" : pnl < 0 ? "loss" : "be", net: pnl - 1,
    entryAt: T0 + i * 600_000, exitAt: T0 + i * 600_000 + 300_000, entrySec: 9 * 3600 + 35 * 60, notional: 10_000, exitKind: "whole",
    strategy: "Day", setupId: 7, setupName: "ORB", pnl, fees: 1, ...o,
  } as FlowTrade;
}

const cfg = { minTrades: 2, giveback: { thresholdStops: 1.5, nearPeakShare: 0.1 }, greenToRed: { sizeRatio: 1.3, paceRatio: 1.5, minAfter: 2 } };

describe("season report numbers", () => {
  const trades = [
    tr("2026-10-20", "AAA", 301), tr("2026-10-20", "AAA", -99), tr("2026-10-20", "AAA", -49), // 2nd and 3rd entries: re-entries
    tr("2026-10-21", "BBB", 151, { strategy: "Day", entrySec: 11 * 3600 }), tr("2026-10-21", "CCC", -201, { setupId: null, setupName: null }),
    tr("2026-10-22", "DDD", 1, { result: "be" }), tr("2026-10-22", "EEE", 81, { strategy: "AfterMarket", entrySec: 16 * 3600 + 600 }),
    tr("2026-10-22", "OPN", 500, { result: "open" }),
  ];
  const r = seasonReport({ trades, families: new Map([[1, "gap_up_long"], [2, "gap_up_long"]]), marks: [], dailyLimit: 200, ...cfg });

  it("totals are the core metrics of the closed trades", () => {
    const closed = trades.filter((t) => t.result !== "open");
    const net = Math.round(closed.reduce((a, t) => a + netPnl(t)!, 0) * 100) / 100;
    expect(r.totals.net).toBe(net);
    expect(r.totals.n).toBe(closed.length);
    expect(r.totals.winrate).toBe(Number(winRateOf(3, 3)!.toFixed(4))); // 300, 150, 80 win; −100, −50, −202 lose; BE out
    expect(r.totals.days).toBe(3);
  });

  it("the setup × timing rows and the timing rows add up to the totals", () => {
    const sum = (xs: { net: number | null }[]) => Math.round(xs.reduce((a, x) => a + (x.net ?? 0), 0) * 100) / 100;
    expect(sum(r.rows)).toBe(r.totals.net);
    expect(sum(r.timings)).toBe(r.totals.net);
    const orbOpen = r.rows.find((x) => x.setupId === 7 && x.timing === "open30")!;
    expect(orbOpen).toMatchObject({ n: 4, net: 150, judged: true });
    expect(r.rows.find((x) => x.timing === "pm")).toMatchObject({ n: 1, judged: false });
    expect(r.rows.find((x) => x.setupId == null)).toMatchObject({ setup: null, net: -202 });
  });

  it("best / worst trades, families, re-entries", () => {
    expect(r.best.map((b) => b.net)).toEqual([300, 150, 80]);
    expect(r.worst.map((b) => b.net)).toEqual([-202, -100, -50]);
    expect(r.families).toEqual([expect.objectContaining({ family: "gap_up_long", n: 2, net: 200 })]);
    expect(r.flow.reentry).toMatchObject({ n: 2, net: -150 });
  });
});

describe("season calendar", () => {
  it("a season runs from the prime start day of its quarter to the day before the next one", () => {
    expect(seasonOfDay("2026-10-29", 12)).toEqual({ key: "2026-Q4", from: "2026-10-12", to: "2027-01-11" });
    expect(seasonOfDay("2026-10-05", 12)).toEqual({ key: "2026-Q3", from: "2026-07-12", to: "2026-10-11" });
    expect(seasonOfDay("2026-01-03", 12)).toEqual({ key: "2025-Q4", from: "2025-10-12", to: "2026-01-11" });
    expect(previousSeason(seasonOfDay("2026-10-29", 12), 12)).toEqual({ key: "2026-Q3", from: "2026-07-12", to: "2026-10-11" });
  });
});
