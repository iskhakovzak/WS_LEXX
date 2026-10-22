import { describe, expect, it } from "vitest";
import { suggestionGrid } from "../whatIfGrid";
import { type FitView, type Recipe, dayIndicator, fitRecipes, gridRecipes, unitWeights } from "../whatIfRecipes";
import { prepare } from "../whatIfSuggest";
import { mulberry32, quantileSorted, round2, type SimTrade, weightedQuantileSorted } from "../whatIfTypes";
import { mixedTrades } from "./whatIfFixtures";
import { legacySuggestionGrid } from "./whatIfGridLegacy";

/** Noise plus a few losing tickers / setups / tags / mistakes, so the picked and label slots have something to pick. */
function rich(seed: number, traders = 1, days = 90, perDay = 6): SimTrade[] {
  const rnd = mulberry32(seed);
  return mixedTrades({ traders, days, perDay, seed }).map((t) => {
    const x = rnd();
    if (x < 0.08) return { ...t, ticker: "BAD", gross: round2((t.gross ?? 0) - 30) };
    if (x < 0.14) return { ...t, setup: x < 0.11 ? "Chase" : "chase", gross: round2((t.gross ?? 0) - 25) };
    if (x < 0.2) return { ...t, ptags: [x < 0.17 ? "Tilt" : "tilt "], gross: round2((t.gross ?? 0) - 20) };
    if (x < 0.25) return { ...t, mistakes: ["fomo"], gross: round2((t.gross ?? 0) - 15) };
    return t;
  });
}

const keyOf = (rules: unknown[]) => rules.map((r) => JSON.stringify(r));
const dataDependent = (rs: Recipe[]) => rs.filter((r) => !r.fixed);

describe("recipes: stable slots", () => {
  it("72 unique ids on the mixed fixture, the same for another seed; team drops the size and tag slots", () => {
    const a = gridRecipes(prepare(mixedTrades({ traders: 1, days: 60, perDay: 6, seed: 3 })).base).recipes.map((r) => r.id);
    const b = gridRecipes(prepare(rich(9)).base).recipes.map((r) => r.id);
    expect(a).toHaveLength(72);
    expect(new Set(a).size).toBe(72);
    expect(b).toEqual(a);
    const team = gridRecipes(mixedTrades({ traders: 2, days: 30, perDay: 4 }), { team: true }).recipes.map((r) => r.id);
    expect(team).toHaveLength(67);
    expect(team.some((id) => id.startsWith("size.") || id.startsWith("tags."))).toBe(false);
  });

  it("no slot ever yields a commission / loss-cap / min-hold / stop rule", () => {
    for (const trades of [rich(1), mixedTrades({ traders: 2, days: 40, perDay: 5, seed: 4 })]) {
      const { days, recipes } = gridRecipes(prepare(trades).base);
      const rnd = mulberry32(5);
      const views: FitView[] = [{ pick: unitWeights(days.length), all: unitWeights(days.length), minPick: 10 }];
      for (let k = 0; k < 5; k++) {
        const w = Float64Array.from(days, () => Math.floor(rnd() * 3));
        views.push({ pick: w, all: w, minPick: 10 });
      }
      for (const v of views) {
        for (const rule of fitRecipes(recipes, v)) {
          if (rule) expect(["commissionPlan", "capLoss", "minHold", "requireStop"]).not.toContain(rule.type);
        }
      }
    }
  });
});

describe("parity: suggestionGrid over recipes = the committed grid", () => {
  const fixtures: [string, SimTrade[]][] = [
    ["mixed 1×60×6", mixedTrades({ traders: 1, days: 60, perDay: 6, seed: 21 })],
    ["mixed 2×40×5", mixedTrades({ traders: 2, days: 40, perDay: 5, seed: 22 })],
    ["mixed 1×20×4 (no holdout)", mixedTrades({ traders: 1, days: 20, perDay: 4, seed: 23 })],
    ["rich 1×90×6", rich(24)],
    ["rich 2×120×5", rich(25, 2, 120, 5)],
    ["rich 3×45×4", rich(26, 3, 45, 4)],
  ];
  for (const [name, trades] of fixtures) {
    it(name, () => {
      const prep = prepare(trades);
      const shuffled = [...trades].sort((a, b) => ((a.id * 7919) % 101) - ((b.id * 7919) % 101) || a.id - b.id);
      let picked = 0;
      for (const team of [false, true]) {
        for (const input of [trades, prep.base, shuffled]) {
          for (const train of [undefined, null, prep.train] as const) {
            const now = suggestionGrid(input, { team, train });
            expect(now, `${name} team=${team} train=${train === undefined ? "default" : train ? "set" : "null"}`).toEqual(legacySuggestionGrid(input, { team, train }));
            picked += now.filter((c) => c.picked).length;
          }
        }
      }
      expect(picked).toBeGreaterThan(0);
    });
  }
});

describe("weighted quantiles", () => {
  const v = [1, 2, 2, 3, 5, 8, 13, 21];
  it("unit weights = quantileSorted", () => {
    for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) expect(weightedQuantileSorted(v, v.map(() => 1), q)).toBeCloseTo(quantileSorted(v, q), 12);
  });
  it("integer weights = the expanded multiset; zero weights drop out", () => {
    const w = [0, 3, 1, 0, 2, 1, 0, 4];
    const expanded = v.flatMap((x, i) => Array.from({ length: w[i] }, () => x));
    for (const q of [0, 0.1, 0.33, 0.5, 0.75, 0.9, 1]) expect(weightedQuantileSorted(v, w, q)).toBeCloseTo(quantileSorted(expanded, q), 12);
    expect(weightedQuantileSorted(v, v.map(() => 0), 0.5)).toBeNaN();
  });
});

describe("weighted fits = fits on the physically cut / resampled trades", () => {
  const trades = rich(31, 1, 120, 6);
  const prep = prepare(trades);
  const { days, recipes } = gridRecipes(prep.base);

  it("fold weights (0/1) = the fit on the sliced trades", () => {
    for (const cut of [40, 70, 100]) {
      const keep = new Set(days.slice(0, cut));
      const w = dayIndicator(days, keep);
      const weighted = fitRecipes(dataDependent(recipes), { pick: w, all: w, minPick: 7 });
      const sliced = gridRecipes(prep.base.filter((t) => keep.has(t.day)));
      const ones = unitWeights(sliced.days.length);
      const direct = fitRecipes(dataDependent(sliced.recipes), { pick: ones, all: ones, minPick: 7 });
      expect(keyOf(weighted)).toEqual(keyOf(direct));
      expect(weighted.filter(Boolean).length).toBeGreaterThan(8);
    }
  });

  it("bootstrap day counts = the fit on the days physically duplicated", () => {
    const rnd = mulberry32(77);
    for (let rep = 0; rep < 4; rep++) {
      const counts = new Float64Array(days.length);
      for (let i = 0; i < days.length; i++) counts[(rnd() * days.length) | 0]++;
      const weighted = fitRecipes(dataDependent(recipes), { pick: counts, all: counts, minPick: 10 });
      // Copy k of a day drawn c times is a distinct day «YYYY-MM-DD#k» (a distinct trader-day, as in the resample).
      let id = 1;
      const dup: SimTrade[] = [];
      days.forEach((d, i) => {
        for (let k = 0; k < counts[i]; k++) for (const t of prep.base) if (t.day === d) dup.push({ ...t, id: id++, day: `${d}#${k}` });
      });
      const g = gridRecipes(dup);
      const ones = unitWeights(g.days.length);
      const direct = fitRecipes(dataDependent(g.recipes), { pick: ones, all: ones, minPick: 10 });
      expect(keyOf(weighted)).toEqual(keyOf(direct));
    }
  });
});
