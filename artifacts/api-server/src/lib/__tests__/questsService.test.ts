/**
 * lib/quests/service.ts over an in-memory store (same contract as lib/quests/store.ts: unique catalog key, status
 * changes only from «active», achievements once): quests synced and notified once, achievement tiers awarded once with
 * one notification per line (history older than NOTIFY_DAYS quietly), badges an older process stored mapped into the
 * lines, quest points in the level, the nightly rollover idempotent, assignment checks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredQuest } from "../quests/catalog";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [{ name: "Кирилл Б." }], rowCount: 1 })) } }));
const notify = vi.hoisted(() => ({ notifyUser: vi.fn(async () => 1) }));
vi.mock("../notifyUtils", () => notify);
// Roadmap R3: the trader's quest_done / achievement_earned go to the nightly batch (lib/notificationBatch) — recorded on
// the same spy, marked `batched`.
vi.mock("../notificationBatch", () => ({
  enqueueBatch: vi.fn(async (userName: string, type: string, params: Record<string, unknown>) => { await (notify.notifyUser as unknown as (n: unknown) => Promise<unknown>)({ userName, type, params, batched: true }); }),
}));

const mem = vi.hoisted(() => ({
  quests: [] as StoredQuest[],
  ach: new Map<string, { line: string; tier: string; date: string; target: number }>(),
  badges: [] as { badge: string; date: string; target: number }[],
  id: 1,
}));
vi.mock("../quests/store", () => ({
  questsOf: vi.fn(async (t: string) => mem.quests.filter((q) => q.trader === t).map((q) => ({ ...q }))),
  createQuests: vi.fn(async (trader: string, list: Omit<StoredQuest, "id" | "trader" | "params" | "assignedBy" | "note">[]) => {
    const out: StoredQuest[] = [];
    for (const n of list) {
      if (mem.quests.some((q) => q.trader === trader && q.scope === n.scope && q.template === n.template && q.period === n.period)) continue;
      const q = { id: mem.id++, trader, params: {}, assignedBy: null, note: null, ...n } as StoredQuest;
      mem.quests.push(q);
      out.push(q);
    }
    return out;
  }),
  updateQuests: vi.fn(async (list: { id: number; progress: number; target: number; status: StoredQuest["status"]; completedOn: string | null }[]) => {
    const changed: StoredQuest[] = [];
    for (const u of list) {
      const q = mem.quests.find((x) => x.id === u.id);
      if (!q || q.status !== "active") continue;
      Object.assign(q, { progress: u.progress, target: u.target, status: u.status, completedOn: q.completedOn ?? u.completedOn });
      if (u.status !== "active") changed.push({ ...q });
    }
    return changed;
  }),
  achievementsOf: vi.fn(async () => [...mem.ach.values()]),
  insertAchievement: vi.fn(async (_t: string, a: { line: string; tier: string; date: string; target: number }) => {
    const k = `${a.line}|${a.tier}`;
    if (mem.ach.has(k)) return false;
    mem.ach.set(k, a);
    return true;
  }),
  legacyBadges: vi.fn(async () => mem.badges),
  activeCuratorQuests: vi.fn(async () => mem.quests.filter((q) => q.scope === "curator" && q.status === "active").length),
  insertCuratorQuest: vi.fn(),
  closeQuest: vi.fn(async (id: number, status: StoredQuest["status"]) => {
    const q = mem.quests.find((x) => x.id === id);
    if (!q || q.status !== "active") return null;
    q.status = status;
    return { ...q };
  }),
  markAssignedNoticeRead: vi.fn(async () => undefined),
  tradersWithActiveQuests: vi.fn(async () => ["Кирилл Б."]),
}));

/** Weekdays ending at 2026-10-16. */
const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const input = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../quests/load", () => ({ loadTraderInputs: vi.fn(async () => input.current) }));

const service = await import("../quests/service");
const { runQuestsNightly } = await import("../quests/job");

function inputs(over: { contract?: boolean; telegram?: boolean; tier?: string | null } = {}) {
  const ledger = days.map((date, i) => ({ date, outcome: "kept" as const, points: 5, bonus: 0, streak: i + 1 }));
  const plans = new Map(over.contract ? [["2026-10-19", { beforeOpen: true, stop: true, ownRule: true, contract: true }]] : []);
  const quests = {
    today: "2026-10-19", minutes: 8 * 60, lastFinished: "2026-10-16", tradingDay: true,
    user: { mustChangeSecret: false, telegram: !!over.telegram }, plans, ledger, reviews: [], focus: [], games: [{ finishedOn: "2026-03-02", verdict: "worse" }],
    gamePlans: [], deskDayOpens: [], monthStops: [], stopKnown: false, lastTickerDay: null, replayTradeId: null,
  };
  return {
    asOf: "2026-10-16", role: "trader", tier: over.tier === undefined ? "trainee" : over.tier,
    summary: { streak: 15, bestStreak: 15, nextBonus: 10, points30: 40, pointsTotal: 40, windowDays: 30, level: 0, levelFrom: 0, nextLevelAt: 50 },
    ledger,
    achievements: {
      asOf: "2026-10-16", ledger, reviews: [], focus: [], stops: [], cleanMonthMinDays: 15, games: quests.games, plansBeforeOpen: [], promotions: [],
      lessons: [], exams: [], academy: false,
    },
    quests,
  };
}

const NOW = new Date("2026-10-19T12:00:00Z"); // Monday 08:00 NY
const sent = (type: string) => notify.notifyUser.mock.calls.filter((c) => (c as unknown as [{ type: string }])[0].type === type).map((c) => (c as unknown as [Record<string, unknown>])[0]);

beforeEach(() => {
  mem.quests = []; mem.ach.clear(); mem.badges = []; mem.id = 1;
  notify.notifyUser.mockClear();
  service.forgetQuests("Кирилл Б.");
  input.current = inputs();
});

describe("evaluation", () => {
  it("awards tiers once, one notification per line, old history quietly", async () => {
    const e = await service.evaluateTrader("Кирилл Б.", NOW);
    expect([...mem.ach.keys()].sort()).toEqual(["contract_streak|bronze", "contract_streak|silver", "own_replays|bronze"]);
    const ach = sent("achievement_earned");
    expect(ach).toHaveLength(1); // contract streak silver (10th day = 2026-10-09 is within 7 days of 10-16); replay from March: quiet
    expect(ach[0]).toMatchObject({ userName: "Кирилл Б.", params: { line: "contract_streak", tier: "silver", target: 10 }, batched: true });
    expect(e.achievements.find((a) => a.id === "contract_streak")!.tier).toBe("silver");
    expect(e.badges.find((b) => b.id === "streak_2")!.earnedOn).toBe("2026-10-09");
    await service.evaluateTrader("Кирилл Б.", NOW);
    expect(sent("achievement_earned")).toHaveLength(1);
  });

  it("badges stored by an older process are mapped into the lines without a notification", async () => {
    mem.badges = [{ badge: "focus", date: "2026-10-12", target: 5 }];
    await service.evaluateTrader("Кирилл Б.", NOW);
    expect(mem.ach.get("focus_beaten|bronze")).toEqual({ line: "focus_beaten", tier: "bronze", date: "2026-10-12", target: 5 });
    expect(sent("achievement_earned").some((n) => (n.params as { line: string }).line === "focus_beaten")).toBe(false);
  });

  it("quests: a status change notifies once; quest points feed the level", async () => {
    await service.evaluateTrader("Кирилл Б.", NOW);
    const pin = mem.quests.find((q) => q.template === "set_pin")!;
    expect(pin.status).toBe("done"); // created done: points, no notification
    expect(sent("quest_done")).toHaveLength(0);
    expect(mem.quests.find((q) => q.template === "link_telegram")!.status).toBe("active");
    input.current = inputs({ telegram: true });
    const e = await service.evaluateTrader("Кирилл Б.", NOW);
    expect(sent("quest_done").map((n) => (n.params as { template: string }).template)).toEqual(["link_telegram"]);
    // set_pin and replay_own_day were created done, link_telegram done now: 3 × 10
    expect(e.discipline).toMatchObject({ questPoints: 30, pointsTotal: 70, points30: 70, level: 1 });
    await service.evaluateTrader("Кирилл Б.", NOW);
    expect(sent("quest_done")).toHaveLength(1);
  });

  it("questsMe: today's list, summary, onboarding x of n", async () => {
    input.current = inputs({ contract: true });
    const me = await service.questsMe("Кирилл Б.", NOW);
    expect(me.today).toBe("2026-10-19");
    expect(me.quests.filter((q) => q.scope === "daily").map((q) => q.template).sort()).toEqual(["keep_contract", "plan_before_open"]);
    // set_pin, first_plan_stop, replay_own_day, set_own_rule of the 6 required steps (Telegram is optional)
    expect(me.summary.onboarding).toEqual({ done: 4, total: 6 });
    expect(me.quests.filter((q) => q.scope === "onboarding").map((q) => q.template)).toEqual([
      "set_pin", "first_plan_stop", "first_review", "open_desk_day", "replay_own_day", "set_own_rule", "link_telegram",
    ]);
    expect(me.summary.achievementsEarned).toBe(3);
    expect(me.quests.find((q) => q.template === "plan_before_open")!.status).toBe("done");
  });

  it("a Трейдер or Сеньор gets no first steps: none created, none shown", async () => {
    input.current = inputs({ tier: "trader" });
    const me = await service.questsMe("Кирилл Б.", NOW);
    expect(me.summary.onboarding).toBeNull();
    expect(me.quests.some((q) => q.scope === "onboarding")).toBe(false);
    expect(mem.quests.some((q) => q.scope === "onboarding")).toBe(false);
  });

  it("the nightly rollover is idempotent", async () => {
    const a = await runQuestsNightly({ now: NOW });
    const count = mem.quests.length;
    const b = await runQuestsNightly({ now: NOW });
    expect(mem.quests.length).toBe(count);
    expect(b).toMatchObject({ traders: a.traders, failed: 0 });
    expect(sent("achievement_earned")).toHaveLength(1);
  });
});

describe("cache and races", () => {
  it("a forget during a running evaluation: the older run is neither reused nor cached", async () => {
    const load = vi.mocked((await import("../quests/load")).loadTraderInputs);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    load.mockClear();
    load.mockImplementationOnce(async () => { await gate; return input.current as never; });
    const first = service.evaluationFor("Кирилл Б.", NOW);
    await Promise.resolve();
    service.forgetQuests("Кирилл Б."); // e.g. a curator assigned a quest while the first run was loading
    const second = service.evaluationFor("Кирилл Б.", NOW);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
    expect(await service.evaluationFor("Кирилл Б.", NOW)).toBe(b); // the newer run is the cached one
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a desk settings save drops every cached evaluation (levels / targets show at once, not after CACHE_MS)", async () => {
    const load = vi.mocked((await import("../quests/load")).loadTraderInputs);
    const { forgetAllQuests } = await import("../quests/cache");
    const a = await service.evaluationFor("Кирилл Б.", NOW);
    load.mockClear();
    expect(await service.evaluationFor("Кирилл Б.", NOW)).toBe(a);
    expect(load).not.toHaveBeenCalled();
    forgetAllQuests();
    expect(await service.evaluationFor("Кирилл Б.", NOW)).not.toBe(a);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a tier another process stored first: the answer shows the stored day, not this run's", async () => {
    const store = vi.mocked(await import("../quests/store"));
    store.insertAchievement.mockImplementationOnce(async (_t, a) => {
      mem.ach.set(`${a.line}|${a.tier}`, { ...a, date: "2026-10-01" }); // the racing process's row
      return false;
    });
    const e = await service.evaluateTrader("Кирилл Б.", NOW);
    const first = [...mem.ach.values()].find((a) => a.date === "2026-10-01")!;
    const line = e.achievements.find((a) => a.id === first.line)!;
    expect(line.tiers.find((t) => t.tier === first.tier)!.earnedAt).toBe("2026-10-01");
  });
});

describe("curator quest cancel", () => {
  it("tells the trader, marks the «assigned» notice read, keeps the quest in the history flagged", async () => {
    const store = vi.mocked(await import("../quests/store"));
    mem.quests.push({ id: 50, trader: "Кирилл Б.", scope: "curator", template: "review_days", period: "curator", params: {}, progress: 0, target: 3, status: "active",
      rewardPoints: 10, startsOn: "2026-10-19", endsOn: "2026-10-23", completedOn: null, assignedBy: "Ольга Н.", note: null });
    const out = await service.cancelQuest(mem.quests.find((q) => q.id === 50)!, "Ольга Н.");
    expect(out).toMatchObject({ id: 50, status: "expired", cancelled: true });
    expect(store.markAssignedNoticeRead).toHaveBeenCalledWith("Кирилл Б.", 50);
    expect(sent("quest_cancelled")).toEqual([expect.objectContaining({ userName: "Кирилл Б.", actor: "Ольга Н.", link: "/ratings?tab=quests&quest=50", params: expect.objectContaining({ template: "review_days", curator: "Ольга Н." }) })]);
    expect(await service.cancelQuest(mem.quests.find((q) => q.id === 50)!, "Ольга Н.")).toBeNull(); // already cancelled: nothing twice
    expect(sent("quest_cancelled")).toHaveLength(1);
    const me = await service.questsMe("Кирилл Б.", NOW);
    expect(me.quests.find((q) => q.id === 50)).toMatchObject({ cancelled: true });
  });
});

describe("assignment checks", () => {
  const body = { trader: "Кирилл Б.", template: "review_days", target: 5, endsOn: "2026-10-30" };
  it("template, target bounds, deadline, points, active limit", () => {
    expect(service.checkAssign(body, "2026-10-19", 0)).toBeNull();
    expect(service.checkAssign({ ...body, template: "plan_before_open" }, "2026-10-19", 0)).toEqual({ code: "QUEST_TEMPLATE_UNKNOWN" });
    expect(service.checkAssign({ ...body, target: 0 }, "2026-10-19", 0)).toEqual({ code: "QUEST_TARGET_RANGE", min: 1, max: 60 });
    expect(service.checkAssign({ ...body, endsOn: "2026-10-18" }, "2026-10-19", 0)).toMatchObject({ code: "QUEST_DEADLINE_INVALID" });
    expect(service.checkAssign({ ...body, endsOn: "2027-03-01" }, "2026-10-19", 0)).toMatchObject({ code: "QUEST_DEADLINE_INVALID", max: "2027-01-19" });
    expect(service.checkAssign({ ...body, rewardPoints: 51 }, "2026-10-19", 0)).toEqual({ code: "QUEST_POINTS_RANGE", max: 50 });
    expect(service.checkAssign(body, "2026-10-19", 5)).toEqual({ code: "QUEST_LIMIT", max: 5 });
    expect(service.checkAssign({ ...body, template: "curator_task", target: 2 }, "2026-10-19", 0)).toEqual({ code: "QUEST_TARGET_RANGE", min: 1, max: 1 });
  });
});
