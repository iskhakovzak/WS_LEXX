import { describe, expect, it } from "vitest";
import { GREEN_STREAK_DAYS, MOOD_TAGS, greenStreak, moodOf, moodTags, parseLedger, recordDay } from "../context";
import { EMPTY_ROTATION, SURFACE_WEIGHTS, nextQuote } from "../rotation";
import type { QuoteMeta } from "../types";

describe("day ledger", () => {
  it("records finished days, corrects a re-sent day and keeps the newest 12", () => {
    let l = {};
    for (let d = 1; d <= 15; d++) l = recordDay(l, `2026-10-${String(d).padStart(2, "0")}`, d);
    expect(Object.keys(l)).toHaveLength(12);
    expect(Object.keys(l)[0]).toBe("2026-10-04");
    const same = recordDay(l, "2026-10-15", 15);
    expect(same).toBe(l);
    expect(recordDay(l, "2026-10-15", -3)["2026-10-15"]).toBe(-3);
  });
  it("ignores missing or malformed input", () => {
    const l = { "2026-10-01": 5 };
    expect(recordDay(l, null, 5)).toBe(l);
    expect(recordDay(l, "2026-10-02", null)).toBe(l);
    expect(recordDay(l, "yesterday", 5)).toBe(l);
    expect(parseLedger({ "2026-10-01": 5, bad: 1, "2026-10-02": "x" })).toEqual({ "2026-10-01": 5 });
  });
});

describe("mood", () => {
  it("red after a losing day, whatever came before", () => {
    expect(moodOf({ "2026-10-20": 100, "2026-10-21": 200, "2026-10-22": 300, "2026-10-23": -40 })).toBe("red");
  });
  it(`green only after ${GREEN_STREAK_DAYS}+ green days in a row`, () => {
    expect(moodOf({ "2026-10-21": 50, "2026-10-22": 60 })).toBeNull();
    expect(moodOf({ "2026-10-21": 50, "2026-10-22": 60, "2026-10-23": 10 })).toBe("green");
    expect(greenStreak({ "2026-10-20": 50, "2026-10-21": -5, "2026-10-22": 60, "2026-10-23": 10 })).toBe(2);
  });
  it("neutral with no data or after a flat day", () => {
    expect(moodOf({})).toBeNull();
    expect(moodOf({ "2026-10-23": 0 })).toBeNull();
    expect(moodTags(null)).toBeNull();
  });
});

describe("context selection", () => {
  const list: QuoteMeta[] = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `w-${i}`, cat: "trading" as const, tags: ["wisdom" as const], author: "a", work: "w", loc: "", rel: "verified" as const })),
    { id: "r-1", cat: "philosophy", tags: ["loss"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "r-2", cat: "olympus", tags: ["patience", "fate"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "g-1", cat: "psychology", tags: ["humility"], author: "a", work: "w", loc: "", rel: "verified" },
    { id: "g-2", cat: "trading", tags: ["process"], author: "a", work: "w", loc: "", rel: "verified" },
  ];
  it("after a red day the day's quote carries a patience / loss / resilience tag", () => {
    for (let seed = 0; seed < 25; seed++) {
      const r = nextQuote(list, EMPTY_ROTATION, { seed, weights: SURFACE_WEIGHTS.dash, preferTags: moodTags("red") }, "d")!;
      expect(["r-1", "r-2"]).toContain(r.id);
    }
  });
  it("on a green streak it carries humility / process", () => {
    for (let seed = 0; seed < 25; seed++) {
      const r = nextQuote(list, EMPTY_ROTATION, { seed, weights: SURFACE_WEIGHTS.dash, preferTags: MOOD_TAGS.green }, "d")!;
      expect(["g-1", "g-2"]).toContain(r.id);
    }
  });
});
