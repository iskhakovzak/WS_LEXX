import { describe, it, expect } from "vitest";
import type { Candle } from "@/components/chart-engine";
import { aggregate, baseTfOf, dayHiLo, displayTime, displayTfsOf, formingInfo, lastBaseOf, pickDisplayTf, stepToClose, toDisplayIdx, todayCandle } from "./tf-model";

/** Fake intraday time of the play day (day 0) at New York minute `min` (the server's fake clock). */
const at = (min: number, day = 0) => Date.UTC(2001, 0, 10) / 1000 + day * 86400 + (min + 300) * 60;
const bar = (min: number, o: number, h: number, l: number, c: number, v = 100, day = 0): Candle => ({ t: at(min, day), o, h, l, c, v });

describe("sim timeframes — which ones a game offers", () => {
  it("uses the server's list, else defaults for the base; old games fall back to tf", () => {
    expect(displayTfsOf({ mode: "intraday", tf: "2m", baseTf: "1m", displayTfs: ["1m", "2m", "5m", "15m"] })).toEqual(["1m", "2m", "5m", "15m"]);
    expect(displayTfsOf({ mode: "intraday", tf: "5m", baseTf: "5m" })).toEqual(["5m", "15m", "30m"]);
    expect(displayTfsOf({ mode: "intraday", tf: "1m" })).toEqual(["1m", "2m", "5m", "15m"]);
    expect(baseTfOf({ mode: "intraday", tf: "5m" })).toBe("5m");
    expect(displayTfsOf({ mode: "swing", tf: "1d" })).toEqual([]);
  });

  it("drops unknown tfs, tfs below the base and ones that are not a whole multiple", () => {
    expect(displayTfsOf({ mode: "intraday", tf: "2m", baseTf: "2m", displayTfs: ["1m", "2m", "5m", "10m", "D", "10m"] })).toEqual(["2m", "10m"]);
  });

  it("picks the remembered tf when allowed, else the game default", () => {
    const meta = { mode: "intraday", tf: "2m", baseTf: "1m" };
    const tfs = displayTfsOf(meta);
    expect(pickDisplayTf(tfs, "5m", meta)).toBe("5m");
    expect(pickDisplayTf(tfs, "30m", meta)).toBe("2m");
    expect(pickDisplayTf([], "5m", meta)).toBeNull();
  });
});

describe("sim timeframes — aggregation with a forming last bar", () => {
  const base = [
    bar(570, 10, 10.2, 9.9, 10.1),
    bar(571, 10.1, 10.5, 10, 10.4),
    bar(572, 10.4, 10.6, 10.3, 10.3),
    bar(573, 10.3, 10.3, 9.8, 9.9),
    bar(574, 9.9, 10, 9.7, 9.8),
    bar(575, 9.8, 10.1, 9.8, 10),
    bar(576, 10, 10.2, 9.95, 10.15, 50),
  ];

  it("merges base bars into clock-aligned buckets (OHLCV)", () => {
    const a = aggregate(base, 1, 5);
    expect(a.bars).toHaveLength(2);
    expect(a.bars[0]).toEqual({ t: at(570), o: 10, h: 10.6, l: 9.7, c: 9.8, v: 500 });
    expect(a.bars[1]).toEqual({ t: at(575), o: 9.8, h: 10.2, l: 9.8, c: 10.15, v: 150 });
    expect(a.map).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(a.first).toEqual([0, 5]);
    expect(lastBaseOf(a, 0)).toBe(4);
    expect(lastBaseOf(a, 1)).toBe(6);
  });

  it("the last bar is built only from the bars seen (no peeking)", () => {
    const seen = base.slice(0, 6);
    const a = aggregate(seen, 1, 5);
    expect(a.bars[1]).toEqual({ t: at(575), o: 9.8, h: 10.1, l: 9.8, c: 10, v: 100 });
    expect(formingInfo(seen, 1, 5)).toEqual({ have: 1, need: 5 });
    expect(formingInfo(base.slice(0, 5), 1, 5)).toEqual({ have: 5, need: 5 });
    expect(formingInfo(seen, 1, 1)).toBeNull();
  });

  it("forming progress follows the clock (missing minutes in a thin premarket); → steps to the candle's close", () => {
    const thin = [bar(560, 1, 1, 1, 1), bar(564, 1, 1, 1, 1)]; // 9:20 and 9:24 only
    expect(formingInfo(thin, 1, 5)).toEqual({ have: 5, need: 5 });
    expect(stepToClose(formingInfo(thin, 1, 5))).toBe(5);
    expect(stepToClose(formingInfo(base.slice(0, 7), 1, 5))).toBe(3);
    expect(stepToClose(formingInfo(base.slice(0, 7), 1, 15))).toBe(8);
    expect(stepToClose(null)).toBe(1);
  });

  it("does not mutate the base bars; the identity keeps indices", () => {
    const copy = JSON.parse(JSON.stringify(base));
    aggregate(base, 1, 15);
    expect(base).toEqual(copy);
    const id = aggregate(base, 1, 1);
    expect(id.bars).toHaveLength(base.length);
    expect(id.map[3]).toBe(3);
  });

  it("a gap (the overnight) starts a new bucket; base idx → display idx is clamped", () => {
    const two = [bar(955, 9, 9, 9, 9, 1, -1), bar(959, 9, 9, 9, 9, 1, -1), bar(570, 10, 10, 10, 10)];
    const a = aggregate(two, 1, 15);
    expect(a.bars).toHaveLength(2);
    expect(toDisplayIdx(a, 2)).toBe(1);
    expect(toDisplayIdx(a, 99)).toBe(1);
    expect(toDisplayIdx(a, -5)).toBe(0);
  });

  it("after the reveal the axis time is the real bucket start", () => {
    const a = aggregate(base, 1, 5);
    const real = base.map((_, i) => 1_700_000_000 + 60 + i * 60); // real 9:31 for the first fake bar? shift check
    expect(displayTime(a, 1, base, real)).toBe(real[5] - (base[5].t - a.bars[1].t));
    expect(displayTime(a, 1, base, null)).toBe(a.bars[1].t);
  });
});

describe("sim timeframes — the play day's daily candle", () => {
  it("builds today's candle from the regular-session bars seen; premarket and yesterday excluded", () => {
    const bars = [bar(900, 50, 60, 40, 55, 1, -1), bar(500, 20, 21, 19, 20.5), bar(570, 21, 22, 20.8, 21.5), bar(571, 21.5, 21.6, 20.1, 20.4)];
    expect(todayCandle(bars)).toEqual({ t: at(570), o: 21, h: 22, l: 20.1, c: 20.4, v: 200 });
    expect(dayHiLo(bars)).toEqual({ hod: 22, lod: 20.1 });
    expect(todayCandle(bars.slice(0, 2))).toBeNull();
  });
});
