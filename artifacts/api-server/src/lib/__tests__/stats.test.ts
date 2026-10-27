/**
 * lib/stats (ALGORITHMS P1–P3) on synthetic data only: seeded determinism, interval coverage, shrinkage limits, the
 * method-of-moments prior and Benjamini–Hochberg against hand-computed values.
 */
import { describe, expect, it } from "vitest";
import {
  bhQValues, blockBootstrapMean, blockDiffProb, blockLength, blocksAgreeing, clusterBootstrapMean, deskPrior, normCdf,
  randNormal, rejectedAt, rngFor, shrink, winsorize, winsorBounds,
} from "../stats";
import { bhQ } from "../whatIfStepdown";

describe("P1 bootstrap", () => {
  it("cluster bootstrap: point = ΣS/ΣN, identical under the same seed, different under another", () => {
    const sums = [10, -4, 6, -12, 3, 8, -1];
    const counts = [2, 1, 3, 4, 1, 2, 1];
    const a = clusterBootstrapMean(sums, counts, rngFor(7, "x"))!;
    const b = clusterBootstrapMean(sums, counts, rngFor(7, "x"))!;
    const c = clusterBootstrapMean(sums, counts, rngFor(8, "x"))!;
    expect(a.mean).toBeCloseTo(10 / 14, 12);
    expect(a).toEqual(b);
    expect(c.lo80).not.toBe(a.lo80);
    expect(a.lo95).toBeLessThanOrEqual(a.lo80);
    expect(a.hi95).toBeGreaterThanOrEqual(a.hi80);
    expect(clusterBootstrapMean([], [], rngFor(1))).toBeNull();
  });

  it("rngFor: the stream depends on the parts, not on the call order", () => {
    const x = rngFor(1, "T1", "slice");
    const y = rngFor(1, "T2", "slice");
    expect(x()).not.toBe(y());
    expect(rngFor(1, "T1", "slice")()).toBe(rngFor(1, "T1", "slice")());
  });

  it("cluster bootstrap 80% interval covers the true mean about 80% of the time (synthetic days)", () => {
    const sim = rngFor(99, "coverage");
    let covered = 0;
    const R = 300;
    for (let r = 0; r < R; r++) {
      const sums: number[] = [];
      const counts: number[] = [];
      for (let d = 0; d < 60; d++) {
        const n = 1 + Math.floor(sim() * 5);
        let s = 0;
        for (let k = 0; k < n; k++) s += 2 + 10 * randNormal(sim);
        sums.push(s);
        counts.push(n);
      }
      const b = clusterBootstrapMean(sums, counts, rngFor(5, r), 400)!;
      if (b.lo80 <= 2 && 2 <= b.hi80) covered++;
    }
    expect(covered / R).toBeGreaterThan(0.72);
    expect(covered / R).toBeLessThan(0.88);
  });

  it("block length = round(n^(1/3)) (the plateau detector passes block 5 explicitly)", () => {
    expect(blockLength(120)).toBe(5);
    expect(blockLength(250)).toBe(6);
    expect(blockLength(1)).toBe(1);
    expect(blockLength(0)).toBe(1);
  });

  it("block bootstrap mean: deterministic, interval brackets the mean; P(diff > 0) is high for a clear rise", () => {
    const sim = rngFor(3, "series");
    const flat = Array.from({ length: 200 }, () => 5 + 50 * randNormal(sim));
    const up = Array.from({ length: 200 }, () => 40 + 50 * randNormal(sim));
    const s1 = blockBootstrapMean(flat, rngFor(1, "a"), { block: 5 })!;
    expect(s1).toEqual(blockBootstrapMean(flat, rngFor(1, "a"), { block: 5 }));
    expect(s1.lo80).toBeLessThan(s1.mean);
    expect(s1.hi80).toBeGreaterThan(s1.mean);
    expect(blockDiffProb(up, flat, rngFor(1, "d"), { block: 5 })!).toBeGreaterThan(0.99);
    expect(blockDiffProb(flat, up, rngFor(1, "d"), { block: 5 })!).toBeLessThan(0.01);
    expect(blockDiffProb([], flat, rngFor(1))).toBeNull();
  });
});

describe("P2 shrinkage", () => {
  const prior = { mu: 1, tau: 3 };

  it("w → 1 as n → ∞ (se → 0) and w → 0 as se → ∞", () => {
    expect(shrink(-10, 1e-6, prior).w).toBeCloseTo(1, 9);
    expect(shrink(-10, 1e-6, prior).theta).toBeCloseTo(-10, 5);
    expect(shrink(-10, 1e9, prior).w).toBeLessThan(1e-15);
    expect(shrink(-10, 1e9, prior).theta).toBeCloseTo(1, 6);
    expect(shrink(-10, Number.POSITIVE_INFINITY, prior).w).toBe(0);
    // monotone in se
    const ws = [0.5, 1, 2, 4, 8, 16].map((se) => shrink(-10, se, prior).w);
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeLessThan(ws[i - 1]);
  });

  it("posterior: θ = w·x̄ + (1 − w)·μ0, sd = √w·se, 80% = θ ± 1.2816·sd, P(θ<0) = Φ(−θ/sd)", () => {
    const p = shrink(-6, 3, prior);
    expect(p.w).toBeCloseTo(9 / 18, 12);
    expect(p.theta).toBeCloseTo(0.5 * -6 + 0.5 * 1, 12);
    expect(p.sdPost).toBeCloseTo(Math.sqrt(0.5) * 3, 12);
    expect(p.hi80 - p.theta).toBeCloseTo(1.2816 * p.sdPost, 3);
    expect(p.pNeg).toBeCloseTo(normCdf(-p.theta / p.sdPost), 12);
  });

  it("method-of-moments prior: precision-weighted μ0, τ² = var(x̄) − mean(se²) floored at τ_min; fallback under 5 units", () => {
    const units = [
      { xbar: -4, se: 2, n: 40 }, { xbar: 0, se: 2, n: 50 }, { xbar: 4, se: 2, n: 60 },
      { xbar: 8, se: 2, n: 30 }, { xbar: -8, se: 2, n: 35 }, { xbar: 100, se: 1, n: 10 },
    ];
    const p = deskPrior(units, { fallbackMu: 0, fallbackTau: 3 });
    expect(p.method).toBe("moments");
    expect(p.units).toBe(5); // the n = 10 unit is out
    expect(p.mu).toBeCloseTo(0, 12);
    // var(x̄) of {-8,-4,0,4,8} = 40, mean se² = 4 → τ² = 36
    expect(p.tau).toBeCloseTo(6, 12);
    const tight = deskPrior(units.map((u) => ({ ...u, xbar: 0.1 })), { fallbackMu: 0, fallbackTau: 3, tauMin: 1 });
    expect(tight.tau).toBe(1);
    const few = deskPrior(units.slice(0, 3), { fallbackMu: 0.7, fallbackTau: 3 });
    expect(few).toEqual({ mu: 0.7, tau: 3, method: "fallback", units: 3 });
  });

  it("winsorize clips at mean ± k·SD", () => {
    const xs = [...Array.from({ length: 50 }, (_, i) => (i % 2 ? 1 : -1)), 1000];
    const w = winsorize(xs, 3);
    const b = winsorBounds(xs, 3)!;
    expect(Math.max(...w)).toBeCloseTo(b.hi, 9);
    expect(w.slice(0, 50)).toEqual(xs.slice(0, 50));
    expect(winsorize([1, 2], 5)).toEqual([1, 2]);
  });
});

describe("P3 multiple testing", () => {
  it("Benjamini–Hochberg q values match the hand computation and the what-if implementation", () => {
    const p = [0.01, 0.04, 0.03, 0.005, 0.2];
    // sorted: .005 .01 .03 .04 .2 → raw p·m/k: .025 .025 .05 .05 .2 → monotone from the top
    const q = bhQValues(p);
    expect(q[3]).toBeCloseTo(0.025, 12);
    expect(q[0]).toBeCloseTo(0.025, 12);
    expect(q[2]).toBeCloseTo(0.05, 12);
    expect(q[1]).toBeCloseTo(0.05, 12);
    expect(q[4]).toBeCloseTo(0.2, 12);
    expect(Array.from(bhQ(p))).toEqual(q.map((v) => expect.closeTo(v, 12)));
    expect(rejectedAt(q, 0.04)).toEqual([true, false, false, true, false]);
    expect(bhQValues([])).toEqual([]);
    expect(bhQValues([Number.NaN, 0.01])).toEqual([1, 0.02]);
  });

  it("BH controls the false-discovery rate at q on independent null p-values (simulation)", () => {
    const sim = rngFor(11, "bh");
    let anyFalse = 0;
    const R = 2000;
    for (let r = 0; r < R; r++) {
      const p = Array.from({ length: 30 }, () => sim());
      if (bhQValues(p).some((v) => v <= 0.1)) anyFalse++;
    }
    // all nulls: FDR = FWER ≤ 0.1
    expect(anyFalse / R).toBeLessThanOrEqual(0.12);
  });

  it("persistence: blocks agreeing with the sign; empty blocks never agree", () => {
    expect(blocksAgreeing([-1, -2, 3], -1)).toBe(2);
    expect(blocksAgreeing([-1, null, Number.NaN], -1)).toBe(1);
    expect(blocksAgreeing([1, 2, 0], 1)).toBe(2);
  });
});
