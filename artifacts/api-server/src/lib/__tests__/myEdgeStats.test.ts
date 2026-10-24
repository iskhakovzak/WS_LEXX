import { describe, expect, it } from "vitest";
import {
  meBhQ, meBootP, meDayBootstrap, meHashSeed, meMedian, mePersistence, meQuantileSorted, meResampleDays, meRng, meStatus,
  ME_MIN_DAYS, ME_MIN_TRADES, type MeDay,
} from "../stats/myEdgeStats";
import { buildRows, rankRows, type MeRowTrade } from "../myEdge/rows";
import { addDays } from "../tradingDate";

/** Synthetic days: `n` days, each with `per` trades of mean `mu` and noise ±`sd` (seeded). */
function days(n: number, mu: number, sd: number, per = 3, seed = 1): MeDay[] {
  const rnd = meRng(seed);
  return Array.from({ length: n }, () => {
    let sum = 0;
    for (let k = 0; k < per; k++) sum += mu + (rnd() * 2 - 1) * sd;
    return { sum, n: per };
  });
}

describe("myEdge stats — seeded primitives", () => {
  it("same seed ⇒ same stream; hash is stable", () => {
    const a = meRng(42), b = meRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(meHashSeed("time|9:30-9:50|12")).toBe(meHashSeed("time|9:30-9:50|12"));
    expect(meHashSeed("a")).not.toBe(meHashSeed("b"));
  });

  it("quantile and median", () => {
    expect(meQuantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(meQuantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(meMedian([5, 1, 3])).toBe(3);
  });

  it("bootstrap p: all-positive draws ⇒ tiny p, symmetric draws ⇒ p ≈ 1", () => {
    expect(meBootP(new Float64Array(999).fill(5))).toBeLessThan(0.01);
    const sym = Float64Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : -1));
    expect(meBootP(sym)).toBeGreaterThan(0.9);
  });
});

describe("day-clustered bootstrap", () => {
  it("is deterministic and brackets the point", () => {
    const d = days(30, 20, 60);
    const a = meDayBootstrap(d, { seed: 7 })!;
    const b = meDayBootstrap(d, { seed: 7 })!;
    expect(a).toEqual(b);
    expect(a.perDay.lo).toBeLessThanOrEqual(a.perDay.point);
    expect(a.perDay.hi).toBeGreaterThanOrEqual(a.perDay.point);
    expect(a.trades).toBe(90);
    expect(a.days).toBe(30);
  });

  it("a clear edge is significant, pure noise is not", () => {
    expect(meDayBootstrap(days(40, 50, 20), { seed: 3 })!.p).toBeLessThan(0.01);
    const noise = meDayBootstrap(days(40, 0, 80, 3, 11), { seed: 3 })!;
    expect(noise.p).toBeGreaterThan(0.05);
    expect(noise.perDay.lo).toBeLessThan(0);
    expect(noise.perDay.hi).toBeGreaterThan(0);
  });

  it("clusters by day: one huge day among many flat ones keeps a wide interval (trade-level would not)", () => {
    const d: MeDay[] = [{ sum: 3000, n: 30 }, ...Array.from({ length: 19 }, () => ({ sum: 0, n: 1 }))];
    const b = meDayBootstrap(d, { seed: 5 })!;
    // A trade-level bootstrap would see 30 «independent» +$100 trades; by day the lower bound reaches 0.
    expect(b.perTrade.lo).toBe(0);
    expect(b.p).toBeGreaterThan(0.1);
  });

  it("empty input ⇒ null", () => {
    expect(meDayBootstrap([], { seed: 1 })).toBeNull();
  });

  it("generic resampler skips null statistics", () => {
    const draws = meResampleDays([1, 2, 3], (pick, u) => (pick.every((i) => u[i] === 1) ? null : 1), 9, 200);
    expect(draws.length).toBeGreaterThan(150);
    expect([...draws].every((v) => v === 1)).toBe(true);
  });
});

describe("Benjamini–Hochberg", () => {
  it("textbook example (input order kept)", () => {
    const p = [0.01, 0.04, 0.03, 0.005];
    const q = meBhQ(p);
    // sorted: .005(1) .01(2) .03(3) .04(4); raw p·m/k = .02 .02 .04 .04; step-up minima identical here.
    expect(q.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.02, 0.04, 0.04, 0.02]);
  });
  it("q ≥ p, capped at 1, monotone in p", () => {
    const p = [0.9, 0.2, 0.5, 0.01, 0.7];
    const q = meBhQ(p);
    q.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(p[i]!); expect(v).toBeLessThanOrEqual(1); });
    expect(q[3]).toBeLessThanOrEqual(q[1]!);
  });
});

describe("persistence and status", () => {
  it("three chronological blocks of the window's trading days", () => {
    const windowDays = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];
    const bucket = new Map<string, MeDay>([
      ["2026-01-01", { sum: 30, n: 3 }], ["2026-01-02", { sum: 10, n: 1 }],
      ["2026-01-03", { sum: -40, n: 4 }],
      ["2026-01-06", { sum: 5, n: 1 }],
    ]);
    const b = mePersistence(windowDays, bucket);
    expect(b.map((x) => x.sign)).toEqual([1, -1, 0]);
    expect(b.map((x) => x.trades)).toEqual([4, 4, 1]);
  });

  it("status thresholds", () => {
    expect(meStatus(ME_MIN_DAYS - 1, 100, 0.001)).toBe("low");
    expect(meStatus(20, ME_MIN_TRADES - 1, 0.001)).toBe("low");
    expect(meStatus(20, 50, 0.05)).toBe("reliable");
    expect(meStatus(20, 50, 0.3)).toBe("hypothesis");
  });
});

describe("rows: BH over the family, ranking", () => {
  /** 40 days × (2 «good» trades +$40 ± 10, 2 «bad» −$30 ± 10, 1 «noise» ±$50, 1 rare). */
  function fixture(): { trades: MeRowTrade[]; key: Map<number, string> } {
    const rnd = meRng(99);
    const trades: MeRowTrade[] = [];
    const key = new Map<number, string>();
    let id = 1;
    for (let d = 0; d < 40; d++) {
      const day = addDays("2026-03-02", d);
      const add = (k: string, net: number) => { trades.push({ id, day, net, win: net > 0 ? true : net < 0 ? false : null }); key.set(id, k); id++; };
      add("good", 40 + (rnd() * 2 - 1) * 10); add("good", 40 + (rnd() * 2 - 1) * 10);
      add("bad", -30 + (rnd() * 2 - 1) * 10); add("bad", -30 + (rnd() * 2 - 1) * 10);
      add("noise", (rnd() * 2 - 1) * 50);
      if (d < 3) add("rare", 500);
    }
    return { trades, key };
  }

  it("good is a reliable strength, bad a reliable leak, noise a hypothesis, rare is «мало данных»", () => {
    const { trades, key } = fixture();
    const { rows, coverage } = buildRows({ trades, dims: ["d"], keyOf: (id) => key.get(id)!, skip: new Set() });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.good!.status).toBe("reliable");
    expect(by.bad!.status).toBe("reliable");
    expect(by.noise!.status).toBe("hypothesis");
    expect(by.rare!.status).toBe("low");
    expect(by.rare!.q).toBeNull();
    expect(by.good!.persist).toBe(3);
    expect(coverage).toEqual([{ dim: "d", known: trades.length, total: trades.length }]);
    const ranked = rankRows(rows);
    expect(ranked.strengths[0]!.key).toBe("good");
    expect(ranked.leaks[0]!.key).toBe("bad");
    expect(ranked.strengths.some((r) => r.key === "rare")).toBe(false);
  });

  it("a bucket holding > 85 % of its dimension is the baseline, never a ranked strength / leak", () => {
    const { trades } = fixture();
    const { rows } = buildRows({ trades, dims: ["all"], keyOf: (id) => (id % 20 === 0 ? "few" : "most"), skip: new Set() });
    expect(rows.find((r) => r.key === "most")!.status).not.toBe("low");
    const ranked = rankRows(rows);
    expect([...ranked.strengths, ...ranked.leaks].some((r) => r.key === "most")).toBe(false);
  });

  it("skip keys feed coverage only; outcome dims are never ranked", () => {
    const { trades, key } = fixture();
    const { rows, coverage } = buildRows({
      trades, dims: ["d", "hold"], keyOf: (id, dim) => (dim === "hold" ? key.get(id)! : key.get(id) === "noise" ? "unknown" : key.get(id)!),
      skip: new Set(["unknown"]), outcomeDims: new Set(["hold"]),
    });
    expect(rows.some((r) => r.dim === "d" && r.key === "unknown")).toBe(false);
    expect(coverage.find((c) => c.dim === "d")!.known).toBe(trades.length - 40);
    expect(rankRows(rows).strengths.every((r) => r.dim !== "hold")).toBe(true);
  });
});
