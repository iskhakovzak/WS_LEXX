// Quests view logic: texts from keys (with fallbacks), the dashboard strip, grouping, history, deadlines, celebration,
// achievement tiers and ordering.
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import {
  achievementHint, achievementTitle, activeByScope, daysLeft, defaultDeadline, freshlyDone, isHidden, nextTier, questHistory, questTitle,
  sortAchievements, stripView, todayQuests,
} from "../model";
import { TODAY, achievements, daily, finished, fromCurator, me, onboarding, quest, weekly } from "./fixtures";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("texts", () => {
  it("renders the server key, falls back to the template key, then to a generic word", () => {
    expect(questTitle(weekly)).toBe("Соблюдать контракт");
    expect(questTitle({ ...weekly, title: { key: "quest.no_such.title" } })).toBe("Соблюдать контракт");
    expect(questTitle({ title: { key: "x.y" }, template: "unknown_tpl", target: 1 })).toBe("Квест");
  });

  it("achievement hint takes the next target as count (plural)", () => {
    const a = achievements[0];
    expect(achievementTitle(a)).toBe("Серия контракта");
    expect(achievementHint(a, 10)).toBe("Соблюдайте контракт 10 дней подряд");
    expect(achievementHint(a, 21)).toBe("Соблюдайте контракт 21 день подряд");
  });

  it("Uzbek (Latin)", async () => {
    await setLang("uz", { source: "init" });
    expect(questTitle(weekly)).toBe("Kontraktga rioya qilish");
    expect(achievementTitle(achievements[0])).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("dates", () => {
  it("days left to an inclusive deadline", () => {
    expect(daysLeft("2026-10-23", TODAY)).toBe(4);
    expect(daysLeft(TODAY, TODAY)).toBe(0);
    expect(daysLeft("2026-10-18", TODAY)).toBe(-1);
  });

  it("default deadline: this Friday, next Friday when fewer than two days are left", () => {
    expect(defaultDeadline("2026-10-19")).toBe("2026-10-23"); // Mon
    expect(defaultDeadline("2026-10-21")).toBe("2026-10-23"); // Wed
    expect(defaultDeadline("2026-10-22")).toBe("2026-10-30"); // Thu
    expect(defaultDeadline("2026-10-23")).toBe("2026-10-30"); // Fri
    expect(defaultDeadline("2026-10-24")).toBe("2026-10-30"); // Sat
    expect(defaultDeadline("2026-10-25")).toBe("2026-10-30"); // Sun
  });
});

describe("dashboard strip", () => {
  it("today = today's daily quests + running curator quests; «Квесты 1/3»", () => {
    const v = stripView(me())!;
    expect(v.kind).toBe("today");
    expect(todayQuests(me()).map((q) => q.id)).toEqual([201, 202, 401]);
    expect([v.done, v.total]).toEqual([1, 3]);
  });

  it("an unfinished onboarding chain wins: «Первые шаги 3/7» with the next step", () => {
    const v = stripView(me({ quests: [...onboarding, ...daily], summary: { ...me().summary, onboarding: { done: 3, total: 7 } } }))!;
    expect(v.kind).toBe("onboarding");
    expect([v.done, v.total]).toEqual([3, 7]);
    expect(v.next?.id).toBe(104);
    expect(v.today.map((q) => q.id)).toEqual([201, 202]);
  });

  it("a finished chain falls back to today's quests; nothing at all → no strip", () => {
    expect(stripView(me({ summary: { ...me().summary, onboarding: { done: 7, total: 7 } } }))?.kind).toBe("today");
    expect(stripView(me({ quests: [weekly] }))).toBeNull();
    expect(stripView(null)).toBeNull();
  });
});

describe("board", () => {
  it("active quests grouped by scope in a fixed order, curator first after onboarding", () => {
    const groups = activeByScope(me().quests);
    expect(groups.map((g) => g.scope)).toEqual(["curator", "daily", "weekly"]);
    expect(groups.find((g) => g.scope === "daily")!.quests.map((q) => q.id)).toEqual([202]);
  });

  it("history: finished quests, newest first", () => {
    expect(questHistory(me().quests).map((q) => q.id)).toEqual([201, 501, 502]);
  });

  it("celebrates only fresh, unseen completions", () => {
    const old = quest({ id: 900, scope: "daily", template: "plan_before_open", status: "done", completedAt: "2026-10-10" });
    const list = [...daily, ...finished, old, fromCurator];
    expect(freshlyDone(list, TODAY, new Set()).map((q) => q.id)).toEqual([201]);
    expect(freshlyDone(list, TODAY, new Set([201]))).toEqual([]);
  });
});

describe("achievements", () => {
  it("next tier is the lowest unearned one", () => {
    expect(nextTier(achievements[0])?.tier).toBe("silver");
    expect(nextTier({ tiers: achievements[0].tiers.map((t) => ({ ...t, earnedAt: "2026-10-01" })) })).toBeNull();
  });

  it("secret lines stay hidden until earned; sort by category, earned first", () => {
    expect(isHidden(achievements[2])).toBe(true);
    expect(isHidden({ ...achievements[2], tier: "bronze" })).toBe(false);
    expect(sortAchievements(achievements).map((a) => a.id)).toEqual(["contract_streak", "reviews_total", "beat_yourself"]);
  });
});
