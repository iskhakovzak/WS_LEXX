/**
 * Trading pods — stats aggregation and privacy (lib/pods/stats): sum and median of members on the core metrics,
 * inactive members left out of both, a trader's own $ only, the $ sum from three active members, no $ median for a
 * trader. Synthetic traders only.
 */
import { describe, expect, it } from "vitest";
import { median, podStats, type MemberTotals } from "../pods/stats";

const m = (trader: string, trades: number, wins: number, losses: number, net: number | null, sumR: number, rTrades: number): MemberTotals => ({ trader, trades, wins, losses, net, sumR, rTrades });
const A = m("Synth A", 10, 6, 4, 500, 5, 10);
const B = m("Synth B", 4, 1, 3, -200, -2, 4);
const C = m("Synth C", 6, 3, 3, 100, 1.5, 6);
const IDLE = m("Synth D", 0, 0, 0, null, 0, 0);

describe("pod stats: aggregation", () => {
  it("sum and median over the active members (core win rate, R per trade)", () => {
    const s = podStats([A, B, C, IDLE], "Curator X", true);
    expect(s.active).toBe(3);
    expect(s.sum).toEqual({ trades: 20, wins: 10, losses: 10, winRate: 0.5, net: 400 });
    expect(s.median).toEqual({ trades: 6, winRate: 0.5, avgR: 0.25, net: 100 });
    expect(s.members.find((r) => r.trader === "Synth A")).toMatchObject({ winRate: 0.6, avgR: 0.5, net: 500 });
    expect(s.members.find((r) => r.trader === "Synth D")).toMatchObject({ trades: 0, winRate: null, avgR: null });
  });

  it("median of an even count is the mean of the middle two", () => {
    expect(median([4, 1, 3, 10])).toBe(3.5);
    expect(median([])).toBeNull();
  });
});

describe("pod stats: privacy", () => {
  it("a trader sees his own $, not the other members' (counts, win rate and R stay)", () => {
    const s = podStats([A, B, C], "Synth B", false);
    expect(s.members.find((r) => r.trader === "Synth B")?.net).toBe(-200);
    expect(s.members.find((r) => r.trader === "Synth A")).toMatchObject({ net: null, trades: 10, winRate: 0.6, avgR: 0.5 });
    expect(s.median.net).toBeNull(); // the median of a few values is one member's result
    expect(s.median.avgR).toBe(0.25);
  });

  it("the $ sum needs three active members for a trader; staff always see it", () => {
    expect(podStats([A, B, C], "Synth B", false)).toMatchObject({ netVisible: true, sum: { net: 400 } });
    const two = podStats([A, B, IDLE], "Synth B", false);
    expect(two.netVisible).toBe(false);
    expect(two.sum.net).toBeNull(); // own −200 + the sum would give A's +500 away
    expect(two.sum.trades).toBe(14);
    expect(podStats([A, B], "Curator X", true)).toMatchObject({ netVisible: true, sum: { net: 300 }, median: { net: 150 } });
  });
});
