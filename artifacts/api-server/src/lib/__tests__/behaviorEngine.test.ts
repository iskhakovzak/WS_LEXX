/**
 * Behaviour engine ordering (ROMAN-01): trades entered in the same second are one decision (opening-auction batches),
 * so the in-batch order by id never creates fatigue / overtrading / martingale / tilt flags, and a size-up only counts
 * after a loss that was already closed when the bigger trade went in.
 */
import { describe, expect, it } from "vitest";
import { analyzeBehavior, entryRanks, groupByDay, lastClosedBefore, type BehaviorTrade } from "../behaviorEngine";
import { evaluateTrigger } from "../behaviorTriggers";

/** Trade on `date` entered at NY 09:30 + `inMin` (EDT, 13:30Z), held `holdMin` minutes. */
function bt(id: number, date: string, inMin: number, holdMin: number, net: number, qty = 100, entry = 10, ticker = "AAA"): BehaviorTrade {
  const [y, m, d] = date.split("-").map(Number);
  const entryAt = Date.UTC(y!, m! - 1, d!, 13, 30) + inMin * 60000;
  return {
    id, ticker, date, side: "long", result: net > 0 ? "win" : net < 0 ? "loss" : "be", net, gross: net, qty, entry,
    entryAt, exitAt: entryAt + holdMin * 60000, entryMin: 570 + inMin, holdMin, horizon: "intraday", setup: null,
  };
}

/** Four quiet days of 2 trades each: median 2 trades/day → fatigue cut = 2. */
const quietDays = (): BehaviorTrade[] => ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].flatMap((d, k) => [
  bt(100 + k * 2, d, 10, 5, 20), bt(101 + k * 2, d, 60, 5, -10),
]);

/** 9 trades all entered at 09:30:00, closed at different times, losses first and growing sizes (by id). */
const auctionBatch = (): BehaviorTrade[] => [
  bt(1, "2026-10-09", 0, 3, -40, 100, 10, "MRVL"),
  bt(2, "2026-10-09", 0, 4, -30, 400, 20, "INTC"),
  bt(3, "2026-10-09", 0, 5, -25, 900, 30, "PLUG"),
  bt(4, "2026-10-09", 0, 6, -20, 2000, 40, "RGTI"),
  bt(5, "2026-10-09", 0, 7, 15, 3000, 50, "NIO"),
  bt(6, "2026-10-09", 0, 8, -12, 5000, 60, "AAL"),
  bt(7, "2026-10-09", 0, 9, 30, 6000, 70, "NVDA"),
  bt(8, "2026-10-09", 0, 10, -8, 8000, 80, "ACHR"),
  bt(9, "2026-10-09", 0, 11, 22, 9000, 90, "AMD"),
];

const flaggedIds = (rep: ReturnType<typeof analyzeBehavior>, key: string) => {
  const p = rep.patterns.find((x) => x.key === key)!;
  return p.tradeIds;
};

describe("behaviour engine — one entry second = one decision", () => {
  it("9 trades at 09:30:00 → no fatigue, martingale, overtrading or tilt", () => {
    const batch = auctionBatch();
    const rep = analyzeBehavior([...quietDays(), ...batch]);
    expect(rep.summary.medianTradesPerDay).toBe(2);
    const batchIds = new Set(batch.map((t) => t.id));
    for (const key of ["fatigue", "martingale", "overtrading", "tilt", "revenge"]) {
      expect(flaggedIds(rep, key).filter((id) => batchIds.has(id)), key).toEqual([]);
    }
    // All 9 are the first decision of the day.
    expect(flaggedIds(rep, "firstTrade").filter((id) => batchIds.has(id)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rep.byTradeNumber.find((b) => b.key === "1")!.n).toBe(4 + 9);
  });

  it("ranks: a batch shares the number of its first trade", () => {
    const day = groupByDay([...auctionBatch(), bt(20, "2026-10-09", 30, 1, 5), bt(21, "2026-10-09", 31, 1, 5)]).get("2026-10-09")!;
    expect(entryRanks(day)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 10, 11]);
  });

  it("fatigue still flags real late decisions", () => {
    const day = [bt(30, "2026-10-09", 0, 1, 10), bt(31, "2026-10-09", 10, 1, 10), bt(32, "2026-10-09", 20, 1, -10), bt(33, "2026-10-09", 30, 1, -10)];
    const rep = analyzeBehavior([...quietDays(), ...day]);
    expect(flaggedIds(rep, "fatigue").sort((a, b) => a - b)).toEqual([32, 33]);
  });
});

describe("behaviour engine — profile", () => {
  it("worst hour = the weakest eligible hour even when every hour is green (MAKSIM-16)", () => {
    const trades: BehaviorTrade[] = [];
    let id = 1;
    for (let d = 1; d <= 9; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      trades.push(bt(id++, date, 35, 2, 10), bt(id++, date, 95, 2, 3)); // 10:05 strong, 11:05 weak but green
    }
    const rep = analyzeBehavior(trades);
    expect(rep.profile.hours.best?.label).toBe("10");
    expect(rep.profile.hours.worst?.label).toBe("11");
    expect(rep.profile.hours.worst?.net).toBeGreaterThan(0);
  });
});

describe("behaviour engine — martingale needs a closed loss", () => {
  it("bigger trade after a closed loss is flagged, after a still-open loss is not", () => {
    const closed = [bt(40, "2026-10-09", 0, 5, -50, 100, 10, "MRVL"), bt(41, "2026-10-09", 10, 5, -10, 600, 10, "INTC")];
    const open = [bt(50, "2026-10-12", 0, 30, -50, 100, 10, "MRVL"), bt(51, "2026-10-12", 10, 5, -10, 600, 10, "INTC")];
    const rep = analyzeBehavior([...quietDays(), ...closed, ...open]);
    expect(flaggedIds(rep, "martingale")).toEqual([41]);
  });

  it("the reference loss is the trade closed last before the entry, not the previous entry", () => {
    // 41 entered 09:31 and still open at 09:40; 40 (loss) closed 09:35 → 42 compares to 40.
    const day = [bt(40, "2026-10-09", 0, 5, -50, 100, 10), bt(41, "2026-10-09", 1, 60, 30, 100, 10), bt(42, "2026-10-09", 10, 5, -5, 300, 10)];
    const sorted = groupByDay(day).get("2026-10-09")!;
    expect(lastClosedBefore(sorted, 2)?.id).toBe(40);
    expect(lastClosedBefore(sorted, 1)).toBeNull();
  });

  it("a sized-up batch after one loss is one chain step", () => {
    const day = [bt(60, "2026-10-09", 0, 5, -50, 100, 10), bt(61, "2026-10-09", 10, 5, -5, 300, 10, "B"), bt(62, "2026-10-09", 10, 5, -5, 400, 10, "C")];
    const rep = analyzeBehavior([...quietDays(), ...day]);
    const p = rep.patterns.find((x) => x.key === "martingale")!;
    expect(p.tradeIds.sort((a, b) => a - b)).toEqual([61, 62]);
    expect(p.extra).toMatchObject({ chains: 1, longestChain: 1 });
  });

  it("size_up_after_loss trigger uses the same rule", () => {
    const byDay = groupByDay(auctionBatch());
    expect(evaluateTrigger("size_up_after_loss", { ratio: 1.3 }, byDay).fires).toBe(0);
    const ok = groupByDay([bt(40, "2026-10-09", 0, 5, -50, 100, 10), bt(41, "2026-10-09", 10, 5, -10, 600, 10)]);
    expect(evaluateTrigger("size_up_after_loss", { ratio: 1.3 }, ok).tradeIds).toEqual([41]);
  });
});
