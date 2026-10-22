import { describe, expect, it } from "vitest";
import { HONESTY } from "../whatIfHonesty";
import { type SlotFacts, decideSlot, familyNeighbours, fragileOf, monthFolds, needDaysFor, statusFor, walkForward, wfOk, withoutTopDays } from "../whatIfWalkForward";
import { dayList } from "./whatIfFixtures";

const WF = HONESTY.wf;

describe("F3 walk-forward folds", () => {
  it("8 months: months 3…8 are tested, each trained on the earlier days minus a 5-day embargo", () => {
    const days = dayList(243); // 2026-01-01 … 2026-08-31
    const f = monthFolds(days, WF);
    expect(f.K).toBe(8);
    expect(f.folds.map((x) => x.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    const march = f.folds[0];
    const firstMarch = days.indexOf("2026-03-01");
    expect(march.test[0]).toBe(firstMarch);
    expect(march.test.length).toBe(31);
    // Trained on Jan 1 … Feb 23 (59 days − 5): the 5 trading days before March are the embargo.
    expect(march.train.reduce((s, v) => s + v, 0)).toBe(firstMarch - 5);
    expect(march.train[firstMarch - 6]).toBe(1);
    expect(march.train[firstMarch - 5]).toBe(0);
    expect(march.train[firstMarch]).toBe(0);
    expect(f.testDays).toBe(243 - 59);
    expect(f.available).toBe(true);
  });

  it("needs ≥ 6 months, ≥ 3 counted folds (train ≥ 30 days) and ≥ 20 tested days", () => {
    expect(monthFolds(dayList(150), WF)).toMatchObject({ K: 5, available: false }); // Jan…May
    expect(monthFolds(dayList(160), WF)).toMatchObject({ K: 6, available: true });
    // One day a week for 7 months: trains are too short for most folds.
    const sparse = dayList(210).filter((_, i) => i % 7 === 0);
    const f = monthFolds(sparse, WF);
    expect(f.K).toBe(7);
    expect(f.folds.every((x) => x.train.reduce((s, v) => s + v, 0) >= 30)).toBe(true);
    expect(f.available).toBe(false);
  });

  it("a month the rule never touched is not a month it helped; the ratio and the sum both decide", () => {
    const f = monthFolds(dayList(243), WF);
    const wf = walkForward(f, [100, 50, 0, 0, 0, 0]);
    expect(wf).toMatchObject({ months: 6, positive: 2, sum: 150, available: true });
    expect(wfOk(wf, WF)).toBe(false);
    // posShare = 0.7 (Ф7 calibration): 5 of 6 helped months pass, 4 of 6 do not.
    expect(WF.posShare).toBe(0.7);
    expect(wfOk(walkForward(f, [100, 50, 20, 5, 1, -1]), WF)).toBe(true); // 5 of 6 ≥ 70%
    expect(wfOk(walkForward(f, [100, 50, 20, 5, -10, -1]), WF)).toBe(false); // 4 of 6
    expect(wfOk(walkForward(f, [100, 50, 20, -5, -10, -1]), WF)).toBe(false); // 3 of 6
    expect(wfOk(walkForward(f, [1, 1, 1, 1, -10, 0]), WF)).toBe(false); // sum < 0
  });
});

describe("F5 one-day guard", () => {
  it("Δ without the 3 best days", () => {
    expect(withoutTopDays([0, 500, -20, 10, 300, 0, 200, 5], 995, 3)).toBe(-5);
    expect(withoutTopDays([0, 10, 0], 10, 3)).toBe(0);
  });

  it("neighbours: the previous and next member of the family present, none without a family", () => {
    const slots = [
      { family: "tw.to", order: 660 }, { family: "tw.to", order: 630 }, { family: null, order: 0 },
      { family: "tw.to", order: 720 }, { family: "dll", order: 50 },
    ];
    expect(familyNeighbours(slots)).toEqual([[1, 3], [0], [], [0], []]);
  });

  it("fragile: < 15 affected days, else Δ ≤ 0 without the top 3 days", () => {
    expect(fragileOf(14, 500, HONESTY.conc)).toEqual({ reason: "fewDays", days: 14 });
    expect(fragileOf(15, 0, HONESTY.conc)).toEqual({ reason: "topDays", days: 3 });
    expect(fragileOf(15, 0.01, HONESTY.conc)).toBeNull();
  });
});

describe("F6 days still needed", () => {
  const cfg = { z: 2, floorDays: 21, maxNeedDays: 250, daysPerMonth: 21 };
  const one = (sd: number, mu: number) => [{ sd, mu }];
  it("N* = ⌈(z·sd/μ)²⌉ days in all, minus the days already there", () => {
    // (2 · 100 / 10)² = 400 days in all; 200 known → 200 more.
    expect(needDaysFor({ legs: one(100, 10), D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg)).toEqual({ needDays: 200, atLeast: false });
    // The calibrated z = 4.4 (c₁ + 0.84, Ф7): (4.4 · 100 / 10)² = 1936 days in all; 200 known → 1736 more.
    expect(HONESTY.mde.z).toBe(4.4);
    expect(needDaysFor({ legs: one(100, 10), D: 200, K: 8, wfAvailable: true, minMonths: 6 }, HONESTY.mde).needDays).toBe(1736);
  });
  it("every leg must be reached: the largest N*; a leg with nothing to wait for (μ ≤ 0) → null", () => {
    // Raw leg 400 days, guard leg (2 · 100 / 5)² = 1600 → 1400 more.
    expect(needDaysFor({ legs: [{ sd: 100, mu: 10 }, { sd: 100, mu: 5 }], D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg).needDays).toBe(1400);
    expect(needDaysFor({ legs: [{ sd: 100, mu: 10 }, { sd: 100, mu: 0 }], D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg).needDays).toBeNull();
    expect(needDaysFor({ legs: [], D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg).needDays).toBeNull();
  });
  it("at least one more month; without a walk-forward at least the missing months, and «at least»", () => {
    expect(needDaysFor({ legs: one(10, 10), D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg)).toEqual({ needDays: 21, atLeast: false });
    expect(needDaysFor({ legs: one(10, 10), D: 90, K: 4, wfAvailable: false, minMonths: 6 }, cfg)).toEqual({ needDays: 42, atLeast: true });
    expect(needDaysFor({ legs: one(10, 0), D: 90, K: 4, wfAvailable: false, minMonths: 6 }, cfg).needDays).toBeNull();
    expect(needDaysFor({ legs: one(10, -1), D: 200, K: 8, wfAvailable: true, minMonths: 6 }, cfg).needDays).toBeNull();
  });
});

describe("F6 status", () => {
  const ok = {
    gates: true, smallSample: false, kind: "exante" as const, pAdj: 0.1, guardAdj: 0.1 as number | null,
    wfOk: true, wfAvailable: true, wfSum: 100, concOk: true, q: 0.01, needDays: null as number | null,
  };
  const cfg = { alphaConfirm: 0.1, qHypothesis: 0.2, maxNeedDays: 250 };
  it("confirmed needs every check, the guard included (α inclusive)", () => {
    expect(statusFor(ok, cfg)).toBe("confirmed");
    for (const miss of [{ gates: false }, { smallSample: true }, { kind: "label" as const }, { pAdj: 0.1001 }, { wfOk: false }, { concOk: false }, { guardAdj: null }, { guardAdj: 0.11 }]) {
      expect(statusFor({ ...ok, ...miss, needDays: 100 }, cfg), JSON.stringify(miss)).not.toBe("confirmed");
    }
    expect(statusFor({ ...ok, guardAdj: 0.11, needDays: 100 }, cfg)).toBe("hypothesis");
  });
  it("hypothesis: gates, q ≤ 0.20, a non-negative out-of-sample total and ≤ 250 days; else hidden", () => {
    const h = { ...ok, pAdj: 0.5, needDays: 250 };
    expect(statusFor(h, cfg)).toBe("hypothesis");
    expect(statusFor({ ...h, needDays: 251 }, cfg)).toBe("hidden");
    expect(statusFor({ ...h, needDays: null }, cfg)).toBe("hidden");
    expect(statusFor({ ...h, q: 0.21 }, cfg)).toBe("hidden");
    expect(statusFor({ ...h, wfSum: -1 }, cfg)).toBe("hidden");
    expect(statusFor({ ...h, wfSum: -1, wfAvailable: false }, cfg)).toBe("hypothesis");
    expect(statusFor({ ...h, gates: false }, cfg)).toBe("hidden");
  });
  it("a «разбор» (label) rule is a hypothesis on q and the walk-forward alone: it promises no days", () => {
    const h = { ...ok, kind: "label" as const, pAdj: 0.5 };
    expect(statusFor({ ...h, needDays: null }, cfg)).toBe("hypothesis");
    expect(statusFor({ ...h, needDays: 9999 }, cfg)).toBe("hypothesis");
    expect(statusFor({ ...h, q: 0.21 }, cfg)).toBe("hidden");
    expect(statusFor({ ...h, wfSum: -1 }, cfg)).toBe("hidden");
  });
});

describe("F6 decideSlot", () => {
  const cfg = { alphaConfirm: 0.1, qHypothesis: 0.2, posShare: 0.7, minMonths: 6, mde: { z: 2, floorDays: 21, maxNeedDays: 250, daysPerMonth: 21 } };
  const ctx = { smallSample: false, avail: true, folds: 6, testDays: 120, D: 200, K: 8 };
  const base: SlotFacts = {
    kind: "exante", ordering: false, gates: true, pAdj: 0.01, guardAdj: 0.01, q: 0.01, delta: 1000, sdDiff: 50,
    wf: { positive: 6, sum: 600 }, excess: { delta: 800, sdDiff: 50, wf: { positive: 6, sum: 500 } }, tPerm: null, concOk: true,
  };
  it("confirmed: both legs pass on every check; no days, the metric is the smaller out-of-sample sum", () => {
    expect(decideSlot(base, ctx, cfg)).toEqual({ status: "confirmed", needDays: null, atLeast: false, metric: 500 });
  });
  it("«trade less» on a losing trader: the dollars pass, the excess does not → never confirmed, hidden (nothing to wait for)", () => {
    const tradeLess = { ...base, guardAdj: 0.6, excess: { delta: -20, sdDiff: 50, wf: { positive: 2, sum: -30 } } };
    expect(decideSlot(tradeLess, ctx, cfg)).toMatchObject({ status: "hidden", needDays: null, metric: -30 });
    // The excess helped out of sample but not in enough months: not confirmed either.
    const fewMonths = { ...base, excess: { delta: 800, sdDiff: 50, wf: { positive: 4, sum: 500 } } };
    expect(decideSlot(fewMonths, ctx, cfg).status).not.toBe("confirmed");
  });
  it("days needed: the largest of the legs (raw Δ, the excess)", () => {
    // raw: μ = 600 / 120 = 5, (2·50/5)² = 400; excess: μ = 100 / 120, (2·50·120/100)² = 14400 → 14200 > 250 → hidden.
    const weakExcess = { ...base, guardAdj: 0.5, excess: { delta: 200, sdDiff: 50, wf: { positive: 5, sum: 100 } } };
    expect(decideSlot(weakExcess, ctx, cfg)).toMatchObject({ status: "hidden", needDays: 14200 });
    // raw 400, excess μ = 500/120: (2·50·120/500)² = 576 → 376 more.
    expect(decideSlot({ ...base, guardAdj: 0.5 }, ctx, cfg)).toMatchObject({ status: "hidden", needDays: 376 });
    expect(decideSlot({ ...base, guardAdj: 0.5 }, ctx, { ...cfg, mde: { ...cfg.mde, maxNeedDays: 400 } })).toMatchObject({ status: "hypothesis", needDays: 376, atLeast: false });
  });
  it("ordering: the within-day permutation leg — no excess over the permutation mean, nothing to wait for", () => {
    const ord = { ...base, ordering: true, excess: null, guardAdj: 0.4, tPerm: -0.2 };
    expect(decideSlot(ord, ctx, cfg)).toMatchObject({ status: "hidden", needDays: null, metric: 600 });
    // t = 1 on 200 days: per day 1/√200 in sd units → (2·√200)² = 800 → 600 more.
    expect(decideSlot({ ...ord, tPerm: 1 }, ctx, cfg)).toMatchObject({ needDays: 600 });
    expect(decideSlot({ ...ord, tPerm: 1 }, ctx, { ...cfg, mde: { ...cfg.mde, maxNeedDays: 1000 } })).toMatchObject({ status: "hypothesis", needDays: 600 });
  });
  it("a «разбор» rule never carries days", () => {
    const label = { ...base, kind: "label" as const, guardAdj: 0.5 };
    expect(decideSlot(label, ctx, cfg)).toEqual({ status: "hypothesis", needDays: null, atLeast: false, metric: 500 });
    expect(decideSlot(label, { ...ctx, avail: false, K: 4 }, cfg)).toMatchObject({ status: "hypothesis", needDays: null, atLeast: false });
  });
});
