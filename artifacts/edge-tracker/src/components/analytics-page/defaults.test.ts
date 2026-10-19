import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { DEFAULT_FILTERS, activeFilterCount, periodRange, withHotkeys } from "./metrics";
import { entryMinutesOf, toSimTrades } from "./edge-api";

describe("analytics defaults (DEV-01, MAKSIM-32)", () => {
  it("opens on 90 days; the default period is not an «active filter»", () => {
    expect(DEFAULT_FILTERS.period).toBe("90d");
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, period: "all" })).toBe(1);
    const r = periodRange("90d", new Date(2026, 9, 19))!;
    expect([r.from, r.prevFrom, r.prevTo]).toEqual(["2026-07-22", "2026-04-23", "2026-07-21"]);
  });

  it("hotkeys follow the visible tabs: 7 tabs → 1–7", () => {
    const tabs = withHotkeys(["a", "b", "c", "d", "e", "f", "g"].map((value) => ({ value })));
    expect(tabs.map((x) => x.key)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });
});

describe("what-if entry time (MAKSIM-14)", () => {
  it("reads the PropReports entry time", () => {
    const t = { id: 1, date: "2026-10-01", result: "win", pnl: 5, contextSnapshot: { openedAt: "2026-10-01T09:40:12" } } as unknown as Trade;
    expect(entryMinutesOf(t)).toBe(9 * 60 + 40);
    expect(toSimTrades([t])[0].entryMin).toBe(580);
  });
});
