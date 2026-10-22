import { describe, expect, it } from "vitest";
import { draftRange, isYmd, parseDayRange, prevDayRange, rangeDays, rangeError, shiftYmd } from "./period-range";
import { filtersRange } from "@/components/analytics-page/period";
import { statsRanges } from "@/components/stats/metrics";

describe("period-range («Свой период»)", () => {
  it("accepts real days only", () => {
    expect(isYmd("2026-02-28")).toBe(true);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-2-1")).toBe(false);
    expect(isYmd(null)).toBe(false);
  });

  it("validates from ≤ to", () => {
    expect(rangeError({ from: "2026-10-01", to: "2026-10-21" })).toBeNull();
    expect(rangeError({ from: "2026-10-21", to: "2026-10-21" })).toBeNull();
    expect(rangeError({ from: "2026-10-22", to: "2026-10-21" })).toBe("order");
    expect(rangeError({ from: "", to: "2026-10-21" })).toBe("missing");
    expect(parseDayRange("2026-10-22", "2026-10-21")).toBeNull();
    expect(parseDayRange("2026-10-01", "2026-10-21")).toEqual({ from: "2026-10-01", to: "2026-10-21" });
  });

  it("compares with an equally long window right before", () => {
    const r = { from: "2026-03-01", to: "2026-03-10" };
    expect(rangeDays(r)).toBe(10);
    expect(prevDayRange(r)).toEqual({ from: "2026-02-19", to: "2026-02-28" });
    expect(shiftYmd("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("prefills the form: the stored range, else the preset window, else 30 days", () => {
    const c = { from: "2026-01-05", to: "2026-01-09" };
    expect(draftRange(c, { from: "2026-07-01" }, "2026-10-23")).toEqual(c);
    expect(draftRange(null, { from: "2026-07-01", to: null }, "2026-10-23")).toEqual({ from: "2026-07-01", to: "2026-10-23" });
    expect(draftRange(null, null, "2026-10-23")).toEqual({ from: "2026-09-24", to: "2026-10-23" });
  });

  it("drives /analytics and /stats windows", () => {
    expect(filtersRange({ period: "custom", from: "2026-03-01", to: "2026-03-10" })).toEqual({ from: "2026-03-01", to: "2026-03-10", prevFrom: "2026-02-19", prevTo: "2026-02-28" });
    // A custom period without a valid range falls back to the default 90 days.
    expect(filtersRange({ period: "custom", from: "x" }, new Date(2026, 9, 19))?.from).toBe(filtersRange({ period: "90d" }, new Date(2026, 9, 19))?.from);
    expect(statsRanges("custom", { from: "2026-03-01", to: "2026-03-10" })).toEqual({ cur: { from: "2026-03-01", to: "2026-03-10" }, prev: { from: "2026-02-19", to: "2026-02-28" } });
  });
});
