/**
 * lib/finviz/csv.ts — Finviz export CSV parsing from fixtures (realistic header rows): suffixes %/K/M/B/T, bare
 * size units, empty cells, quoted commas, earnings date formats, HTML instead of CSV.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv, parseEarnings, parseFinvizCsv, parseNumber } from "../../finviz/csv";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (f: string) => readFileSync(path.join(dir, f), "utf8");
const TODAY = "2026-10-19";

describe("parseNumber", () => {
  it.each([
    ["15.20B", 1, 15_200_000_000],
    ["1.42T", 1, 1_420_000_000_000],
    ["593.50M", 1, 593_500_000],
    ["650.00K", 1, 650_000],
    ["4.50%", 1, 4.5],
    ["-2.40%", 1, -2.4],
    ["8,456,123", 1, 8_456_123],
    ["(1.5)", 1, -1.5],
    ["$12.34", 1, 12.34],
    ["812.55", 1e6, 812_550_000],
    ["245.6", 1e3, 245_600],
    ["3.12", 1, 3.12],
  ])("%s ×%d → %d", (raw, unit, want) => {
    expect(parseNumber(raw, unit)).toBe(want);
  });

  it.each(["", "-", " ", "N/A", "abc", "1.2.3", undefined])("%s → null", (raw) => {
    expect(parseNumber(raw as string | undefined)).toBeNull();
  });

  it("a suffixed size ignores the bare unit", () => {
    expect(parseNumber("9.80M", 1e6)).toBe(9_800_000);
  });
});

describe("parseEarnings", () => {
  it.each([
    ["11/04/2026 4:30:00 PM", "2026-11-04", "amc"],
    ["10/19/2026 8:30:00 AM", "2026-10-19", "bmo"],
    ["10/21/2026 6:55 AM", "2026-10-21", "bmo"],
    ["10/22/2026", "2026-10-22", null],
    ["10/22/2026 12:00:00 AM", "2026-10-22", null],
    ["2026-10-23", "2026-10-23", null],
    ["2026-10-23T16:05", "2026-10-23", "amc"],
    ["Oct 21/a", "2026-10-21", "amc"],
    ["Oct 21/b", "2026-10-21", "bmo"],
    ["Oct 21 BMO", "2026-10-21", "bmo"],
    ["Nov 3", "2026-11-03", null],
  ])("%s → %s %s", (raw, date, timing) => {
    expect(parseEarnings(raw, TODAY)).toEqual({ date, timing });
  });

  it("a year-less date picks the nearest year across New Year", () => {
    expect(parseEarnings("Jan 05/b", "2026-12-28")).toEqual({ date: "2027-01-05", timing: "bmo" });
    expect(parseEarnings("Dec 30/a", "2027-01-02")).toEqual({ date: "2026-12-30", timing: "amc" });
  });

  it.each(["", "-", "soon", "13/45/2026", "Feb 30"])("%s → nulls", (raw) => {
    expect(parseEarnings(raw, TODAY)).toEqual({ date: null, timing: null });
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿"a","b, c"\r\n"x ""y""",2\r\n')).toEqual([["a", "b, c"], ['x "y"', "2"]]);
  });
});

describe("parseFinvizCsv", () => {
  it("parses the gappers fixture by header name", () => {
    const rows = parseFinvizCsv(fx("screener-gappers.csv"), TODAY);
    expect(rows.map((r) => r.ticker)).toEqual(["SMCI", "ABCD", "XYZW", "TINY"]); // empty ticker + duplicate skipped
    expect(rows[0]).toEqual({
      ticker: "SMCI", company: "Super Micro Computer, Inc.", sector: "Technology", industry: "Computer Hardware", country: "USA",
      marketCap: 25_800_000_000, sharesOutstanding: 593_500_000, float: 540_100_000, shortFloatPct: 18.4, shortRatio: 1.25,
      beta: 1.45, atr: 3.12, gapPct: 12.35, avgVolume: 38_500_000, relVolume: 4.21, price: 48.75, changePct: 15.2,
      volume: 61_234_567, earningsDate: "2026-11-04", earningsTiming: "amc",
    });
    expect(rows[1]).toMatchObject({ shortFloatPct: null, shortRatio: null, beta: null, volume: 8_456_123, earningsDate: "2026-10-19", earningsTiming: "bmo" });
    expect(rows[2]).toMatchObject({ marketCap: null, float: null, atr: null, avgVolume: null, gapPct: 8.05, earningsDate: null, earningsTiming: null });
    // bare numbers: market cap / shares in millions, average volume in thousands
    expect(rows[3]).toMatchObject({ marketCap: 812_550_000, sharesOutstanding: 40_200_000, float: 31_700_000, avgVolume: 245_600, changePct: -2.4, earningsDate: "2026-10-21", earningsTiming: "amc" });
  });

  it("maps alias headers and ignores unknown columns", () => {
    const rows = parseFinvizCsv('Ticker,Float,ATR,Rel Volume,Avg Volume,Earnings,P/E\nAMD,1.61B,5.2,1.3,40.1M,Oct 28/a,110.2\n', TODAY);
    expect(rows).toEqual([expect.objectContaining({ ticker: "AMD", float: 1_610_000_000, atr: 5.2, relVolume: 1.3, avgVolume: 40_100_000, earningsDate: "2026-10-28", earningsTiming: "amc" })]);
  });

  it("an empty body is no rows; a header-only CSV is no rows", () => {
    expect(parseFinvizCsv("", TODAY)).toEqual([]);
    expect(parseFinvizCsv('"No.","Ticker"\n', TODAY)).toEqual([]);
  });

  it("throws on the login page (HTML) and on a CSV without Ticker", () => {
    expect(() => parseFinvizCsv(fx("login.html"), TODAY)).toThrow(/HTML/);
    expect(() => parseFinvizCsv("a,b\n1,2\n", TODAY)).toThrow(/Ticker/);
  });
});
