/**
 * Quest catalog + engine (lib/quests/catalog.ts, engine.ts): onboarding order (each step unlocks the next), every
 * template's progress / done / failed rule, relevance, the weekly rotation, expiry after the last day (+ the review
 * grace day), idempotency (a plan applied twice creates nothing new) and the API helpers (visible list, week summary,
 * quest points).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const c = await import("../quests/catalog");
const e = await import("../quests/engine");
type QuestData = import("../quests/catalog").QuestData;
type StoredQuest = import("../quests/catalog").StoredQuest;
type Switches = import("../quests/engine").Switches;

const ALL_ON: Switches = { enabled: true, onboarding: true, daily: true, weekly: true, monthly: true, curator: true };
const ONLY = (k: keyof Switches): Switches => ({ enabled: true, onboarding: false, daily: false, weekly: false, monthly: false, curator: false, [k]: true });
const PRE = 8 * 60; // 08:00 NY
const AFTER = 17 * 60;

function data(over: Partial<QuestData> = {}): QuestData {
  return {
    today: "2026-10-14", minutes: PRE, lastFinished: "2026-10-13", tradingDay: true,
    user: { mustChangeSecret: true, telegram: false }, plans: new Map(), ledger: [], reviews: [], focus: [], games: [], gamePlans: [],
    deskDayOpens: [], monthStops: [], stopKnown: false, lastTickerDay: { ticker: "AMD", date: "2026-10-13" }, replayTradeId: 42, ...over,
  };
}

let nextId = 1;
/** Applies a plan to an in-memory store the way lib/quests/store.ts does (unique catalog key, status only from active). */
function apply(store: StoredQuest[], plan: ReturnType<typeof e.planQuests>): StoredQuest[] {
  for (const u of plan.update) {
    const q = store.find((x) => x.id === u.id);
    if (q && q.status === "active") Object.assign(q, { progress: u.progress, target: u.target, status: u.status, completedOn: q.completedOn ?? u.completedOn });
  }
  for (const n of plan.create) {
    if (store.some((q) => q.scope === n.scope && q.template === n.template && q.period === n.period)) continue;
    store.push({ id: nextId++, trader: "Кирилл Б.", params: {}, assignedBy: null, note: null, ...n });
  }
  return store;
}
const run = (d: QuestData, store: StoredQuest[] = [], sw = ALL_ON, onboarding = true) => apply(store, e.planQuests(d, store, { onboarding }, sw));
const tpl = (store: StoredQuest[], key: string) => store.find((q) => q.template === key);

describe("onboarding chain", () => {
  it("starts with the first step only", () => {
    const s = run(data(), [], ONLY("onboarding"));
    expect(s.map((q) => [q.template, q.status])).toEqual([["set_pin", "active"]]);
    expect(s[0]!.endsOn).toBeNull();
    expect(s[0]!.rewardPoints).toBe(10);
  });

  it("steps the data already shows are done at once and unlock the next", () => {
    const s = run(data({ user: { mustChangeSecret: false, telegram: true } }), [], ONLY("onboarding"));
    expect(s.map((q) => [q.template, q.status])).toEqual([["set_pin", "done"], ["link_telegram", "done"], ["first_plan_stop", "active"]]);
  });

  it("a later step done out of order waits for the earlier ones", () => {
    const d = data({ user: { mustChangeSecret: false, telegram: false }, games: [{ finishedOn: "2026-10-01", verdict: "better" }] });
    const s = run(d, [], ONLY("onboarding"));
    expect(s.map((q) => q.template)).toEqual(["set_pin", "link_telegram"]);
    // Telegram linked later → the chain continues; replay is done at once when its turn comes.
    const d2 = { ...d, user: { mustChangeSecret: false, telegram: true }, plans: new Map([["2026-10-10", { beforeOpen: true, stop: true, ownRule: true, contract: true }]]),
      reviews: [{ date: "2026-10-10", reviewedOn: "2026-10-10" }], deskDayOpens: ["2026-10-11"] };
    run(d2, s, ONLY("onboarding"));
    expect(s.map((q) => [q.template, q.status])).toEqual([
      ["set_pin", "done"], ["link_telegram", "done"], ["first_plan_stop", "done"], ["first_review", "done"], ["open_desk_day", "done"], ["replay_own_day", "done"], ["set_own_rule", "done"],
    ]);
    expect(e.onboardingState(s)).toEqual({ done: 7, total: 7, doneOn: "2026-10-14" });
    expect(run(d2, s, ONLY("onboarding")).length).toBe(7); // finished: nothing new
  });

  it("only traders get it; the switch turns it off", () => {
    expect(run(data(), [], ONLY("onboarding"), false)).toEqual([]);
    expect(run(data(), [], { ...ONLY("onboarding"), onboarding: false })).toEqual([]);
  });

  it("links are prefilled from the trader's data", () => {
    const s = run(data({ user: { mustChangeSecret: false, telegram: true }, plans: new Map([["2026-10-10", { beforeOpen: false, stop: true, ownRule: false, contract: true }]]),
      reviews: [{ date: "2026-10-10", reviewedOn: "2026-10-11" }] }), [], ONLY("onboarding"));
    const desk = tpl(s, "open_desk_day")!;
    expect(e.toQuest(desk, data()).href).toBe("/desk-day?ticker=AMD&date=2026-10-13");
    expect(c.templateOf("onboarding", "replay_own_day")!.href(data(), desk)).toBe("/trainer?own=42");
  });
});

describe("daily quests", () => {
  const contractPlan = { beforeOpen: true, stop: true, ownRule: false, contract: true };

  it("plan before the open: offered only before 09:30 on a trading day; done / failed", () => {
    expect(tpl(run(data({ minutes: 10 * 60 }), [], ONLY("daily")), "plan_before_open")).toBeUndefined();
    expect(tpl(run(data({ tradingDay: false }), [], ONLY("daily")), "plan_before_open")).toBeUndefined();
    const s = run(data(), [], ONLY("daily"));
    expect(tpl(s, "plan_before_open")!.status).toBe("active");
    run(data({ plans: new Map([["2026-10-14", contractPlan]]), minutes: 9 * 60 }), s, ONLY("daily"));
    expect(tpl(s, "plan_before_open")!).toMatchObject({ status: "done", progress: 1, completedOn: "2026-10-14" });
    const s2 = run(data(), [], ONLY("daily"));
    run(data({ minutes: 9 * 60 + 31 }), s2, ONLY("daily"));
    expect(tpl(s2, "plan_before_open")!.status).toBe("failed");
  });

  it("review the last day: only when it was traded; on time until the next trading day ends, then expired", () => {
    expect(tpl(run(data(), [], ONLY("daily")), "review_yesterday")).toBeUndefined();
    const traded = [{ date: "2026-10-16", reviewedOn: null }];
    const fri = data({ today: "2026-10-16", minutes: AFTER, lastFinished: "2026-10-16", reviews: traded });
    const s = run(fri, [], ONLY("daily"));
    expect(tpl(s, "review_yesterday")).toMatchObject({ period: "2026-10-16", startsOn: "2026-10-16", endsOn: "2026-10-19", status: "active" });
    run({ ...fri, today: "2026-10-19", minutes: PRE, reviews: [{ date: "2026-10-16", reviewedOn: "2026-10-19" }] }, s, ONLY("daily"));
    expect(tpl(s, "review_yesterday")!.status).toBe("done");
    const s2 = run(fri, [], ONLY("daily"));
    run({ ...fri, today: "2026-10-20", lastFinished: "2026-10-19" }, s2, ONLY("daily"));
    expect(tpl(s2, "review_yesterday")!.status).toBe("expired");
  });

  it("keep today's contract: relevant with a contract; kept → done, broken → failed, no verdict → expired next day", () => {
    expect(tpl(run(data(), [], ONLY("daily")), "keep_contract")).toBeUndefined();
    const d = data({ plans: new Map([["2026-10-14", contractPlan]]) });
    const s = run(d, [], ONLY("daily"));
    expect(tpl(s, "keep_contract")!.status).toBe("active");
    run({ ...d, minutes: AFTER, lastFinished: "2026-10-14", ledger: [{ date: "2026-10-14", outcome: "kept", points: 5, bonus: 0, streak: 1 }] }, s, ONLY("daily"));
    expect(tpl(s, "keep_contract")!.status).toBe("done");
    const s2 = run(d, [], ONLY("daily"));
    run({ ...d, ledger: [{ date: "2026-10-14", outcome: "broken", points: -15, bonus: 0, streak: 0 }] }, s2, ONLY("daily"));
    expect(tpl(s2, "keep_contract")!.status).toBe("failed");
    const s3 = run(d, [], ONLY("daily"));
    run({ ...d, today: "2026-10-15", lastFinished: "2026-10-14" }, s3, ONLY("daily"));
    expect(tpl(s3, "keep_contract")!.status).toBe("expired");
  });
});

describe("weekly quests", () => {
  const recentContract = new Map([["2026-10-05", { beforeOpen: false, stop: true, ownRule: false, contract: true }]]);
  const busy = data({
    plans: recentContract,
    focus: [{ date: "2026-10-09", status: "kept", disputed: false }],
    reviews: [{ date: "2026-10-09", reviewedOn: "2026-10-09" }],
    gamePlans: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date) => ({ date, readOn: null })),
  });

  it("quests.weeklyCount (3) of the relevant ones, rotated by the week; created once per week", () => {
    const s = run(busy, [], ONLY("weekly"));
    expect(s).toHaveLength(3);
    expect(s.every((q) => q.period === "2026-10-12" && q.startsOn === "2026-10-12" && q.endsOn === "2026-10-16")).toBe(true);
    const relevant = ["contract_days", "focus_absent_days", "replay_own_days", "review_traded_days", "read_game_plan"];
    expect(s.map((q) => q.template)).toEqual(e.rotate(relevant, 3, c.weekIndex("2026-10-12")));
    expect(run(busy, s, ONLY("weekly"))).toHaveLength(3);
    const next = run({ ...busy, today: "2026-10-19" }, [...s], ONLY("weekly"));
    expect(next.filter((q) => q.period === "2026-10-19").map((q) => q.template)).toEqual(e.rotate(relevant, 3, c.weekIndex("2026-10-19")));
  });

  it("at the weekend the coming week is offered, not the one that is over", () => {
    const s = run({ ...busy, today: "2026-10-18", tradingDay: false }, [], ONLY("weekly"));
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((q) => q.period === "2026-10-19" && q.status === "active")).toBe(true);
    expect(c.questWeekOf("2026-10-17")).toBe("2026-10-19");
    expect(c.questWeekOf("2026-10-16")).toBe("2026-10-12");
  });

  it("a quest already lost at creation is not offered", () => {
    const lateMonth = data({ today: "2026-10-20", lastFinished: "2026-10-19", reviews: [{ date: "2026-10-01", reviewedOn: null }, { date: "2026-10-02", reviewedOn: null }, { date: "2026-10-05", reviewedOn: null }] });
    expect(run(lateMonth, [], ONLY("monthly")).map((q) => q.template)).not.toContain("review_month");
  });

  it("nothing relevant → nothing offered", () => {
    expect(run(data(), [], ONLY("weekly"))).toEqual([]);
  });

  const q = (template: string, over: Partial<StoredQuest> = {}): StoredQuest => ({
    id: 1, trader: "Кирилл Б.", scope: "weekly", template, period: "2026-10-12", params: {}, progress: 0, target: 1, status: "active",
    rewardPoints: 10, startsOn: "2026-10-12", endsOn: "2026-10-16", completedOn: null, assignedBy: null, note: null, ...over,
  });

  it("contract 4 of 5 days, focus absent 3 days, 2 replays, plan reads — counted inside the week", () => {
    const ledger = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((date) => ({ date, outcome: "kept" as const, points: 5, bonus: 0, streak: 1 }));
    expect(e.evaluateQuest(data({ today: "2026-10-15", ledger }), q("contract_days", { target: 4 }))).toEqual({ progress: 4, target: 4, status: "done" });
    expect(e.evaluateQuest(data({ today: "2026-10-14", ledger }), q("contract_days", { target: 4 })).status).toBe("active");
    expect(e.evaluateQuest(data({ today: "2026-10-17", lastFinished: "2026-10-16", ledger: ledger.slice(0, 3) }), q("contract_days", { target: 4 })).status).toBe("expired");
    const focus = ["2026-10-12", "2026-10-13", "2026-10-14"].map((date, i) => ({ date, status: "kept", disputed: i === 1 }));
    expect(e.evaluateQuest(data({ focus }), q("focus_absent_days", { target: 3 })).progress).toBe(2);
    const games = [{ finishedOn: "2026-10-12", verdict: "worse" }, { finishedOn: "2026-10-13", verdict: "better" }];
    expect(e.evaluateQuest(data({ games }), q("replay_own_days", { target: 2 })).status).toBe("done");
    const gamePlans = [{ date: "2026-10-12", readOn: "2026-10-12" }, { date: "2026-10-13", readOn: "2026-10-14" }, { date: "2026-10-14", readOn: null }];
    expect(e.evaluateQuest(data({ gamePlans }), q("read_game_plan", { target: 3 })).progress).toBe(2);
  });

  it("review every traded day: done once the week is over and all were on time; failed as soon as one was late", () => {
    const reviews = (late: boolean) => ["2026-10-12", "2026-10-14", "2026-10-16"].map((date, i) => ({ date, reviewedOn: late && i === 0 ? "2026-10-15" : date }));
    expect(e.evaluateQuest(data({ today: "2026-10-16", minutes: AFTER, lastFinished: "2026-10-16", reviews: reviews(false) }), q("review_traded_days")))
      .toEqual({ progress: 3, target: 3, status: "done" });
    expect(e.evaluateQuest(data({ today: "2026-10-15", reviews: reviews(true) }), q("review_traded_days")).status).toBe("failed");
    expect(e.evaluateQuest(data({ today: "2026-10-14", reviews: reviews(false).slice(0, 2) }), q("review_traded_days")))
      .toEqual({ progress: 2, target: 2, status: "active" });
  });
});

describe("monthly quests", () => {
  const q = (template: string, target = 15): StoredQuest => ({
    id: 1, trader: "Кирилл Б.", scope: "monthly", template, period: "2026-10", params: {}, progress: 0, target, status: "active",
    rewardPoints: 25, startsOn: "2026-10-01", endsOn: "2026-10-31", completedOn: null, assignedBy: null, note: null,
  });
  const days = (n: number, trough = -50) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, trough, limit: 300 }));

  it("clean month: progress while clean, failed on a breach, done at the month end with enough days", () => {
    expect(e.evaluateQuest(data({ monthStops: days(10) }), q("clean_month_progress"))).toEqual({ progress: 10, target: 15, status: "active" });
    expect(e.evaluateQuest(data({ monthStops: [...days(9), { date: "2026-10-12", trough: -320, limit: 300 }] }), q("clean_month_progress")).status).toBe("failed");
    expect(e.evaluateQuest(data({ today: "2026-11-02", lastFinished: "2026-10-30", monthStops: days(16) }), q("clean_month_progress")).status).toBe("done");
    expect(e.evaluateQuest(data({ today: "2026-11-02", lastFinished: "2026-10-30", monthStops: days(12) }), q("clean_month_progress")).status).toBe("expired");
    expect(c.MONTHLY[0]!.relevant!(data({ stopKnown: false }), c.periods.month(data()))).toBe(false);
  });

  it("review the month: ≥ 90 % of traded days on time", () => {
    const reviews = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, reviewedOn: i < 18 ? `2026-10-${String(i + 1).padStart(2, "0")}` : null }));
    const end = { today: "2026-11-03", lastFinished: "2026-11-02" };
    expect(e.evaluateQuest(data({ ...end, reviews }), q("review_month", 1))).toEqual({ progress: 18, target: 18, status: "done" });
    const worse = reviews.map((r, i) => (i === 3 ? { ...r, reviewedOn: null } : r));
    expect(e.evaluateQuest(data({ ...end, reviews: worse }), q("review_month", 1)).status).toBe("failed");
  });
});

describe("curator quests", () => {
  const q = (template: string, over: Partial<StoredQuest> = {}): StoredQuest => ({
    id: 9, trader: "Кирилл Б.", scope: "curator", template, period: "curator", params: {}, progress: 0, target: 3, status: "active",
    rewardPoints: 10, startsOn: "2026-10-12", endsOn: "2026-10-16", completedOn: null, assignedBy: "Ольга Н.", note: null, ...over,
  });

  it("counts only the quest's own days; expires after the deadline (+1 trading day for reviews)", () => {
    const reviews = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-16"].map((date) => ({ date, reviewedOn: date }));
    expect(e.evaluateQuest(data({ today: "2026-10-14", reviews }), q("review_days"))).toEqual({ progress: 2, target: 3, status: "active" });
    expect(e.evaluateQuest(data({ today: "2026-10-19", reviews: reviews.slice(0, 3) }), q("review_days")).status).toBe("active"); // grace day
    expect(e.evaluateQuest(data({ today: "2026-10-20", reviews: reviews.slice(0, 3) }), q("review_days")).status).toBe("expired");
    expect(e.evaluateQuest(data({ today: "2026-10-17", reviews }), q("review_days")).status).toBe("done");
    const plans = new Map([["2026-10-12", { beforeOpen: true, stop: false, ownRule: false, contract: false }], ["2026-10-20", { beforeOpen: true, stop: false, ownRule: false, contract: false }]]);
    expect(e.evaluateQuest(data({ today: "2026-10-21", plans }), q("plan_days", { target: 1 })).status).toBe("done");
    expect(e.evaluateQuest(data({ today: "2026-10-17" }), q("beat_yourself")).status).toBe("expired");
  });

  it("the manual task never completes by itself (the curator marks it) but still expires", () => {
    expect(e.evaluateQuest(data({ today: "2026-10-14" }), q("curator_task", { target: 1 })).status).toBe("active");
    expect(e.evaluateQuest(data({ today: "2026-10-17" }), q("curator_task", { target: 1 })).status).toBe("expired");
    expect(c.curatorTemplate("curator_task")!.assign).toEqual({ unit: "count", defaultTarget: 1, minTarget: 1, maxTarget: 1 });
    expect(c.curatorTemplate("plan_before_open")).toBeNull(); // daily-only templates are not assignable
  });
});

describe("idempotency and the API helpers", () => {
  it("a second plan over the stored result creates and changes nothing", () => {
    const d = data({ user: { mustChangeSecret: false, telegram: true }, plans: new Map([["2026-10-14", { beforeOpen: true, stop: true, ownRule: false, contract: true }]]) });
    const s = run(d);
    const again = e.planQuests(d, s, { onboarding: true }, ALL_ON);
    expect(again).toEqual({ create: [], update: [] });
  });

  it("quests switched off: nothing new, active ones still finish", () => {
    const s = run(data(), [], ONLY("daily"));
    const off = e.planQuests(data({ minutes: 9 * 60 + 40 }), s, { onboarding: true }, { ...ALL_ON, enabled: false });
    expect(off.create).toEqual([]);
    expect(off.update.map((u) => u.status)).toEqual(["failed"]);
  });

  it("visible list, week summary and points", () => {
    const s = run(data({ user: { mustChangeSecret: false, telegram: false }, plans: new Map([["2026-10-14", { beforeOpen: true, stop: true, ownRule: false, contract: true }]]) }));
    const shown = e.visibleQuests(s, "2026-10-14", "2026-10-12", "2026-10");
    expect(shown.map((q) => q.scope)).toEqual(["onboarding", "onboarding", "daily", "daily", "weekly"]); // contract_days: the only relevant weekly
    // «Квесты недели»: weekly quests only (the two daily ones of the day do not count).
    expect(e.weekSummary(s, "2026-10-12", "2026-10-16")).toEqual({ weekDone: 0, weekTotal: 1 });
    const curator = { ...s[0]!, id: 900, scope: "curator" as const, template: "review_days", period: "curator", status: "cancelled" as const, startsOn: "2026-10-13", endsOn: "2026-10-20", completedOn: null };
    expect(e.weekSummary([...s, curator], "2026-10-12", "2026-10-16")).toEqual({ weekDone: 0, weekTotal: 1 });
    // A cancelled curator quest stays in the list (history), flagged; the old clients read it as expired.
    expect(e.visibleQuests([...s, curator], "2026-10-14", "2026-10-12", "2026-10").some((q) => q.id === 900)).toBe(true);
    expect(e.toQuest(curator, data())).toMatchObject({ status: "expired", cancelled: true, href: null });
    expect(e.questPoints(s, "2026-10-01")).toEqual({ total: 13, recent: 13 });
    expect(e.questPoints(s, "2026-10-15")).toEqual({ total: 13, recent: 0 });
    const api = e.toQuest(tpl(s, "plan_before_open")!, data());
    expect(api).toMatchObject({ title: { key: "quest.plan_before_open.title", params: { target: 1, count: 1 } }, description: { key: "quest.plan_before_open.desc" }, status: "done", href: null });
  });
});
