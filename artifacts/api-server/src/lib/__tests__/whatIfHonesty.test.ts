import { describe, expect, it } from "vitest";
import { runScenario } from "../whatIf";
import { HONESTY, type HonestyResult, computeHonesty, computeHonestyAsync, timingOf } from "../whatIfHonesty";
import { candidateEffect, familyBootstrap, prepare } from "../whatIfSuggest";
import { mixedTrades } from "./whatIfFixtures";
import { noise, plant, sequentialDays } from "./whatIfHonestyFixtures";

/** Faster settings for the many-run tests (the defaults are 600 / 200). */
const QUICK = { iters: 300, perms: 100 };
const verdict = (r: HonestyResult, id: string) => r.verdicts.find((v) => v.id === id);
const confirmedIds = (r: HonestyResult) => r.verdicts.filter((v) => v.status === "confirmed").map((v) => v.id);
const bad = (seed: number, days = 220) => plant(noise(seed, days), { seed: seed + 1000, ticker: "BAD" });

describe("pure noise", () => {
  it("≥ 19 of 20 seeds confirm nothing (200 days × 6, 7 months)", { timeout: 180_000 }, () => {
    const withConfirmed: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = computeHonesty(noise(seed), QUICK);
      expect(r.wfAvailable).toBe(true);
      if (r.confirmed > 0 || confirmedIds(r).length) withConfirmed.push(seed);
    }
    expect(withConfirmed.length).toBeLessThanOrEqual(1);
  });
});

describe("planted effects", () => {
  it("a losing ticker (≈ 1 trade a day at −$50 ± 20, 220 days) is confirmed, helps out of sample, first card, before the entry", () => {
    const r = computeHonesty(bad(1), QUICK);
    const v = verdict(r, "tickers.worst1");
    expect(v?.rule).toEqual({ type: "excludeTickers", tickers: ["BAD"] });
    expect(v?.status).toBe("confirmed");
    expect(v!.wf.positive).toBeGreaterThanOrEqual(0.6 * v!.wf.months);
    expect(r.cards[0]).toMatchObject({ recipeId: "tickers.worst1", status: "confirmed", timing: "exante", picked: true, sameData: false, needDays: null });
    expect(r.cards[0].oos).toMatchObject({ months: v!.wf.months, positive: v!.wf.positive });
  });

  it("tilt after 2 losses in a row: «stop after 2 losses» is confirmed, the within-day permutation included", () => {
    const r = computeHonesty(sequentialDays(3, { tilt: 40 }), QUICK);
    const v = verdict(r, "sal.2");
    expect(v?.ordering).toBe(true);
    expect(v?.pPermAdj).toBeLessThanOrEqual(0.1);
    expect(v?.status).toBe("confirmed");
  });

  it("control: every trade at −$5 with no ordering — «at most N trades a day» is never confirmed (the permutation fails)", () => {
    const r = computeHonesty(sequentialDays(4, { drift: -5 }), QUICK);
    const mtd = r.verdicts.filter((v) => v.id.startsWith("mtd."));
    expect(mtd.length).toBeGreaterThan(0);
    for (const v of mtd) expect(v.status, v.id).not.toBe("confirmed");
  });

  it("«trade less» is not an attribute effect: a losing trader with no attribute effect confirms no non-ordering rule (defaults)", { timeout: 120_000 }, () => {
    // Every trade iid at mean −$5 (sd ≈ $40). Before the excess guard 10 of 10 seeds confirmed 4–9 rules each
    // («не торгуй лонг», «без BBB», «до 11:30» …): any rule that removes a third of the trades adds ≈ $5 per trade.
    let dollarsPass = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = computeHonesty(sequentialDays(seed, { drift: -5 }));
      const attr = r.verdicts.filter((v) => !v.ordering);
      expect(attr.filter((v) => v.status === "confirmed").map((v) => v.id), `seed ${seed}`).toEqual([]);
      for (const v of attr) {
        expect(v.excess, v.id).not.toBeNull();
        // The dollar effect alone may pass; then the excess over the average trade is what keeps it out.
        if (v.pAdj <= HONESTY.alphaConfirm && v.gates) { dollarsPass++; expect(v.excess!.pAdj, `${seed} ${v.id}`).toBeGreaterThan(HONESTY.alphaConfirm); }
      }
    }
    expect(dollarsPass).toBeGreaterThan(10);
  });

  it("days needed of an ordering hypothesis come from the permutation excess too (no «~21 days» for a claim the permutation rejects)", () => {
    // Seed 7, defaults: sal.2 had bootstrap t 5.15 but permutation p 0.39; it was «Гипотеза — нужно ещё ~21 день».
    const r = computeHonesty(sequentialDays(7, { drift: -5 }));
    expect(r.cards.map((c) => c.recipeId)).not.toContain("sal.2");
    expect(r.cards.map((c) => c.recipeId)).not.toContain("afterLoss.30");
    const z = HONESTY.mde.z;
    for (const c of r.cards) {
      const v = verdict(r, c.recipeId)!;
      if (!v.ordering || c.status !== "hypothesis") continue;
      expect(v.tPerm, c.recipeId).toBeGreaterThan(0);
      expect(c.needDays!, c.recipeId).toBeGreaterThanOrEqual(Math.ceil(r.days * (z / v.tPerm!) ** 2) - r.days);
    }
  });

  it("decay: the ticker loses only in the first 3 of 8 months → not confirmed (the walk-forward fails)", () => {
    const trades = plant(noise(5, 243), { seed: 1005, ticker: "BAD", mean: (day) => (day < "2026-04-01" ? -50 : 15) });
    const r = computeHonesty(trades, QUICK);
    const v = r.verdicts.find((x) => x.id.startsWith("tickers.") && JSON.stringify(x.rule).includes("BAD"));
    expect(v).toBeDefined();
    expect(v!.status).not.toBe("confirmed");
    expect(v!.wf.positive).toBeLessThan(0.6 * v!.wf.months);
  });

  it("«no AMD»: a picked ticker that stops trading after month 5 is never confirmed", () => {
    const trades = plant(noise(6, 270), { seed: 1006, ticker: "AMD", present: (day) => day < "2026-06-01" });
    const r = computeHonesty(trades, QUICK);
    const v = r.verdicts.find((x) => x.id.startsWith("tickers.") && JSON.stringify(x.rule).includes("AMD"));
    expect(v).toBeDefined();
    expect(v!.status).not.toBe("confirmed");
  });

  it("spike: 3 days of a large loss on one ticker → not confirmed; flagged «rests on 3 days» when shown", () => {
    // SPK trades on every 10th day at break-even; on 3 of those days it loses $3,000.
    const spike = (_d: string, i: number) => (i === 50 || i === 120 || i === 180 ? -3000 : 0);
    const trades = plant(noise(7, 220), { seed: 1007, ticker: "SPK", present: (_d, i) => i % 10 === 0, mean: spike, jitter: 0 });
    const r = computeHonesty(trades, QUICK);
    const v = r.verdicts.find((x) => JSON.stringify(x.rule).includes("SPK"));
    expect(v).toBeDefined();
    expect(v!.status).not.toBe("confirmed");
    expect(v!.withoutTop3).toBeLessThanOrEqual(0);
    const card = r.cards.find((c) => JSON.stringify(c.rule).includes("SPK"));
    if (card) expect(card.fragile).toEqual({ reason: "topDays", days: 3 });
  });
});

describe("not enough data", () => {
  it("< 6 months: no walk-forward, nothing confirmed, hypotheses say «at least» the missing months", () => {
    const r = computeHonesty(bad(8, 120), QUICK);
    expect(r.months).toBe(4);
    expect(r.wfAvailable).toBe(false);
    expect(confirmedIds(r)).toEqual([]);
    const hyp = r.cards.filter((c) => c.status === "hypothesis" && c.kind === "exante");
    expect(hyp.length).toBeGreaterThan(0);
    expect(hyp.map((c) => c.recipeId)).toContain("tickers.worst1");
    for (const c of hyp) {
      expect(c.needDaysAtLeast).toBe(true);
      expect(c.needDays).toBeGreaterThanOrEqual((6 - 4) * 21);
      expect(c.oos).toBeNull();
    }
    expect(r.cards.find((c) => c.recipeId === "tickers.worst1")?.sameData).toBe(true);
  });

  it("a small sample (25 days) confirms nothing", () => {
    const r = computeHonesty(bad(9, 25), QUICK);
    expect(r.smallSample).toBe(true);
    expect(confirmedIds(r)).toEqual([]);
  });

  it("fewer than 2 days → no cards", () => {
    const r = computeHonesty(noise(10, 1), QUICK);
    expect(r).toMatchObject({ tested: 0, cards: [], verdicts: [] });
  });
});

describe("label rules (review)", () => {
  it("a losing setup is never confirmed and sorts after the ex-ante cards", () => {
    const trades = plant(plant(noise(11, 220), { seed: 1011, ticker: "BAD" }), { seed: 2011, setup: "Chase", slot: 1 });
    const r = computeHonesty(trades, QUICK);
    const setup = r.verdicts.find((v) => v.id === "setups.worst1");
    expect(setup?.rule).toEqual({ type: "excludeSetups", setups: ["Chase"] });
    expect(setup?.status).toBe("hypothesis");
    for (const v of r.verdicts) if (v.kind === "label") expect(v.status, v.id).not.toBe("confirmed");
    const firstLabel = r.cards.findIndex((c) => c.kind === "label");
    expect(firstLabel).toBeGreaterThan(0);
    expect(r.cards.slice(firstLabel).every((c) => c.kind === "label" && c.timing === "review")).toBe(true);
  });

  it("a «разбор» card never promises days: more data cannot confirm it (220 and 440 days, 6/6 and 13/13 months helped)", () => {
    for (const days of [220, 440]) {
      const trades = plant(plant(noise(11, days), { seed: 1011, ticker: "BAD" }), { seed: 2011, setup: "Chase", slot: 1 });
      const r = computeHonesty(trades, QUICK);
      const review = r.cards.filter((c) => c.timing === "review");
      expect(review.map((c) => c.recipeId), String(days)).toContain("setups.worst1");
      for (const c of review) expect({ id: c.recipeId, status: c.status, needDays: c.needDays, atLeast: c.needDaysAtLeast }).toEqual({ id: c.recipeId, status: "hypothesis", needDays: null, atLeast: false });
    }
  });
});

describe("F2 timing", () => {
  it("label → review; exit-time rules → in the trade; everything else → before the entry", () => {
    expect(timingOf({ type: "excludeSetups", setups: ["x"] }, "label")).toBe("review");
    expect(timingOf({ type: "minGrade", grade: "A" }, "label")).toBe("review");
    expect(timingOf({ type: "minHold", seconds: 60 }, "exante")).toBe("inTrade");
    expect(timingOf({ type: "capLoss", usd: 50 }, "exante")).toBe("inTrade");
    expect(timingOf({ type: "timeWindow", to: "11:00" }, "exante")).toBe("exante");
    expect(timingOf({ type: "stopAfterLosses", n: 2 }, "exante")).toBe("exante");
  });
});

describe("cards", () => {
  const trades = plant(plant(noise(12, 220), { seed: 1012, ticker: "BAD" }), { seed: 2012, setup: "Chase", slot: 1 });
  const r = computeHonesty(trades, QUICK);

  it("numbers match the scenario page: scenarioNet = baseline + improvement, ci = the fast path's per-rule interval", () => {
    expect(r.cards.length).toBeGreaterThan(0);
    const baseline = runScenario(trades, [], { bootstrap: false }).baseline.net;
    const prep = prepare(trades, { iters: QUICK.iters });
    for (const c of r.cards) {
      expect(Math.abs(c.scenarioNet - (baseline + c.improvement)), c.recipeId).toBeLessThan(0.02);
      expect(c.ci, c.recipeId).toEqual(familyBootstrap(prep, [candidateEffect(prep, c.rule)]).boots[0].ci);
    }
  });

  it("caps: ≤ 8 cards, one per rule type, ≤ 1 label, ≤ 2 picked; never an in-trade or commission rule", () => {
    expect(r.cards.length).toBeLessThanOrEqual(8);
    expect(new Set(r.cards.map((c) => c.rule.type)).size).toBe(r.cards.length);
    expect(r.cards.filter((c) => c.kind === "label").length).toBeLessThanOrEqual(1);
    expect(r.cards.filter((c) => c.picked).length).toBeLessThanOrEqual(2);
    for (const c of r.cards) {
      expect(c.timing).not.toBe("inTrade");
      expect(["commissionPlan", "capLoss", "minHold"]).not.toContain(c.rule.type);
    }
    expect(r.confirmed + r.hypotheses).toBe(r.cards.length);
  });
});

describe("determinism", () => {
  const trades = mixedTrades({ traders: 1, days: 75, perDay: 5, seed: 13 });

  it("the same input gives a deep-equal result; the async driver gives the sync result", async () => {
    const a = computeHonesty(trades, QUICK);
    expect(computeHonesty([...trades].reverse(), QUICK)).toEqual(a);
    expect(await computeHonestyAsync(trades, QUICK, { yieldMs: 0 })).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("an aborted signal rejects with an AbortError (before the start and mid-way)", async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(computeHonestyAsync(trades, QUICK, { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
    const mid = new AbortController();
    const run = computeHonestyAsync(trades, QUICK, { signal: mid.signal, yieldMs: 0 });
    setImmediate(() => mid.abort());
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
