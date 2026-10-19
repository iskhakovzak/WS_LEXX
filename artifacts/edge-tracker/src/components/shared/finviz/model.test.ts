import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  addTickerToDoc, catalystLine, earningsFlag, earningsFlagOf, earningsList, morningState, newPlanItem, nextWeekday, normTicker, nyClock,
  periodRange, planTickers, rowMove, screenerSummary, sessionDay, sortRows, PLAN_MAX_TICKERS, type EarningsRow, type ScreenerRow, type TickerSnapshot,
} from "./model";
import { contextChips } from "./chips";
import { EarningsFlagPill, FinvizOff } from "./earnings";

const row = (over: Partial<ScreenerRow> = {}): ScreenerRow => ({
  ticker: "AAA", company: "Aaa Inc", sector: "Technology", price: 12.5, changePct: 3, gapPct: 5, relVolume: 2.5, volume: 1_000_000,
  avgVolume: 800_000, float: 15_000_000, shortFloatPct: 12, atr: 0.8, marketCap: 500_000_000, earningsDate: null, earningsTiming: null, ...over,
});

const snap = (over: Partial<TickerSnapshot> = {}): TickerSnapshot => ({
  ticker: "NVDA", company: "NVIDIA Corp", sector: "Technology", industry: "Semiconductors", country: "USA", marketCap: 3.4e12,
  float: 24_300_000_000, shortFloatPct: 1.1, shortRatio: 1.4, avgVolume: 250_000_000, relVolume: 1.2, atr: 4.21, beta: 1.7,
  earningsDate: null, earningsTiming: null, asOf: "2026-10-19T10:00:00Z", ...over,
});

const er = (ticker: string, date: string, timing: EarningsRow["timing"], marketCap: number | null = null): EarningsRow => ({ ticker, date, timing, company: null, marketCap });

describe("tickers and the NY clock", () => {
  it("normalizes tickers, rejects junk", () => {
    expect(normTicker(" nvda ")).toBe("NVDA");
    expect(normTicker("BRK.B")).toBe("BRK.B");
    expect(normTicker("")).toBeNull();
    expect(normTicker("1ABC")).toBeNull();
    expect(normTicker("TOO-LONG-TICKER")).toBeNull();
  });

  it("reads the New York date and minutes (EDT and EST)", () => {
    expect(nyClock(new Date("2026-10-19T12:05:00Z"))).toEqual({ date: "2026-10-19", minutes: 8 * 60 + 5 });
    expect(nyClock(new Date("2026-12-01T03:30:00Z"))).toEqual({ date: "2026-11-30", minutes: 22 * 60 + 30 });
  });

  it("next weekday skips the weekend; the session of a weekend is Monday", () => {
    expect(nextWeekday("2026-10-23")).toBe("2026-10-26");
    expect(nextWeekday("2026-10-19")).toBe("2026-10-20");
    expect(sessionDay(new Date("2026-10-24T15:00:00Z"))).toBe("2026-10-26");
    expect(sessionDay(new Date("2026-10-19T15:00:00Z"))).toBe("2026-10-19");
  });

  it("morning state: before the open → today, expanded; RTH → collapsed; after the close / weekend → next session", () => {
    expect(morningState(new Date("2026-10-19T12:00:00Z"))).toEqual({ planDate: "2026-10-19", beforeOpen: true }); // 08:00 NY
    expect(morningState(new Date("2026-10-19T14:00:00Z"))).toEqual({ planDate: "2026-10-19", beforeOpen: false }); // 10:00 NY
    expect(morningState(new Date("2026-10-23T21:00:00Z"))).toEqual({ planDate: "2026-10-26", beforeOpen: true }); // Fri 17:00 NY
    expect(morningState(new Date("2026-10-25T15:00:00Z"))).toEqual({ planDate: "2026-10-26", beforeOpen: true }); // Sunday
  });
});

describe("screener", () => {
  it("move = gap for gappers, the day change otherwise (falls back to the other)", () => {
    expect(rowMove(row(), "gappers")).toBe(5);
    expect(rowMove(row(), "relvol")).toBe(3);
    expect(rowMove(row({ changePct: null }), "relvol")).toBe(5);
    expect(rowMove(row({ gapPct: null }), "gappers")).toBe(3);
  });

  it("sorts by |move| with empties last; ties by ticker; ticker sort ascending", () => {
    const rows = [row({ ticker: "B", gapPct: -9 }), row({ ticker: "A", gapPct: 4 }), row({ ticker: "C", gapPct: null, changePct: null }), row({ ticker: "D", gapPct: 4 })];
    expect(sortRows(rows, "move", "desc", "gappers").map((r) => r.ticker)).toEqual(["B", "A", "D", "C"]);
    expect(sortRows(rows, "move", "asc", "gappers").map((r) => r.ticker)).toEqual(["A", "D", "B", "C"]);
    expect(sortRows(rows, "ticker", "asc", "gappers").map((r) => r.ticker)).toEqual(["A", "B", "C", "D"]);
    expect(sortRows([row({ ticker: "X", float: null }), row({ ticker: "Y", float: 1 })], "float", "asc", "relvol").map((r) => r.ticker)).toEqual(["Y", "X"]);
  });

  it("summary leader per preset", () => {
    const rows = [row({ ticker: "A", gapPct: 4, relVolume: 9, marketCap: 1 }), row({ ticker: "B", gapPct: -12, relVolume: 2, marketCap: 9 })];
    expect(screenerSummary(rows, "gappers")).toMatchObject({ count: 2, move: -12 });
    expect(screenerSummary(rows, "gappers").leader?.ticker).toBe("B");
    expect(screenerSummary(rows, "relvol").leader?.ticker).toBe("A");
    expect(screenerSummary(rows, "earnings_today").leader?.ticker).toBe("B");
    expect(screenerSummary([], "gappers")).toEqual({ count: 0, leader: null, move: null });
  });

  it("catalyst prefill: the numbers that made it a candidate, same notation in every language", () => {
    expect(catalystLine(row(), "gappers", null)).toBe("Gap +5.0% · RVOL 2.5 · Float 15M · SI 12.0%");
    expect(catalystLine(row({ changePct: -2.25, float: null, shortFloatPct: null }), "relvol", "Отчёт сегодня до открытия")).toBe("−2.3% · RVOL 2.5 · Отчёт сегодня до открытия");
    expect(catalystLine(row({ gapPct: null, changePct: null, relVolume: null, float: null, shortFloatPct: null }), "gappers", null)).toBe("");
  });
});

describe("«в план»", () => {
  it("collects plan tickers case-insensitively and ignores junk items", () => {
    expect([...planTickers({ inPlay: [{ ticker: "nvda" }, { ticker: " " }, null, { x: 1 }] })]).toEqual(["NVDA"]);
    expect(planTickers(null).size).toBe(0);
  });

  it("appends the ticker and keeps every stored field", () => {
    const doc = { marketView: "Риск-офф", focus: "Только A+", setups: [3], inPlay: [{ ticker: "AAPL" }], maxLossUsd: 300 };
    const r = addTickerToDoc(doc, newPlanItem("NVDA", "Gap +5.0%"));
    expect(r.kind).toBe("added");
    if (r.kind !== "added") return;
    expect(r.doc).toMatchObject({ marketView: "Риск-офф", focus: "Только A+", setups: [3], maxLossUsd: 300 });
    expect((r.doc.inPlay as { ticker: string; catalyst: string; horizon: string }[]).map((i) => i.ticker)).toEqual(["AAPL", "NVDA"]);
    expect((r.doc.inPlay as { catalyst: string }[])[1].catalyst).toBe("Gap +5.0%");
    expect(doc.inPlay).toHaveLength(1); // input not mutated
  });

  it("an empty / picks-only plan gets its first ticker; duplicates and a full plan are refused", () => {
    expect(addTickerToDoc(null, newPlanItem("NVDA", ""))).toMatchObject({ kind: "added", doc: { inPlay: [{ ticker: "NVDA" }] } });
    expect(addTickerToDoc({ setups: [1] }, newPlanItem("NVDA", ""))).toMatchObject({ kind: "added", doc: { setups: [1] } });
    expect(addTickerToDoc({ inPlay: [{ ticker: "nvda" }] }, newPlanItem("NVDA", ""))).toEqual({ kind: "exists" });
    const full = { inPlay: Array.from({ length: PLAN_MAX_TICKERS }, (_, i) => ({ ticker: `T${i}` })) };
    expect(addTickerToDoc(full, newPlanItem("NVDA", ""))).toEqual({ kind: "full" });
  });

  it("a new item is a valid empty plan ticker (server defaults)", () => {
    expect(newPlanItem("NVDA", "x")).toMatchObject({ ticker: "NVDA", bias: "neutral", grade: null, horizon: "intraday", levels: { support: [], resistance: [] }, media: [] });
  });
});

describe("earnings", () => {
  const rows = [er("AAA", "2026-10-19", "bmo"), er("BBB", "2026-10-19", "amc"), er("CCC", "2026-10-19", null), er("DDD", "2026-10-20", "bmo"), er("EEE", "2026-10-20", "amc")];

  it("flags today BMO / AMC / unknown time and tomorrow before the open; tomorrow after the close is not today's risk", () => {
    expect(earningsFlag("aaa", rows, "2026-10-19")).toBe("todayBmo");
    expect(earningsFlag("BBB", rows, "2026-10-19")).toBe("todayAmc");
    expect(earningsFlag("CCC", rows, "2026-10-19")).toBe("today");
    expect(earningsFlag("DDD", rows, "2026-10-19")).toBe("tomorrowBmo");
    expect(earningsFlag("EEE", rows, "2026-10-19")).toBeNull();
    expect(earningsFlag("ZZZ", rows, "2026-10-19")).toBeNull();
    expect(earningsFlag("AAA", undefined, "2026-10-19")).toBeNull();
  });

  it("Friday's «tomorrow» is Monday", () => {
    expect(earningsFlag("MON", [er("MON", "2026-10-26", "bmo")], "2026-10-23")).toBe("tomorrowBmo");
  });

  it("flag from a row's own earnings date", () => {
    expect(earningsFlagOf({ ticker: "AAA", earningsDate: "2026-10-19", earningsTiming: "amc" }, "2026-10-19")).toBe("todayAmc");
    expect(earningsFlagOf({ ticker: "AAA", earningsDate: null, earningsTiming: null }, "2026-10-19")).toBeNull();
  });

  it("period ranges: today, next session, through Friday; a weekend starts on Monday", () => {
    expect(periodRange("today", "2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(periodRange("tomorrow", "2026-10-23")).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(periodRange("week", "2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-23" });
    expect(periodRange("week", "2026-10-24")).toEqual({ from: "2026-10-26", to: "2026-10-30" });
    expect(periodRange("today", "2026-10-25")).toEqual({ from: "2026-10-26", to: "2026-10-26" });
  });

  it("block list: own tickers first, then market cap, then date and BMO before AMC", () => {
    const list = [er("S", "2026-10-21", "amc", 1e9), er("M", "2026-10-22", "bmo", 5e8), er("BIG", "2026-10-21", "bmo", 1e12), er("X", "2026-10-30", "bmo", 9e12), er("N", "2026-10-21", null, null)];
    const out = earningsList(list, { from: "2026-10-21", to: "2026-10-23" }, new Set(["M"]));
    expect(out.map((r) => r.ticker)).toEqual(["M", "BIG", "S", "N"]);
  });
});

describe("context chips (RU)", () => {
  it("orders earnings, short float, RVOL, float, cap, ATR, volume, sector; tones flag what matters", () => {
    const chips = contextChips(snap({ earningsDate: "2026-10-19", earningsTiming: "amc", shortFloatPct: 25, relVolume: 3, float: 12_000_000 }), "2026-10-19");
    expect(chips.map((c) => c.key)).toEqual(["earnings", "short", "rvol", "float", "cap", "atr", "avgvol", "sector"]);
    expect(chips[0]).toMatchObject({ tone: "warn", title: "Отчёт в этот день после закрытия" });
    expect(chips[0].text).toContain("AMC");
    expect(chips.find((c) => c.key === "short")).toMatchObject({ text: "SI 25.0%", tone: "warn" });
    expect(chips.find((c) => c.key === "rvol")).toMatchObject({ text: "RVOL 3.0", tone: "accent" });
    expect(chips.find((c) => c.key === "float")).toMatchObject({ text: "Float 12M", tone: "accent" });
    expect(chips.find((c) => c.key === "cap")?.text).toBe("Кап. $3.4T");
    expect(chips.find((c) => c.key === "sector")).toMatchObject({ text: "Technology", title: "Technology · Semiconductors" });
  });

  it("skips missing values; an earnings date far from the day is neutral", () => {
    const chips = contextChips(snap({ earningsDate: "2026-11-19", shortFloatPct: null, relVolume: null, atr: null, avgVolume: null, sector: null }), "2026-10-19");
    expect(chips.map((c) => c.key)).toEqual(["earnings", "float", "cap"]);
    expect(chips[0].tone).toBe("neutral");
  });
});

describe("render (RU)", () => {
  it("«Finviz не подключён» state", () => {
    expect(renderToStaticMarkup(createElement(FinvizOff))).toContain("Finviz не подключён");
  });

  it("earnings pill: full text, or a short one with the full text kept for screen readers", () => {
    expect(renderToStaticMarkup(createElement(EarningsFlagPill, { flag: "todayBmo" }))).toContain("Отчёт сегодня до открытия");
    const short = renderToStaticMarkup(createElement(EarningsFlagPill, { flag: "tomorrowBmo", short: true }));
    expect(short).toContain("Отчёт завтра");
    expect(short).toContain("Отчёт завтра до открытия");
    expect(renderToStaticMarkup(createElement(EarningsFlagPill, { flag: "todayAmc", onToday: false }))).toContain("Отчёт в этот день после закрытия");
  });
});
