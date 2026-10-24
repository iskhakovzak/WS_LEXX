/**
 * Achievement lines (lib/quests/achievements.ts): every line and its tiers with the default settings, the day each tier
 * was reached, implied lower tiers, stored tiers kept (awarded once), secret lines hidden until earned, academy lines
 * only with academy data, and the badge ↔ tier map (the old discipline badges).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const a = await import("../quests/achievements");
const { scaleLedger, scaleConfig } = await import("../daily/discipline");
type Input = import("../quests/achievements").AchievementInput;

/** Weekdays from `from`. */
function weekdays(n: number, from = "2026-03-02"): string[] {
  const out: string[] = [];
  let x = new Date(`${from}T12:00:00Z`);
  while (out.length < n) {
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(x.toISOString().slice(0, 10));
    x = new Date(x.getTime() + 86_400_000);
  }
  return out;
}
const kept = ["kept", "unset", "unset"] as const;
const broken = ["broken", "unset", "unset"] as const;
const ledgerOf = (days: readonly { date: string; items: readonly ("kept" | "broken" | "unset")[] }[]) => scaleLedger(days, scaleConfig());

function input(over: Partial<Input> = {}): Input {
  return {
    asOf: "2026-10-16", ledger: [], reviews: [], focus: [], stops: [], cleanMonthMinDays: 15, games: [], plansBeforeOpen: [],
    promotions: [], lessons: [], exams: [], academy: false, onboarding: { done: 0, total: 7, doneOn: null }, ...over,
  };
}
const line = (res: ReturnType<typeof a.evaluateAchievements>, id: string) => res.find((r) => r.id === id)!;
const earned = (res: ReturnType<typeof a.evaluateAchievements>, id: string) => line(res, id).tiers.map((t) => t.earnedOn);

describe("lines and tiers (default settings)", () => {
  it("default tier targets", () => {
    const res = a.evaluateAchievements(input({ academy: true }));
    const targets = Object.fromEntries(res.map((r) => [r.id, r.tiers.map((t) => t.target)]));
    expect(targets).toEqual({
      contract_streak: [5, 10, 20, 50], clean_month: [1, 3, 6], comeback: [5], reviews_total: [10, 50, 100, 250],
      review_streak: [5, 10, 20, 40], focus_beaten: [5, 10, 20], plan_before_open: [10, 30, 100], full_loop: [20],
      own_replays: [1, 10, 50], beat_yourself: [3, 10, 25], lessons: [5, 20, 50], exams: [1, 2, 3], tier_up: [1, 2, 3], onboarding: [7],
    });
    expect(line(res, "comeback").tiers[0]!.tier).toBe("gold");
    expect(line(res, "contract_streak").tiers.map((t) => t.tier)).toEqual(["bronze", "silver", "gold", "platinum"]);
  });

  it("targets an admin typed out of order: bronze is still the smallest", async () => {
    const { __loadSettingsCache } = await import("../settings/registry");
    __loadSettingsCache({ "achievements.cleanMonth1": 6, "achievements.cleanMonth2": 1, "achievements.cleanMonth3": 3 });
    try {
      expect(line(a.evaluateAchievements(input()), "clean_month").tiers.map((t) => t.target)).toEqual([1, 3, 6]);
    } finally {
      __loadSettingsCache({});
    }
  });

  it("contract streak: the day the streak reached 5 / 10 / 20; a broken day restarts it", () => {
    const d = weekdays(23);
    const days = d.map((date, i) => ({ date, items: i === 11 ? broken : kept }));
    const res = a.evaluateAchievements(input({ ledger: ledgerOf(days) }));
    expect(earned(res, "contract_streak")).toEqual([d[4], d[9], null, null]);
    expect(line(res, "contract_streak").current).toBe(11);
  });

  it("clean months: total finished clean months (current month never counts)", () => {
    const month = (from: string, n: number, trough = -50) => weekdays(n, from).map((date) => ({ date, trough, limit: 300 }));
    const stops = [...month("2026-06-01", 16), ...month("2026-07-01", 16, -400), ...month("2026-08-03", 16), ...month("2026-09-01", 16), ...month("2026-10-01", 12)];
    const res = a.evaluateAchievements(input({ stops }));
    expect(line(res, "clean_month").current).toBe(3);
    expect(earned(res, "clean_month")).toEqual([stops[15]!.date, stops[63]!.date, null]);
    expect(a.cleanMonths(month("2026-09-01", 14), 15, "2026-10-16")).toEqual([]); // too few traded days
    expect(a.cleanMonths(month("2026-09-01", 16).map((x, i) => (i === 2 ? { ...x, limit: null } : x)), 15, "2026-10-16")).toEqual([]); // stop unknown
  });

  it("comeback (secret): a kept contract day right after a broken one; days without a contract are skipped", () => {
    const d = weekdays(30);
    const items = d.map((date, i) => ({ date, items: i % 3 === 0 ? broken : i % 3 === 1 ? kept : (["unset", "unset", "unset"] as const) }));
    const res = a.evaluateAchievements(input({ ledger: ledgerOf(items) }));
    expect(line(res, "comeback").current).toBe(10);
    expect(earned(res, "comeback")).toEqual([d[13]]);
  });

  it("reviews total and the on-time review streak (the last day may still be reviewed)", () => {
    const d = weekdays(12, "2026-09-28");
    // Full EOD reviews (roadmap R3: the one-tap «Разобрал» does not count for the review lines).
    const reviews = d.map((date, i) => ({ date, reviewedOn: i === 5 ? null : date, fullOn: i === 5 ? null : date }));
    const res = a.evaluateAchievements(input({ reviews, asOf: d[11]! }));
    expect(line(res, "reviews_total").current).toBe(11);
    expect(earned(res, "reviews_total")[0]).toBe(d[10]);
    expect(earned(res, "review_streak")).toEqual([d[4], null, null, null]);
    expect(line(res, "review_streak").current).toBe(6);
    const open = reviews.map((r, i) => (i === 11 ? { ...r, reviewedOn: null, fullOn: null } : r));
    expect(line(a.evaluateAchievements(input({ reviews: open, asOf: d[11]! })), "review_streak").current).toBe(5);
  });

  it("focus beaten: kept days in a row, broken resets, disputed / no trades skipped", () => {
    const d = weekdays(12);
    const focus = d.map((date, i) => ({ date, status: i === 2 ? "broken" : i === 4 ? "no_trades" : "kept", disputed: i === 6 }));
    const res = a.evaluateAchievements(input({ focus }));
    expect(line(res, "focus_beaten").current).toBe(7);
    expect(earned(res, "focus_beaten")).toEqual([d[9], null, null]);
  });

  it("plan before the open, full loop (secret), own replays, beat yourself", () => {
    const d = weekdays(30);
    const plansBeforeOpen = d.slice(0, 25);
    const ledger = ledgerOf(d.map((date) => ({ date, items: kept })));
    const reviews = d.map((date) => ({ date, reviewedOn: date, fullOn: date }));
    const games = [
      ...d.slice(0, 9).map((finishedOn) => ({ finishedOn, verdict: "worse" })),
      ...d.slice(9, 12).map((finishedOn) => ({ finishedOn, verdict: "better" })),
    ];
    const res = a.evaluateAchievements(input({ plansBeforeOpen, ledger, reviews, games }));
    expect(earned(res, "plan_before_open")).toEqual([d[9], null, null]);
    expect(earned(res, "full_loop")).toEqual([d[19]]);
    expect(line(res, "full_loop").current).toBe(25);
    expect(earned(res, "own_replays")).toEqual([d[0], d[9], null]);
    expect(earned(res, "beat_yourself")).toEqual([d[11], null, null]);
  });

  it("tier up: real promotions only; academy lines only with academy data", () => {
    const res = a.evaluateAchievements(input({ promotions: [{ date: "2025-12-01", rank: 1 }, { date: "2026-05-04", rank: 2 }] }));
    expect(earned(res, "tier_up")).toEqual(["2025-12-01", "2026-05-04", null]);
    expect(res.some((r) => r.id === "lessons" || r.id === "exams")).toBe(false);
    const acad = a.evaluateAchievements(input({ academy: true, lessons: weekdays(6), exams: ["2026-04-01"] }));
    expect(earned(acad, "lessons")).toEqual([weekdays(6)[4], null, null]);
    expect(earned(acad, "exams")).toEqual(["2026-04-01", null, null]);
  });

  it("onboarding: earned the day the last step was done", () => {
    expect(earned(a.evaluateAchievements(input({ onboarding: { done: 7, total: 7, doneOn: "2026-10-14" } })), "onboarding")).toEqual(["2026-10-14"]);
    expect(earned(a.evaluateAchievements(input({ onboarding: { done: 6, total: 7, doneOn: null } })), "onboarding")).toEqual([null]);
  });
});

describe("awarding (pure)", () => {
  const d = weekdays(12);
  const res = () => a.evaluateAchievements(input({ ledger: ledgerOf(d.map((date) => ({ date, items: kept }))) }));

  it("new tiers once; stored ones are not awarded again", () => {
    const first = a.newAwards(res(), new Map());
    expect(first.filter((x) => x.line === "contract_streak")).toEqual([
      { line: "contract_streak", tier: "bronze", date: d[4], target: 5 },
      { line: "contract_streak", tier: "silver", date: d[9], target: 10 },
    ]);
    const stored = new Map(first.map((x) => [a.awardKey(x.line, x.tier), { date: x.date, target: x.target }]));
    expect(a.newAwards(res(), stored)).toEqual([]);
  });

  it("a stored higher tier implies the lower ones on its day (data trimmed / settings raised)", () => {
    const stored = new Map([[a.awardKey("review_streak", "silver"), { date: "2026-05-05", target: 10 }]]);
    const out = a.newAwards(a.evaluateAchievements(input()), stored);
    expect(out).toContainEqual({ line: "review_streak", tier: "bronze", date: "2026-05-05", target: 5 });
  });

  it("each tier on the day its own target was reached; a stored tier on a wrong day is repaired (same number only)", () => {
    const stored = new Map([[a.awardKey("contract_streak", "bronze"), { date: d[11]!, target: 5 }]]); // dated late by an old build
    expect(a.newAwards(res(), stored).find((x) => x.line === "contract_streak")).toEqual({ line: "contract_streak", tier: "silver", date: d[9], target: 10 });
    expect(a.dateFixes(res(), stored)).toEqual([{ line: "contract_streak", tier: "bronze", date: d[4], target: 5 }]);
    // Another number than today's target, or a tier the data no longer shows: the stored day stays.
    expect(a.dateFixes(res(), new Map([[a.awardKey("contract_streak", "bronze"), { date: d[11]!, target: 3 }]]))).toEqual([]);
    expect(a.dateFixes(a.evaluateAchievements(input()), stored)).toEqual([]);
  });

  it("clean months: bronze / silver / gold on the 1st / 3rd / 6th clean month, not all on the legacy badge's day", () => {
    const months = ["2025-06", "2025-07", "2025-08", "2025-10", "2025-11", "2025-12", "2026-01"];
    const stops = months.flatMap((m) => Array.from({ length: 15 }, (_, i) => ({ date: `${m}-${String(i + 1).padStart(2, "0")}`, trough: -10, limit: 300 })));
    const r = a.evaluateAchievements(input({ stops }));
    const legacy = new Map([[a.awardKey("clean_month", "bronze"), { date: "2026-07-31", target: 1 }]]);
    expect(a.dateFixes(r, legacy)).toEqual([{ line: "clean_month", tier: "bronze", date: "2025-06-15", target: 1 }]);
    const fixed = new Map([[a.awardKey("clean_month", "bronze"), { date: "2025-06-15", target: 1 }]]);
    expect(a.newAwards(r, fixed).filter((x) => x.line === "clean_month").map((x) => [x.tier, x.date])).toEqual([["silver", "2025-08-15"], ["gold", "2025-12-15"]]);
  });

  it("states: stored tiers keep their day and number; secret lines hide until earned", () => {
    const stored = new Map([[a.awardKey("own_replays", "bronze"), { date: "2026-10-01", target: 1 }]]);
    const states = a.achievementStates(a.evaluateAchievements(input()), stored);
    const replays = states.find((s) => s.id === "own_replays")!;
    expect(replays.tier).toBe("bronze");
    expect(replays.tiers[0]).toEqual({ tier: "bronze", target: 1, earnedAt: "2026-10-01" });
    expect(replays.hint).toEqual({ key: "ach.own_replays.hint", params: { target: 10, count: 10 } });
    const secret = states.find((s) => s.id === "comeback")!;
    expect(secret).toMatchObject({ secret: true, tier: null, current: 0, title: { key: "ach.secret.title" }, hint: { key: "ach.secret.hint" } });
    expect(secret.tiers[0]!.target).toBe(0);
  });

  it("badges are tiers of the lines (both ways)", () => {
    expect(a.badgeAward("streak_3")).toEqual({ line: "contract_streak", tier: "gold" });
    expect(a.badgeAward("reviews")).toEqual({ line: "review_streak", tier: "silver" });
    expect(a.badgeAward("sim_beat")).toEqual({ line: "beat_yourself", tier: "bronze" });
    expect(a.badgeAward("nope")).toBeNull();
    const stored = new Map([[a.awardKey("contract_streak", "bronze"), { date: "2026-10-09", target: 5 }]]);
    const badges = a.badgesOf(a.achievementStates(a.evaluateAchievements(input()), stored));
    expect(badges.map((b) => b.id)).toEqual(["streak_1", "streak_2", "streak_3", "reviews", "focus", "clean_month", "sim_first", "sim_beat"]);
    expect(badges[0]).toEqual({ id: "streak_1", earnedOn: "2026-10-09", target: 5, progress: 5 });
    expect(badges[1]).toEqual({ id: "streak_2", earnedOn: null, target: 10, progress: 0 });
  });
});
