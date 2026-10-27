import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DEFAULT_TIERS, addDays, computeWindowMetrics, disciplineIndexOf, evaluateTrader, isWeekend, normalizeDisciplineRule, windowStart, type Rule, type TraderInput } from "../scalingEngine";
import { computePromoMetrics, type PromotionInput } from "../promotionEngine";
import { curatorDisciplineGradeOf, rulesNeedDiscipline } from "../disciplineIndex";
import { LEGACY_DISCIPLINE_LABELS } from "../scalingSeed";

const TODAY = "2026-10-16"; // Friday

/** Index days for the last `n` weekdays (oldest first) + one far outside every window. */
function days(scores: number[]): { date: string; score: number }[] {
  const out: { date: string; score: number }[] = [];
  let d = TODAY;
  for (let i = scores.length - 1; i >= 0; i--) {
    while (isWeekend(d)) d = addDays(d, -1);
    out.unshift({ date: d, score: scores[i] });
    d = addDays(d, -1);
  }
  return [{ date: "2025-01-02", score: 0 }, ...out];
}

const scalingInput = (disciplineDays: TraderInput["disciplineDays"]): TraderInput => ({
  trader: "u", tierKey: "junior", limits: null, trades: [], ratings: [{ week: "2026-10-12", discipline: 5, overall: 5 }], violationDates: [], today: TODAY, disciplineDays,
});
const promoInput = (disciplineDays: PromotionInput["disciplineDays"]): PromotionInput => ({
  user: "u", stage: "junior", stageSince: null, today: TODAY, trades: [], violationDates: [], ratings: [{ week: "2026-10-12", discipline: 5, overall: 5 }],
  limits: null, disciplineDays, learning: null, challengesPassed: null,
});

describe("one discipline score (IMPROVEMENT_PLAN 2.7)", () => {
  const series = days([100, 95, 80, 91.5, 70, 100, 88, 93, 60, 100, 99, 97, 85, 100, 90, 100, 75, 100, 100, 92]);

  it("disciplineIndexOf: mean of the daily index inside [from, to]; null without days or engine", () => {
    expect(disciplineIndexOf(series, windowStart(TODAY, 3), TODAY)).toEqual({ value: (100 + 100 + 92) / 3, days: 3 });
    expect(disciplineIndexOf(series, "2027-01-01", "2027-02-01")).toEqual({ value: null, days: 0 });
    expect(disciplineIndexOf(null, windowStart(TODAY, 20), TODAY)).toEqual({ value: null, days: 0 });
    expect(disciplineIndexOf([{ date: "bad", score: 50 }, { date: TODAY, score: Number.NaN }], "2026-01-01", TODAY).value).toBeNull();
  });

  it.each([5, 10, 20])("scaling «discipline» and the path's «discipline_index» give the same number over %i days", (windowDays) => {
    const scaling = computeWindowMetrics(scalingInput(series), null, windowDays).values.discipline.value;
    const path = computePromoMetrics(promoInput(series), null, windowDays).discipline_index.value;
    const one = disciplineIndexOf(series, windowStart(TODAY, windowDays), TODAY).value!;
    expect(scaling).toBe(Math.round(one * 100) / 100);
    expect(path).toBe(scaling);
    // The curators' weekly 1–10 grade (5/10 in the fixture) is not the discipline score any more.
    expect(scaling).toBeGreaterThan(10);
  });

  it("no index days ⇒ n/a in both, never the curators' grade", () => {
    const m = computeWindowMetrics(scalingInput(null), null, 20).values.discipline;
    expect(m.value).toBeNull();
    expect(m.noteCode).toBe("noBehavior");
    expect(computePromoMetrics(promoInput([]), null, 20).discipline_index.value).toBeNull();
  });

  it("stored legacy 0–10 thresholds are read ×10; 0–100 thresholds and other metrics stay; legacy seeded labels go", () => {
    const rule = (metric: Rule["metric"], value: number, label: string | null = null, unit: Rule["unit"] = "abs") => ({ metric, value, unit, label });
    expect(normalizeDisciplineRule(rule("discipline", 7))).toMatchObject({ value: 70 });
    expect(normalizeDisciplineRule(rule("discipline", 4, LEGACY_DISCIPLINE_LABELS[1]))).toEqual({ metric: "discipline", value: 40, unit: "abs", label: null });
    expect(normalizeDisciplineRule(rule("discipline", 70, "Свой порог"))).toEqual(rule("discipline", 70, "Свой порог")); // i18n-ignore (test data)
    expect(normalizeDisciplineRule(rule("discipline", 0)).value).toBe(0);
    expect(normalizeDisciplineRule(rule("rating_overall", 7)).value).toBe(7);
    expect(normalizeDisciplineRule(rule("trades", 5)).value).toBe(5);
  });

  it("evaluateTrader applies a stored threshold as saved (migration 0274 converted the legacy rows); seeds are 0–100", () => {
    const seeds = DEFAULT_RULES.filter((r) => r.metric === "discipline").map((r) => r.value);
    expect(seeds).toEqual([70, 40]);
    const rules: Rule[] = [{ id: 1, kind: "promote", metric: "discipline", op: ">=", value: 70, unit: "abs", windowDays: 20, tierKey: null, label: null, enabled: true }];
    const low = evaluateTrader(scalingInput(days(Array(20).fill(65))), DEFAULT_TIERS, rules, "en");
    expect(low.rules[0]).toMatchObject({ threshold: 70, actual: 65, status: "fail", label: "Discipline index (0–100)" });
    expect(low.rules[0].text).toBe("Discipline index (0–100): 65/100 (need >= 70/100)");
    const high = evaluateTrader(scalingInput(days(Array(20).fill(75))), DEFAULT_TIERS, rules);
    expect(high.rules[0].status).toBe("pass");
    // A small threshold typed on purpose stays what the curator typed (it used to be read ×10 on every load).
    const typed = evaluateTrader(scalingInput(days(Array(20).fill(9))), DEFAULT_TIERS, [{ ...rules[0], value: 8 }], "en");
    expect(typed.rules[0]).toMatchObject({ threshold: 8, actual: 9, status: "pass" });
    expect(rulesNeedDiscipline(rules)).toBe(true);
    expect(rulesNeedDiscipline([{ ...rules[0], enabled: false }])).toBe(false);
  });

  it("the curators' 1–10 grade stays available as its own number (path criterion rating_discipline)", () => {
    const ratings = [{ week: "2026-10-12", discipline: 8 }, { week: "2026-10-05", discipline: 6 }, { week: "2026-01-05", discipline: 1 }, { week: "2026-10-12", discipline: null }];
    expect(curatorDisciplineGradeOf(ratings, "2026-10-07", TODAY)).toEqual({ value: 7, weeks: 2 }); // week of Mon 10-05 touches the window
    expect(curatorDisciplineGradeOf([], "2026-10-07", TODAY)).toEqual({ value: null, weeks: 0 });
  });
});
