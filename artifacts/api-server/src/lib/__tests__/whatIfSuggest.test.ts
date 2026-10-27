import { describe, expect, it } from "vitest";
import { mulberry32, runScenario, type Rule, type SimTrade } from "../whatIf";
import { suggestionGrid } from "../whatIfGrid";
import { candidateEffect, familyBootstrap, findSuggestions, passesGates, prepare, selectCards, type Effect, type Scored } from "../whatIfSuggest";
import { dayList, mixedTrades, mk } from "./whatIfFixtures";

describe("fast path parity with runScenario", () => {
  const trades = mixedTrades({ traders: 2, days: 40, perDay: 5, seed: 11 });
  const prep = prepare(trades, { iters: 600, seed: 20260101 });
  const extra: Rule[] = [
    { type: "capLoss", usd: 30 }, { type: "minHold", seconds: 120 }, { type: "requireStop" }, { type: "excludeTags", tags: ["news"] },
    { type: "commissionPlan", perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: false }, { type: "maxSizeRel", x: 2 },
  ];
  const rules = [...suggestionGrid(prep.base, { train: prep.train }).map((c) => c.rule), ...extra];

  it("tries a rich grid on the mixed fixture", () => {
    expect(rules.length).toBeGreaterThan(50);
  });

  it("delta, affected and the interval match runScenario + pairedDayBootstrap (600 iters, same seed) for every rule", () => {
    let exact = 0;
    for (const rule of rules) {
      const e = candidateEffect(prep, rule);
      const r = runScenario(trades, [rule], { iters: 600, seed: 20260101 });
      const label = JSON.stringify(rule);
      expect(e.skipped, label).toBe(r.skipped.length > 0);
      expect(e.excluded + e.changed, label).toBe(r.excluded.length + r.changed.length);
      expect(Math.abs(e.delta - (r.scenario.net - r.baseline.net)), label).toBeLessThan(0.006);
      expect(e.tradesLeft, label).toBe(r.scenario.trades);
      // Same resamples (count matrix in pairedDayBootstrap's draw order); the sums run in another order, so a
      // quantile that lands exactly on a half cent may round the other way: equal to the cent.
      const { boots } = familyBootstrap(prep, [e]);
      expect(Math.abs(boots[0].ci.lo - r.bootstrap!.diffTotal.lo), label).toBeLessThanOrEqual(0.0100001);
      expect(Math.abs(boots[0].ci.hi - r.bootstrap!.diffTotal.hi), label).toBeLessThanOrEqual(0.0100001);
      exact += Number(boots[0].ci.lo === r.bootstrap!.diffTotal.lo && boots[0].ci.hi === r.bootstrap!.diffTotal.hi);
    }
    expect(exact / rules.length).toBeGreaterThan(0.9);
  });
});

/** A synthetic scored candidate for the selection rules. */
function sc(rule: Rule, delta: number, ids: number[], o: Partial<Pick<Scored, "kind" | "picked" | "robust">> & { imxShare?: number } = {}): Scored {
  const e: Effect = {
    rule, skipped: false, dayDiff: new Float64Array(0), dayRemoved: new Float64Array(0), affectedIds: new Set(ids), excluded: ids.length, changed: 0, removedNet: -delta,
    delta, tradesLeft: 100, affectedTraderDays: 5, holdout: null, imxShare: o.imxShare ?? 0,
  };
  return { kind: o.kind ?? "exante", picked: o.picked ?? false, robust: o.robust ?? false, e, b: { ci: { lo: 0, hi: 0 }, se: 1, center: delta } };
}
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const types = (cards: Scored[]) => cards.map((c) => JSON.stringify(c.e.rule));

describe("selection caps", () => {
  it("one card per rule type (the bigger effect)", () => {
    const out = selectCards([sc({ type: "timeWindow", to: "15:00" }, 50, ids(1, 10)), sc({ type: "timeWindow", to: "11:00" }, 80, ids(100, 10))]);
    expect(types(out)).toEqual([JSON.stringify({ type: "timeWindow", to: "11:00" })]);
  });

  it("at most one label card", () => {
    const out = selectCards([
      sc({ type: "minGrade", grade: "A" }, 90, ids(1, 10), { kind: "label" }),
      sc({ type: "excludeMistakes", codes: ["fomo"] }, 80, ids(100, 10), { kind: "label" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].e.rule.type).toBe("minGrade");
  });

  it("at most two picked cards", () => {
    const out = selectCards([
      sc({ type: "excludeTickers", tickers: ["A"] }, 90, ids(1, 10), { picked: true }),
      sc({ type: "priceRange", min: 5 }, 80, ids(100, 10), { picked: true }),
      sc({ type: "excludeSide", side: "long" }, 70, ids(200, 10), { picked: true }),
      sc({ type: "maxTradesPerDay", n: 3 }, 60, ids(300, 10)),
    ]);
    expect(out.map((c) => c.e.rule.type)).toEqual(["excludeTickers", "priceRange", "maxTradesPerDay"]);
  });

  it("skips a card whose affected trades are ≥ 70% those of a card above", () => {
    const out = selectCards([
      sc({ type: "maxTradesPerDay", n: 3 }, 90, ids(1, 10)),
      sc({ type: "stopAfterLosses", n: 2 }, 80, [...ids(1, 7), ...ids(100, 3)]),
      sc({ type: "afterLoss", minutes: 5 }, 70, [...ids(1, 6), ...ids(200, 4)]),
    ]);
    expect(out.map((c) => c.e.rule.type)).toEqual(["maxTradesPerDay", "afterLoss"]);
  });

  it("IMX guard: «не позже 15:00» that is ≥ 70% IMX goes when «без IMX» is kept", () => {
    const imx = sc({ type: "excludeImx" }, 50, ids(1, 10));
    const late = (share: number) => sc({ type: "timeWindow", to: "15:00" }, 90, ids(100, 10), { imxShare: share });
    expect(selectCards([imx, late(0.8)]).map((c) => c.e.rule.type)).toEqual(["excludeImx"]);
    expect(selectCards([imx, late(0.6)]).map((c) => c.e.rule.type)).toEqual(["timeWindow", "excludeImx"]);
    expect(selectCards([late(0.8)]).map((c) => c.e.rule.type)).toEqual(["timeWindow"]);
  });

  it("IMX guard only once «без IMX» is actually shown: cut by the limit, the IMX-heavy card stays", () => {
    const robust = sc({ type: "timeWindow", to: "15:00" }, 500, ids(1, 10), { robust: true, imxShare: 0.8 });
    const weak = (["priceRange", "maxTradesPerDay", "stopAfterLosses", "afterLoss", "excludeSide", "dailyLossLimit", "noReentry", "sizeRange"] as const)
      .map((type, i) => sc({ type } as Rule, 300 - i * 10, ids(100 * (i + 1), 10)));
    const imx = sc({ type: "excludeImx" }, 100, ids(5000, 10));
    const out = selectCards([robust, ...weak, imx]);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe(robust);
    expect(out.map((c) => c.e.rule.type)).not.toContain("excludeImx");
  });

  it("IMX guard only once «без IMX» is actually shown: skipped for overlap, the IMX-heavy card stays", () => {
    // A card above already covers every IMX trade, so «без IMX» is never shown — the 15:00 card must not vanish with it.
    const wide = sc({ type: "maxTradesPerDay", n: 3 }, 90, [...ids(1, 10), ...ids(100, 20)], { imxShare: 0.33 });
    const late = sc({ type: "timeWindow", to: "15:00" }, 80, [1, 2, 3, ...ids(300, 7)], { imxShare: 0.8 });
    const imx = sc({ type: "excludeImx" }, 50, ids(1, 10));
    expect(selectCards([wide, late, imx]).map((c) => c.e.rule.type)).toEqual(["maxTradesPerDay", "timeWindow"]);
  });

  it("orders robust ex-ante → robust label → weak ex-ante → weak label, then the effect, and stops at the limit", () => {
    const pool: Scored[] = [
      sc({ type: "priceRange", min: 5 }, 10, ids(1, 5)),
      sc({ type: "minGrade", grade: "A" }, 20, ids(100, 5), { kind: "label", robust: true }),
      sc({ type: "excludeSide", side: "short" }, 5, ids(200, 5), { robust: true }),
      sc({ type: "maxTradesPerDay", n: 2 }, 30, ids(300, 5)),
    ];
    expect(selectCards(pool).map((c) => c.e.rule.type)).toEqual(["excludeSide", "minGrade", "maxTradesPerDay", "priceRange"]);
    const many = Array.from({ length: 12 }, (_, i) => sc({ type: (["priceRange", "maxTradesPerDay", "stopAfterLosses", "afterLoss", "excludeSide", "timeWindow", "dailyLossLimit", "noReentry", "excludeImx", "sizeRange", "maxSizeRel", "dailyProfitTarget"] as const)[i] } as Rule, 100 - i, ids(1000 * (i + 1), 5)));
    expect(selectCards(many)).toHaveLength(8);
  });
});

describe("IMX guard end to end (imxShare from candidateEffect)", () => {
  /**
   * 40 days: three winners before 14:31 (+$40 each), then one late loser — an IMX entry at 15:55 (−$20) on 30 days, a
   * 15:20 entry (−$15) on the other 10. «не позже 15:00» removes the same IMX trades plus the 15:20 ones: 75% IMX.
   */
  const day = (imxNet: number, lateNet: number) => {
    const TICK = ["AAA", "BBB", "CCC", "DDD"];
    const out: SimTrade[] = [];
    dayList(40).forEach((d, i) => {
      const side = (k: number) => ((i + k) % 2 ? "long" as const : "short" as const);
      const tk = (k: number) => TICK[(i * 5 + k) % 4];
      for (const [k, entryMin] of [[0, 600], [1, 660], [2, 870]] as const) out.push(mk({ day: d, entryMin, gross: 40, side: side(k), ticker: tk(k) }));
      if (i % 4 === 3) out.push(mk({ day: d, entryMin: 920, gross: lateNet, side: side(3), ticker: tk(3) }));
      else out.push(mk({ day: d, entryMin: 955, gross: imxNet, side: side(3), ticker: tk(3), imx: true }));
    });
    return out;
  };

  it("imxShare counts the IMX trades among the removed ones", () => {
    const prep = prepare(day(-20, -15));
    const late = candidateEffect(prep, { type: "timeWindow", to: "15:00" });
    expect(late).toMatchObject({ excluded: 40, delta: 750, imxShare: 0.75 });
    expect(passesGates(late, false, prep.n)).toBe(true);
    expect(candidateEffect(prep, { type: "excludeImx" })).toMatchObject({ excluded: 30, delta: 600, imxShare: 1 });
    expect(candidateEffect(prep, { type: "timeWindow", from: "10:30" }).imxShare).toBe(0);
  });

  it("with «без IMX» shown, the cards that are mostly IMX (15:00 window, its twins) are not", () => {
    const r = findSuggestions(day(-20, -15));
    expect(r.suggestions.map((s) => s.rule)).toEqual([{ type: "excludeImx" }]);
  });

  it("without a «без IMX» card, the 15:00 window may show", () => {
    const r = findSuggestions(day(5, -100));
    expect(r.suggestions.some((s) => s.rule.type === "excludeImx")).toBe(false);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions[0].improvement).toBe(850);
  });
});

describe("keep gates", () => {
  const eff = (p: Partial<Effect>): Effect => ({ ...sc({ type: "excludeSide", side: "long" }, 50, ids(1, 10)).e, ...p });
  it("at most half of the trades removed", () => {
    expect(passesGates(eff({ excluded: 50 }), false, 100)).toBe(true);
    expect(passesGates(eff({ excluded: 51 }), false, 100)).toBe(false);
  });
  it("affected ≥ max(5, 2% of the trades)", () => {
    expect(passesGates(eff({ excluded: 4 }), false, 100)).toBe(false);
    expect(passesGates(eff({ excluded: 5 }), false, 100)).toBe(true);
    expect(passesGates(eff({ excluded: 19, tradesLeft: 981 }), false, 1000)).toBe(false);
    expect(passesGates(eff({ excluded: 20, tradesLeft: 980 }), false, 1000)).toBe(true);
  });
  it("≥ 3 trader-days, ≥ 30 trades left, a positive effect", () => {
    expect(passesGates(eff({ affectedTraderDays: 2 }), false, 100)).toBe(false);
    expect(passesGates(eff({ affectedTraderDays: 3 }), false, 100)).toBe(true);
    expect(passesGates(eff({ tradesLeft: 29 }), false, 100)).toBe(false);
    expect(passesGates(eff({ delta: 0 }), false, 100)).toBe(false);
  });
  it("a picked card must also win on ≥ 3 affected TEST trades", () => {
    expect(passesGates(eff({ holdout: { delta: 5, days: 20, affected: 3 } }), true, 100)).toBe(true);
    expect(passesGates(eff({ holdout: { delta: 0, days: 20, affected: 3 } }), true, 100)).toBe(false);
    expect(passesGates(eff({ holdout: { delta: 5, days: 20, affected: 2 } }), true, 100)).toBe(false);
    expect(passesGates(eff({ holdout: { delta: -5, days: 20, affected: 9 } }), false, 100)).toBe(true);
  });
});

/** A ticker that loses on ~60% of the days (−$50 ± $20), on top of the noise. */
function withBadTicker(trades: SimTrade[], days: string[], seed = 5): SimTrade[] {
  const rnd = mulberry32(seed);
  const out = [...trades];
  let id = 900_000;
  for (const day of days) {
    if (rnd() >= 0.6) continue;
    // Same spread of times / prices / sides as the noise: only the ticker carries the effect.
    const entryMin = 540 + Math.floor(rnd() * 451), entry = Math.round(100 + rnd() * 29900) / 100, side = rnd() < 0.5 ? "long" as const : "short" as const;
    out.push(mk({ id: ++id, seq: id, day, ticker: "BAD", entryMin, entry, side, qty: 200, gross: Math.round(-5000 + (rnd() - 0.5) * 4000) / 100, trader: "T0" }));
  }
  return out;
}

describe("family-wise correction (single-step max-t)", () => {
  const noise = mixedTrades({ traders: 1, days: 150, perDay: 6, seed: 3 });
  const found = findSuggestions(noise);

  it("pure noise over ~70 candidates: nothing robust", () => {
    expect(found.tested).toBeGreaterThan(50);
    expect(found.smallSample).toBe(false);
    expect(found.suggestions.filter((s) => s.robust)).toEqual([]);
  });

  it("a planted losing ticker is robust", () => {
    const r = findSuggestions(withBadTicker(noise, dayList(150)));
    const bad = r.suggestions.find((s) => s.rule.type === "excludeTickers" && s.rule.tickers[0] === "BAD");
    expect(bad).toMatchObject({ robust: true, picked: true, sameData: false, kind: "exante" });
    expect(bad!.holdout!.delta).toBeGreaterThan(0);
  });

  it("a planted mistake on losers (plus 20% non-losers) is robust", () => {
    const rnd = mulberry32(9);
    const marked = noise.map((t, i) => (i % 9 === 0 ? { ...t, gross: rnd() < 0.2 ? 10 : -60, mistakes: ["fomo" as const] } : { ...t, mistakes: [] }));
    const r = findSuggestions(marked);
    expect(r.suggestions.find((s) => s.rule.type === "excludeMistakes")).toMatchObject({ robust: true, kind: "label" });
  });

  it("the caps hold on a real run: ≤ 8 cards, one per type, ≤ 1 label, ≤ 2 picked, tiers in order", () => {
    const r = findSuggestions(withBadTicker(noise, dayList(150)));
    const s = r.suggestions;
    expect(s.length).toBeLessThanOrEqual(8);
    expect(new Set(s.map((x) => x.rule.type)).size).toBe(s.length);
    expect(s.filter((x) => x.kind === "label").length).toBeLessThanOrEqual(1);
    expect(s.filter((x) => x.picked).length).toBeLessThanOrEqual(2);
    const tier = s.map((x) => (x.robust ? 0 : 2) + (x.kind === "label" ? 1 : 0));
    expect(tier).toEqual([...tier].sort((a, b) => a - b));
    expect(findSuggestions(withBadTicker(noise, dayList(150)), { limit: 2 }).suggestions.length).toBeLessThanOrEqual(2);
  });
});

describe("small samples", () => {
  const short = withBadTicker(mixedTrades({ traders: 1, days: 25, perDay: 6, seed: 4 }), dayList(25));
  const r = findSuggestions(short);

  it("fewer than 30 days: smallSample, nothing robust", () => {
    expect(r.smallSample).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => !s.robust)).toBe(true);
  });

  it("a picked card without a holdout says it was checked on the same data", () => {
    const picked = r.suggestions.filter((s) => s.picked);
    expect(picked.length).toBeGreaterThan(0);
    for (const s of picked) expect(s).toMatchObject({ sameData: true, holdout: null });
  });

  it("fewer than 2 days: no suggestions", () => {
    expect(findSuggestions([mk({ gross: 1 }), mk({ gross: -1 })]).suggestions).toEqual([]);
  });
});

describe("determinism and the finalists", () => {
  const trades = withBadTicker(mixedTrades({ traders: 2, days: 60, perDay: 4, seed: 21 }), dayList(60));
  it("the same input gives the same answer", () => {
    expect(findSuggestions(trades, { team: true })).toEqual(findSuggestions(trades, { team: true }));
  });
  it("each card's scenario net is baseline + its fast delta", () => {
    const base = runScenario(trades, [], { bootstrap: false }).baseline.net;
    const r = findSuggestions(trades);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s of r.suggestions) {
      expect(Math.abs(s.scenarioNet - base - s.improvement)).toBeLessThan(0.011);
      expect(s.affected).toBe(s.excluded + s.changed);
    }
  });
});
