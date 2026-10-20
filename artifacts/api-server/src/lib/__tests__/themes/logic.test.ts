/**
 * lib/themes/logic.ts — pure: session / TTL, ticker normalising, Finviz + Yahoo rows → moves, equal-weight themes.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateTheme, buildResponse, normalizeTickers, pctChange, quoteFromFinviz, quoteFromYahoo, round2, themeSession,
  themeTickers, ttlMs, TTL_OPEN_MS, TTL_SLOW_MS, type MemberQuote,
} from "../../themes/logic";

/** 2026-10-20 (Tue) at hh:mm New York (EDT = UTC−4). */
const ny = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 20, hh + 4, mm));
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const TODAY = "2026-10-20";
const yesterdayClose = sec(new Date(Date.UTC(2026, 9, 19, 20, 0)));

describe("session and TTL", () => {
  it("maps New York time to pre / rth / post / closed", () => {
    expect(themeSession(ny(3, 59), false)).toBe("closed");
    expect(themeSession(ny(4), false)).toBe("pre");
    expect(themeSession(ny(9, 29), false)).toBe("pre");
    expect(themeSession(ny(9, 30), false)).toBe("rth");
    expect(themeSession(ny(15, 59), false)).toBe("rth");
    expect(themeSession(ny(16), false)).toBe("post");
    expect(themeSession(ny(20), false)).toBe("closed");
  });

  it("a market holiday / weekend is closed all day", () => {
    expect(themeSession(ny(11), true)).toBe("closed");
  });

  it("30 s while open, 5 min otherwise", () => {
    expect(ttlMs("rth")).toBe(TTL_OPEN_MS);
    expect(TTL_OPEN_MS).toBe(30_000);
    for (const s of ["pre", "post", "closed"] as const) expect(ttlMs(s)).toBe(TTL_SLOW_MS);
    expect(TTL_SLOW_MS).toBe(300_000);
  });
});

describe("numbers", () => {
  it("round2 / pctChange: 2 decimals, no -0, null for junk", () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(-0.001)).toBe(0);
    expect(Object.is(round2(-0.001), -0)).toBe(false);
    expect(round2(Number.NaN)).toBeNull();
    expect(round2(null)).toBeNull();
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(110, 0)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
  });

  it("normalizeTickers: upper-case, $ dropped, unique, invalid reported", () => {
    expect(normalizeTickers("$aapl, msft  brk.b;MSFT")).toEqual({ tickers: ["AAPL", "MSFT", "BRK.B"], invalid: [] });
    expect(normalizeTickers(["nvda", "B", "x1", "toolongticker", ""])).toEqual({ tickers: ["NVDA", "B"], invalid: ["X1", "TOOLONGTICKER"] });
  });
});

describe("Finviz rows", () => {
  it("today = Change; fromOpen = (1+change)/(1+gap) − 1", () => {
    const q = quoteFromFinviz({ ticker: "nvda", price: 110, changePct: 10, gapPct: 5 }, "rth");
    expect(q.ticker).toBe("NVDA");
    expect(q.today).toBe(10);
    expect(q.fromOpen).toBe(round2((1.1 / 1.05 - 1) * 100));
    expect(q.fromOpen).toBe(4.76);
  });

  it("no open before 09:30 → fromOpen null; missing gap → null", () => {
    expect(quoteFromFinviz({ ticker: "A", price: 1, changePct: 2, gapPct: 1 }, "pre").fromOpen).toBeNull();
    expect(quoteFromFinviz({ ticker: "A", price: 1, changePct: 2, gapPct: null }, "rth").fromOpen).toBeNull();
    expect(quoteFromFinviz({ ticker: "A", price: null, changePct: null, gapPct: 3 }, "rth")).toEqual({ ticker: "A", price: null, today: null, fromOpen: null });
  });
});

describe("Yahoo quotes", () => {
  const base = { symbol: "mu", regularMarketPrice: 105, regularMarketOpen: 102, regularMarketPreviousClose: 100, regularMarketTime: sec(ny(11)) };

  it("rth: price vs previous close and vs today's open", () => {
    expect(quoteFromYahoo(base, "rth", TODAY)).toEqual({ ticker: "MU", price: 105, today: 5, fromOpen: round2((105 / 102 - 1) * 100) });
  });

  it("rth with a quote still from yesterday: no open of today", () => {
    expect(quoteFromYahoo({ ...base, regularMarketTime: yesterdayClose }, "rth", TODAY)!.fromOpen).toBeNull();
  });

  it("pre: today's premarket print vs the last regular close; fromOpen null", () => {
    const q = quoteFromYahoo(
      { symbol: "MU", regularMarketPrice: 100, regularMarketPreviousClose: 95, regularMarketOpen: 96, regularMarketTime: yesterdayClose, preMarketPrice: 98, preMarketTime: sec(ny(8)) },
      "pre", TODAY,
    );
    expect(q).toEqual({ ticker: "MU", price: 98, today: -2, fromOpen: null });
  });

  it("pre without a print today: price = last close, today unknown", () => {
    const q = quoteFromYahoo({ symbol: "MU", regularMarketPrice: 100, regularMarketTime: yesterdayClose, preMarketPrice: 97, preMarketTime: yesterdayClose - 3600 }, "pre", TODAY);
    expect(q).toEqual({ ticker: "MU", price: 100, today: null, fromOpen: null });
  });

  it("post: today's after-hours print moves both values", () => {
    const q = quoteFromYahoo({ ...base, postMarketPrice: 110, postMarketTime: sec(ny(17)) }, "post", TODAY)!;
    expect(q.price).toBe(110);
    expect(q.today).toBe(10);
    expect(q.fromOpen).toBe(round2((110 / 102 - 1) * 100));
  });

  it("closed: the last session as it ended; junk rows → null", () => {
    expect(quoteFromYahoo({ ...base, regularMarketTime: yesterdayClose }, "closed", TODAY)!.fromOpen).toBe(round2((105 / 102 - 1) * 100));
    expect(quoteFromYahoo({ regularMarketPrice: 1 }, "rth", TODAY)).toBeNull();
    expect(quoteFromYahoo({ symbol: "X" }, "rth", TODAY)).toBeNull();
  });
});

describe("aggregation", () => {
  const quotes = new Map<string, MemberQuote>([
    ["MU", { ticker: "MU", price: 100, today: 2, fromOpen: 1 }],
    ["WDC", { ticker: "WDC", price: 50, today: -1, fromOpen: null }],
    ["STX", { ticker: "STX", price: 90, today: 0.5, fromOpen: 0.4 }],
  ]);

  it("equal-weight mean of the members that have the value; missing listed", () => {
    const th = aggregateTheme({ id: 1, name: "Memory", tickers: ["MU", "wdc", "STX", "SNDK"] }, quotes);
    expect(th.today).toBe(round2((2 - 1 + 0.5) / 3));
    expect(th.today).toBe(0.5);
    expect(th.fromOpen).toBe(0.7);
    expect(th.members.map((m) => m.ticker)).toEqual(["MU", "WDC", "STX"]);
    expect(th.missing).toEqual(["SNDK"]);
  });

  it("no quotes → nulls, every ticker missing", () => {
    const th = aggregateTheme({ id: 2, name: "X", tickers: ["A", "B"] }, new Map());
    expect(th).toEqual({ id: 2, name: "X", today: null, fromOpen: null, members: [], missing: ["A", "B"] });
  });

  it("themeTickers: distinct, upper-case, first-seen order", () => {
    expect(themeTickers([{ id: 1, name: "a", tickers: ["mu", "WDC"] }, { id: 2, name: "b", tickers: ["MU", "STX"] }])).toEqual(["MU", "WDC", "STX"]);
  });

  it("buildResponse: ISO asOf, source, session, stale flag; empty cache → nulls", () => {
    const r = buildResponse([{ id: 1, name: "Memory", tickers: ["MU"] }], { quotes, asOf: Date.UTC(2026, 9, 20, 15), source: "yahoo" }, "rth", false);
    expect(r).toMatchObject({ asOf: "2026-10-20T15:00:00.000Z", session: "rth", source: "yahoo", stale: false });
    expect(r.themes[0]!.today).toBe(2);
    const empty = buildResponse([{ id: 1, name: "Memory", tickers: ["MU"] }], null, "closed", false);
    expect(empty).toMatchObject({ asOf: null, source: null, themes: [{ today: null, missing: ["MU"] }] });
  });
});
