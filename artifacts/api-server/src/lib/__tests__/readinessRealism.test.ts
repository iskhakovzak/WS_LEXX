/**
 * Roadmap R1 «readiness realism» — acceptance tests, adjusted to the owner decision (2026-10-24): win rate ≥ 48 STAYS,
 * edge_margin_pp ≥ 2 (40 days) and expectancy_lb ≥ 0 (120 days) are ADDED. Synthetic fixtures only.
 */
import { describe, expect, it } from "vitest";
import { addDays, isWeekend } from "../scalingEngine";
import {
  DEFAULT_CRITERIA, adviceFor, computePromoMetrics, evaluatePromotion, type Criterion, type PromoTrade, type PromotionInput,
} from "../promotionEngine";
import {
  INFEASIBLE_MIN_WINDOWS, bindingConstraintOf, expectancyLbMetric, paceOf, scanEnds, stageSignalOf, type FailingCriterion,
} from "../academy/readinessRealism";

const TODAY = "2026-10-16"; // Friday

/** Last `n` weekdays ending `end`, oldest first. */
function weekdays(n: number, end = TODAY): string[] {
  const out: string[] = [];
  for (let d = end; out.length < n; d = addDays(d, -1)) if (!isWeekend(d)) out.unshift(d);
  return out;
}
const tr = (date: string, net: number): PromoTrade => ({ date, net, gross: net + 1, fees: 1, r: null, result: net > 0 ? "win" : net < 0 ? "loss" : "be", source: "propreports" });
const input = (trades: PromoTrade[], extra: Partial<PromotionInput> = {}): PromotionInput => ({
  user: "u", stage: "junior", stageSince: null, today: TODAY, trades, violationDates: [], ratings: [], limits: null,
  disciplineDays: null, learning: null, challengesPassed: null, ...extra,
});
const crit = (metric: Criterion["metric"], op: Criterion["op"], value: number, windowDays: number | null, id: number): Criterion =>
  ({ id, fromStage: "junior", metric, op, value, windowDays, label: null, enabled: true });

/**
 * `days` weekdays, `perDay` trades each, a deterministic win pattern with share `wr` of winners: winners +avgWin,
 * losers avgLoss (< 0).
 */
function book(days: number, perDay: number, wr: number, avgWin: number, avgLoss: number): PromoTrade[] {
  const out: PromoTrade[] = [];
  let k = 0;
  for (const d of weekdays(days)) {
    for (let j = 0; j < perDay; j++, k++) out.push(tr(d, (k * wr) % 1 < wr - 1e-9 ? avgWin : avgLoss));
  }
  return out;
}

describe("edge_margin_pp", () => {
  const margin = (trades: PromoTrade[]) => computePromoMetrics(input(trades), null, 40).edge_margin_pp;

  it("WR 36 %, avg win 80, avg loss −40 → +2.7 pp → passes ≥ 2", () => {
    const m = margin(book(40, 5, 0.36, 80, -40));
    expect(m.value).toBeCloseTo(2.67, 1);
    const r = evaluatePromotion(input(book(40, 5, 0.36, 80, -40)), [crit("edge_margin_pp", ">=", 2, 40, 1)]);
    expect(r.criteria[0].status).toBe("pass");
  });

  it("WR 60 %, payoff 0.5 → −6.7 pp → fails", () => {
    expect(margin(book(40, 5, 0.6, 50, -100)).value).toBeCloseTo(-6.67, 1);
  });

  it("fewer than 5 losses → null → fails", () => {
    const trades = [...weekdays(10).map((d) => tr(d, 50)), ...weekdays(4).map((d) => tr(d, -30))];
    expect(margin(trades).value).toBeNull();
    const r = evaluatePromotion(input(trades), [crit("edge_margin_pp", ">=", 2, 40, 1)]);
    expect(r.criteria[0].status).toBe("fail");
  });
});

describe("expectancy_lb", () => {
  const t = (k: string) => k;
  it("is deterministic under the seed and below the mean (a lower bound)", () => {
    const trades = book(120, 4, 0.4, 70, -40);
    const a = computePromoMetrics(input(trades), null, 120).expectancy_lb.value;
    const b = computePromoMetrics(input(trades), null, 120).expectancy_lb.value;
    expect(a).toBe(b);
    expect(expectancyLbMetric(trades, t).value).toBe(a);
    const mean = trades.reduce((s, x) => s + (x.net ?? 0), 0) / trades.length;
    expect(a!).toBeLessThan(mean);
  });
  it("needs at least two trading days", () => {
    expect(expectancyLbMetric([tr(TODAY, 5)], t).value).toBeNull();
  });
});

describe("win rate stays; the new criteria are added", () => {
  it("DEFAULT_CRITERIA keeps win_rate ≥ 48 and adds edge_margin_pp ≥ 2 (40 d) and expectancy_lb ≥ 0 (120 d)", () => {
    const j = DEFAULT_CRITERIA.filter((c) => c.fromStage === "junior");
    expect(j.find((c) => c.metric === "win_rate")).toMatchObject({ op: ">=", value: 48, windowDays: 40 });
    expect(j.find((c) => c.metric === "edge_margin_pp")).toMatchObject({ op: ">=", value: 2, windowDays: 40 });
    expect(j.find((c) => c.metric === "expectancy_lb")).toMatchObject({ op: ">=", value: 0, windowDays: 120 });
  });

  it("the other criteria give identical results with or without the two new ones", () => {
    const trades = book(130, 3, 0.45, 60, -45);
    const all = DEFAULT_CRITERIA.filter((c) => c.fromStage === "junior").map((c, i) => ({ ...c, id: i + 1 }));
    const old = all.filter((c) => c.metric !== "edge_margin_pp" && c.metric !== "expectancy_lb");
    const pick = (r: ReturnType<typeof evaluatePromotion>) => r.criteria.filter((c) => c.metric !== "edge_margin_pp" && c.metric !== "expectancy_lb")
      .map((c) => ({ metric: c.metric, value: c.value, status: c.status, advice: c.advice }));
    expect(pick(evaluatePromotion(input(trades), all))).toEqual(pick(evaluatePromotion(input(trades), old)));
  });
});

describe("binding constraint", () => {
  it("a high-payoff style whose WR maximum over 250 days stays below 48 → infeasible_style (curator review)", () => {
    const trades = book(300, 4, 0.35, 90, -30);
    const r = evaluatePromotion(input(trades), [crit("win_rate", ">=", 48, 40, 1), crit("net_pnl", ">=", 1e6, 40, 2)]);
    expect(r.bindingConstraint?.metric).toBe("win_rate");
    expect(r.bindingConstraint?.kind).toBe("infeasible_style");
    expect(r.bindingConstraint!.neverMetWindows!).toBeGreaterThanOrEqual(INFEASIBLE_MIN_WINDOWS);
  });

  it("met once in the lookback → not infeasible; ranks by expected days to close", () => {
    const f = (metric: FailingCriterion["metric"], value: number, prevValue: number, target: number): FailingCriterion => ({
      metric, label: metric, op: ">=", target, windowDays: 40, source: "trades", value, prevValue, display: "", targetDisplay: "", advice: null,
    });
    const b = bindingConstraintOf([f("net_pnl", 1000, 600, 1500), f("profit_factor", 1.2, 1.19, 1.3)], () => ({ value: 1e9, traded: true }), TODAY)!;
    // net_pnl: gap 500 at +10/day → 50 days; PF: gap 0.1 at 0.00025/day → 400 days.
    expect(b).toMatchObject({ metric: "net_pnl", kind: "money", daysToClose: 50, neverMetWindows: null });
  });

  it("process criteria are «process»; no failing criterion → null", () => {
    const f: FailingCriterion = { metric: "violations", label: "v", op: "<=", target: 1, windowDays: 40, source: "rules", value: 3, prevValue: 4, display: "", targetDisplay: "", advice: null };
    expect(bindingConstraintOf([f], () => ({ value: 0, traded: true }), TODAY)?.kind).toBe("process");
    expect(bindingConstraintOf([], () => ({ value: 0, traded: true }), TODAY)).toBeNull();
  });

  it("window ends every 5th trading day over 250", () => {
    const e = scanEnds(TODAY);
    expect(e[0]).toBe(TODAY);
    expect(e).toHaveLength(50);
  });
});

describe("stage days, pace, days-left hint", () => {
  it("signals at 120 / 250 / 500 trading days", () => {
    expect([119, 120, 250, 500].map(stageSignalOf)).toEqual([null, "info", "curator", "admin"]);
    const r = evaluatePromotion(input(book(30, 2, 0.5, 50, -40), { stageSince: weekdays(130)[0] }), [crit("net_pnl", ">=", 1500, 40, 1)]);
    expect(r.stageDays).toBe(130);
    expect(r.stageSignal).toBe("info");
  });

  it("pace: need target ÷ window per day, now = the mean with an 80 % interval (no ETA date)", () => {
    const daily = Array.from({ length: 40 }, (_, i) => (i % 2 ? 50 : -4));
    const p = paceOf(1500, daily);
    expect(p).toMatchObject({ needPerDay: 37.5, nowPerDay: 23, windowDays: 40 });
    expect(p.lo80!).toBeLessThan(23);
    expect(p.hi80!).toBeGreaterThan(23);
    expect(paceOf(1500, daily)).toEqual(p); // seeded
    const r = evaluatePromotion(input(book(40, 1, 0.5, 60, -20)), [crit("net_pnl", ">=", 1500, 40, 1)]);
    expect(r.pace).toMatchObject({ target: 1500, needPerDay: 37.5, windowDays: 40 });
  });

  it("a new stage: the net advice spreads the gap over the days left in its first window", () => {
    expect(adviceFor("net_pnl", ">=", 500, 1500, { windowDays: 40, tradingDaysLeftHint: 10 })).toContain("10");
    const r = evaluatePromotion(input(book(10, 1, 0.5, 60, -20), { stageSince: weekdays(10)[0] }), [crit("net_pnl", ">=", 1500, 40, 1)]);
    expect(r.criteria[0].advice).toMatch(/30/);
  });
});
