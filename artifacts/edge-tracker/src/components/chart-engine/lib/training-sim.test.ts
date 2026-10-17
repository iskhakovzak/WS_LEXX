import { describe, expect, it } from "vitest";
import {
  EMPTY_SIM, historyStats, idealMove, parseHistory, scoreTraining, simApplyBar, simMark, simOrder, simSetStop, stopInvalid, suggestStop, trainingVerdict, winStreak,
  type TrainingRecord,
} from "./training-sim";
import { buildTradeSummary, fmtPerShare } from "./trade-summary";

describe("training simulator — orders", () => {
  it("opens, adds and closes a long with realised P&L", () => {
    let s = simOrder(EMPTY_SIM, { action: "buy", idx: 1, t: 1, price: 10, qty: 100, stop: 9.8 });
    expect(s.pos).toBe(100);
    expect(s.avg).toBe(10);
    expect(s.stop).toBe(9.8);
    expect(s.firstRiskUsd).toBeCloseTo(20);
    s = simOrder(s, { action: "buy", idx: 2, t: 2, price: 10.2, qty: 100 });
    expect(s.pos).toBe(200);
    expect(s.avg).toBeCloseTo(10.1);
    expect(s.stop).toBe(9.8); // adding without a stop keeps the stop
    s = simOrder(s, { action: "flat", idx: 3, t: 3, price: 10.5 });
    expect(s.pos).toBe(0);
    expect(s.avg).toBeNull();
    expect(s.stop).toBeNull();
    expect(s.realized).toBeCloseTo(80); // 200 × 0.40
    expect(s.roundTrips).toBe(1);
    expect(s.maxAbs).toBe(200);
  });

  it("shorts and covers; a bigger opposite order reverses", () => {
    let s = simOrder(EMPTY_SIM, { action: "sell", idx: 1, t: 1, price: 20, qty: 50 });
    expect(s.pos).toBe(-50);
    s = simOrder(s, { action: "buy", idx: 2, t: 2, price: 19.5, qty: 80 });
    expect(s.realized).toBeCloseTo(25);
    expect(s.pos).toBe(30);
    expect(s.avg).toBe(19.5);
    expect(simMark(s, 20).total).toBeCloseTo(25 + 15);
  });

  it("ignores empty orders and a stop on the wrong side", () => {
    expect(simOrder(EMPTY_SIM, { action: "buy", idx: 1, t: 1, price: 10, qty: 0 })).toBe(EMPTY_SIM);
    expect(simOrder(EMPTY_SIM, { action: "flat", idx: 1, t: 1, price: 10 })).toBe(EMPTY_SIM);
    const s = simOrder(EMPTY_SIM, { action: "buy", idx: 1, t: 1, price: 10, qty: 10, stop: 10.5 });
    expect(s.stop).toBeNull();
    expect(stopInvalid(1, 10, 10.5)).toBe(true);
    expect(stopInvalid(-1, 10, 10.5)).toBe(false);
    expect(simSetStop(s, 10.2, 10)).toBe(s);
    expect(simSetStop(s, 9.5, 10).stop).toBe(9.5);
  });

  it("triggers the stop on a later bar, at the stop or the gap open", () => {
    const s = simOrder(EMPTY_SIM, { action: "buy", idx: 1, t: 1, price: 10, qty: 100, stop: 9.8 });
    expect(simApplyBar(s, { t: 2, o: 9.95, h: 10, l: 9.85 }, 2)).toBe(s);
    const hit = simApplyBar(s, { t: 3, o: 9.9, h: 9.95, l: 9.7 }, 3);
    expect(hit.pos).toBe(0);
    expect(hit.realized).toBeCloseTo(-20);
    expect(hit.fills.at(-1)?.reason).toBe("stop");
    const gap = simApplyBar(s, { t: 3, o: 9.6, h: 9.7, l: 9.5 }, 3);
    expect(gap.realized).toBeCloseTo(-40);
    const short = simOrder(EMPTY_SIM, { action: "sell", idx: 1, t: 1, price: 10, qty: 10, stop: 10.3 });
    expect(simApplyBar(short, { t: 2, o: 10.1, h: 10.4, l: 10 }, 2).realized).toBeCloseTo(-3);
  });
});

describe("training simulator — ideal and score", () => {
  const closes = [10, 9.5, 10.5, 11, 10.2, 9, 9.4];

  it("finds the best single round trip either way", () => {
    expect(idealMove(closes, 0, 6)).toEqual({ perShare: 2, side: "short", fromIdx: 3, toIdx: 5 });
    expect(idealMove(closes, 0, 3)).toEqual({ perShare: 1.5, side: "long", fromIdx: 1, toIdx: 3 });
    expect(idealMove([5, 5, 5], 0, 2)).toBeNull();
    expect(idealMove(closes, 3, 3)).toBeNull();
  });

  it("scores the captured share of the ideal and compares with the real trade", () => {
    let s = simOrder(EMPTY_SIM, { action: "buy", idx: 1, t: 1, price: 9.5, qty: 100, stop: 9.0 });
    s = simOrder(s, { action: "flat", idx: 3, t: 3, price: 10.7 });
    const o = scoreTraining(s, { lastClose: 10.7, ideal: idealMove(closes, 0, 3), real: { side: "long", avgEntry: 9.6, avgExit: 10.1, risk: 0.3 } });
    expect(o.pnlUsd).toBeCloseTo(120);
    expect(o.perShare).toBeCloseTo(1.2);
    expect(o.r).toBeCloseTo(120 / 50);
    expect(o.score).toBe(80);
    expect(o.realPerShare).toBeCloseTo(0.5);
    expect(o.realR).toBeCloseTo(0.5 / 0.3);
    expect(o.vsRealPerShare).toBeCloseTo(0.7);
    expect(o.trades).toBe(1);
    expect(trainingVerdict(o).tone).toBe("up");
  });

  it("marks an open paper position, scores losses as 0 and handles no trades", () => {
    const open = simOrder(EMPTY_SIM, { action: "sell", idx: 1, t: 1, price: 10, qty: 10 });
    const o = scoreTraining(open, { lastClose: 10.5, ideal: { perShare: 1, side: "long", fromIdx: 0, toIdx: 2 }, real: { side: "short", avgEntry: null, avgExit: null, risk: null } });
    expect(o.pnlUsd).toBeCloseTo(-5);
    expect(o.score).toBe(0);
    expect(o.r).toBeNull();
    expect(o.realPerShare).toBeNull();
    expect(trainingVerdict(o).tone).toBe("down");
    const none = scoreTraining(EMPTY_SIM, { lastClose: 10, ideal: null, real: { side: "long", avgEntry: 10, avgExit: 11, risk: null } });
    expect(none.trades).toBe(0);
    expect(none.score).toBeNull();
    expect(none.perShare).toBeNull();
    expect(trainingVerdict(none).tone).toBe("neutral");
  });

  it("suggests a stop beyond the recent extreme", () => {
    const bars = [{ h: 10.2, l: 9.9 }, { h: 10.3, l: 9.95 }, { h: 10.4, l: 10.1 }];
    expect(suggestStop(bars, 2, 1, 3)).toBeCloseTo(9.89);
    expect(suggestStop(bars, 2, -1, 2)).toBeCloseTo(10.41);
    expect(suggestStop(bars, 5, 1)).toBeNull();
  });
});

describe("training history", () => {
  const rec = (pnlUsd: number, score: number | null, trades = 1, vs: number | null = null): TrainingRecord => ({ at: 1, tradeId: 1, ticker: "X", day: "2026-10-15", score, pnlUsd, r: null, perShare: null, vsRealPerShare: vs, trades });

  it("parses defensively", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{bad")).toEqual([]);
    expect(parseHistory(JSON.stringify([rec(1, 50), { junk: true }]))).toHaveLength(1);
  });

  it("counts the streak from the newest attempt and averages", () => {
    const list = [rec(10, 80, 1, 0.1), rec(5, 40), rec(-3, 0), rec(20, 90)];
    expect(winStreak(list)).toBe(2);
    const st = historyStats(list);
    expect(st.count).toBe(4);
    expect(st.avgScore).toBe(53);
    expect(st.plusShare).toBe(0.75);
    expect(st.beatReal).toBe(1);
    expect(winStreak([rec(0, null, 0), rec(5, 50)])).toBe(0);
  });
});

describe("trade summary", () => {
  it("derives per-share, R, capture and left on the table from prices", () => {
    const s = buildTradeSummary({
      side: "short", avgEntry: 20, avgExit: 19.6, risk: 0.2,
      excursion: { mfe: 0.8, mae: 0.1, mfeUsd: null, maeUsd: null, mfePct: null, maePct: null, mfeR: null, maeR: null, mfeAt: 500, maeAt: 400, mfePrice: 19.2, maePrice: 20.1, approximate: false, barsUsed: 10 },
      entryTime: 100, exitTime: 700, pnlUsd: null,
    });
    expect(s.perShare).toBeCloseTo(0.4);
    expect(s.pct).toBeCloseTo(2);
    expect(s.r).toBeCloseTo(2);
    expect(s.mfeR).toBeCloseTo(4);
    expect(s.maeR).toBeCloseTo(0.5);
    expect(s.capture).toBeCloseTo(0.5);
    expect(s.leftPerShare).toBeCloseTo(0.4);
    expect(s.bestExitPrice).toBe(19.2);
    expect(s.holdSec).toBe(600);
    expect(s.pnlUsd).toBeNull();
  });

  it("formats per-share moves in cents below a dollar", () => {
    expect(fmtPerShare(0.123)).toBe("+12¢");
    expect(fmtPerShare(-0.05)).toBe("−5.0¢");
    expect(fmtPerShare(1.5)).toBe("+$1.50");
    expect(fmtPerShare(null)).toBe("—");
  });
});
