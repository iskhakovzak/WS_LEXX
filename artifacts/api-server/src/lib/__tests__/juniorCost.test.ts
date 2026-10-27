/**
 * «Цена джуна до безубытка» (lib/juniorCost) on synthetic series only (made-up juniors and numbers): breakeven detection
 * with the stable window, the price and its exact fees / gross split, seat cost, statuses, truncation, the projection,
 * the Kaplan–Meier median and «что окупается» with its small-sample marker.
 */
import { describe, expect, it } from "vitest";
import { attribution, type Exposure } from "../juniorCost/attribution";
import { kmMedian } from "../juniorCost/cohorts";
import { DAYS_PER_MONTH, findBreakeven, juniorPath, type DayPnl, type JuniorInput } from "../juniorCost/path";
import { weekdays } from "./fixtures/edgeSynth";

const FEE = 10;
/** Own trading days from net values (fees FEE a day, gross = net + fees). */
function series(nets: readonly number[], start = "2025-01-06"): DayPnl[] {
  return weekdays(nets.length, start).map((day, i) => ({ day, net: nets[i], fees: FEE, gross: nets[i] + FEE }));
}
const junior = (name: string, nets: readonly number[], over: Partial<JuniorInput> = {}): JuniorInput =>
  ({ name, days: series(nets), academyStart: null, deactivated: false, ...over });
const rep = (n: number, v: number) => Array.from({ length: n }, () => v);
const ASOF = "2025-12-31";

describe("breakeven detection", () => {
  it("needs the whole stable window ≥ 0; a short recovery does not count", () => {
    // −100 × 5 (cum −500), +100 × 6 (back to +100 for 2 days … then) −300 dip, +60 × 10 back up, then flat 25 days.
    const nets = [...rep(5, -100), ...rep(6, 100), -300, ...rep(10, 60), ...rep(25, 0)];
    const cum = nets.reduce<number[]>((a, v) => [...a, (a[a.length - 1] ?? 0) + v], []);
    const be = findBreakeven(cum, 20);
    // The first ≥ 0 run (days 10–11) is broken by the dip; the stable run starts where cum is back ≥ 0 after it.
    expect(cum[10]).toBe(100);
    expect(cum[11]).toBe(-200);
    expect(be.index).toBe(cum.findIndex((v, i) => i > 11 && v >= 0));
  });

  it("price = deepest loss before breakeven, split exactly into fees − gross", () => {
    const p = juniorPath(junior("junior-a", [...rep(8, -50), ...rep(10, 60), ...rep(20, 5)]), { asOf: ASOF, stableDays: 20 });
    expect(p.status).toBe("reached");
    expect(p.trough).toMatchObject({ cum: -400, fees: 80, gross: -320 });
    expect(p.cost.trading).toBe(400);
    expect(p.cost.trading).toBeCloseTo(p.cost.fees - p.cost.gross, 6);
    expect(p.breakeven).toMatchObject({ activeDays: 15, day: p.curve[14].day });
    expect(p.curve[14].cum).toBeGreaterThanOrEqual(0);
    expect(p.curve[13].cum).toBeLessThan(0);
  });

  it("a curve ≥ 0 from day one breaks even on day one at no cost", () => {
    const p = juniorPath(junior("junior-b", rep(25, 20)), { asOf: ASOF, stableDays: 20 });
    expect(p.breakeven?.activeDays).toBe(1);
    expect(p.cost.total).toBe(0);
    expect(p.trough).toBeNull();
  });

  it("seat cost runs from the academy start to breakeven", () => {
    const p = juniorPath(junior("junior-c", [...rep(5, -100), ...rep(30, 50)], { academyStart: "2024-12-06" }), { asOf: ASOF, stableDays: 20, seatUsdMonth: 300 });
    expect(p.startSource).toBe("academy");
    const months = p.breakeven!.calendarDays / DAYS_PER_MONTH;
    expect(p.cost.seat).toBeCloseTo(300 * months, 1);
    expect(p.cost.total).toBeCloseTo(500 + 300 * months, 1);
  });
});

describe("statuses", () => {
  it("provisional while the run is shorter than the window; below with a projection otherwise", () => {
    const prov = juniorPath(junior("junior-d", [...rep(10, -30), ...rep(7, 60)]), { asOf: "2025-02-01", stableDays: 20 });
    expect(prov.status).toBe("provisional");
    expect(prov.provisionalDays).toBeGreaterThan(0);
    expect(prov.provisionalDays).toBeLessThan(20);

    const nets = [...rep(10, -100), ...Array.from({ length: 20 }, (_, i) => (i % 2 ? 60 : 20))];
    const below = juniorPath(junior("junior-e", nets), { asOf: "2025-02-17", stableDays: 20, B: 300 });
    expect(below.status).toBe("below");
    expect(below.projection?.kind).toBe("eta");
    if (below.projection?.kind === "eta") {
      expect(below.projection.days.point).toBe(Math.ceil(200 / 40));
      expect(below.projection.days.lo).toBeLessThanOrEqual(below.projection.days.point);
      expect(below.projection.eta.point > "2025-02-17").toBe(true);
    }
    const sinking = juniorPath(junior("junior-f", [...rep(10, -100), ...rep(15, -5)]), { asOf: "2025-02-07", stableDays: 20, B: 300 });
    expect(sinking.projection?.kind).toBe("notImproving");
  });

  it("stopped, insufficient and truncated", () => {
    expect(juniorPath(junior("junior-g", rep(10, -20)), { asOf: "2025-04-01" }).status).toBe("stopped");
    expect(juniorPath(junior("junior-h", rep(10, -20), { deactivated: true }), { asOf: "2025-01-20" }).status).toBe("stopped");
    expect(juniorPath(junior("junior-i", rep(3, -20)), { asOf: "2025-01-09" }).status).toBe("insufficient");
    expect(juniorPath(junior("junior-j", rep(10, -20)), { asOf: "2025-01-20", deskFirstDay: "2025-01-03" }).truncated).toBe(true);
    expect(juniorPath(junior("junior-k", rep(10, -20), { academyStart: "2025-01-02" }), { asOf: "2025-01-20", deskFirstDay: "2025-01-03" }).truncated).toBe(false);
  });
});

describe("cohort statistics", () => {
  it("Kaplan–Meier median keeps the censored juniors in the risk set", () => {
    // Events at 10 and 30; censored at 5 and 20: S(10) = 2/3, S(30) = 0 → median 30 (a reached-only median would say 20).
    expect(kmMedian([{ t: 5, event: false }, { t: 10, event: true }, { t: 20, event: false }, { t: 30, event: true }])).toBe(30);
    expect(kmMedian([{ t: 10, event: true }, { t: 50, event: false }, { t: 60, event: false }])).toBeNull();
  });

  it("«что окупается»: a clear practice pays; three per group is marked low", () => {
    const paths = [];
    const exp = new Map<string, Exposure>();
    const e = (trainer: number): Exposure => ({ windowDays: 60, trainerPerMonth: trainer, exams: 0, oneOnOnePerMonth: 0, planAnswers: 0, planShare: null });
    for (let i = 0; i < 16; i++) {
      const used = i % 2 === 0;
      const depth = used ? 200 + i * 5 : 900 + i * 20;
      const p = juniorPath(junior(`junior-${i}`, [...rep(5, -depth / 5), ...rep(30, depth / 10)]), { asOf: ASOF, stableDays: 20 });
      paths.push(p);
      exp.set(p.name, e(used ? 8 : 0));
    }
    const trainer = attribution(paths, exp, { B: 400 }).find((f) => f.factor === "trainer")!;
    expect(trainer.yes.juniors).toBe(8);
    expect(trainer.costDiff!.point).toBeLessThan(0);
    expect(trainer.costDiff!.hi).toBeLessThan(0);
    expect(trainer.status).not.toBe("low");
    expect(trainer.verdict).toBe("pays");

    const few = attribution(paths.slice(0, 6), exp, { B: 200 }).find((f) => f.factor === "trainer")!;
    expect(few.status).toBe("low");
    expect(few.verdict).toBe("unclear");
  });
});
