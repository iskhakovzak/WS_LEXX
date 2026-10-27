/**
 * Curator priority (roadmap R11): the score, its order against the urgent steps, the capacity cut, the digest items
 * and the input heuristics. Synthetic traders only.
 */
import { describe, expect, it } from "vitest";
import { capNextActions, digestTopItems, nextActionFor, priorityScore, type NextActionInput, type PriorityInputs } from "../curatorLogic";
import { lastWeekdays, priorityInputsFrom } from "../curatorPriority";

const quiet: PriorityInputs = { shrunkMean20: 5, leakCostPerDay: 0, activityDrop: false, noGreenWeek6: false, completionDrop: false, overdueQueue: 0 };
const base: NextActionInput = {
  trader: "T", halted: false, nearStop: false, unreviewedBreaches: 0, eodPending: 0, weeklySubmitted: false, overdueActions: 0,
  hasLimits: true, templateDrift: 0, missingPlan: false, missingEod: false, daysSinceOneOnOne: 3, coach: quiet,
};

describe("priorityScore", () => {
  it("components and ranges: $ at stake ≤ 30, stagnation 25 / 12, dropout ≤ 20, SLA ≤ 15, trial 10, total ≤ 79", () => {
    expect(priorityScore(quiet, null)).toEqual({ atStake: 0, stagnation: 0, dropout: 0, sla: 0, trial: 0, total: 0 });
    const s = priorityScore({ ...quiet, shrunkMean20: -8, leakCostPerDay: 4.2 }, { plateau: true, escalationOpen: true });
    expect(s).toMatchObject({ atStake: 12, stagnation: 25, total: 37 }); // a stuck junior, about −$8/day plus leaks
    expect(priorityScore({ ...quiet, shrunkMean20: -500, leakCostPerDay: 100 }, null).atStake).toBe(30);
    expect(priorityScore(quiet, { plateau: true, escalationOpen: false }).stagnation).toBe(12);
    expect(priorityScore({ ...quiet, activityDrop: true, noGreenWeek6: true, completionDrop: true }, null).dropout).toBe(20);
    expect(priorityScore({ ...quiet, overdueQueue: 9 }, null).sla).toBe(15);
    expect(priorityScore({ ...quiet, trialAttention: true }, null).trial).toBe(10);
    const all = priorityScore({ shrunkMean20: -99, leakCostPerDay: 9, activityDrop: true, noGreenWeek6: true, completionDrop: true, overdueQueue: 5, trialAttention: true }, { plateau: true, escalationOpen: true });
    expect(all.total).toBe(79);
  });
});

describe("ordering", () => {
  const stuck = { ...base, trader: "Stuck", coach: { ...quiet, shrunkMean20: -8, leakCostPerDay: 4 }, plateau: { plateau: true, escalationOpen: true } };
  const noPlan = { ...base, trader: "NoPlan", missingPlan: true };

  it("a breach always wins: urgent steps keep their fixed priority above any score", () => {
    const breach = nextActionFor({ ...base, trader: "B", unreviewedBreaches: 1 });
    const maxed = nextActionFor({ ...stuck, coach: { ...quiet, shrunkMean20: -999, leakCostPerDay: 50, activityDrop: true, noGreenWeek6: true, completionDrop: true, overdueQueue: 9 } });
    expect(breach).toMatchObject({ kind: "breach_review", priority: 100 });
    expect(maxed.priority).toBeLessThanOrEqual(79);
    expect(nextActionFor({ ...stuck, nearStop: true })).toMatchObject({ kind: "near_stop", priority: 80 });
  });

  it("a stuck junior outranks a missing plan", () => {
    const a = nextActionFor(stuck);
    const b = nextActionFor(noPlan);
    expect(a.kind).toBe("plateau_review");
    expect(b.kind).toBe("missing_plan");
    expect(a.priority).toBeGreaterThan(b.priority);
    expect(a.score?.total).toBe(37);
  });

  it("no operational step: the score's dominant reason is the step; nothing at all → none", () => {
    expect(nextActionFor({ ...base, coach: { ...quiet, shrunkMean20: -20 } })).toMatchObject({ kind: "at_stake", priority: 20 });
    expect(nextActionFor({ ...base, coach: { ...quiet, activityDrop: true } }).kind).toBe("dropout_risk");
    expect(nextActionFor({ ...base, plateau: { plateau: true, escalationOpen: false } }).kind).toBe("plateau_review");
    expect(nextActionFor(base).kind).toBe("none");
  });
});

describe("capacity and the digest", () => {
  const step = (trader: string, priority: number, kind = "missing_plan" as const) => ({ trader, kind, label: "", href: "", priority, base: 40 });

  it("capacity cut: every urgent step stays, the rest fills up to the capacity, the remainder goes to the digest", () => {
    const list = [step("A", 100, "breach_review" as never), step("B", 95, "stopped" as never), step("C", 37), step("D", 20), step("E", 12), step("F", 0, "none" as never)];
    const { shown, more } = capNextActions(list, 3);
    expect(shown.map((a) => a.trader)).toEqual(["A", "B", "C"]);
    expect(more.map((a) => a.trader)).toEqual(["D", "E"]);
    const tight = capNextActions(list, 1);
    expect(tight.shown.map((a) => a.trader)).toEqual(["A", "B"]); // urgent ones are never cut
  });

  it("digest: one item per trader (his top step), urgent first, «none» never, top n", () => {
    const items = digestTopItems([step("A", 20), step("A", 37), step("B", 80, "near_stop" as never), step("C", 0, "none" as never), step("D", 12)], 3);
    expect(items.map((a) => `${a.trader}:${a.priority}`)).toEqual(["B:80", "A:37", "D:12"]);
    expect(digestTopItems([step("A", 20), step("A", 21)], 3)).toHaveLength(1);
  });
});

describe("score inputs (pure part of lib/curatorPriority)", () => {
  const today = "2026-10-23";
  const w40 = lastWeekdays(today, 40);

  it("activity drop, no green week, completion drop; shrinkage toward the roster", () => {
    const days = [
      ...w40.slice(0, 20).map((day) => ({ trader: "Fading", day, net: -10 })), // traded every day before …
      ...w40.slice(20, 25).map((day) => ({ trader: "Fading", day, net: -30 })), // … then 5 red days of the last 20
      ...w40.map((day) => ({ trader: "Steady", day, net: 20 })),
    ];
    const completed = new Map([["Fading", new Set(w40.slice(0, 20))], ["Steady", new Set(w40)]]);
    const out = priorityInputsFrom(["Fading", "Steady", "Idle"], today, days, completed, new Map([["Fading", 3.5]]));
    const f = out.get("Fading")!;
    expect(f).toMatchObject({ activityDrop: true, noGreenWeek6: true, completionDrop: true, leakCostPerDay: 3.5 });
    expect(f.shrunkMean20!).toBeLessThan(0);
    expect(out.get("Steady")).toMatchObject({ activityDrop: false, noGreenWeek6: false, completionDrop: false, leakCostPerDay: 0 });
    expect(out.get("Idle")).toMatchObject({ shrunkMean20: null, activityDrop: false, noGreenWeek6: false });
  });

  it("lastWeekdays skips weekends", () => {
    expect(lastWeekdays("2026-10-26", 2)).toEqual(["2026-10-23", "2026-10-26"]);
  });
});
