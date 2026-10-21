import { describe, expect, it, vi } from "vitest";

// rulesEngine (via rulesEval → rulesCatalog) touches the DB pool at import time; keep these tests pure.
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { computeMetrics, computeStop, drawdownSince, nextPeak } = await import("../riskMetrics");
const { evalRule } = await import("../rulesEngine");
const { describeThreshold, thresholdRaw, validateThreshold } = await import("../rulesCatalog");
const { DEFAULT_RULES, DEFAULT_TIERS, formatMetric, ruleLabel } = await import("../scalingEngine");
const { renderNotification } = await import("../notificationText");
type DayRow = import("../riskMetrics").DayRow;
type Limits = import("../riskMetrics").Limits;

const limits = (over: Partial<Limits> = {}): Limits => ({
  trader: "Денис Ф.", accountSize: 25_000, dailyLossLimit: 300, weeklyLossLimit: 900, maxDrawdown: 2_000, maxRiskPerTrade: 100,
  maxPositionUsd: 25_000, maxOvernightExposure: null, maxOpenPositions: 3, allowOvernight: false, allowSwing: false, tier: "junior",
  notes: null, updatedBy: null, updatedAt: null, ...over,
});
const day = (date: string, pnl: number | null): DayRow => ({ trader: "Денис Ф.", date, pnl, source: "propreports", trades: 3, brokerTrades: 3, r: 0, fees: 0 });

// +3 000 peak on Oct 1, then −2 600 over two weeks: a 2 600 drawdown ≥ the 2 000 limit → halted.
const DAYS = [day("2026-10-01", 3_000), day("2026-10-06", -1_200), day("2026-10-13", -800), day("2026-10-15", -600)];

describe("OLGA-01 drawdown baseline: a curator review lifts the halt", () => {
  it("without a review the peak is lifetime and the trader stays halted «до решения куратора»", () => {
    const m = computeMetrics("Денис Ф.", DAYS, [], limits(), "2026-10-19");
    expect(m.drawdown.currentUsd).toBe(2_600);
    expect(m.stop.state).toBe("drawdown");
    expect(m.halted).toBe(true);
    expect(m.stop.message).toContain("до решения куратора");
    expect(m.drawdown.since).toBeNull();
  });

  it("a review on Oct 18 resets the peak to that day's equity: no drawdown, no halt", () => {
    const m = computeMetrics("Денис Ф.", DAYS, [], limits(), "2026-10-19", "ru", "2026-10-18");
    expect(m.drawdown.currentUsd).toBe(0);
    expect(m.drawdown.peakNet).toBe(400);
    expect(m.halted).toBe(false);
    expect(m.drawdown.since).toBe("2026-10-18");
    expect(m.drawdown.maxUsd).toBe(2_600); // the lifetime max drawdown stays as history
  });

  it("a new drawdown ≥ the limit from the baseline halts again", () => {
    const later = [...DAYS, day("2026-10-20", 500), day("2026-10-21", -2_600)];
    const m = computeMetrics("Денис Ф.", later, [], limits(), "2026-10-21", "ru", "2026-10-18");
    expect(m.drawdown.currentUsd).toBe(2_600); // peak 900 on Oct 20 → −1 700
    expect(m.stop.state).toBe("drawdown");
  });

  it("a back-test before the review date ignores it; the latest review not after the date wins", () => {
    expect(drawdownSince(["2026-10-18", "2026-09-01", "2026-11-02"], "2026-10-19")).toBe("2026-10-18");
    expect(drawdownSince(["2026-11-02"], "2026-10-19")).toBeNull();
    expect(drawdownSince(undefined, "2026-10-19")).toBeNull();
    const m = computeMetrics("Денис Ф.", DAYS, [], limits(), "2026-10-16", "ru", "2026-10-18");
    expect(m.halted).toBe(true);
  });

  it("nextPeak follows equity up to the baseline day, then keeps the high-water mark", () => {
    expect(nextPeak(3_000, 400, "2026-10-15", "2026-10-18")).toBe(400);
    expect(nextPeak(400, 900, "2026-10-20", "2026-10-18")).toBe(900);
    expect(nextPeak(900, 100, "2026-10-21", "2026-10-18")).toBe(900);
    expect(nextPeak(900, 100, "2026-10-21", null)).toBe(900);
  });

  it("computeStop still ranks drawdown over weekly and daily", () => {
    expect(computeStop({ todayLoss: 400, weekLoss: 1_000, currentDd: 2_100, limits: limits() }).state).toBe("drawdown");
    expect(computeStop({ todayLoss: 400, weekLoss: 1_000, currentDd: 0, limits: limits() }).state).toBe("weekly");
  });

  it("breach texts carry money in the app format ($1,234.56; whole amounts without cents)", async () => {
    const { fmtMoney } = await import("../notifyEventsCore");
    expect(fmtMoney(318.756)).toBe("$318.76");
    expect(fmtMoney(-1234.5)).toBe("$1,234.50");
    expect(fmtMoney(300)).toBe("$300");
    expect(fmtMoney(-318.76, true)).toBe("−$318.76");
    expect(fmtMoney(0, true)).toBe("$0");
    const s = computeStop({ todayLoss: 2_345.6, weekLoss: 0, currentDd: 0, limits: { ...limits(), weeklyLossLimit: null, maxDrawdown: null } }, "en");
    expect(s.state).toBe("stop");
    expect(s.message).toContain("$2,345.60");
  });
});

describe("MAKSIM-01 pause rule reads the stored `minutes` threshold", () => {
  const t = (id: number, entry: string, exit: string, result: "win" | "loss") => ({
    id, trader: "alice", date: "2026-10-14", closeDate: "2026-10-14", result, pnl: result === "loss" ? -50 : 50, netPnl: result === "loss" ? -51 : 49,
    signedR: null, entry: null, stop: null, qty: null, riskUsd: null, horizon: "intraday", source: null, playbookId: null, setupScore: null,
    maxNotional: null, checklistRuns: 0, entryAt: Date.parse(`2026-10-14T${entry}:00Z`), exitAt: Date.parse(`2026-10-14T${exit}:00Z`),
  }) as import("../rulesEngine").TradeForRule;
  const trades = [t(1, "14:00", "14:05", "loss"), t(2, "14:12", "14:20", "win"), t(3, "14:22", "14:30", "loss"), t(4, "14:33", "14:40", "win")];
  const rule = (threshold: Record<string, unknown>) => ({ id: 290, trader: "alice", name: "Пауза", kind: "min_pause_after_loss", threshold, enabled: true });

  it("{minutes: 5}: a 7-minute gap is fine, a 3-minute gap is a violation saying «пауза 5 мин»", () => {
    const v = evalRule(rule({ minutes: 5 }), trades);
    expect(v.map((x) => x.tradeId)).toEqual([4]);
    expect(v[0].message).toContain("5");
    expect(v[0].details).toMatchObject({ limitMin: 5 });
  });

  it("the catalog key `min` wins; nothing stored → default 10", () => {
    expect(evalRule(rule({ min: 5, minutes: 30 }), trades).map((x) => x.tradeId)).toEqual([4]);
    expect(evalRule(rule({}), trades).map((x) => x.tradeId)).toEqual([2, 4]);
  });

  it("validation and the summary read the legacy key too (an edit saves it as `min`)", () => {
    expect(thresholdRaw("min_pause_after_loss", { minutes: 5 }, "min")).toBe(5);
    expect(thresholdRaw("max_trades_per_day", { minutes: 5 }, "n")).toBeUndefined();
    expect(validateThreshold("min_pause_after_loss", { minutes: 5 })).toEqual({ ok: true, value: { min: 5 } });
    expect(describeThreshold("min_pause_after_loss", { minutes: 5 })).toContain("5");
  });
});

describe("UMID-04 / OWNER-25 scaling texts", () => {
  it("a seeded RU rule label is shown as the metric label in EN / UZ; a curator's own label stays", () => {
    const seeded = DEFAULT_RULES.find((r) => r.metric === "net_pnl" && r.kind === "demote")!;
    expect(ruleLabel(seeded, "ru")).toBe(seeded.label);
    expect(ruleLabel(seeded, "en")).toBe("Net P&L");
    expect(ruleLabel(seeded, "uz")).not.toMatch(/[А-Яа-яЁё]/);
    expect(ruleLabel({ label: "Мой порог", metric: "net_pnl" }, "en")).toBe("Мой порог");
  });

  it("drawdown % reads as a share of the limit", () => {
    expect(formatMetric("max_dd_pct", 170, "ru")).toBe("170% лимита");
    expect(formatMetric("max_dd_pct", 170, "en")).toBe("170% of limit");
    expect(formatMetric("win_rate", 55, "en")).toBe("55%");
  });

  it("the seed data is still exported from the engine (lib/scalingSeed)", () => {
    expect(DEFAULT_TIERS.map((t) => t.key)).toEqual(["junior", "trader", "senior", "lead"]); // no «trainee» (wave 1, item 1.21)
    expect(DEFAULT_RULES.length).toBeGreaterThan(5);
  });
});

describe("risk notifications per reader", () => {
  it("UMID-21: a template notice renders the default tier in the reader's language (tierKey)", () => {
    const p = { variant: "template", actor: "Ориф", tier: "Джун", tierKey: "junior", resync: 0, a_dailyLossLimit: 300, a_tier: "junior" };
    const uz = renderNotification("limit_change", p, "uz")!;
    expect(uz.title).toContain("Junior");
    expect(uz.title + uz.body).not.toMatch(/junior|Джун/);
    // A tier the admin renamed is user content: shown as written.
    expect(renderNotification("limit_change", { ...p, tier: "Новичок" }, "en")!.title).toContain("Новичок");
  });

  it("DENIS-06: a drawdown review tells the trader the drawdown count restarted", () => {
    const p = { actor: "Ольга Н.", date: "2026-10-15", reasonCode: "revenge", consequenceCode: "warning", actions: "пауза 15 мин", ddReset: 1 };
    expect(renderNotification("risk_breach_review", p, "ru")!.body).toContain("стоп по просадке снят");
    expect(renderNotification("risk_breach_review", { ...p, ddReset: undefined }, "en")!.body).not.toContain("drawdown stop");
  });
});
