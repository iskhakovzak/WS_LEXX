// Correct default days (Волна 1, item 1.4) and the day a late close writes its «Фокус на завтра» for.
import { describe, expect, it } from "vitest";
import { CLOSE_MIN, defaultJournalDay, defaultReportDay, focusDayFor, homeDay, reviewLastWeek } from "../default-day";

const MORNING = 9 * 60;
const EVENING = 17 * 60;

describe("defaultJournalDay", () => {
  // Tue 2026-10-20; trades on Thu 15, Fri 16, Mon 19 and today.
  const tradeDays = ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"];

  it("before the close: the last unclosed finished day, never the empty today", () => {
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: MORNING, tradeDays, closed: new Set() })).toBe("2026-10-19");
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: MORNING, tradeDays, closed: new Set(["2026-10-19"]) })).toBe("2026-10-16");
  });

  it("after the close: today once it is finished and still open", () => {
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: CLOSE_MIN, tradeDays, closed: new Set() })).toBe("2026-10-20");
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: EVENING, tradeDays, closed: new Set(["2026-10-20"]) })).toBe("2026-10-19");
  });

  it("everything closed (or nothing traded) → today; on a weekend → Friday", () => {
    const all = new Set(tradeDays);
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: MORNING, tradeDays, closed: all })).toBe("2026-10-20");
    expect(defaultJournalDay({ today: "2026-10-18", nyMinutes: MORNING, tradeDays: [], closed: new Set() })).toBe("2026-10-16");
    expect(homeDay("2026-10-17")).toBe("2026-10-16");
  });

  it("a weekend visit opens Friday when it is still open; days older than two weeks are history", () => {
    expect(defaultJournalDay({ today: "2026-10-18", nyMinutes: MORNING, tradeDays: ["2026-10-16"], closed: new Set() })).toBe("2026-10-16");
    expect(defaultJournalDay({ today: "2026-10-20", nyMinutes: MORNING, tradeDays: ["2026-09-01"], closed: new Set() })).toBe("2026-10-20");
  });
});

describe("defaultReportDay", () => {
  it("the last day with trades, else the home day", () => {
    expect(defaultReportDay("2026-10-20", "2026-10-16")).toBe("2026-10-16");
    expect(defaultReportDay("2026-10-20", null)).toBe("2026-10-20");
    expect(defaultReportDay("2026-10-18", undefined)).toBe("2026-10-16");
  });
});

describe("reviewLastWeek", () => {
  it("Monday–Wednesday → last week; Thursday–Sunday → this week", () => {
    expect(["2026-10-19", "2026-10-20", "2026-10-21"].map(reviewLastWeek)).toEqual([true, true, true]);
    expect(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(reviewLastWeek)).toEqual([false, false, false, false]);
  });
});

describe("focusDayFor", () => {
  it("the next trading day when closed on time", () => {
    expect(focusDayFor("2026-10-16", "2026-10-16", EVENING)).toBe("2026-10-19");
    expect(focusDayFor("2026-10-19", "2026-10-19", EVENING)).toBe("2026-10-20");
  });
  it("closed late: the session ahead, never the past", () => {
    expect(focusDayFor("2026-10-16", "2026-10-20", MORNING)).toBe("2026-10-20");
    expect(focusDayFor("2026-10-16", "2026-10-20", EVENING)).toBe("2026-10-21");
    expect(focusDayFor("2026-10-15", "2026-10-18", MORNING)).toBe("2026-10-19");
  });
});
