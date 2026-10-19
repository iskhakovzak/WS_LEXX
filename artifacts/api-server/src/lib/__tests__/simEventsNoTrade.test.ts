/**
 * «Тренажёр 2» pure rules: event detection for the «jump to event» step (causal), the «Не торгую» verdict and the
 * series state builder.
 */
import { describe, expect, it } from "vitest";
import type { SimBar } from "../sim/engine";
import { findEvent } from "../sim/events";
import { noTradeVerdict, windowEndOf } from "../sim/noTrade";
import { stateOf, type SeriesRow } from "../sim/seriesStore";
import { aggregate, buildIntraday, displayTfsOf, intradaySpecOf } from "../sim/scenario";
import { fakeDailyTimes, contextOf } from "../sim/context";

const ny = (date: string, min: number) => Date.parse(`${date}T${String(Math.floor(min / 60) + 4).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00Z`) / 1000;
const DAY = "2026-10-16";
/** Flat 1m bars at `px` (tiny range) from `from` to `to` minutes of DAY. */
function flat(from: number, to: number, px: number, v = 1000): SimBar[] {
  const out: SimBar[] = [];
  for (let m = from; m < to; m++) out.push({ t: ny(DAY, m), o: px, h: px + 0.02, l: px - 0.02, c: px, v });
  return out;
}
const NO_LEVELS = { pdh: null, pdl: null, pdc: null, pmh: null, pml: null };

describe("events (jump to the next event)", () => {
  // 30 premarket bars at 10, then the session.
  const pre = flat(540, 570, 10);
  it("a premarket-high break on the open fires pmh up at that bar", () => {
    const rth = flat(570, 600, 10);
    rth[3] = { ...rth[3], h: 10.6, c: 10.5 };
    const bars = [...pre, ...rth];
    const ev = findEvent(bars, { ...NO_LEVELS, pmh: 10.3 }, 60, 30, bars.length - 1);
    expect(ev).toEqual({ kind: "pmh", dir: "up", idx: 33, level: 10.3 });
  });

  it("no whipsaw: a level crossed back right away does not fire again until 5 minutes on one side", () => {
    const rth = flat(570, 610, 10.5);
    rth[0] = { ...rth[0], o: 10.5, h: 10.52, l: 10.2, c: 10.25 }; // pml 10.3 broken down
    rth[1] = { ...rth[1], o: 10.25, h: 10.45, l: 10.24, c: 10.4 }; // straight back up: no event
    for (let i = 2; i < 40; i++) rth[i] = { ...rth[i], o: 10.4, h: 10.42, l: 10.38, c: 10.4 };
    rth[12] = { ...rth[12], l: 10.25, c: 10.28 }; // after 10 minutes above: may fire down again
    const bars = [...flat(540, 570, 10.5), ...rth];
    const lv = { ...NO_LEVELS, pml: 10.3 };
    expect(findEvent(bars, lv, 60, 30, bars.length - 1)).toMatchObject({ kind: "pml", dir: "down", idx: 30 });
    expect(findEvent(bars, lv, 60, 31, bars.length - 1)).toMatchObject({ kind: "pml", dir: "down", idx: 42 });
  });

  it("is causal: the event found does not change when later bars change", () => {
    const rth = flat(570, 640, 10);
    rth[20] = { ...rth[20], v: 10_000 };
    const a = findEvent([...pre, ...rth], NO_LEVELS, 60, 30, 99);
    const later = rth.map((b, i) => (i > 20 ? { ...b, h: b.h + 5, v: 99_999 } : b));
    const b = findEvent([...pre, ...later], NO_LEVELS, 60, 30, 99);
    expect(a).toEqual({ kind: "volume", dir: "up", idx: 50, level: null });
    expect(b).toEqual(a);
  });

  it("a volume spike needs 20 bars of session history; the search window is respected", () => {
    const rth = flat(570, 640, 10);
    rth[5] = { ...rth[5], v: 50_000 }; // only 5 session bars before it (premarket is not history)
    rth[40] = { ...rth[40], v: 50_000 };
    const bars = [...pre, ...rth];
    expect(findEvent(bars, NO_LEVELS, 60, 30, bars.length - 1)?.idx).toBe(70);
    expect(findEvent(bars, NO_LEVELS, 60, 30, 60)).toBeNull();
  });

  it("a new high of day fires only when the old high had stood 15 minutes", () => {
    const rth = flat(570, 620, 10);
    rth[0] = { ...rth[0], h: 10.2 };
    rth[5] = { ...rth[5], h: 10.25 }; // 5 min later: too young, no event
    rth[25] = { ...rth[25], h: 10.4, c: 10.35 }; // 20 min after the last high
    const ev = findEvent([...pre, ...rth], NO_LEVELS, 60, 31, 79);
    expect(ev).toMatchObject({ kind: "hod", dir: "up", idx: 55, level: 10.25 });
  });

  it("a VWAP cross after ≥ 5 minutes on the other side", () => {
    const rth = flat(570, 600, 10);
    for (let i = 0; i < 9; i++) rth[i] = { ...rth[i], c: 9.99 }; // below VWAP for 9 minutes
    for (let i = 10; i < 30; i++) rth[i] = { ...rth[i], o: 10.1, h: 10.12, l: 10.08, c: 10.1 };
    rth[9] = { ...rth[9], o: 10, h: 10.12, c: 10.1 };
    const ev = findEvent([...pre, ...rth], NO_LEVELS, 60, 31, 59);
    expect(ev).toMatchObject({ kind: "vwap", dir: "up", idx: 39 });
  });

  it("nothing in the window → null", () => {
    const bars = [...pre, ...flat(570, 600, 10)];
    expect(findEvent(bars, NO_LEVELS, 60, 30, bars.length - 1)).toBeNull();
  });
});

describe("no-trade verdict", () => {
  const rising = (n: number, step: number): SimBar[] => Array.from({ length: n }, (_, i) => {
    const o = 10 + i * step, c = o + step;
    return { t: i, o, h: Math.max(o, c) + 0.01, l: Math.min(o, c) - 0.01, c, v: 1 };
  });

  it("a quiet tape: no side reached 1.5R → correct", () => {
    const bars = flat(570, 640, 10);
    const v = noTradeVerdict(bars, 0, 60, 0.5);
    expect(v).toMatchObject({ correct: true, reasonKey: "noTrade.correct", missed: null });
    expect(v.bestR).toBeLessThan(1.5);
  });

  it("a clean trend up: missed long, with the move to show", () => {
    const v = noTradeVerdict(rising(40, 0.05), 0, 39, 0.5);
    expect(v.correct).toBe(false);
    expect(v.reasonKey).toBe("noTrade.missedLong");
    expect(v.bestR).toBeGreaterThanOrEqual(1.5);
    expect(v.missed).toMatchObject({ side: "long", fromIdx: 0 });
    expect(v.missed!.extreme).toBeGreaterThan(v.missed!.entry);
  });

  it("a trend down: missed short", () => {
    expect(noTradeVerdict(rising(40, -0.05), 0, 39, 0.5).reasonKey).toBe("noTrade.missedShort");
  });

  it("a move that only comes after a 1R adverse move does not count", () => {
    // Long side: down 1R first (stopped), then up 3R. Short side: the down move is only 1R.
    const bars: SimBar[] = [
      { t: 0, o: 10, h: 10, l: 10, c: 10, v: 1 },
      { t: 1, o: 10, h: 10.05, l: 9.45, c: 9.5, v: 1 },
      { t: 2, o: 9.5, h: 11.5, l: 9.5, c: 11.5, v: 1 },
    ];
    const v = noTradeVerdict(bars, 0, 2, 0.5);
    expect(v.correct).toBe(true);
    expect(v.bestR).toBe(1.1);
  });

  it("window: 60 minutes of base bars intraday, 20 bars swing, capped at the game end", () => {
    expect(windowEndOf(100, 1000, 60, false)).toBe(160);
    expect(windowEndOf(100, 1000, 300, false)).toBe(112);
    expect(windowEndOf(100, 130, 60, false)).toBe(130);
    expect(windowEndOf(100, 1000, 86400, true)).toBe(120);
  });
});

describe("series state", () => {
  const row: SeriesRow = { id: 7, userId: 1, mode: "intraday", difficulty: "medium", tf: null, size: 4, idx: 2, status: "active" };
  it("results follow the dealt games in order; the prepared one is not a result", () => {
    const st = stateOf(row, [
      { id: 11, index: 0, status: "finished", r: 1.234, trades: 2, correct: null },
      { id: 12, index: 1, status: "skipped", r: 0, trades: 0, correct: null },
      { id: 13, index: 2, status: "finished", r: 0, trades: 0, correct: true },
      { id: 14, index: 3, status: "prepared", r: 0, trades: 0, correct: null },
    ]);
    expect(st.tf).toBe("1m");
    expect(st.currentGameId).toBe(13);
    expect(st.results).toEqual([
      { gameId: 11, outcome: "traded", r: 1.23, correct: null },
      { gameId: 12, outcome: "skipped", r: null, correct: null },
      { gameId: 13, outcome: "no_trade", r: 0, correct: true },
    ]);
    expect(st.totals).toEqual({ traded: 1, noTrade: 1, skipped: 1, netR: 1.23, correctNoTrade: 1 });
  });

  it("the game being played is the current one, not a result; a finished series has no current game", () => {
    const st = stateOf({ ...row, idx: 0 }, [{ id: 11, index: 0, status: "active", r: 0, trades: 0, correct: null }]);
    expect(st.results).toEqual([]);
    expect(st.currentGameId).toBe(11);
    expect(stateOf({ ...row, status: "finished" }, []).currentGameId).toBeNull();
  });
});

describe("base series and context", () => {
  it("displayTfs follow the base timeframe", () => {
    expect(displayTfsOf("1m")).toEqual(["1m", "2m", "5m", "15m"]);
    expect(displayTfsOf("5m")).toEqual(["5m", "15m", "30m"]);
    expect(displayTfsOf("1d")).toEqual(["1d"]);
  });

  it("a 5m level stored on 1m bars: the same session window, the risk unit judged on 5m bars", () => {
    const dayBars = [...flat(240, 570, 10), ...flat(570, 960, 10)].map((b, i) => ({ ...b, h: b.h + (i % 7) * 0.01, c: b.c + (i % 3) * 0.01 }));
    const spec = intradaySpecOf("easy", "5m");
    const on1m = buildIntraday({ day: DAY, dayBars, prevBars: [], prevLevels: null, spec, baseTf: "1m" })!;
    const on5m = buildIntraday({ day: DAY, dayBars, prevBars: [], prevLevels: null, spec })!;
    expect(on1m.endIdx - on1m.startIdx).toBe(390);
    expect(on5m.endIdx - on5m.startIdx).toBe(78);
    expect(on1m.riskUnit).toBe(on5m.riskUnit);
    expect(aggregate(on1m.bars.slice(on1m.startIdx + 1), 300)).toHaveLength(78);
    // A base coarser than the display tf is refused.
    expect(buildIntraday({ day: DAY, dayBars: aggregate(dayBars, 300), prevBars: [], prevLevels: null, spec: intradaySpecOf("medium", "1m"), baseTf: "5m" })).toBeNull();
  });

  it("context: fake business-day dates before the reveal, real dates after; gap and ATR from the past only", () => {
    expect(fakeDailyTimes(3).map((t) => new Date(t * 1000).toISOString().slice(0, 10))).toEqual(["2001-01-05", "2001-01-08", "2001-01-09"]);
    const daily = [
      { date: "2026-10-14", o: 9, h: 9.6, l: 8.9, c: 9.5, v: 100 },
      { date: "2026-10-15", o: 9.5, h: 10.2, l: 9.4, c: 10, v: 120 },
    ];
    const g = { mode: "intraday" as const, status: "active" as const, bars: [{ t: 0, o: 10.4, h: 10.5, l: 10.3, c: 10.5, v: 1 }], startIdx: 0,
      params: { levels: { pdh: 10.2, pdl: 9.4, pdc: 10, pmh: 10.6, pml: 10.1 } } as never };
    const c = contextOf(g, daily);
    expect(c.daily.map((b) => new Date(b[0] * 1000).getUTCFullYear())).toEqual([2001, 2001]);
    expect(c.levels).toMatchObject({ pdh: 10.2, pdc: 10, pmh: 10.6, gapPct: 5 });
    expect(c.levels.atr14).toBe(0.8);
    const done = contextOf({ ...g, status: "finished" as never }, daily);
    expect(new Date(done.daily[1][0] * 1000).toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(contextOf({ ...g, mode: "swing" as never }, daily)).toEqual({ daily: [], levels: { pdh: null, pdl: null, pdc: null, pmh: null, pml: null, gapPct: null, atr14: null } });
  });
});
