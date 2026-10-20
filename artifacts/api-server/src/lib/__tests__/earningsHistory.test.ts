/**
 * lib/earningsHistory — the fallback chain of GET /api/earnings/history/:ticker with injected fetchers (no network,
 * no DB): NASDAQ → Yahoo EPS × Finviz report dates → honest «source unavailable» (item 1.14).
 */
import { describe, expect, it, vi } from "vitest";
import { fiscalLabel, historyUnavailable, mergeEpsWithDates, MIN_SESSIONS_WITH_REPORTS, surpriseRowsWithFallback, type HistoryFetchers } from "../earningsHistory";

const TODAY = "2026-10-20";
const nasdaqRow = { fiscalQuarter: "Jun 2026", date: "2026-08-27", epsActual: 1.1, epsEstimate: 1.0, surprisePct: 10 };
const fetchers = (over: Partial<HistoryFetchers>): HistoryFetchers => ({
  nasdaq: vi.fn(async () => []),
  yahoo: vi.fn(async () => []),
  reportDates: vi.fn(async () => []),
  ...over,
});

describe("surpriseRowsWithFallback", () => {
  it("NASDAQ rows → used as is, the fallbacks are not called", async () => {
    const f = fetchers({ nasdaq: vi.fn(async () => [nasdaqRow]) });
    expect(await surpriseRowsWithFallback("NVDA", f, TODAY)).toEqual({ rows: [nasdaqRow], source: "nasdaq", allFailed: false });
    expect(f.yahoo).not.toHaveBeenCalled();
    expect(f.reportDates).not.toHaveBeenCalled();
  });

  it("NASDAQ empty → Yahoo EPS matched to Finviz report dates", async () => {
    const f = fetchers({
      yahoo: vi.fn(async () => [
        { quarterEnd: "2026-04-30", epsActual: 0.8, epsEstimate: 0.75, surprisePct: 6.67 },
        { quarterEnd: "2026-07-31", epsActual: 1.05, epsEstimate: 1.1, surprisePct: -4.55 },
      ]),
      reportDates: vi.fn(async () => ["2026-11-19", "2026-08-27", "2026-05-28"]),
    });
    const r = await surpriseRowsWithFallback("NVDA", f, TODAY);
    expect(r.source).toBe("yahoo");
    expect(r.rows).toEqual([
      { fiscalQuarter: "Jul 2026", date: "2026-08-27", epsActual: 1.05, epsEstimate: 1.1, surprisePct: -4.55 },
      { fiscalQuarter: "Apr 2026", date: "2026-05-28", epsActual: 0.8, epsEstimate: 0.75, surprisePct: 6.67 },
    ]); // the future date (2026-11-19) is not a report yet
  });

  it("NASDAQ failed and Yahoo failed → Finviz dates alone still give reaction quarters", async () => {
    const f = fetchers({ nasdaq: vi.fn(async () => null), yahoo: vi.fn(async () => null), reportDates: vi.fn(async () => ["2026-07-30"]) });
    const r = await surpriseRowsWithFallback("AAPL", f, TODAY);
    expect(r.source).toBe("finviz");
    expect(r.rows).toEqual([{ fiscalQuarter: null, date: "2026-07-30", epsActual: null, epsEstimate: null, surprisePct: null }]);
  });

  it("every source failed (null or thrown) → empty, allFailed", async () => {
    const f = fetchers({ nasdaq: vi.fn(async () => null), yahoo: vi.fn(async () => { throw new Error("down"); }), reportDates: vi.fn(async () => null) });
    expect(await surpriseRowsWithFallback("MSFT", f, TODAY)).toEqual({ rows: [], source: null, allFailed: true });
  });

  it("sources answered with nothing → empty, not allFailed", async () => {
    expect(await surpriseRowsWithFallback("NEWCO", fetchers({}), TODAY)).toEqual({ rows: [], source: null, allFailed: false });
  });
});

describe("historyUnavailable", () => {
  it("quarters found → never unavailable", () => {
    expect(historyUnavailable({ rowsEmpty: false, allFailed: true, sessions: null })).toBe(false);
  });
  it("empty and every source failed → unavailable", () => {
    expect(historyUnavailable({ rowsEmpty: true, allFailed: true, sessions: 10 })).toBe(true);
  });
  it("empty for a ticker that has traded long enough to have reported → unavailable (not «no reports»)", () => {
    expect(historyUnavailable({ rowsEmpty: true, allFailed: false, sessions: 500 })).toBe(true);
    expect(historyUnavailable({ rowsEmpty: true, allFailed: false, sessions: null })).toBe(true);
  });
  it("empty for a young listing whose sources answered → honest «no reports»", () => {
    expect(historyUnavailable({ rowsEmpty: true, allFailed: false, sessions: MIN_SESSIONS_WITH_REPORTS - 1 })).toBe(false);
  });
});

describe("mergeEpsWithDates", () => {
  it("a quarter without a report date in (end, end + 100 d] is dropped; a date is used once", () => {
    const rows = mergeEpsWithDates(
      [{ quarterEnd: "2025-12-31", epsActual: 1, epsEstimate: 1, surprisePct: 0 }, { quarterEnd: "2026-03-31", epsActual: 2, epsEstimate: 1, surprisePct: 100 }],
      ["2026-04-28"],
    );
    expect(rows).toEqual([{ fiscalQuarter: "Mar 2026", date: "2026-04-28", epsActual: 2, epsEstimate: 1, surprisePct: 100 }]);
    expect(fiscalLabel("2026-09-30")).toBe("Sep 2026");
  });
});
