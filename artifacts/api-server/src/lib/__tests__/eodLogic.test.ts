import { describe, expect, it } from "vitest";
import { EARLY_CLOSE_MIN, MARKET_CLOSE_MIN, canCloseDay, computeStreaks, missingFields, missingList, nextTradingDay, prevTradingDay, tradingDaysAfter, tradingHoursBetween, type ReviewableTrade } from "../eodLogic";

describe("eodLogic trading-day navigation (weekends only)", () => {
  it.each<[string, string]>([
    ["2026-10-16", "2026-10-19"], // Fri → Mon
    ["2026-10-17", "2026-10-19"], // Sat → Mon
    ["2026-10-18", "2026-10-19"], // Sun → Mon
    ["2026-10-19", "2026-10-20"],
    ["2026-12-31", "2027-01-01"], // Thu → Fri (holidays not modelled)
  ])("nextTradingDay(%s) → %s", (d, e) => expect(nextTradingDay(d)).toBe(e));

  it.each<[string, string]>([
    ["2026-10-19", "2026-10-16"], // Mon → Fri
    ["2026-10-18", "2026-10-16"],
    ["2026-10-17", "2026-10-16"],
    ["2026-10-20", "2026-10-19"],
    ["2026-01-01", "2025-12-31"],
  ])("prevTradingDay(%s) → %s", (d, e) => expect(prevTradingDay(d)).toBe(e));
});

describe("eodLogic.missingFields", () => {
  it.each<[string, { setup: string | null; confidenceGrade: string | null }, string[]]>([
    ["complete", { setup: "ORB", confidenceGrade: "A" }, []],
    ["A+ is valid", { setup: "ORB", confidenceGrade: "A+" }, []],
    ["setup null", { setup: null, confidenceGrade: "B" }, ["setup"]],
    ["setup whitespace", { setup: "   ", confidenceGrade: "C" }, ["setup"]],
    ["grade null", { setup: "ORB", confidenceGrade: null }, ["grade"]],
    ["grade not in list", { setup: "ORB", confidenceGrade: "A-" }, ["grade"]],
    ["grade lower-case is rejected", { setup: "ORB", confidenceGrade: "a" }, ["grade"]],
    ["both missing", { setup: "", confidenceGrade: "" }, ["setup", "grade"]],
  ])("%s", (_n, t, e) => expect(missingFields(t)).toEqual(e));

  it("missingList keeps only incomplete trades with ids and tickers", () => {
    const trades: ReviewableTrade[] = [
      { id: 1, ticker: "AAPL", setup: "ORB", confidenceGrade: "A" },
      { id: 2, ticker: "TSLA", setup: null, confidenceGrade: "A" },
      { id: 3, ticker: "NVDA", setup: "Gap", confidenceGrade: "Z" },
    ];
    expect(missingList(trades)).toEqual([
      { tradeId: 2, ticker: "TSLA", fields: ["setup"] },
      { tradeId: 3, ticker: "NVDA", fields: ["grade"] },
    ]);
  });
});

describe("eodLogic.canCloseDay", () => {
  const ok: ReviewableTrade = { id: 1, ticker: "A", setup: "x", confidenceGrade: "B" };
  it("future day is refused even with no trades", () => {
    const r = canCloseDay({ date: "2026-10-18", today: "2026-10-17", trades: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/будущий/);
  });
  it("today and the past are allowed when every trade is reviewed", () => {
    expect(canCloseDay({ date: "2026-10-17", today: "2026-10-17", trades: [ok] })).toEqual({ ok: true, missing: [], reason: null });
    expect(canCloseDay({ date: "2026-10-10", today: "2026-10-17", trades: [] }).ok).toBe(true);
  });
  it("unreviewed trades block the close and are listed", () => {
    const r = canCloseDay({ date: "2026-10-17", today: "2026-10-17", trades: [ok, { id: 2, ticker: "B", setup: "", confidenceGrade: null }] });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ tradeId: 2, ticker: "B", fields: ["setup", "grade"] }]);
  });
  // Волна 0, item 0.5: today closes only after the market close (16:00 NY; 13:00 on an early-close day).
  it("today before 16:00 NY is refused with opensAt; from 16:00 it closes", () => {
    const at = (h: number, m = 0) => ({ date: "2026-10-16", today: "2026-10-16", trades: [ok], nowMinutes: h * 60 + m });
    const early = canCloseDay(at(10, 30));
    expect(early).toMatchObject({ ok: false, reasonCode: "EOD_TOO_EARLY", opensAt: "16:00", missing: [] });
    expect(canCloseDay(at(15, 59)).ok).toBe(false);
    expect(canCloseDay(at(16, 0))).toEqual({ ok: true, missing: [], reason: null });
    expect(canCloseDay(at(18, 45)).ok).toBe(true);
  });
  it("a short day (Christmas Eve, 13:00 close) opens at 13:00", () => {
    const at = (h: number) => canCloseDay({ date: "2026-12-24", today: "2026-12-24", trades: [], nowMinutes: h * 60, closeMinutes: EARLY_CLOSE_MIN });
    expect(at(12)).toMatchObject({ ok: false, opensAt: "13:00" });
    expect(at(13).ok).toBe(true);
    expect(MARKET_CLOSE_MIN).toBe(960);
  });
  it("the time only matters for today: yesterday closes at 09:00, without nowMinutes nothing is checked", () => {
    expect(canCloseDay({ date: "2026-10-15", today: "2026-10-16", trades: [ok], nowMinutes: 9 * 60 }).ok).toBe(true);
    expect(canCloseDay({ date: "2026-10-16", today: "2026-10-16", trades: [ok] }).ok).toBe(true);
  });
  it("the time rule comes before the trade check (no «incomplete» list mid-session)", () => {
    const r = canCloseDay({ date: "2026-10-16", today: "2026-10-16", trades: [{ id: 2, ticker: "B", setup: "", confidenceGrade: null }], nowMinutes: 600 });
    expect(r).toMatchObject({ reasonCode: "EOD_TOO_EARLY", opensAt: "16:00", missing: [] });
  });
});

describe("eodLogic.computeStreaks", () => {
  const days = (xs: Array<[string, number, number]>) => new Map(xs.map(([d, n, reviewed]) => [d, { n, reviewed }]));

  it("closed streak counts consecutive weekdays ending today", () => {
    // today Wed 2026-10-14; closed Mon..Wed and the previous Fri → 4 (weekend skipped)
    const s = computeStreaks({ today: "2026-10-14", closedDates: new Set(["2026-10-14", "2026-10-13", "2026-10-12", "2026-10-09"]), tradeDays: new Map() });
    expect(s.closedStreak).toBe(4);
    expect(s.closedTotal).toBe(4);
    expect(s.lastClosed).toBe("2026-10-14");
  });

  it("today not yet closed: the streak starts from the previous trading day", () => {
    const s = computeStreaks({ today: "2026-10-14", closedDates: new Set(["2026-10-13", "2026-10-12"]), tradeDays: new Map() });
    expect(s.closedStreak).toBe(2);
  });

  it("a gap breaks the closed streak", () => {
    const s = computeStreaks({ today: "2026-10-14", closedDates: new Set(["2026-10-14", "2026-10-12"]), tradeDays: new Map() });
    expect(s.closedStreak).toBe(1);
  });

  it("weekend today: counting starts on Friday", () => {
    const s = computeStreaks({ today: "2026-10-17", closedDates: new Set(["2026-10-16", "2026-10-15"]), tradeDays: new Map() });
    expect(s.closedStreak).toBe(2);
  });

  it("empty input", () => {
    expect(computeStreaks({ today: "2026-10-14", closedDates: new Set(), tradeDays: new Map() })).toEqual({ closedStreak: 0, reviewedStreak: 0, closedTotal: 0, lastClosed: null });
  });

  it("reviewed streak: days without trades neither count nor break; a partially reviewed day breaks", () => {
    const s = computeStreaks({
      today: "2026-10-14",
      closedDates: new Set(),
      tradeDays: days([
        ["2026-10-14", 2, 2],
        // 10-13 no trades
        ["2026-10-12", 1, 1],
        ["2026-10-09", 3, 2], // breaks
        ["2026-10-08", 1, 1],
      ]),
    });
    expect(s.reviewedStreak).toBe(2);
  });

  it("reviewed streak stops after 60 empty trading days", () => {
    const s = computeStreaks({
      today: "2026-10-14",
      closedDates: new Set(),
      tradeDays: days([["2026-06-01", 1, 1]]), // > 60 trading days before today
    });
    expect(s.reviewedStreak).toBe(0);
  });
});

describe("eodLogic.tradingHoursBetween (OLGA-07: SLA in trading hours)", () => {
  it("a day closed Friday evening is not overdue on Sunday", () => {
    // Fri 16 Oct 18:00 NY (22:00Z) → Sun 18 Oct 12:00 NY: only the 6 h left of Friday count.
    expect(tradingHoursBetween("2026-10-16T22:00:00Z", new Date("2026-10-18T16:00:00Z"))).toBe(6);
    // … and Monday 12:00 NY: 6 h of Friday + 12 h of Monday.
    expect(tradingHoursBetween("2026-10-16T22:00:00Z", new Date("2026-10-19T16:00:00Z"))).toBe(18);
  });
  it("weekdays count in full; a holiday pauses the clock", () => {
    expect(tradingHoursBetween("2026-10-13T16:00:00Z", new Date("2026-10-14T16:00:00Z"))).toBe(24);
    expect(tradingHoursBetween("2026-10-13T16:00:00Z", new Date("2026-10-14T16:00:00Z"), new Set(["2026-10-14"]))).toBe(12);
  });
  it("empty or reversed ranges → 0", () => {
    expect(tradingHoursBetween("2026-10-14T16:00:00Z", new Date("2026-10-13T16:00:00Z"))).toBe(0);
    expect(tradingHoursBetween("garbage", new Date())).toBe(0);
  });
});

describe("eodLogic.tradingDaysAfter (OLGA-13: idle days in trading days)", () => {
  it("Friday → Monday is one trading day; holidays skipped", () => {
    expect(tradingDaysAfter("2026-10-16", "2026-10-19")).toBe(1);
    expect(tradingDaysAfter("2026-10-16", "2026-10-18")).toBe(0);
    expect(tradingDaysAfter("2026-11-25", "2026-11-30", new Set(["2026-11-26"]))).toBe(2); // Fri 27 + Mon 30
    expect(tradingDaysAfter("2026-10-19", "2026-10-19")).toBe(0);
  });
});
