/**
 * lib/gamification pure rules: seasons (score, ranking, top for a viewer — aliases / hidden users), the league, titles,
 * setup mastery, the rewards eligibility and item checks, streak milestones, and the streak freeze on the discipline
 * scale (lib/daily/discipline scaleLedger: missed / frozen days).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const season = await import("../gamification/season");
const { leagueTeams, visibleTeams, LEAGUE_MIN_TEAMS } = await import("../gamification/league");
const titles = await import("../gamification/titles");
const mastery = await import("../gamification/mastery");
const rewards = await import("../gamification/rewards");
const hooks = await import("../gamification/hooks");
const d = await import("../daily/discipline");
import type { LedgerDay } from "../daily/discipline";

const day = (date: string, points: number, outcome: LedgerDay["outcome"] = "kept", streak = 1): LedgerDay => ({ date, outcome, points, bonus: 0, streak });

describe("season score", () => {
  it("month's ledger points + quests done in the month; floored at 0; active flag", () => {
    const ledger = [day("2026-09-30", 50), day("2026-10-01", 5), day("2026-10-02", -15, "broken", 0), day("2026-10-05", 6)];
    const quests = [
      { status: "done", completedOn: "2026-10-03", rewardPoints: 10 },
      { status: "done", completedOn: "2026-09-29", rewardPoints: 99 },
      { status: "failed", completedOn: "2026-10-04", rewardPoints: 25 },
    ];
    expect(season.seasonScore("2026-10", { ledger, quests })).toEqual({ discipline: -4, quests: 10, points: 6, active: true });
    expect(season.seasonScore("2026-10", { ledger: [day("2026-10-02", -15, "broken", 0)], quests: [] })).toMatchObject({ points: 0, active: true });
    expect(season.seasonScore("2026-11", { ledger, quests, tradedDays: [] }).active).toBe(false);
    expect(season.seasonScore("2026-11", { ledger: [], quests: [], tradedDays: ["2026-11-03"] }).active).toBe(true);
  });

  it("ranges, previous season, days left", () => {
    expect(season.seasonRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(season.previousSeason("2026-01")).toBe("2025-12");
    expect(season.endsInDays("2026-10", "2026-10-18")).toBe(13);
    expect(season.endsInDays("2026-10", "2026-10-31")).toBe(0);
    expect(season.endsInDays("2026-09", "2026-10-18")).toBe(0);
    expect(season.isSeasonKey("2026-10")).toBe(true);
    expect(season.isSeasonKey("2026-13")).toBe(false);
  });

  it("ranking: ties share the place, names break ties", () => {
    const r = season.rankRows([{ trader: "B", points: 10 }, { trader: "A", points: 10 }, { trader: "C", points: 3 }, { trader: "D", points: 0 }]);
    expect(r.map((x) => [x.trader, x.rank])).toEqual([["A", 1], ["B", 1], ["C", 3], ["D", 4]]);
  });

  it("top for a trader: aliases, hidden users left out (but not himself), zero points never listed", () => {
    const ranked = season.rankRows([{ trader: "A", points: 30 }, { trader: "B", points: 20 }, { trader: "Me", points: 10 }, { trader: "Z", points: 0 }]);
    const o = { hidden: new Set(["B"]), alias: new Map([["A", 4], ["B", 2], ["Me", 1], ["Z", 3]]), titles: new Map([["A", "iron"]]) };
    const trader = season.topFor(ranked, 10, { name: "Me", staff: false, hideNames: true }, o);
    expect(trader).toEqual([{ label: "t4", me: false, points: 30, title: "iron" }, { label: "t1", me: true, points: 10, title: null }]);
    const staff = season.topFor(ranked, 10, { name: "Boss", staff: true, hideNames: true }, o);
    expect(staff.map((x) => x.label)).toEqual(["A", "B", "Me"]);
    const shown = season.topFor(ranked, 1, { name: "Me", staff: false, hideNames: false }, o);
    expect(shown).toEqual([{ label: "A", me: false, points: 30, title: "iron" }]);
    expect(season.topFor(ranked, 10, { name: "B", staff: false, hideNames: true }, o).map((x) => x.me)).toEqual([false, true, false]);
  });

  it("a risk-halted trader takes no place in the top — for traders and staff — but still sees himself (OWNER-09)", () => {
    const ranked = season.rankRows([{ trader: "Kirill", points: 96 }, { trader: "B", points: 20 }, { trader: "Me", points: 10 }]);
    const o = { hidden: new Set<string>(), alias: new Map([["Kirill", 1], ["B", 2], ["Me", 3]]), titles: new Map<string, string>(), excluded: new Set(["Kirill"]) };
    expect(season.topFor(ranked, 10, { name: "Me", staff: false, hideNames: false }, o).map((x) => x.label)).toEqual(["B", "Me"]);
    expect(season.topFor(ranked, 10, { name: "Boss", staff: true, hideNames: true }, o).map((x) => x.label)).toEqual(["B", "Me"]);
    expect(season.topFor(ranked, 10, { name: "Kirill", staff: false, hideNames: false }, o).map((x) => [x.label, x.me])).toEqual([["Kirill", true], ["B", false], ["Me", false]]);
  });

  it("season place only with ≥ 5 ranked participants for a trader; staff always (2.14)", () => {
    const st = { myRank: 1, of: 6, top: [{ label: "t1", me: true, points: 10 }, { label: "t2", me: false, points: 5 }] };
    const four = [10, 5, 3, 1, 0, 0].map((points) => ({ points }));
    const hidden = season.withRankThreshold(st, four, false);
    expect(hidden).toMatchObject({ myRank: null, rankHidden: true, of: 6 });
    expect(hidden.top).toEqual([{ label: "t1", me: true, points: 10 }]);
    expect(season.withRankThreshold(st, four, true)).toBe(st);
    const five = [10, 5, 3, 2, 1].map((points) => ({ points }));
    expect(season.withRankThreshold(st, five, false)).toBe(st);
    expect(season.SEASON_MIN_RANKED).toBe(5);
    // «#1 of 1» (the audit's case): one participant → no place.
    expect(season.withRankThreshold({ myRank: 1, of: 1, top: [{ me: true }] }, [{ points: 10 }], false).myRank).toBeNull();
  });

  it("seasons to re-score: this month, the judged day's month, the month before in the first days", () => {
    expect(hooks.seasonsToScore("2026-10-18", "2026-10-16")).toEqual(["2026-10"]);
    expect(hooks.seasonsToScore("2026-11-02", "2026-10-30")).toEqual(["2026-10", "2026-11"]);
    expect(hooks.seasonsToScore("2026-11-11", "2026-11-10")).toEqual(["2026-11"]);
  });

  it("streak milestones: kept days on multiples of the step in the recent window, tier targets excluded", () => {
    const ledger = [day("2026-10-01", 15, "kept", 24), day("2026-10-12", 15, "kept", 25), day("2026-10-13", 15, "kept", 50), day("2026-10-14", 0, "frozen", 50), day("2026-10-15", 15, "kept", 75)];
    expect(hooks.streakMilestones(ledger, "2026-10-16", 25, [5, 10, 20, 50])).toEqual([{ days: 25, date: "2026-10-12" }, { days: 75, date: "2026-10-15" }]);
    expect(hooks.streakMilestones(ledger, "2026-11-30", 25, [])).toEqual([]);
  });
});

describe("streak freeze on the discipline scale", () => {
  const cfg = { kept: 5, broken: -15, step: 1, cap: 10, onBreak: "reset" as const, freezePerMonth: 1 };
  const k = ["kept", "unset", "unset"] as const;
  const b = ["broken", "unset", "unset"] as const;
  const missed = (date: string) => ({ date, items: [] as const, missed: true });

  it("the first missed day of a running streak is frozen, the next one in the month breaks it", () => {
    const l = d.scaleLedger([{ date: "2026-10-01", items: k }, { date: "2026-10-02", items: k }, missed("2026-10-05"), { date: "2026-10-06", items: k }, missed("2026-10-07"), { date: "2026-10-08", items: k }], cfg);
    expect(l.map((x) => [x.outcome, x.streak, x.points])).toEqual([["kept", 1, 5], ["kept", 2, 6], ["frozen", 2, 0], ["kept", 3, 7], ["missed", 0, 0], ["kept", 1, 5]]);
  });

  it("a broken contract is never covered; a missed day without a streak uses no freeze; a new month brings a new freeze", () => {
    const l = d.scaleLedger([missed("2026-09-28"), { date: "2026-09-29", items: k }, { date: "2026-09-30", items: b }, { date: "2026-10-01", items: k }, missed("2026-10-02"), missed("2026-11-02")], cfg);
    expect(l.map((x) => x.outcome)).toEqual(["missed", "kept", "broken", "kept", "frozen", "frozen"]);
    expect(l.map((x) => x.streak)).toEqual([0, 1, 0, 1, 1, 1]);
  });

  it("no freezes (0 a month) → a missed day breaks the streak; «halve» keeps half", () => {
    const days = [{ date: "2026-10-01", items: k }, { date: "2026-10-02", items: k }, missed("2026-10-05")];
    expect(d.scaleLedger(days, { ...cfg, freezePerMonth: 0 }).at(-1)).toMatchObject({ outcome: "missed", streak: 0 });
    expect(d.scaleLedger(days, { ...cfg, freezePerMonth: 0, onBreak: "halve" }).at(-1)).toMatchObject({ outcome: "missed", streak: 1 });
  });

  it("contract ledger: traded days without a contract become missed days (switch on), not when off", async () => {
    const { pool } = await import("@workspace/db");
    vi.mocked(pool.query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("FROM trader_plans")) return { rows: [{ date: "2026-10-12", doc: { maxTrades: 3 } }], rowCount: 1 };
      if (String(sql).includes("verdict -> 'contract'")) return { rows: [{ date: "2026-10-12", c: { maxLoss: { status: "unset" }, maxTrades: { status: "kept" }, rule: { status: "unset" } } }], rowCount: 1 };
      if (String(sql).includes("SELECT DISTINCT substring(date, 1, 10) AS d FROM trades")) return { rows: [{ d: "2026-10-12" }, { d: "2026-10-13" }, { d: "2026-10-14" }], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    }) as never);
    const now = new Date("2026-10-19T14:00:00Z");
    const l = await d.contractLedger("Кирилл Б.", { to: "2026-10-16", trades: [], now });
    expect(l.map((x) => [x.date, x.outcome])).toEqual([["2026-10-12", "kept"], ["2026-10-13", "frozen"], ["2026-10-14", "missed"]]);
    const { __loadSettingsCache } = await import("../settings/registry");
    __loadSettingsCache({ "gamification.missedDayBreaksStreak": false });
    expect((await d.contractLedger("Кирилл Б.", { to: "2026-10-16", trades: [], now })).map((x) => x.outcome)).toEqual(["kept"]);
    __loadSettingsCache({});
    vi.mocked(pool.query).mockImplementation((async () => ({ rows: [], rowCount: 0 })) as never);
  });
});

describe("curator league", () => {
  it("average of ACTIVE members, small teams not ranked, ties share the place", () => {
    const m = (trader: string, curator: string | null, points: number, active = true) => ({ trader, curator, points, active });
    const teams = leagueTeams([
      m("a1", "Ольга", 30), m("a2", "Ольга", 10), m("a3", "Ольга", 0, false),
      m("b1", "Сергей", 20), m("b2", "Сергей", 20),
      m("c1", "Анна", 100), m("x", null, 500),
    ], 2);
    expect(teams).toEqual([
      { curator: "Ольга", members: 2, score: 20, rank: 1 },
      { curator: "Сергей", members: 2, score: 20, rank: 1 },
    ]);
    expect(leagueTeams([m("c1", "Анна", 7), m("c2", "Анна", 8)], 1)).toEqual([{ curator: "Анна", members: 2, score: 7.5, rank: 1 }]);
  });

  it("a league of one team is not shown (OLGA-15): fewer than LEAGUE_MIN_TEAMS ranked teams → none", () => {
    expect(LEAGUE_MIN_TEAMS).toBe(2);
    expect(visibleTeams([{ curator: "Ольга" }], LEAGUE_MIN_TEAMS)).toEqual([]);
    expect(visibleTeams([{ curator: "Ольга" }, { curator: "Сергей" }], LEAGUE_MIN_TEAMS)).toHaveLength(2);
    expect(visibleTeams([{ curator: "Ольга" }], 1)).toHaveLength(1);
  });
});

describe("titles", () => {
  it("from gold / platinum tiers and mastery 4; the chosen one must be earned", () => {
    const t = titles.titlesOf(
      [{ line: "contract_streak", tier: "gold", date: "2026-10-01" }, { line: "contract_streak", tier: "bronze", date: "2026-09-01" }, { line: "reviews_total", tier: "gold", date: "2026-08-01" }],
      [{ setupId: 12, code: "1.3", level: 4, levelOn: "2026-10-10" }, { setupId: 13, code: null, level: 3, levelOn: "2026-10-10" }, { setupId: 14, code: null, level: 4, levelOn: "2026-10-11" }],
    );
    expect(t).toEqual([
      { key: "analyst", earnedAt: "2026-08-01" }, { key: "iron", earnedAt: "2026-10-01" }, { key: "sniper:1.3", earnedAt: "2026-10-10" }, { key: "sniper:14", earnedAt: "2026-10-11" },
    ]);
    expect(titles.activeTitleOf("iron", t)).toBe("iron");
    expect(titles.activeTitleOf("unbreakable", t)).toBeNull();
    expect(titles.activeTitleOf(null, t)).toBeNull();
  });
});

describe("setup mastery", () => {
  it("points = graded-A trades + passed drills / per point; levels by thresholds 3 / 10 / 25 / 50", () => {
    expect(mastery.masteryPoints(4, 5, 2)).toBe(6);
    const th = mastery.masteryThresholds();
    expect(th).toEqual([3, 10, 25, 50]);
    expect(mastery.masteryLevel(2, th)).toEqual({ level: 0, next: 3 });
    expect(mastery.masteryLevel(10, th)).toEqual({ level: 2, next: 25 });
    expect(mastery.masteryLevel(80, th)).toEqual({ level: 4, next: null });
  });

  it("builds per setup with sources, sorted by code; level-ups only against stored levels (quiet first run)", () => {
    const m = mastery.buildMastery([{ id: 2, name: "2.1 VWAP Hold" }, { id: 1, name: "1.3 ORB" }], new Map([[1, 12]]), new Map([[1, { passed: 6, attempts: 9 }], [2, { passed: 1, attempts: 1 }]]));
    expect(m.map((x) => [x.setupId, x.level, x.progress.current, x.sources.gradeATrades, x.sources.drills])).toEqual([[1, 2, 15, 12, 6], [2, 0, 0, 0, 1]]);
    expect(mastery.levelUps(m, new Map())).toEqual([]);
    expect(mastery.levelUps(m, new Map([[1, 1], [2, 0]]))).toEqual([{ setupId: 1, from: 1, to: 2 }]);
  });
});

describe("rewards eligibility", () => {
  const input = {
    achievements: [{ line: "contract_streak", tier: "silver" }, { line: "comeback", tier: "gold" }],
    level: 2,
    seasons: [{ season: "2026-08", rank: 1 }, { season: "2026-09", rank: 4 }],
    mastery: [{ setupId: 12, code: "1.3", level: 4 }, { setupId: 13, code: "2.1", level: 2 }],
  };
  const item = (kind: "achievement" | "level" | "season_rank" | "mastery", ref: string, tier: string | null = null, rank: number | null = null) => ({ condition: { kind, ref, tier, rank } });

  it("achievement tier or higher; any tier when null", () => {
    expect(rewards.eligibleRefs(item("achievement", "contract_streak", "bronze"), input)).toEqual([""]);
    expect(rewards.eligibleRefs(item("achievement", "contract_streak", "gold"), input)).toEqual([]);
    expect(rewards.eligibleRefs(item("achievement", "comeback"), input)).toEqual([""]);
    expect(rewards.eligibleRefs(item("achievement", "reviews_total"), input)).toEqual([]);
  });
  it("level, season rank (one grant per season), mastery by code or any setup", () => {
    expect(rewards.eligibleRefs(item("level", "2"), input)).toEqual([""]);
    expect(rewards.eligibleRefs(item("level", "3"), input)).toEqual([]);
    expect(rewards.eligibleRefs(item("season_rank", "season", null, 3), input)).toEqual(["2026-08"]);
    expect(rewards.eligibleRefs(item("season_rank", "season", null, 5), input)).toEqual(["2026-08", "2026-09"]);
    expect(rewards.eligibleRefs(item("mastery", "", "4"), input)).toEqual([""]);
    expect(rewards.eligibleRefs(item("mastery", "2.1", "3"), input)).toEqual([]);
    expect(rewards.eligibleRefs(item("mastery", "13", "2"), input)).toEqual([""]);
  });
  it("stale eligibility: inactive / missing item or condition no longer met; history never stale (ILYA-17)", () => {
    const items: import("../gamification/types").RewardItem[] = [
      { id: 1, title: "Master", description: null, active: true, stock: null, condition: { kind: "mastery" as const, ref: "", tier: "4" } },
      { id: 2, title: "Off", description: null, active: false, stock: null, condition: { kind: "level" as const, ref: "1" } },
      { id: 3, title: "Top-3", description: null, active: true, stock: null, condition: { kind: "season_rank" as const, ref: "season", rank: 3 } },
      { id: 4, title: "Expert", description: null, active: true, stock: null, condition: { kind: "mastery" as const, ref: "", tier: "3" } },
    ];
    const expert = { ...input, mastery: [{ setupId: 13, code: "2.1", level: 3 }] };
    const g = (id: number, itemId: number, status: string, ref = "") => ({ id, itemId, status, ref });
    const stale = rewards.staleGrants([
      g(1, 1, "eligible"), g(2, 2, "eligible"), g(3, 3, "eligible", "2026-08"), g(4, 3, "eligible", "2026-09"), g(5, 4, "eligible"),
      g(6, 1, "requested"), g(7, 2, "granted"), g(8, 99, "eligible"),
    ], items, expert);
    expect(stale.map((x) => x.id)).toEqual([1, 2, 4, 8]);
    expect(rewards.conditionChanged(items[0]!, { ...items[0]! })).toBe(false);
    expect(rewards.conditionChanged(items[0]!, { ...items[0]!, condition: { ...items[0]!.condition, tier: "3" } })).toBe(true);
    expect(rewards.conditionChanged(items[2]!, { ...items[2]!, condition: { ...items[2]!.condition, rank: 1 } })).toBe(true);
  });

  it("item checks", () => {
    const o = { lines: ["contract_streak"], levels: 4 };
    const base = { title: "Book", description: null, active: false, stock: null };
    expect(rewards.itemProblem({ ...base, condition: { kind: "achievement", ref: "contract_streak", tier: "gold" } }, o)).toBeNull();
    expect(rewards.itemProblem({ ...base, condition: { kind: "achievement", ref: "nope" } }, o)).toBe("ref");
    expect(rewards.itemProblem({ ...base, condition: { kind: "achievement", ref: "contract_streak", tier: "diamond" } }, o)).toBe("tier");
    expect(rewards.itemProblem({ ...base, condition: { kind: "level", ref: "5" } }, o)).toBe("ref");
    expect(rewards.itemProblem({ ...base, condition: { kind: "season_rank", ref: "season", rank: 0 } }, o)).toBe("rank");
    expect(rewards.itemProblem({ ...base, condition: { kind: "mastery", ref: "", tier: "5" } }, o)).toBe("tier");
    expect(rewards.itemProblem({ ...base, title: " ", condition: { kind: "level", ref: "1" } }, o)).toBe("title");
    expect(rewards.itemProblem({ ...base, stock: -1, condition: { kind: "level", ref: "1" } }, o)).toBe("stock");
  });
});
