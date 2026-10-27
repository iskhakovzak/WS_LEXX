import { describe, expect, it } from "vitest";
import { bhQ, byQ, normalTail, romanoWolf } from "../whatIfStepdown";
import { mulberry32 } from "../whatIfTypes";

describe("Romano–Wolf stepdown", () => {
  // 3 hypotheses × 4 replicates. Order by t: j0 (3) > j2 (2) > j1 (1).
  const t = [3, 1, 2];
  const T = Float64Array.from([
    0.5, 3.5, -1, 0, // j0
    2, 0, 1.5, -0.5, // j1
    1, 0.2, 2.5, 0.1, // j2
  ]);

  it("adjusted p values of a hand matrix", () => {
    // j1: suffix {j1}: #{2, 1.5 ≥ 1} = 2 → 3/5. j2: suffix {j2, j1} max = [2, .2, 2.5, .1]: #≥2 = 2 → 3/5.
    // j0: suffix all, max = [2, 3.5, 2.5, .1]: #≥3 = 1 → 2/5. Monotone: j0 .4, j2 max(.4, .6), j1 max(.6, .6).
    expect([...romanoWolf(t, T, 3, 4)]).toEqual([0.4, 0.6, 0.6]);
  });

  it("monotone along t, ≥ each hypothesis's own p and ≤ the single-step max-t p", () => {
    const rnd = mulberry32(3);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const m = 12, B = 300;
    const tObs = Array.from({ length: m }, (_, j) => gauss() + (j < 3 ? 3 : 0));
    const M = Float64Array.from({ length: m * B }, () => gauss());
    const adj = romanoWolf(tObs, M, m, B);
    const byT = Array.from({ length: m }, (_, j) => j).sort((a, b) => tObs[b] - tObs[a]);
    for (let i = 1; i < m; i++) expect(adj[byT[i]]).toBeGreaterThanOrEqual(adj[byT[i - 1]]);
    for (let j = 0; j < m; j++) {
      let own = 0, single = 0;
      for (let b = 0; b < B; b++) {
        if (M[j * B + b] >= tObs[j]) own++;
        let mx = -Infinity;
        for (let k = 0; k < m; k++) mx = Math.max(mx, M[k * B + b]);
        if (mx >= tObs[j]) single++;
      }
      expect(adj[j]).toBeGreaterThanOrEqual((1 + own) / (B + 1) - 1e-12);
      expect(adj[j]).toBeLessThanOrEqual((1 + single) / (B + 1) + 1e-12);
    }
  });

  it("−∞ (no statistic in a replicate) never counts as an exceedance", () => {
    expect([...romanoWolf([1], Float64Array.from([-Infinity, -Infinity, 2, 0]), 1, 4)]).toEqual([0.4]);
  });

  it("50 independent nulls over 400 simulated studies: family-wise error ≈ α = 0.10", () => {
    const rnd = mulberry32(11);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const m = 50, B = 200;
    let studiesWithAFalseFind = 0;
    for (let s = 0; s < 400; s++) {
      const tObs = Array.from({ length: m }, gauss);
      const M = Float64Array.from({ length: m * B }, gauss);
      if (romanoWolf(tObs, M, m, B).some((p) => p <= 0.1)) studiesWithAFalseFind++;
    }
    const fwer = studiesWithAFalseFind / 400;
    console.log(`[whatIfStepdown] simulated FWER at α = 0.10: ${fwer}`);
    expect(fwer).toBeGreaterThanOrEqual(0.05);
    expect(fwer).toBeLessThanOrEqual(0.15);
  });
});

describe("FDR q values", () => {
  const p = [0.01, 0.04, 0.03, 0.005];
  it("Benjamini–Hochberg on a textbook example", () => {
    // sorted .005 .01 .03 .04 → p·m/k = .02 .02 .04 .04 → running min from the top: .02 .02 .04 .04
    const q = bhQ(p);
    [0.02, 0.04, 0.04, 0.02].forEach((v, i) => expect(q[i]).toBeCloseTo(v, 12));
  });
  it("Benjamini–Yekutieli = BH × Σ 1/i (capped at 1)", () => {
    const c = 1 + 1 / 2 + 1 / 3 + 1 / 4;
    const q = byQ(p);
    [0.02, 0.04, 0.04, 0.02].forEach((v, i) => expect(q[i]).toBeCloseTo(v * c, 12));
    expect([...byQ([0.5, 0.9])]).toEqual([1, 1]);
  });
});

describe("normal tail", () => {
  it("matches the standard normal to 1e-7", () => {
    expect(normalTail(0)).toBeCloseTo(0.5, 7);
    expect(normalTail(1.645)).toBeCloseTo(0.0499849, 6);
    expect(normalTail(3)).toBeCloseTo(0.0013499, 6);
    expect(normalTail(-1.645)).toBeCloseTo(1 - 0.0499849, 6);
  });
});
