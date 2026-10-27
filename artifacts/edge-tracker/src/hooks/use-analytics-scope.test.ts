import { describe, expect, it } from "vitest";
import { readAnalyticsScope } from "./use-analytics-scope";

describe("analytics group scope (design audit wave 3)", () => {
  it("URL → shared key → the page's old prefs → «Квартал», per field; legacy values read", () => {
    expect(readAnalyticsScope("", null, null)).toEqual({ period: "quarter", custom: null, trader: "", unit: null });
    expect(readAnalyticsScope("?period=30d&trader=Bob", { period: "year", trader: "Zed", unit: "usd" }, null))
      .toMatchObject({ period: "month", trader: "Bob", unit: "usd" });
    expect(readAnalyticsScope("?p=ytd", null, { period: "7d" }, { legacyPeriodParams: ["p"] }).period).toBe("year");
    expect(readAnalyticsScope("", null, { period: "custom", from: "2026-03-01", to: "2026-03-10" }))
      .toMatchObject({ period: "custom", custom: { from: "2026-03-01", to: "2026-03-10" } });
  });

  it("«Всё» and «Вся команда» come back from storage only where the page allows it; a link always wins", () => {
    const stored = { period: "all", trader: "__team__" };
    expect(readAnalyticsScope("", stored, null, { restoreAll: false, restoreTeam: false })).toMatchObject({ period: "quarter", trader: "" });
    expect(readAnalyticsScope("", stored, null)).toMatchObject({ period: "all", trader: "__team__" });
    expect(readAnalyticsScope("?period=all&trader=all", null, null, { restoreAll: false, restoreTeam: false })).toMatchObject({ period: "all", trader: "__team__" });
    // «Сегодня» is not offered in the group: the next source decides.
    expect(readAnalyticsScope("?period=today", { period: "week" }, null).period).toBe("week");
  });
});
