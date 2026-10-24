/** The lab's exit analysis and entry overlay maths (lib/chartLab/exitMath, overlayMath): no look-ahead, missing bars. */
import { describe, expect, it } from "vitest";
import {
  type DayBars, type ExitTrade, type LabBar, MIN_N, aggregateExits, bootMean, bracketExit, timeExit, tradeExits, vwapExit,
} from "../chartLab/exitMath";
import { POST_MIN, PRE_MIN, closeAt, overlayOf, tradePath } from "../chartLab/overlayMath";
import { riskPerShareOf, rowToLab, sideOf } from "../chartLab/load";
import { mulberry32 } from "../whatIfTypes";

const T0 = 1_760_000_000 - (1_760_000_000 % 60); // a minute boundary
const CLOSE = T0 + 120 * 60; // «16:00» two hours after the entry minute
/** 1-minute bars from T0 − 10 min: each [o, h, l, c, v]. */
function day(rows: [number, number, number, number, number?][], start = T0 - 600): DayBars {
  const bars: LabBar[] = rows.map(([o, h, l, c, v], i) => ({ t: start + i * 60, o, h, l, c, v: v ?? 100 }));
  return { bars, barSec: 60, closeAt: CLOSE };
}
/** Flat bars at `px` from T0 − 10 min to the close. */
const flat = (px: number, n = 130) => Array.from({ length: n }, () => [px, px, px, px] as [number, number, number, number]);
const long = (p: Partial<ExitTrade> = {}): ExitTrade => ({ id: 1, setup: "ORB", side: 1, qty: 100, entry: 10, entryAt: T0 + 20, exit: 10.5, riskPerShare: 0.5, ...p });

describe("R brackets", () => {
  it("target first → +kR; stop first → −1R; both in one bar → the stop (conservative)", () => {
    const rows = flat(10);
    rows[12] = [10, 11.2, 10, 11]; // 2 min after the entry minute: +2.4R high
    expect(bracketExit(long(), day(rows), 2)).toBe(1);
    const down = flat(10);
    down[12] = [10, 10, 9.4, 9.5];
    expect(bracketExit(long(), day(down), 2)).toBe(-0.5);
    const both = flat(10);
    both[12] = [10, 11.5, 9.4, 10];
    expect(bracketExit(long(), day(both), 2)).toBe(-0.5);
  });
  it("the entry bar itself is never walked (it mixes moments before the fill)", () => {
    const rows = flat(10);
    rows[10] = [10, 11.5, 10, 10]; // the entry minute's bar spikes to +3R
    expect(bracketExit(long(), day(rows), 2)).toBe(0); // flat until the close → exits at the close
  });
  it("a short is mirrored; no stop distance → no R variant", () => {
    const rows = flat(10);
    rows[15] = [10, 10, 9, 9.2];
    expect(bracketExit(long({ side: -1 }), day(rows), 1)).toBe(0.5);
    expect(bracketExit(long({ riskPerShare: null }), day(rows), 1)).toBeNull();
  });
  it("bars that stop before the close leave an unresolved bracket unknown — never filled in", () => {
    expect(bracketExit(long(), day(flat(10, 60)), 2)).toBeNull();
    // …while one resolved before the gap still counts.
    const rows = flat(10, 60);
    rows[13] = [10, 10.6, 10, 10.6];
    expect(bracketExit(long(), day(rows), 1)).toBe(0.5);
  });
  it("no look-ahead: what happens after the bracket resolved never changes it", () => {
    const rnd = mulberry32(3);
    for (let k = 0; k < 20; k++) {
      const rows = flat(10);
      const at = 11 + Math.floor(rnd() * 30);
      rows[at] = [10, 10.8, 10, 10.8];
      const a = bracketExit(long(), day(rows), 1);
      const later = rows.map((r, i) => (i > at ? ([5, 20, 1, rnd() * 10 + 5] as [number, number, number, number]) : r));
      expect(bracketExit(long(), day(later), 1)).toBe(a);
    }
  });
});

describe("time stops and VWAP", () => {
  it("exits at the close of the bar holding entry + m minutes; a missing bar → unknown", () => {
    const rows = flat(10);
    rows[10 + 5] = [10, 10.3, 10, 10.25]; // the bar holding T0 + 20 s + 5 min
    expect(timeExit(long(), day(rows), 5)).toBe(0.25);
    const gap = day(rows);
    gap.bars = gap.bars.filter((b) => b.t !== T0 + 5 * 60);
    expect(timeExit(long(), gap, 5)).toBeNull();
  });
  it("VWAP uses the bars BEFORE the touching bar; the exit price is that VWAP", () => {
    // Day at 10 with volume, then the stock runs to 11; the first bar back down through 10 touches the VWAP (10).
    const rows = flat(10, 11).map((r) => [...r, 1000] as [number, number, number, number, number]); // up to the entry minute
    rows.push([11, 11, 11, 11, 10], [11, 11, 11, 11, 10], [11, 11, 9.9, 10.5, 10]);
    const d = day([...rows, ...flat(10.5, 120).map((r) => [...r, 10] as [number, number, number, number, number])]);
    const v = vwapExit(long({ entry: 10.2 }), d);
    expect(v).not.toBeNull();
    expect(v as number).toBeLessThan(0); // exits at ~10.0x < 10.2
    expect(v as number).toBeGreaterThan(-0.2);
  });
  it("no volume → no VWAP variant", () => {
    const rows = flat(10).map((r) => [...r, 0] as [number, number, number, number, number]);
    expect(vwapExit(long(), day(rows))).toBeNull();
  });
  it("tradeExits without bars keeps only the actual exit", () => {
    const x = tradeExits(long(), null);
    expect(x.perShare.actual).toBe(0.5);
    expect(x.perShare.r1).toBeNull();
    expect(x.perShare.vwap).toBeNull();
  });
});

describe("aggregation: honest statistics per setup", () => {
  it("fewer than MIN_N trades → «few», never a verdict", () => {
    const rows = Array.from({ length: MIN_N - 1 }, (_, i) => tradeExits(long({ id: i }), day(flat(10))));
    const s = aggregateExits("ORB", rows, 2);
    expect(s.trades).toBe(MIN_N + 1);
    expect(s.missing).toBe(2);
    expect(s.variants.find((v) => v.variant === "t5")?.verdict).toBe("few");
    expect(s.best).toBeNull();
  });
  it("a variant that is better on every trade is «better»; Δ is (variant − actual) × qty", () => {
    // Actual exits at −0.4 / share; a 5-minute exit at 0 is $40 better on each of 40 trades (plus a little noise).
    const rnd = mulberry32(9);
    const rows = Array.from({ length: 40 }, (_, i) => {
      const r = flat(10);
      r[15] = [10, 10, 10, 10 + (rnd() - 0.5) * 0.02];
      return tradeExits(long({ id: i, exit: 9.6 }), day(r));
    });
    const s = aggregateExits("ORB", rows, 0, { iters: 400 });
    const t5 = s.variants.find((v) => v.variant === "t5")!;
    expect(t5.n).toBe(40);
    expect(t5.meanDelta).toBeGreaterThan(38);
    expect(t5.meanDelta).toBeLessThan(42);
    expect(t5.verdict).toBe("better");
    expect(t5.q).toBeLessThan(0.1);
    expect(s.best).not.toBeNull();
  });
  it("pure noise is «не отличить» after BH", () => {
    const rnd = mulberry32(11);
    const rows = Array.from({ length: 60 }, (_, i) => {
      const r = flat(10).map((x) => { const c = 10 + (rnd() - 0.5) * 0.4; return [c, c + 0.05, c - 0.05, c] as [number, number, number, number]; });
      return tradeExits(long({ id: i, exit: 10 + (rnd() - 0.5) * 0.4 }), day(r));
    });
    const s = aggregateExits("Noise", rows, 0, { iters: 400 });
    expect(s.variants.filter((v) => v.verdict === "better")).toHaveLength(0);
  });
  it("bootMean is seeded", () => {
    expect(bootMean([1, 2, 3, 4], 200, 5)).toEqual(bootMean([1, 2, 3, 4], 200, 5));
  });
});

describe("overlay", () => {
  it("aligns at the entry minute: 0 at the entry, side-adjusted %, R when the stop is known", () => {
    const rows = flat(10);
    rows[12] = [10, 10.6, 9.9, 10.5];
    const d = day(rows);
    const p = tradePath({ id: 1, side: 1, entry: 10, entryAt: T0 + 20, riskPerShare: 0.5, result: 1 }, d.bars, 60, "pct")!;
    expect(p.values).toHaveLength(PRE_MIN + POST_MIN + 1);
    expect(p.values[PRE_MIN]).toBe(0);
    expect(p.values[PRE_MIN + 2]).toBe(5); // +5% at minute 2
    const r = tradePath({ id: 1, side: -1, entry: 10, entryAt: T0 + 20, riskPerShare: 0.5, result: 1 }, d.bars, 60, "r")!;
    expect(r.values[PRE_MIN + 2]).toBe(-1); // a short: −1R
    expect(r.mfe[PRE_MIN + 3]).toBe(0.2); // the low 9.9 = +0.2R for the short
    expect(r.mae[PRE_MIN + 3]).toBe(-1.2);
    expect(tradePath({ id: 1, side: 1, entry: 10, entryAt: T0, riskPerShare: null, result: null }, d.bars, 60, "r")).toBeNull();
  });
  it("missing bars truncate a path (n per minute drops), a missing day is counted", () => {
    const short = day(flat(10, 30)); // bars stop 20 minutes after the entry
    const full = day(flat(10));
    const o = overlayOf([
      { trade: { id: 1, side: 1, entry: 10, entryAt: T0, riskPerShare: 0.5, result: 1 }, bars: full.bars, barSec: 60 },
      { trade: { id: 2, side: 1, entry: 10, entryAt: T0, riskPerShare: 0.5, result: -1 }, bars: short.bars, barSec: 60 },
      { trade: { id: 3, side: 1, entry: 10, entryAt: T0, riskPerShare: 0.5, result: null }, bars: null, barSec: 60 },
    ], "pct");
    expect(o.missing).toBe(1);
    expect(o.trades).toBe(2);
    expect(o.n[PRE_MIN + 5]).toBe(2);
    expect(o.n[PRE_MIN + 40]).toBe(1);
    expect(o.mean[PRE_MIN + 40]).toBe(0);
    expect(o.paths.map((p) => p.win)).toEqual([true, false]);
  });
  it("closeAt finds the bar holding a moment or nothing", () => {
    const d = day(flat(10, 5));
    expect(closeAt(d.bars, 60, T0 - 600 + 59)).toBe(10);
    expect(closeAt(d.bars, 60, T0 - 600 + 5 * 60)).toBeNull();
    expect(closeAt(d.bars, 60, T0 - 601)).toBeNull();
  });
});

describe("lab loader mapping", () => {
  it("side, stop distance, intraday only", () => {
    expect(sideOf("Short")).toBe(-1);
    expect(sideOf("buy")).toBe(1);
    expect(sideOf(null)).toBeNull();
    expect(riskPerShareOf(10, 9.5, null, 100)).toBe(0.5);
    expect(riskPerShareOf(10, null, 50, 100)).toBe(0.5);
    expect(riskPerShareOf(10, null, null, 100)).toBeNull();
    const row = { id: 1, ticker: "aapl", date: "2026-10-01", exit_date: null, side: "long", qty: "100", entry: "10", exit: "10.5", stop: "9.5", risk_usd: null, pnl: "50", fees: "2", setup: " ORB ", first_entry: new Date(T0 * 1000) };
    expect(rowToLab(row)).toEqual({ id: 1, ticker: "AAPL", day: "2026-10-01", setup: "ORB", side: 1, qty: 100, entry: 10, exit: 10.5, entryAt: T0, riskPerShare: 0.5, net: 48 });
    expect(rowToLab({ ...row, exit_date: "2026-10-02" })).toBeNull();
    expect(rowToLab({ ...row, first_entry: null })).toBeNull();
  });
});
