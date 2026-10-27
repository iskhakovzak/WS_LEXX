import { describe, expect, it } from "vitest";
import { wrapLines } from "@/components/shared/share-canvas/canvas";
import type { BehaviorSlice, ReadinessSlice, StatsSlice, WeeklySlice } from "./api";
import { buildWrapped, disciplineCard, edgeCard, focusCard, lessonCard, netCard, progressCard, trailingRun, unitOf, bestCard } from "./model";
import { dashOffer, lastClosedMonth, lastClosedWeek, periodOf, weekStart } from "./period";
import { fileNameOf, hourText, storyTexts } from "./texts";
import { gestureOf } from "./use-story-player";

const FIELDS = [
  "n", "closed", "wins", "losses", "rN", "r", "rPos", "rNeg", "rPosN", "rNegN", "pnlN", "gross", "grossPos", "grossNeg",
  "grossPosN", "grossNegN", "net", "netPos", "netNeg", "netPosN", "netNegN", "fees", "withFees",
] as const;
const bucket = (o: Partial<Record<(typeof FIELDS)[number], number>>) => FIELDS.map((f) => o[f] ?? 0);

const week = periodOf("week", "2026-W42")!;
const month = periodOf("month", "2026-10")!;

const stats = (o: Partial<StatsSlice> = {}): StatsSlice => ({
  money: true,
  fields: FIELDS,
  total: bucket({ n: 6, closed: 6, wins: 4, losses: 2, rN: 6, r: 3.5, pnlN: 6, net: 812.5 }),
  days: [
    { key: "2026-10-12", b: bucket({ n: 2, closed: 2, pnlN: 2, net: 500, rN: 2, r: 2 }) },
    { key: "2026-10-13", b: bucket({ n: 2, closed: 2, pnlN: 2, net: -120, rN: 2, r: -1 }) },
    { key: "2026-10-14", b: bucket({ n: 2, closed: 2, pnlN: 2, net: 432.5, rN: 2, r: 2.5 }) },
  ],
  extremes: { net: { best: [11], worst: [12] }, r: { best: [13], worst: [12] } },
  trades: [
    { id: 11, ticker: "nvda", date: "2026-10-14 09:41", exitDate: null, result: "win", side: "Long", setup: "ORB", entry: 120, exit: 122, stop: 119, rMultiple: 2, pnl: 404, fees: 4, riskUsd: 200, horizon: "intraday" },
    { id: 12, ticker: "TSLA", date: "2026-10-13 10:02", exitDate: null, result: "loss", side: "Short", setup: null, entry: 200, exit: 201, stop: 201, rMultiple: 1, pnl: -100, fees: 2, riskUsd: 100, horizon: "intraday" },
    { id: 13, ticker: "AMD", date: "2026-10-12 11:15", exitDate: null, result: "win", side: "short", setup: "Fade", entry: 150, exit: 147, stop: 151, rMultiple: 3, pnl: 300, fees: 3, riskUsd: 100, horizon: "intraday" },
  ],
  ...o,
});

const weekly = (o: Partial<WeeklySlice> = {}): WeeklySlice => ({
  week: { key: "2026-W42", start: "2026-10-12", end: "2026-10-16" },
  days: [
    { date: "2026-10-12", trades: 2 }, { date: "2026-10-13", trades: 2 }, { date: "2026-10-14", trades: 2 },
    { date: "2026-10-15", trades: 0 }, { date: "2026-10-16", trades: 0 },
  ],
  violations: { items: [{ tradeId: 12, tradeDate: "2026-10-13", tradeNet: -102, tradeR: -1 }] },
  mistakes: { items: [{ tradeId: 12, tradeDate: "2026-10-13", tradeNet: -102, tradeR: -1 }, { tradeId: null, tradeDate: null, tradeNet: null, tradeR: null }] },
  discipline: { cleanDays: 2, cleanStreak: 9, tradingDays: 3 },
  review: { goals: [{ id: "g1", text: "Stop after two losses", status: "open" }], selfReview: { focus: "Patience" } },
  ...o,
});

const behavior: BehaviorSlice = {
  patterns: [
    { key: "revenge", title: "Revenge trading", n: 3, days: 2, cost: -340.5, insight: { recommendation: "Wait 10 minutes after a loss." } },
    { key: "fatigue", title: "Fatigue", n: 2, days: 1, cost: -50 },
    { key: "chase", title: "Chase", n: 1, days: 1, cost: 20 },
  ],
  byHour: [{ label: "10", n: 3, net: 400, avgNet: 133, winRate: 0.67 }, { label: "11", n: 1, net: 900, avgNet: 900, winRate: 1 }],
  profile: { hours: { best: null }, setups: { best: null, rows: [{ label: "ORB", n: 3, net: 600, avgNet: 200, winRate: 0.67 }, { label: "Fade", n: 1, net: 300, avgNet: 300, winRate: 1 }] } },
};

const readiness: ReadinessSlice = {
  stage: { key: "junior", name: "Junior" }, nextStage: { key: "trader", name: "Trader" }, passed: 2, total: 4, ready: false,
  criteria: [
    { id: 1, label: "Net", display: "$812", targetDisplay: "$1,000", status: "fail", progress: 0.81 },
    { id: 2, label: "Days", display: "14", targetDisplay: "10", status: "pass", progress: 1 },
    { id: 3, label: "PF", display: "1.1", targetDisplay: "1.5", status: "fail", progress: 0.4 },
    { id: 4, label: "Fees", display: "12%", targetDisplay: "20%", status: "pass", progress: 1 },
    { id: 5, label: "N/A", display: "—", targetDisplay: "1", status: "na", progress: 0 },
  ],
};

describe("periods", () => {
  it("weeks are Mon–Fri ISO weeks; months list the weeks that cover their weekdays", () => {
    expect(weekStart("2026-W42")).toBe("2026-10-12");
    expect(week).toMatchObject({ from: "2026-10-12", to: "2026-10-16", weeks: ["2026-W42"] });
    expect(month.from).toBe("2026-10-01");
    expect(month.to).toBe("2026-10-31");
    expect(month.weeks).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
    expect(periodOf("month", "2026-02")!.to).toBe("2026-02-28");
    expect(periodOf("week", "2026-W99")).toBeNull();
    expect(periodOf("month", "2026-13")).toBeNull();
  });

  it("the last closed week / month", () => {
    expect(lastClosedWeek("2026-10-24")).toBe("2026-W43"); // Saturday: this week is done
    expect(lastClosedWeek("2026-10-26")).toBe("2026-W43"); // Monday
    expect(lastClosedWeek("2026-10-23")).toBe("2026-W42"); // Friday: still trading
    expect(lastClosedMonth("2026-10-24")).toBe("2026-09");
    expect(lastClosedMonth("2026-01-03")).toBe("2025-12");
  });

  it("the dashboard offers a week Sat–Wed and a month in its first 7 days, once", () => {
    expect(dashOffer("2026-10-26", {})).toEqual({ week: "2026-W43", month: null }); // Monday
    expect(dashOffer("2026-10-29", {})).toEqual({ week: null, month: null }); // Thursday
    expect(dashOffer("2026-10-26", { week: "2026-W43" })).toEqual({ week: null, month: null });
    expect(dashOffer("2026-11-02", {})).toEqual({ week: "2026-W44", month: "2026-10" });
    expect(dashOffer("2026-11-02", { week: "2026-W44", month: "2026-10" })).toEqual({ week: null, month: null });
  });
});

describe("cards", () => {
  it("unit: $ when allowed and present, R under r_only or without P&L", () => {
    expect(unitOf(stats(), "usd")).toBe("usd");
    expect(unitOf(stats(), "r_only")).toBe("r");
    expect(unitOf(stats({ money: false }), "usd")).toBe("r");
    expect(unitOf(stats({ total: bucket({ n: 1, closed: 1, rN: 1, r: 1 }) }), "usd")).toBe("r");
  });

  it("net: the aggregate's totals, days and best day", () => {
    const c = netCard(stats(), "usd");
    expect(c).toMatchObject({ value: 812.5, trades: 6, tradingDays: 3, green: 2, red: 1, winRate: 4 / 6, bestDay: { date: "2026-10-12", value: 500 } });
    expect(netCard(stats(), "r").value).toBe(3.5);
  });

  it("best: the extremes' best trade by net $ (fees folded in) or by R", () => {
    const usd = bestCard(stats(), "usd")!;
    expect(usd.trade).toMatchObject({ ticker: "NVDA", side: "long", day: "2026-10-14", net: 400, r: 2, setup: "ORB" });
    expect(usd.value).toBe(400);
    const r = bestCard(stats(), "r")!;
    expect(r.trade.ticker).toBe("AMD");
    expect(r.trade.side).toBe("short");
    expect(r.trade.net).toBeNull(); // never $ under R
    expect(bestCard(stats({ extremes: { net: { best: [12], worst: [] } } }), "usd")).toBeNull(); // a loser is no «best»
  });

  it("discipline: clean trading days from the week reports, the report's own streak for a week", () => {
    const w = disciplineCard(week, [weekly()])!;
    expect(w).toMatchObject({ tradingDays: 3, cleanDays: 2, streak: 9 });
    expect(w.days.map((d) => d.clean)).toEqual([true, false, true]);
    const m = disciplineCard(month, [weekly()])!;
    expect(m.streak).toBe(1); // the run inside the month
    expect(disciplineCard(week, [])).toBeNull();
    expect(trailingRun([{ clean: false }, { clean: true }, { clean: true }])).toBe(2);
  });

  it("edge: the profile's pick, else the top setup row / the best hour with ≥ 2 trades", () => {
    const c = edgeCard(behavior, "usd")!;
    expect(c.setup?.label).toBe("ORB");
    expect(c.hour?.label).toBe("10");
    const picked = edgeCard({ ...behavior, profile: { hours: { best: { label: "9:30", n: 9, net: 50, avgNet: 5, winRate: 0.5 } }, setups: { best: { label: "Gap", n: 6, net: 70, avgNet: 11, winRate: 0.5 } } } }, "usd")!;
    expect(picked.setup?.label).toBe("Gap");
    expect(picked.hour?.label).toBe("9:30");
    expect(edgeCard({ byHour: [], profile: { setups: { best: null, rows: [] }, hours: { best: null } } }, "usd")).toBeNull();
  });

  it("lesson: the costliest habit; else the cost of broken rules; never $ under R", () => {
    const c = lessonCard(week, behavior, [weekly()], "usd")!;
    expect(c.leak).toMatchObject({ title: "Revenge trading", cost: 340.5, trades: 3, days: 2, advice: "Wait 10 minutes after a loss." });
    expect(lessonCard(week, behavior, [weekly()], "r")!.leak!.cost).toBeNull();
    const rules = lessonCard(week, { patterns: [] }, [weekly()], "usd")!;
    expect(rules.leak).toBeNull();
    expect(rules.rules).toEqual({ trades: 1, cost: 102 }); // one distinct trade, counted once
    expect(lessonCard(week, null, [], "usd")).toBeNull();
  });

  it("progress: closest failing criteria first, then the passed ones (≤ 4)", () => {
    const c = progressCard(readiness)!;
    expect(c.criteria.map((x) => x.label)).toEqual(["Net", "PF", "Days", "Fees"]);
    expect(progressCard({ ...readiness, nextStage: null })).toBeNull();
  });

  it("focus: curator goal → own focus → habit advice → none", () => {
    expect(focusCard(week, [weekly()], null)).toEqual({ kind: "focus", text: "Stop after two losses", source: "curator" });
    expect(focusCard(week, [weekly({ review: { goals: [], selfReview: { focus: "Patience" } } })], null).source).toBe("self");
    const lesson = lessonCard(week, behavior, [], "usd");
    expect(focusCard(week, [weekly({ review: null })], lesson)).toMatchObject({ source: "habit", text: "Wait 10 minutes after a loss." });
    expect(focusCard(week, [], null).source).toBe("none");
  });

  it("the whole story: seven cards in order; an empty period keeps the net and focus cards", () => {
    const m = buildWrapped({ period: week, money: "usd", stats: stats(), behavior, weeks: [weekly()], readiness });
    expect(m.cards.map((c) => c.kind)).toEqual(["net", "best", "discipline", "edge", "lesson", "progress", "focus"]);
    const empty = buildWrapped({ period: week, money: "usd", stats: stats({ total: bucket({}), days: [] }), behavior, weeks: [], readiness });
    expect(empty.hasTrades).toBe(false);
    expect(empty.cards.map((c) => c.kind)).toEqual(["net", "focus"]);
    const thin = buildWrapped({ period: week, money: "usd", stats: stats(), behavior: null, weeks: [], readiness: null });
    expect(thin.cards.map((c) => c.kind)).toEqual(["net", "best", "focus"]);
  });

  it("r_only: no $ sign anywhere on the cards", () => {
    const m = buildWrapped({ period: week, money: "r_only", stats: stats(), behavior, weeks: [weekly()], readiness });
    for (const c of m.cards) {
      const s = storyTexts(c, m, { name: null });
      const all = [s.big, s.sub, s.headline, s.quote, ...s.stats.map((x) => x.value), ...s.blocks.flatMap((b) => [b.title, b.value])].join(" ");
      expect(all, c.kind).not.toContain("$");
    }
  });
});

describe("texts and helpers", () => {
  it("hour buckets, file names", () => {
    expect(hourText("10")).toBe("10:00–11:00");
    expect(hourText("before open")).toBe("before open");
    expect(fileNameOf(week, 2)).toBe("WS_Desk-week-2026-W42-2.png");
    expect(fileNameOf(month, "summary")).toBe("WS_Desk-month-2026-10-summary.png");
  });

  it("wrapLines: wraps by width, cuts the last line with «…»", () => {
    const m = (s: string) => s.length * 10;
    expect(wrapLines("one two three four", 90, 3, m)).toEqual(["one two", "three", "four"]);
    const cut = wrapLines("one two three four five six", 90, 2, m);
    expect(cut).toHaveLength(2);
    expect(cut[1]!.endsWith("…")).toBe(true);
    expect(wrapLines("supercalifragilistic", 90, 2, m)[0]!.endsWith("…")).toBe(true);
  });

  it("gestures: swipes, swipe down, taps by thirds, long presses do nothing", () => {
    expect(gestureOf(-120, 10, 200, 0.5)).toBe("next");
    expect(gestureOf(120, 10, 200, 0.5)).toBe("prev");
    expect(gestureOf(5, 150, 200, 0.5)).toBe("close");
    expect(gestureOf(0, 0, 100, 0.2)).toBe("prev");
    expect(gestureOf(0, 0, 100, 0.8)).toBe("next");
    expect(gestureOf(0, 0, 900, 0.8)).toBeNull();
  });
});
