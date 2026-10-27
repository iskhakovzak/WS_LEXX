/**
 * lib/profile/timeline — the biography events and monthly eras on a synthetic career.
 */
import { describe, expect, it } from "vitest";
import { MAX_ACHIEVEMENT_EVENTS, buildTimeline, deepestDrawdown, erasOf, mondayOf, type TimelineInput } from "../profile/timeline";
import type { DayAgg } from "../profile/types";

const day = (d: string, net: number, n = 2): DayAgg => ({ day: d, net, n, wins: net > 0 ? 1 : 0, losses: net < 0 ? 1 : 0, peak: Math.max(0, net) });

const empty: TimelineInput = { joinedAt: null, days: [], firstTrade: null, stages: [], readiness: [], achievements: [], rules: [], interventions: [] };

describe("helpers", () => {
  it("mondayOf", () => {
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
  });
  it("eras: one per month with net, days and win rate", () => {
    const e = erasOf([day("2026-02-03", 10), day("2026-01-05", -4), day("2026-01-06", 6)]);
    expect(e).toEqual([
      { month: "2026-01", trades: 4, net: 2, activeDays: 2, winRate: 0.5 },
      { month: "2026-02", trades: 2, net: 10, activeDays: 1, winRate: 1 },
    ]);
  });
  it("deepest drawdown with its recovery day; none for a rising curve", () => {
    const dd = deepestDrawdown([day("2026-01-05", 50), day("2026-01-06", -20), day("2026-01-07", -40), day("2026-01-08", 30), day("2026-01-09", 40)]);
    expect(dd).toEqual({ peakDay: "2026-01-05", troughDay: "2026-01-07", depth: 60, recoveredDay: "2026-01-09" });
    expect(deepestDrawdown([day("2026-01-05", 5), day("2026-01-06", 6)])).toBeNull();
    const open = deepestDrawdown([day("2026-01-05", -10), day("2026-01-06", -5)]);
    expect(open).toMatchObject({ peakDay: "2026-01-05", troughDay: "2026-01-06", depth: 15, recoveredDay: null });
  });
});

describe("buildTimeline", () => {
  it("a newcomer with no trades: only the joined line", () => {
    expect(buildTimeline({ ...empty, joinedAt: "2026-10-01" })).toEqual([{ kind: "joined", day: "2026-10-01", params: {} }]);
    expect(buildTimeline(empty)).toEqual([]);
  });

  it("joined is left out when the account was created after the imported history", () => {
    const ev = buildTimeline({ ...empty, joinedAt: "2026-10-01", firstTrade: { day: "2026-05-04", ticker: "ABC" }, days: [day("2026-05-04", 5)] });
    expect(ev.map((e) => e.kind)).not.toContain("joined");
  });

  it("a career: first trade, milestones, bests, first green month, drawdown and recovery, oldest first", () => {
    const days: DayAgg[] = [];
    // January: 30 days × 4 trades, red; February: 30 days × 4 trades, green (with a dip).
    for (let i = 0; i < 30; i++) days.push(day(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, -5, 4));
    for (let i = 0; i < 28; i++) days.push(day(`2026-02-${String(i + 1).padStart(2, "0")}`, i === 10 ? 400 : 20, 4));
    const ev = buildTimeline({
      ...empty, joinedAt: "2025-12-20", days, firstTrade: { day: "2026-01-01", ticker: "ABC" },
      stages: [{ day: "2026-02-15", from: "junior", to: "trader", action: "approve" }],
      readiness: [{ day: "2026-02-10", stage: "trader" }],
      rules: [{ day: "2026-01-03", kind: "max_trades", origin: "personal" }],
    });
    const kinds = ev.map((e) => e.kind);
    expect(kinds[0]).toBe("joined");
    expect(kinds[1]).toBe("first_trade");
    expect(ev.filter((e) => e.kind === "milestone_trades").map((e) => e.params.count)).toEqual([100]);
    expect(ev.find((e) => e.kind === "best_day")).toMatchObject({ day: "2026-02-11", params: { net: 400 } });
    expect(ev.find((e) => e.kind === "first_green_month")).toMatchObject({ params: { month: "2026-02" } });
    expect(ev.find((e) => e.kind === "best_month")).toMatchObject({ params: { month: "2026-02" } });
    expect(ev.find((e) => e.kind === "drawdown")).toBeTruthy();
    expect(ev.find((e) => e.kind === "recovery")).toBeTruthy();
    expect(ev.find((e) => e.kind === "stage_change")).toMatchObject({ params: { from: "junior", to: "trader" } });
    for (let i = 1; i < ev.length; i++) expect(ev[i - 1]!.day <= ev[i]!.day).toBe(true);
  });

  it("no best_* events for an all-red career; the first month green is not a «first green month»", () => {
    const red = buildTimeline({ ...empty, days: [day("2026-01-05", -5), day("2026-02-05", -5)] });
    expect(red.some((e) => e.kind.startsWith("best_"))).toBe(false);
    const green = buildTimeline({ ...empty, days: [day("2026-01-05", 5), day("2026-02-05", 5)] });
    expect(green.some((e) => e.kind === "first_green_month")).toBe(false);
  });

  it("caps medal events at the newest tiers and lists curator steps only when given", () => {
    const achievements = Array.from({ length: 12 }, (_, i) => ({ day: `2026-03-${String(i + 1).padStart(2, "0")}`, line: "reviews_total", tier: "bronze" }));
    const ev = buildTimeline({ ...empty, achievements });
    const medals = ev.filter((e) => e.kind === "achievement");
    expect(medals).toHaveLength(MAX_ACHIEVEMENT_EVENTS);
    expect(medals[0]!.day).toBe("2026-03-05");
    expect(ev.some((e) => e.kind === "intervention")).toBe(false);
    const staff = buildTimeline({ ...empty, interventions: [{ day: "2026-03-02", kind: "one_on_one", trigger: "scheduled" }] });
    expect(staff).toEqual([{ kind: "intervention", day: "2026-03-02", params: { kind: "one_on_one", trigger: "scheduled" } }]);
  });
});
