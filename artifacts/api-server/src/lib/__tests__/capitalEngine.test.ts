// Capital allocation engine (lib/capital): edge shrinkage with sample-size honesty, discipline gating, hard caps.
import { describe, expect, it } from "vitest";
import { allocate, decideTrader, tierBand } from "../capital/engine";
import { capitalPriors, edgeOf, rawR, rawU } from "../capital/edge";
import type { CapDay, CapTier, CapTraderInput, CapitalSettings } from "../capital/types";

const SETTINGS: CapitalSettings = {
  weights: { edge: 0.5, regime: 0.25, discipline: 0.25 },
  maxStepUpPct: 20, maxStepDownPct: 25, minStepPct: 5, minTrades: 30, windowDays: 60, includeJuniors: false,
  disciplineGate: 60, disciplineCut: 35, floorPctOfTier: 50, capPctOfTier: 150, maxDeskGrowthPct: 10,
};
const TIERS: CapTier[] = [
  { key: "junior", order: 2, dailyLossLimit: 300 },
  { key: "trader", order: 3, dailyLossLimit: 600 },
  { key: "senior", order: 4, dailyLossLimit: 1200 },
];
const PRIORS = { tauR: 0.25, tauU: 0.15, unitsR: 0, unitsU: 0 };
const ctx = { settings: SETTINGS, tiers: TIERS, priors: PRIORS, regime: null };

/** `n` weekdays of trades: net per day around `meanUsd` (±`spread`, alternating), 4 trades a day, R ∝ net. */
function days(n: number, meanUsd: number, spread: number): CapDay[] {
  const out: CapDay[] = [];
  for (let i = 0; i < n; i++) {
    const net = meanUsd + (i % 2 === 0 ? spread : -spread) * (1 + (i % 3) / 3);
    out.push({ date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, net, trades: 4, rSum: net / 100, rCount: 4, regime: null });
  }
  return out;
}

function trader(over: Partial<CapTraderInput> = {}): CapTraderInput {
  return {
    trader: "t-a", tierKey: "trader", junior: false, dailyLossLimit: 600, weeklyLossLimit: 1800, buyingPower: 400_000,
    days: days(50, 150, 250), discipline: { index: 80, tradedDays: 50, closedDays: 48, violations: 2, stopDays: 0 },
    ladderAction: "hold", pendingTier: false, ...over,
  };
}

describe("edge shrinkage", () => {
  it("pulls a short lucky streak toward zero harder than a long record with the same mean", () => {
    const short = edgeOf(days(4, 150, 250), 600, PRIORS, "s");
    const long = edgeOf(days(60, 150, 250), 600, PRIORS, "l");
    const raw = 150 / 600;
    expect(short.u!.theta).toBeGreaterThan(0);
    expect(short.u!.theta).toBeLessThan(long.u!.theta);
    expect(long.u!.theta).toBeLessThan(raw); // even the long record is shrunk a little
    expect(short.proven).toBe(false); // 4 days: the 80 % interval still covers zero
    expect(long.proven).toBe(true);
  });

  it("a losing record with enough days is a proven negative edge; no limit ⇒ no $ estimate", () => {
    expect(edgeOf(days(60, -150, 200), 600, PRIORS, "n").negative).toBe(true);
    const e = edgeOf(days(60, 150, 200), null, PRIORS, "x");
    expect(e.u).toBeNull();
    expect(e.r).not.toBeNull();
  });

  it("the desk prior falls back with fewer than five traders and estimates τ from the spread with more", () => {
    const one = capitalPriors([{ r: rawR(days(40, 100, 200), "a"), u: rawU(days(40, 100, 200), 600, "a") }], 30);
    expect(one.unitsR).toBe(1);
    expect(one.tauU).toBeCloseTo(0.15);
    const many = capitalPriors([-150, -50, 50, 150, 300].map((m, i) => ({ r: rawR(days(60, m, 150), `p${i}`), u: rawU(days(60, m, 150), 600, `p${i}`) })), 30);
    expect(many.unitsU).toBe(5);
    expect(many.tauU).toBeGreaterThan(0.15);
  });
});

describe("discipline gating", () => {
  it("a proven edge with weak discipline is kept, not raised", () => {
    const row = decideTrader(trader({ discipline: { index: 50, tradedDays: 50, closedDays: 25, violations: 15, stopDays: 1 } }), ctx);
    expect(row.direction).toBe("keep");
    expect(row.reasons).toContainEqual(expect.objectContaining({ code: "gate", gate: "disciplineBlock" }));
  });

  it("discipline below the cut line cuts by the full step even with too few trades to judge the edge", () => {
    const row = decideTrader(trader({ days: days(5, 200, 100), discipline: { index: 20, tradedDays: 5, closedDays: 0, violations: 6, stopDays: 3 } }), ctx);
    expect(row.direction).toBe("cut");
    expect(row.stepPct).toBe(-25);
    expect(row.proposed.dailyLossLimit).toBe(450);
    expect(row.proposed.buyingPower).toBe(300_000); // BP follows the limit ratio
  });

  it("a proven edge with good discipline is raised; too few trades or a pending ladder decision keeps it", () => {
    expect(decideTrader(trader(), ctx).direction).toBe("raise");
    expect(decideTrader(trader({ days: days(6, 150, 250) }), ctx).reasons).toContainEqual(expect.objectContaining({ gate: "fewTrades" }));
    expect(decideTrader(trader({ ladderAction: "promote" }), ctx).direction).toBe("keep");
    expect(decideTrader(trader({ junior: true, tierKey: "junior", dailyLossLimit: 300 }), ctx).reasons).toContainEqual(expect.objectContaining({ gate: "junior" }));
  });
});

describe("caps and steps", () => {
  it("the band: floor = 50 % of the tier, cap = min(150 % of the tier, the next tier's template)", () => {
    expect(tierBand("junior", TIERS, SETTINGS)).toEqual({ floor: 150, cap: 450 });
    expect(tierBand("trader", TIERS, { ...SETTINGS, capPctOfTier: 300 })).toEqual({ floor: 300, cap: 1200 });
    expect(tierBand("senior", TIERS, SETTINGS)).toEqual({ floor: 600, cap: 1800 });
  });

  it("a raise stops at the tier cap; a trader already at the cap is kept", () => {
    const near = decideTrader(trader({ dailyLossLimit: 820, weeklyLossLimit: 3000 }), ctx);
    expect(near.direction).toBe("raise");
    expect(near.proposed.dailyLossLimit).toBe(900); // 600 × 150 %
    const at = decideTrader(trader({ dailyLossLimit: 900, weeklyLossLimit: 3000 }), ctx);
    expect(at.direction).toBe("keep");
    expect(at.reasons).toContainEqual(expect.objectContaining({ gate: "atCap" }));
  });

  it("the desk cap scales raises down so total risk grows by at most maxDeskGrowthPct", () => {
    const team = ["a", "b", "c", "d"].map((n) => trader({ trader: n }));
    const free = allocate(team, { settings: { ...SETTINGS, maxDeskGrowthPct: 100 }, tiers: TIERS, regime: null });
    const capped = allocate(team, { settings: { ...SETTINGS, maxDeskGrowthPct: 5 }, tiers: TIERS, regime: null });
    expect(free.desk.riskAfter).toBeGreaterThan(free.desk.riskBefore * 1.05);
    expect(capped.desk.deskCapApplied).toBe(true);
    expect(capped.desk.riskAfter).toBeLessThanOrEqual(capped.desk.riskBefore * 1.05);
    expect(capped.desk.expectedPerDay.lo).toBeLessThanOrEqual(capped.desk.expectedPerDay.mean);
  });
});
