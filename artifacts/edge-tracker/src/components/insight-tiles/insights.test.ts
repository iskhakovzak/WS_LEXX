import { describe, expect, it } from "vitest";
import { clientEdgeMap, ruleForSlice, sliceNet } from "./edge-map";
import {
  afterInsight, breakEvenRate, edgeMargin, feesInsight, holdInsight, seqInsight, streakInsight, todayInsight, weekdayInsight,
} from "./insights";
import type { InsightTrade } from "./model";

let nextId = 1;
/** A closed intraday trade; `pnl` gross, fees 0 unless given; `sec` = NY entry second. */
function tr(day: string, pnl: number, o: Partial<InsightTrade> & { sec?: number } = {}): InsightTrade {
  const { sec, ...rest } = o;
  return {
    id: nextId++, ticker: "AAPL", date: day, result: pnl > 0 ? "win" : pnl < 0 ? "loss" : "be",
    pnl, fees: 0, entrySec: sec ?? 34_200 + nextId, holdSec: 60, qty: 100, entry: 25, ...rest,
  };
}
/** Trading days 2026-08-03… (weekdays only). */
function days(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 7, 3));
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("streakInsight", () => {
  it("names the current run, its start day and what it is worth (break-even inside counted)", () => {
    const list = [tr("2026-10-20", -50), tr("2026-10-21", 40), tr("2026-10-21", 0), tr("2026-10-22", 60), tr("2026-10-22", 25)];
    const s = streakInsight(list, 0);
    expect(s.current).toEqual({ type: "win", count: 3 });
    expect(s.worth).toBe(125);
    expect(s.since).toBe("2026-10-21");
    expect(s.ids).toEqual([list[1].id, list[2].id, list[3].id, list[4].id]);
  });
});

describe("seqInsight — the costly trade number, its baseline gap, interval, trend and rule", () => {
  const book = (worst: number) => days(20).flatMap((d) => [
    tr(d, 60, { daySeq: 1 }), tr(d, 30, { daySeq: 2 }), tr(d, 10, { daySeq: 3 }), tr(d, worst + ((d.charCodeAt(9) % 3) - 1) * 4, { daySeq: 4 }),
  ]);
  it("a steady loser on №4–5 is a solid leak with a «max 3 trades» rule", () => {
    const s = seqInsight(book(-25));
    expect(s.enough).toBe(true);
    expect(s.worst?.key).toBe("4-5");
    expect(s.worst!.net).toBeLessThan(0);
    // baseline = (60 + 30 + 10 − 25) / 4 ≈ 18.75 → №4–5 averages ≈ −25: about $44 worse than the average trade.
    expect(s.worst!.vsBaseline).toBeCloseTo(s.worst!.avg - s.baseline!, 1);
    expect(s.claim.confidence).toBe("solid");
    expect(s.claim.ci!.hi).toBeLessThan(0);
    expect(s.rule).toEqual({ type: "maxTradesPerDay", n: 3 });
  });
  it("trend: the same bucket in the previous period", () => {
    const s = seqInsight(book(-25), book(-40));
    expect(s.trend?.dir).toBe("better");
    expect(s.trend!.delta).toBeGreaterThan(0);
  });
  it("under the floor: not enough, no claim", () => {
    const s = seqInsight([tr("2026-10-21", 10, { daySeq: 1 }), tr("2026-10-21", -10, { daySeq: 2 })]);
    expect(s.enough).toBe(false);
  });
});

describe("afterInsight", () => {
  it("tilt: win rate after a loss far below after a win → negative gap, pause rule", () => {
    // Each day: W, W (after win: W), L, L (after loss: L), W (after loss: W) → after win 1/2? build explicitly.
    const list = days(15).flatMap((d) => {
      const s = (i: number) => 34_200 + i * 60;
      return [tr(d, 50, { sec: s(0) }), tr(d, 50, { sec: s(1) }), tr(d, 50, { sec: s(2) }), tr(d, -50, { sec: s(3) }), tr(d, -50, { sec: s(4) }), tr(d, -50, { sec: s(5) })];
    });
    const a = afterInsight(list);
    // after-win: W, W, L → 2/3; after-loss: L, L → 0.
    expect(a.afterWin.winRate).toBeCloseTo(2 / 3);
    expect(a.afterLoss.winRate).toBe(0);
    expect(a.verdict).toBe("tilt");
    expect(a.claim.confidence).toBe("solid");
    expect(a.rule).toEqual({ type: "afterLoss", minutes: 30 });
  });
  it("too few after-loss trades → low confidence, no verdict", () => {
    const a = afterInsight([tr("2026-10-21", 50, { sec: 1 }), tr("2026-10-21", -50, { sec: 2 }), tr("2026-10-21", 50, { sec: 3 })]);
    expect(a.verdict).toBeNull();
    expect(a.claim.confidence).toBe("low");
  });
});

describe("holdInsight", () => {
  it("losers held 3× longer → bad, cut-winners-early hint, longest loser example", () => {
    const list = days(12).flatMap((d, i) => [tr(d, 40, { holdSec: 60 + i }), tr(d, -40, { holdSec: 180 + i * 3 })]);
    const h = holdInsight(list);
    expect(h.enough).toBe(true);
    expect(h.ratio).toBeGreaterThan(2.5);
    expect(h.verdict).toBe("bad");
    expect(h.cutEarly).toBe(true);
    expect(h.claim.confidence).toBe("solid");
    expect(h.longestLoser?.hold).toBe(180 + 11 * 3);
  });
});

describe("weekdayInsight", () => {
  it("names the worst weekday with its interval", () => {
    const list = days(25).flatMap((d) => {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      return [tr(d, dow === 3 ? -60 : 30), tr(d, dow === 3 ? -20 : 15)];
    });
    const w = weekdayInsight(list);
    expect(w.enough).toBe(true);
    expect(w.worst?.key).toBe("3");
    expect(w.claim.confidence).toBe("solid");
  });
});

describe("fees", () => {
  it("break-even win rate = |L| / (W + |L|)", () => {
    expect(breakEvenRate(30, -10)).toBeCloseTo(0.25);
    expect(breakEvenRate(null, -10)).toBeNull();
    expect(edgeMargin([{ net: 30 }, { net: -10 }])).toBeCloseTo(0.5 - 0.25);
  });
  it("fee share, per-share figures, margin and the trades fees turned red", () => {
    const list = days(20).flatMap((d) => [tr(d, 40, { fees: 6, qty: 200 }), tr(d, -20, { fees: 6, qty: 200 }), tr(d, 4, { fees: 6, qty: 200 })]);
    const f = feesInsight(list);
    expect(f.gross).toBe(20 * 24);
    expect(f.fees).toBe(20 * 18);
    expect(f.feeShare).toBeCloseTo(18 / 24);
    expect(f.feePerShare).toBeCloseTo(0.03);
    expect(f.grossPerShare).toBeCloseTo(24 / 600);
    expect(f.eaten.count).toBe(20);
    // net: +34, −26, −2 → win rate 1/3, BE = 14 / (34 + 14) ≈ 0.29 → margin ≈ +4 pp.
    expect(f.margin).toBeCloseTo(1 / 3 - 14 / 48, 5);
    // gross: +40, −20, +4 → win rate 2/3, BE = 20 / 42 → the fees take ≈ 15 pp of the margin.
    expect(f.marginGross).toBeCloseTo(2 / 3 - 20 / 42, 5);
  });
});

describe("todayInsight", () => {
  it("cumulative series of today, average of the other days, share of days beaten", () => {
    const list = [tr("2026-10-20", 10), tr("2026-10-21", -30), tr("2026-10-22", 20, { sec: 1 }), tr("2026-10-22", 5, { sec: 2 })];
    const t = todayInsight(list, "2026-10-22");
    expect(t.series).toEqual([0, 20, 25]);
    expect(t.net).toBe(25);
    expect(t.avgDay).toBe(-10);
    expect(t.beat).toBe(1);
  });
});

describe("edge map", () => {
  const list = days(20).flatMap((d) => [
    tr(d, 50, { sec: 34_500, entry: 30, daySeq: 1, prevKind: "first" }),
    tr(d, -45, { sec: 35_500, entry: 3, daySeq: 2, prevKind: "after-win" }),
    tr(d, 20, { sec: 46_000, entry: 30, daySeq: 3, prevKind: "after-loss" }),
  ]);
  it("finds the leak (sub-$5 stocks) and the strength with solid intervals", () => {
    const m = clientEdgeMap(list);
    expect(m.total.trades).toBe(60);
    const leak = m.leaks[0];
    expect(leak.confidence).toBe("solid");
    expect(leak.net).toBe(-900);
    expect(["price", "seq", "times", "prev"]).toContain(leak.dim);
    expect(leak.vsBaseline).toBeCloseTo(-45 - 25 / 3, 1);
    expect(m.strengths[0].net).toBeGreaterThan(0);
    expect(m.tested).toBeGreaterThan(3);
  });
  it("skips unknown keys and slices that are the whole book", () => {
    const m = clientEdgeMap(list.map((t) => ({ ...t, strategy: "Day" })));
    expect([...m.leaks, ...m.strengths].some((s) => s.dim === "strategies")).toBe(false);
  });
  it("prev-period net of a slice", () => {
    expect(sliceNet(list, "price", "lt5")).toEqual({ trades: 20, net: -900 });
  });
  it("maps a slice to a What-if rule when the simulator has one", () => {
    expect(ruleForSlice({ dim: "seq", key: "4-5" })).toEqual({ type: "maxTradesPerDay", n: 3 });
    expect(ruleForSlice({ dim: "seq", key: "1" })).toBeNull();
    expect(ruleForSlice({ dim: "times", key: "9:30-9:50" })).toEqual({ type: "timeWindow", from: "09:50", to: null });
    expect(ruleForSlice({ dim: "times", key: "15:30-16:00" })).toEqual({ type: "timeWindow", from: null, to: "15:30" });
    expect(ruleForSlice({ dim: "times", key: "11:15-13:30" })).toBeNull();
    expect(ruleForSlice({ dim: "price", key: "lt5" })).toEqual({ type: "priceRange", min: 5, max: null });
    expect(ruleForSlice({ dim: "prev", key: "after-loss" })).toEqual({ type: "afterLoss", minutes: 30 });
    expect(ruleForSlice({ dim: "strategies", key: "MOC" })).toEqual({ type: "excludeImx" });
  });
});
