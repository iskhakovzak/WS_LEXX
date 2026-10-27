import { describe, expect, it } from "vitest";
import { addDaysYmd, mondayOf, paceBand, weekdaysLeft, weeklyPulse } from "./pulse";
import { nextHiddenMap } from "./recs-api";
import type { DayPoint } from "./api";

const day = (date: string, v: number, trades = 5): DayPoint => ({ date, doy: 0, v, cum: 0, trades, s: {} });

describe("«Пульс недели»", () => {
  const days = [
    day("2026-09-21", 1), day("2026-09-28", 2), day("2026-10-05", -1), day("2026-10-06", 3),
    day("2026-10-12", 1), day("2026-10-13", 1), day("2026-10-19", -2), day("2026-10-20", 0.5),
  ];

  it("this week vs last week and the 4-week mean", () => {
    const p = weeklyPulse(days, "2026-10-21")!;
    expect(p.which).toBe("current");
    expect(p.week.from).toBe("2026-10-19");
    expect(p.week.net).toBeCloseTo(-1.5);
    expect(p.week.days).toBe(2);
    expect(p.week.green).toBe(1);
    expect(p.week.best?.date).toBe("2026-10-20");
    expect(p.prev.net).toBe(2);
    // weeks of 12.10, 5.10, 28.09, 21.09: 2, 2, 2, 1
    expect(p.avg4).toBeCloseTo(7 / 4);
    expect(p.avg4Weeks).toBe(4);
  });

  it("a week without trades yet shows the last traded week", () => {
    const p = weeklyPulse(days, "2026-10-26")!;
    expect(p.which).toBe("last");
    expect(p.week.from).toBe("2026-10-19");
  });

  it("no days → no pulse; calendar helpers", () => {
    expect(weeklyPulse([], "2026-10-21")).toBeNull();
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdaysLeft("2026-12-29")).toBe(2);
  });
});

describe("year-end band", () => {
  const year = Array.from({ length: 60 }, (_, i) => day(addDaysYmd("2026-01-05", i + Math.floor(i / 5) * 2), i % 3 === 0 ? -1 : 1));

  it("needs 20 traded days", () => {
    expect(paceBand(year.slice(0, 19), 0, 40, "2026-02-01")).toBeNull();
  });

  it("ordered quantiles around the projection; seeded; the goal chance moves the right way", () => {
    const b = paceBand(year, 20, 40, "2026-03-27")!;
    expect(b.p10).toBeLessThan(b.p50);
    expect(b.p50).toBeLessThan(b.p90);
    expect(b.daysLeft).toBeGreaterThan(150);
    expect(paceBand(year, 20, 40, "2026-03-27")).toEqual(b);
    const easy = paceBand(year, 20, 30, "2026-03-27")!;
    const hard = paceBand(year, 20, 200, "2026-03-27")!;
    expect(easy.pGoal).toBeGreaterThan(hard.pGoal);
    expect(hard.pGoal).toBe(0);
  });

  it("no days left → the band collapses to today's result", () => {
    const b = paceBand(year, 5, 40, "2026-12-31")!;
    expect(b).toMatchObject({ p10: 5, p50: 5, p90: 5, pGoal: 0, daysLeft: 0 });
  });
});

describe("«скрыть на неделю» map", () => {
  const hidden = [{ id: "leak:a", until: "2026-10-30", kind: "leak" as const }];
  it("hide adds a week, show removes one, show all clears", () => {
    expect(nextHiddenMap(hidden, { hide: "fees:lt5" }, "2026-10-23")).toEqual({ "leak:a": "2026-10-30", "fees:lt5": "2026-10-30" });
    expect(nextHiddenMap(hidden, { show: "leak:a" }, "2026-10-23")).toEqual({});
    expect(nextHiddenMap(hidden, { show: "all" }, "2026-10-23")).toEqual({});
  });
});
