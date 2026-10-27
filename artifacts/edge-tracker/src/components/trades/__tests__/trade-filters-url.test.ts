import { describe, expect, it } from "vitest";
import { normalizeStoredFilters, parseTradesUrl, serializeTradesUrl } from "../use-trade-filters";
import { DEFAULT_FILTERS, periodRange } from "../trade-utils";

const state = (f: Partial<typeof DEFAULT_FILTERS>) => ({ filters: { ...DEFAULT_FILTERS, ...f }, sort: { col: "date" as const, dir: "desc" as const }, page: 1, pageSize: 50 });

describe("/trades period in the URL (one vocabulary)", () => {
  it("reads legacy values and custom ranges", () => {
    expect(parseTradesUrl("?period=30d").state.filters.period).toBe("month");
    expect(parseTradesUrl("?period=quarter").state.filters.period).toBe("quarter");
    expect(parseTradesUrl("?date=2026-10-01").state.filters).toMatchObject({ period: "custom", from: "2026-10-01", to: "2026-10-01" });
  });
  it("writes ?period (+ from / to for a custom range), «Всё» stays out", () => {
    expect(serializeTradesUrl(state({ period: "week" }))).toBe("period=week");
    expect(serializeTradesUrl(state({ period: "custom", from: "2026-10-01", to: "2026-10-09" }))).toBe("period=custom&from=2026-10-01&to=2026-10-09");
    expect(serializeTradesUrl(state({}))).toBe("");
  });
  it("presets are windows ending today; stored custom without dates falls back to all", () => {
    expect(periodRange({ period: "week", from: "", to: "" }, new Date("2026-10-27T16:00:00Z"))).toEqual({ from: "2026-10-21", to: "2026-10-27" });
    expect(normalizeStoredFilters({ period: "custom" as const, from: "", to: "" }).period).toBe("all");
  });
});
