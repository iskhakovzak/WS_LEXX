/**
 * Discipline rewards: the progressive contract scale (growth, cap, penalty, reset / halve, days without a contract),
 * level thresholds, the points window, quest points in the level and the Telegram evening line. The badge rules are
 * achievement tiers now (questsAchievements.test.ts), awarding is lib/quests/service (questsService.test.ts).
 */
import { describe, expect, it, vi } from "vitest";
import type { EveningCard } from "../daily/types";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
const notify = vi.hoisted(() => ({ notifyUser: vi.fn(async () => 1) }));
vi.mock("../notifyUtils", () => notify);
vi.mock("../../routes/behavior", () => ({ loadBehaviorRows: vi.fn(async () => []), rowToBehaviorTrade: vi.fn() }));
vi.mock("../rulesEngine", () => ({ fetchRiskLimits: vi.fn(async () => ({ dailyLossLimit: null })) }));

const d = await import("../daily/discipline");
const { rewardsLine } = await import("../daily/telegramText");

const cfg = { kept: 5, broken: -15, step: 1, cap: 10, onBreak: "reset" as const };
const kept1 = ["kept", "unset", "unset"] as const;
const broken1 = ["broken", "kept", "unset"] as const;
const none = ["no_trades", "no_trades", "unset"] as const;
/** Weekdays from 2026-09-01 (Tue). */
function weekdays(n: number, from = "2026-09-01"): string[] {
  const out: string[] = [];
  let x = new Date(`${from}T12:00:00Z`);
  while (out.length < n) {
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(x.toISOString().slice(0, 10));
    x = new Date(x.getTime() + 86_400_000);
  }
  return out;
}

describe("progressive contract scale", () => {
  it("defaults: +5 / −15 per item, step 1, cap 10, reset, 1 streak freeze a month", () => {
    expect(d.scaleConfig()).toEqual({ ...cfg, freezePerMonth: 1 });
  });

  it("kept days grow the bonus by the step, up to the cap", () => {
    const days = weekdays(14).map((date) => ({ date, items: kept1 }));
    const l = d.scaleLedger(days, cfg);
    expect(l.slice(0, 4).map((x) => x.points)).toEqual([5, 6, 7, 8]);
    expect(l[10]!.points).toBe(15); // day 11: 5 + cap 10
    expect(l[13]!.points).toBe(15);
    expect(l[13]!.streak).toBe(14);
  });

  it("each item counts; the streak bonus is per day", () => {
    const l = d.scaleLedger(weekdays(2).map((date) => ({ date, items: ["kept", "kept", "kept"] as const })), cfg);
    expect(l.map((x) => x.points)).toEqual([15, 16]);
  });

  it("a broken item applies the penalty (kept items still count) and resets the streak", () => {
    const [a, b2, c, e] = weekdays(4);
    const l = d.scaleLedger([{ date: a!, items: kept1 }, { date: b2!, items: kept1 }, { date: c!, items: broken1 }, { date: e!, items: kept1 }], cfg);
    expect(l.map((x) => x.points)).toEqual([5, 6, -10, 5]);
    expect(l.map((x) => x.streak)).toEqual([1, 2, 0, 1]);
  });

  it("«halve» keeps half the streak after a broken day", () => {
    const days = weekdays(7).map((date, i) => ({ date, items: i === 5 ? broken1 : kept1 }));
    const l = d.scaleLedger(days, { ...cfg, onBreak: "halve" });
    expect(l[5]!.streak).toBe(2); // 5 → 2
    expect(l[6]!.points).toBe(5 + 2); // bonus from the kept half
  });

  it("days without a verdict (no trades / unknown / unset) neither break nor grow the streak", () => {
    const [a, b2, c] = weekdays(3);
    const l = d.scaleLedger([{ date: a!, items: kept1 }, { date: b2!, items: none }, { date: c!, items: kept1 }], cfg);
    expect(l.map((x) => [x.points, x.streak])).toEqual([[5, 1], [0, 1], [6, 2]]);
  });

  it("an all-unknown day is «none»; order of input does not matter", () => {
    expect(d.outcomeOf(["unknown", "unset", "unset"])).toBe("none");
    const [a, b2] = weekdays(2);
    expect(d.scaleLedger([{ date: b2!, items: kept1 }, { date: a!, items: kept1 }], cfg).map((x) => x.date)).toEqual([a, b2]);
  });
});

describe("levels and the summary", () => {
  const th = [0, 50, 150, 400, 800];
  it("default thresholds", () => expect(d.levelThresholds()).toEqual(th));
  it("level by all-time points", () => {
    expect(d.levelOf(0, th)).toEqual({ level: 0, levelFrom: 0, nextLevelAt: 50 });
    expect(d.levelOf(49, th).level).toBe(0);
    expect(d.levelOf(50, th)).toEqual({ level: 1, levelFrom: 50, nextLevelAt: 150 });
    expect(d.levelOf(420, th)).toEqual({ level: 3, levelFrom: 400, nextLevelAt: 800 });
    expect(d.levelOf(5000, th)).toEqual({ level: 4, levelFrom: 800, nextLevelAt: null });
  });
  it("30 trading days window, all-time total, streak and next bonus", () => {
    expect(d.windowStart("2026-10-16", 5)).toBe("2026-10-12");
    expect(d.windowStart("2026-10-18", 1)).toBe("2026-10-16"); // Sunday → back to Friday
    const days = [...weekdays(3, "2026-08-03").map((date) => ({ date, items: broken1 })), ...weekdays(4, "2026-10-13").map((date) => ({ date, items: kept1 }))];
    const s = d.summaryOf(d.scaleLedger(days, cfg), "2026-10-16", { cfg, thresholds: th, windowDays: 30 });
    expect(s.points30).toBe(5 + 6 + 7 + 8);
    expect(s.pointsTotal).toBe(26 - 30);
    expect(s).toMatchObject({ streak: 4, bestStreak: 4, nextBonus: 4, level: 0, levelFrom: 0, nextLevelAt: 50 });
  });
  it("quest points add to the total (→ level) and to the window", () => {
    const s = d.summaryOf([], "2026-10-16", { cfg, thresholds: th, windowDays: 30 });
    const w = d.withQuestPoints({ ...s, pointsTotal: 40, points30: 10 }, { total: 25, recent: 5 }, th);
    expect(w).toMatchObject({ pointsTotal: 65, points30: 15, questPoints: 25, level: 1, levelFrom: 50, nextLevelAt: 150 });
  });
  it("lastFinishedDay: before the close → previous weekday; after → today; weekend → Friday", () => {
    expect(d.lastFinishedDay(new Date("2026-10-19T14:00:00Z"))).toBe("2026-10-16"); // Mon 10:00 NY
    expect(d.lastFinishedDay(new Date("2026-10-19T21:00:00Z"))).toBe("2026-10-19"); // Mon 17:00 NY
    expect(d.lastFinishedDay(new Date("2026-10-18T21:00:00Z"))).toBe("2026-10-16"); // Sunday
  });
});

describe("contract ledger: plan days without a snapshot", () => {
  it("judged from loaded rows when the given rows start after them (not «no trades»); given rows used when they cover", async () => {
    const { pool } = await import("@workspace/db");
    vi.mocked(pool.query).mockImplementation((async (sql: string) =>
      String(sql).includes("FROM trader_plans") ? { rows: [{ date: "2026-06-01", doc: { maxTrades: 3 } }, { date: "2026-10-15", doc: { maxTrades: 3 } }], rowCount: 2 } : { rows: [], rowCount: 0 }) as never);
    const loadTrades = vi.fn(async () => []);
    const now = new Date("2026-10-19T14:00:00Z");
    await d.contractLedger("Кирилл Б.", { to: "2026-10-16", trades: [], tradesFrom: "2026-07-07", loadTrades, now });
    expect(loadTrades).toHaveBeenCalledWith("2026-03-03", "2026-10-15"); // 90 days before the first plan day
    loadTrades.mockClear();
    await d.contractLedger("Кирилл Б.", { to: "2026-10-16", trades: [], tradesFrom: "2026-05-01", loadTrades, now });
    expect(loadTrades).not.toHaveBeenCalled();
    vi.mocked(pool.query).mockImplementation((async () => ({ rows: [], rowCount: 0 })) as never);
  });
});

describe("Telegram evening line", () => {
  const card = (over: Partial<EveningCard>): EveningCard => ({
    trader: "Кирилл Б.", date: "2026-10-16", trades: 3, netPnl: 50, focus: null, tradeToReview: null, deskSameTicker: null, reviewed: false, reviewNote: null,
    contract: { date: "2026-10-16", maxLoss: { limit: 300, actual: -40, status: "kept" }, maxTrades: { limit: null, actual: 3, status: "unset" }, rule: { mistake: null, status: "unset" }, disciplineDelta: 8 },
    ...over,
  });
  it("a new badge wins; else the streak on a kept day; nothing on a broken day", () => {
    expect(rewardsLine("ru", card({ rewards: { streak: 4, badges: [{ id: "streak_1", target: 5 }] } }))).toBe("🏅 Новая награда: контракт 5 дней подряд");
    expect(rewardsLine("ru", card({ rewards: { streak: 4, badges: [] } }))).toBe("🔥 Контракт соблюдён 4 дня подряд · +8 к дисциплине");
    expect(rewardsLine("en", card({ rewards: { streak: 1, badges: [] } }))).toBe("🔥 Contract kept 1 day in a row · +8 to discipline");
    expect(rewardsLine("uz", card({ rewards: { streak: 0, badges: [] } }))).toBeNull();
    expect(rewardsLine("ru", card({ rewards: null }))).toBeNull();
  });
  it("achievement tiers win over badges; quests done are appended, or stand alone", () => {
    const achievements = [{ line: "contract_streak", tier: "silver", target: 10 }];
    expect(rewardsLine("ru", card({ rewards: { streak: 10, badges: [{ id: "streak_2", target: 10 }], achievements, questsDone: 2 } })))
      .toBe("🏅 Новое достижение: Серия контракта (серебро) · 2 квеста выполнено");
    expect(rewardsLine("en", card({ rewards: { streak: 4, badges: [], achievements: [], questsDone: 1 } }))).toBe("🔥 Contract kept 4 days in a row · +8 to discipline · 1 quest done");
    expect(rewardsLine("ru", card({ rewards: { streak: 0, badges: [], questsDone: 5 } }))).toBe("✅ Выполнено 5 квестов");
    expect(rewardsLine("uz", card({ rewards: { streak: 0, badges: [], achievements: [{ line: "full_loop", tier: "gold", target: 20 }] } }))).toBe("🏅 Yangi yutuq: Toʻliq aylana (oltin)");
  });
});
