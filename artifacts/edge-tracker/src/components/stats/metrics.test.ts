import { afterEach, describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { setLang } from "@/i18n";
import { buildDayCandles } from "@/components/equity-candles/lib";
import { derive } from "@/components/equity-chart/model";
import {
  computeKpis, dailySeries, fmtDayKey, hourKey, hourLabel, kpiBase, periodRanges, rCoverage, rowTraderLabel, spansYears,
} from "./metrics";

let id = 0;
const tr = (p: Partial<Trade> & { contextSnapshot?: unknown; fees?: number | null }): Trade =>
  ({ id: ++id, ticker: "AAPL", side: "Long", result: "win", trader: "Максим Р.", ...p }) as unknown as Trade;

afterEach(async () => { await setLang("ru", { source: "init" }); });

describe("stats KPI max DD = the equity curve DD (MAKSIM-08)", () => {
  // Day 1: +100, −80 (per-trade dip to +20); day 2: −50 → close −30; day 3: +200.
  const book = [
    tr({ date: "2026-03-02", pnl: 100 }),
    tr({ date: "2026-03-02", pnl: -80, result: "loss" }),
    tr({ date: "2026-03-03", pnl: -50, result: "loss" }),
    tr({ date: "2026-03-04", pnl: 200 }),
  ];

  it("KPI uses end-of-day closes, exactly like the chart", () => {
    const k = computeKpis(book, "net");
    const chart = derive(buildDayCandles(book, "net")).maxDrawdown;
    expect(k.maxDrawdown).toBe(-50);
    expect(k.maxDrawdown).toBe(chart);
  });

  it("win rate counts all closed trades; payoff uses the metric values", () => {
    const k = computeKpis([...book, tr({ date: "2026-03-05", result: "loss" })], "net"); // a loss without P&L
    expect(k.winRate).toBeCloseTo(2 / 5, 9);
    expect(k.payoff).toBeCloseTo(150 / 65, 9);
    expect(k.missing).toBe(1);
  });
});

describe("R base label and coverage (MAKSIM-24)", () => {
  const book = [
    tr({ date: "2026-03-02", pnl: 50, entry: 10, exit: 11, stop: 9 }),
    tr({ date: "2026-03-02", pnl: -20, result: "loss" }),
    tr({ date: "2026-03-03", pnl: 10 }),
  ];
  it("says «R по сделкам со стопом (N из M)» and never asks to fill R", () => {
    const k = computeKpis(book, "r");
    expect(kpiBase(k, "r")).toBe("R по сделкам со стопом (1 из 3)");
    expect(kpiBase(computeKpis(book, "net"), "net")).toBe("все закрытые сделки (3)");
    expect(rCoverage(dailySeries(book, "r"))).toEqual({ n: 1, m: 3 });
  });
});

describe("entry-hour heatmap columns (MAKSIM-14)", () => {
  it("uses the PropReports entry time; no time → own column", () => {
    expect(hourKey(tr({ date: "2026-03-02", contextSnapshot: { openedAt: "2026-03-02T09:31:07" } }))).toBe("h9");
    expect(hourKey(tr({ date: "2026-03-02", contextSnapshot: { openedAt: "2026-03-02T10:00:00" } }))).toBe("h10");
    expect(hourKey(tr({ date: "2026-03-02", contextSnapshot: { openedAt: "2026-03-02T08:15:00" } }))).toBe("pre");
    expect(hourKey(tr({ date: "2026-03-02", contextSnapshot: { openedAt: "2026-03-02T16:05:00" } }))).toBe("post");
    expect(hourKey(tr({ date: "2026-03-02" }))).toBe("none");
    expect(hourLabel("h9")).toBe("9:30");
    expect(hourLabel("h13")).toBe("13:00");
    expect(hourLabel("none")).toBe("без времени");
  });
});

describe("own name on rows (MAKSIM-37)", () => {
  it("hides the viewer's own name and one-person lists", () => {
    expect(rowTraderLabel("Максим Р.", "Максим Р.")).toBeNull();
    expect(rowTraderLabel("Ориф", "Максим Р.", true)).toBeNull();
    expect(rowTraderLabel("Ориф", "Максим Р.")).toBe("Ориф");
  });
});

describe("dates with years (MAKSIM-34) and the default window (DEV-01)", () => {
  const now = new Date(2026, 9, 19);
  it("adds the year outside the current one or when asked", () => {
    expect(fmtDayKey("2026-10-16", false, now)).not.toMatch(/2026/);
    expect(fmtDayKey("2025-01-02", false, now)).toMatch(/2025/);
    expect(fmtDayKey("2026-10-16", true, now)).toMatch(/2026/);
    expect(spansYears("2025-12-01", "2026-01-05")).toBe(true);
    expect(spansYears("2026-01-01", "2026-03-05")).toBe(false);
  });
  it("90 days: the current window and the previous one are separate", () => {
    const r = periodRanges("quarter", now);
    expect(r.cur.from).toBe("2026-07-22");
    expect(r.prev).toEqual({ from: "2026-04-23", to: "2026-07-21" });
  });
});
