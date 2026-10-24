import { describe, expect, it } from "vitest";
import { confidenceOf, dayBootstrap, hashSeed, median, mulberry32, quantileSorted, trendOf } from "./stats-lite";

type Row = { day: string; v: number };
const sum = (rs: readonly Row[]) => rs.reduce((a, r) => a + r.v, 0);
const mean = (rs: readonly Row[]) => (rs.length ? sum(rs) / rs.length : null);

/** `days` days of `perDay` rows each, values from `f(dayIndex, rowIndex)`. */
function book(days: number, perDay: number, f: (d: number, i: number) => number): Row[] {
  const out: Row[] = [];
  for (let d = 0; d < days; d++) for (let i = 0; i < perDay; i++) out.push({ day: `2026-09-${String(d + 1).padStart(2, "0")}`, v: f(d, i) });
  return out;
}

describe("seeded RNG", () => {
  it("same seed → same sequence; different seed → different sequence", () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("hashSeed is stable", () => {
    expect(hashSeed("seq:4-5")).toBe(hashSeed("seq:4-5"));
    expect(hashSeed("seq:4-5")).not.toBe(hashSeed("seq:6+"));
  });
});

describe("quantiles / median", () => {
  it("interpolates", () => {
    expect(quantileSorted([0, 10], 0.5)).toBe(5);
    expect(quantileSorted([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("dayBootstrap", () => {
  it("is deterministic for the same seed and independent of row order", () => {
    const rows = book(20, 3, (d, i) => ((d * 7 + i * 3) % 11) - 4);
    const a = dayBootstrap(rows, (r) => r.day, sum, { seed: "x" });
    const b = dayBootstrap([...rows].reverse(), (r) => r.day, sum, { seed: "x" });
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(a!.level).toBe(0.8);
    expect(a!.days).toBe(20);
    expect(a!.lo).toBeLessThanOrEqual(a!.estimate);
    expect(a!.hi).toBeGreaterThanOrEqual(a!.estimate);
  });

  it("a constant per-day total has a zero-width interval", () => {
    const rows = book(10, 2, () => 5);
    const iv = dayBootstrap(rows, (r) => r.day, sum)!;
    expect(iv.estimate).toBe(100);
    expect(iv.lo).toBe(100);
    expect(iv.hi).toBe(100);
  });

  it("resamples days, not trades: correlated trades inside a day widen the interval", () => {
    // Same 40 values; clustered = 4 identical trades per day (10 days), spread = 1 trade per day (40 days).
    const vals = Array.from({ length: 10 }, (_, d) => (d % 2 ? 30 : -20));
    const clustered = book(10, 4, (d) => vals[d]);
    const spread = book(40, 1, (d) => vals[Math.floor(d / 4)]).map((r, i) => ({ ...r, day: `d${String(i).padStart(2, "0")}` }));
    const wC = dayBootstrap(clustered, (r) => r.day, mean)!;
    const wS = dayBootstrap(spread, (r) => r.day, mean)!;
    expect(wC.estimate).toBeCloseTo(wS.estimate);
    expect(wC.hi - wC.lo).toBeGreaterThan(wS.hi - wS.lo);
  });

  it("needs two days and a defined statistic", () => {
    expect(dayBootstrap(book(1, 5, () => 1), (r) => r.day, sum)).toBeNull();
    expect(dayBootstrap(book(5, 1, () => 1), (r) => r.day, () => null)).toBeNull();
  });

  it("a clearly losing slice has an interval below zero; a coin flip crosses zero", () => {
    const losing = book(30, 2, (d, i) => -40 + ((d + i) % 3) * 10);
    const coin = book(30, 2, (d) => ((d * 7) % 3 ? 50 : -100));
    expect(dayBootstrap(losing, (r) => r.day, sum)!.hi).toBeLessThan(0);
    const c = dayBootstrap(coin, (r) => r.day, sum)!;
    expect(c.lo).toBeLessThan(0);
    expect(c.hi).toBeGreaterThan(0);
  });
});

describe("confidenceOf", () => {
  const iv = (lo: number, hi: number) => ({ estimate: (lo + hi) / 2, lo, hi, level: 0.8, days: 10, iters: 600 });
  it("solid when the interval sits on the claimed side", () => {
    expect(confidenceOf(iv(-300, -60), "below", { n: 20, minN: 10 })).toBe("solid");
    expect(confidenceOf(iv(10, 90), "above", { n: 20, minN: 10 })).toBe("solid");
  });
  it("hypothesis when it crosses the threshold", () => {
    expect(confidenceOf(iv(-300, 40), "below", { n: 20, minN: 10 })).toBe("hypothesis");
    expect(confidenceOf(iv(0.9, 1.6), "above", { n: 20, minN: 10, threshold: 1 })).toBe("hypothesis");
    expect(confidenceOf(iv(1.1, 1.6), "above", { n: 20, minN: 10, threshold: 1 })).toBe("solid");
  });
  it("low under the sample floor, whatever the interval", () => {
    expect(confidenceOf(iv(-300, -60), "below", { n: 6, minN: 10 })).toBe("low");
    expect(confidenceOf(iv(-300, -60), "below", { n: 20, minN: 10, days: 3, minDays: 4 })).toBe("low");
    expect(confidenceOf(null, "below", { n: 20, minN: 10 })).toBe("low");
  });
});

describe("trendOf", () => {
  it("judges by the metric's good direction", () => {
    expect(trendOf(-120, -186)).toEqual({ cur: -120, prev: -186, delta: 66, dir: "better" });
    expect(trendOf(1.6, 1.2, { higherIsBetter: false })?.dir).toBe("worse");
    expect(trendOf(10, 10.5, { flatWithin: 1 })?.dir).toBe("flat");
  });
  it("null without both sides", () => {
    expect(trendOf(1, null)).toBeNull();
    expect(trendOf(undefined, 2)).toBeNull();
  });
});
