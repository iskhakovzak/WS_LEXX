// The real example chart of a cheat sheet: which example is shown, which part of its day, where the marks go;
// the «Мой план» strip facts.
import { describe, expect, it } from "vitest";
import type { Candle } from "@/components/chart-engine";
import type { SetupExample } from "../../model";
import { buildExampleView, chartWindow, clockText, nyMinuteOf, pickExample } from "../example-model";
import { focusText } from "@/components/shared/plan-focus";
import { pickCandidates, planFacts } from "../today-model";

const ex = (over: Partial<SetupExample>): SetupExample => ({
  id: 1, playbookId: 5, tradeId: 100, tier: 2, note: null, checklistMarks: null, mediaId: null, sortOrder: 0,
  addedBy: null, createdAt: null, updatedAt: null, ticker: "AMD", date: "2026-10-16", closeDate: "2026-10-16",
  side: "Short", result: "win", netPnl: null, pnl: null, fees: null, signedR: 1, horizon: "intraday", trader: "X",
  qty: null, entry: 548.25, exit: 545.03, entryTime: "2026-10-16T13:41:00.000Z", exitTime: "2026-10-16T13:46:00.000Z", redacted: true,
  ...over,
});

/** 5-minute bars of 2026-10-16 (EDT, UTC−4) from 08:00 to 12:00 NY, gently falling, with volume in the session. */
function day(): Candle[] {
  const start = Date.UTC(2026, 9, 16, 12, 0) / 1000; // 08:00 NY
  return Array.from({ length: 48 }, (_, i) => {
    const t = start + i * 300;
    const o = 550 - i * 0.2;
    return { t, o, h: o + 0.5, l: o - 0.7, c: o - 0.2, v: i >= 18 ? 1000 : 0 };
  });
}

describe("example of a setup", () => {
  it("Tier 1 by the curator's order first, else the best Tier 2; a Tier 3 mistake never", () => {
    expect(pickExample([ex({ id: 1, tier: 2, sortOrder: 0 }), ex({ id: 2, tier: 1, sortOrder: 1 }), ex({ id: 3, tier: 1, sortOrder: 0 })])?.id).toBe(3);
    expect(pickExample([ex({ id: 4, tier: 3 }), ex({ id: 5, tier: 2 })])?.id).toBe(5);
    expect(pickExample([ex({ id: 6, tier: 3 })])).toBeNull();
    expect(pickExample(undefined)).toBeNull();
  });
  it("window: the run-up from 9:00 for an opening entry, the session from the bell for a morning one, two hours before an afternoon one", () => {
    expect(chartWindow(581, 585)).toEqual({ from: 540, to: 690 });
    expect(chartWindow(658, 669)).toEqual({ from: 570, to: 720 });
    expect(chartWindow(909, 935)).toEqual({ from: 789, to: 960 });
    expect(chartWindow(957, 960)).toEqual({ from: 837, to: 975 }); // MOC: the bell at 16:00 stays in view
    expect(chartWindow(null, null)).toEqual({ from: 570, to: 720 });
  });
  it("clock text as traders say it", () => {
    expect(clockText(581)).toBe("9:41");
    expect(clockText(960)).toBe("16:00");
    expect(nyMinuteOf("2026-10-16T13:41:00.000Z")).toBe(581);
    expect(nyMinuteOf(null)).toBeNull();
  });
  it("view: the window's candles, the bell, the entry / exit bars, VWAP from the session, time ticks", () => {
    const v = buildExampleView(day(), ex({}))!;
    expect(v).not.toBeNull();
    expect(v.bars).toHaveLength(30); // 9:00–11:30
    expect(v.bellIdx).toBe(6); // 9:30 is the 7th bar
    expect(v.entryIdx).toBe(8); // 9:41 → the 9:40 bar
    expect(v.exitIdx).toBe(9); // 9:46 → the 9:45 bar
    expect(v.side).toBe("short");
    expect(v.win).toBe(true);
    expect(v.vwap[5]).toBeNull(); // before the bell
    expect(v.vwap[10]).not.toBeNull();
    expect(v.lo).toBeLessThanOrEqual(545.03);
    expect(v.hi).toBeGreaterThanOrEqual(548.25);
    expect(v.ticks.map((x) => x.label)).toEqual(["9:30", "10:00", "10:30", "11:00"]);
  });
  it("no bars for the day → no view (the card draws the schematic instead)", () => {
    expect(buildExampleView([], ex({}))).toBeNull();
  });
});

describe("my plan strip", () => {
  it("reads the contract from the plan doc; «не повторяю» falls back to the morning focus until one is chosen", () => {
    expect(planFacts({ plan: { doc: { maxLossUsd: 300, maxTrades: null, ownRule: "day:fees" } } }, null)).toEqual({ maxLossUsd: 300, stopSource: "plan", maxTrades: null, rule: null, ruleFromFocus: false, avoid: "day:fees", avoidFromFocus: false });
    expect(planFacts({ plan: { doc: { maxTrades: 5 } } }, { mistake: "behavior:martingale", source: "auto" })).toEqual({ maxLossUsd: null, stopSource: null, maxTrades: 5, rule: null, ruleFromFocus: false, avoid: "behavior:martingale", avoidFromFocus: true });
    expect(planFacts({ plan: { doc: { ownRule: null } } }, { mistake: "behavior:martingale", source: "auto" }).avoid).toBeNull(); // «no rule» chosen
    expect(planFacts(null, { mistake: "day:fees", source: "none" })).toEqual({ maxLossUsd: null, stopSource: null, maxTrades: null, rule: null, ruleFromFocus: false, avoid: null, avoidFromFocus: false });
  });
  it("«Правило дня» is the plan's focus, not the mistake to avoid (ILYA-11)", () => {
    const f = planFacts({ plan: { doc: { focus: "  Только A+ сетапы ", ownRule: "day:fees" } } }, null); // i18n-ignore (user text)
    expect(f.rule).toBe("Только A+ сетапы"); // i18n-ignore (user text)
    expect(f.avoid).toBe("day:fees");
  });
  it("«Правило дня» renders preset rules in the reader's language and falls back to the trader's own morning focus", () => {
    expect(planFacts({ plan: { doc: { focus: "", focusRules: ["a"] } } }, null).rule).toBe(focusText({ focus: "", focusRules: ["a"] }));
    const own = planFacts({ plan: { doc: {} } }, { mistake: null, source: "own", ownText: " no revenge " });
    expect(own).toMatchObject({ rule: "no revenge", ruleFromFocus: true, avoid: null, avoidFromFocus: false });
    expect(planFacts({ plan: { doc: { focus: "plan rule" } } }, { mistake: null, source: "own", ownText: "own" })).toMatchObject({ rule: "plan rule", ruleFromFocus: false });
    expect(planFacts(null, { mistake: "day:fees", source: "auto", ownText: "ignored" }).rule).toBeNull();
  });
  it("the daily stop falls back to the desk limit, labelled as such (ILYA-12)", () => {
    expect(planFacts({ plan: { doc: {} } }, null, 150)).toMatchObject({ maxLossUsd: 150, stopSource: "limits" });
    expect(planFacts({ plan: { doc: { maxLossUsd: 120 } } }, null, 150)).toMatchObject({ maxLossUsd: 120, stopSource: "plan" });
    expect(planFacts(null, null, 0)).toMatchObject({ maxLossUsd: null, stopSource: null });
  });
  it("prompt tiles: the suggestion first, then anything starred, no duplicates", () => {
    expect(pickCandidates([3, 1], [1, 7])).toEqual([3, 1, 7]);
  });
});
