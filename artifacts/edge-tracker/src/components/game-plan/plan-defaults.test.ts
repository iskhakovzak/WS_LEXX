// /game-plan decisions (Волна 1): the default tab (1.4), the empty desk plan after the open (1.4), the morning summary
// (1.20) and the suggested own rule (1.9).
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { gpI18n } from "@/i18n/ns/gamePlan";
import type { StreamItem } from "@/components/shared/stream/stream-api";
import { NEWS_MAX, dayPosts, defaultPlanView, deskEmptyKind, deskNews, showRuleSuggestion, type PlanPrefill } from "./plan-defaults";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("defaultPlanView (1.4)", () => {
  it("a trader opens «Мой план»; staff / guests the desk plan; ?view= wins", () => {
    expect(defaultPlanView({ url: null, isTrader: true, canMine: true })).toBe("my");
    expect(defaultPlanView({ url: null, isTrader: false, canMine: true })).toBe("desk");
    expect(defaultPlanView({ url: null, isTrader: true, canMine: false })).toBe("desk");
    expect(defaultPlanView({ url: "desk", isTrader: true, canMine: true })).toBe("desk");
  });
});

describe("deskEmptyKind (1.4)", () => {
  const base = { date: "2026-10-20", today: "2026-10-20", sessionAhead: false, nyDate: "2026-10-20" };
  it("after 09:30 NY: «сегодня план деска не публиковался»", () => {
    expect(deskEmptyKind({ ...base, nyMinutes: 9 * 60 + 29 })).toBe("today");
    expect(deskEmptyKind({ ...base, nyMinutes: 9 * 60 + 30 })).toBe("late");
    expect(deskEmptyKind({ ...base, nyMinutes: 11 * 60 + 8 })).toBe("late");
  });
  it("weekend (next session), future and past days keep their own copy", () => {
    expect(deskEmptyKind({ ...base, today: "2026-10-19", date: "2026-10-19", sessionAhead: true, nyMinutes: 700 })).toBe("ahead");
    expect(deskEmptyKind({ ...base, date: "2026-10-21", nyMinutes: 700 })).toBe("future");
    expect(deskEmptyKind({ ...base, date: "2026-10-16", nyMinutes: 700 })).toBe("past");
  });
  it("the late copy exists in RU / EN / UZ", async () => {
    expect(gpI18n.t("page.notPublishedTodayLate")).toBe("Сегодня план деска не публиковался");
    await setLang("en", { source: "init" });
    expect(gpI18n.t("page.notPublishedTodayLate")).toBe("No desk plan was published today");
    await setLang("uz", { source: "init" });
    expect(gpI18n.t("page.notPublishedTodayLate")).toBe("Bugun desk rejasi eʼlon qilinmadi");
  });
});

const item = (id: string, kind: StreamItem["kind"], date: string, at: string): StreamItem => ({
  id, kind, cats: ["desk"], date, at, trader: null, actor: null, title: id, subtitle: null, tone: "neutral", value: null, valueFmt: null,
  ticker: null, href: null, group: null, visibility: "public",
});

describe("deskNews (1.20)", () => {
  it("previous session + the plan day, newest first, without the plan / events the page shows itself, deduped", () => {
    const items = [
      item("a", "day_result", "2026-10-19", "2026-10-19T20:10:00Z"),
      item("plan", "game_plan", "2026-10-20", "2026-10-20T12:00:00Z"),
      item("ev", "event", "2026-10-20", "2026-10-20T11:00:00Z"),
      item("b", "idea", "2026-10-20", "2026-10-20T13:00:00Z"),
      item("old", "idea", "2026-10-15", "2026-10-15T13:00:00Z"),
      item("b", "idea", "2026-10-20", "2026-10-20T13:00:00Z"),
    ];
    expect(deskNews(items, "2026-10-19", "2026-10-20").map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("caps the list (the full feed is a link away)", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`x${i}`, "review", "2026-10-20", `2026-10-20T1${i % 10}:00:00Z`));
    expect(deskNews(many, "2026-10-19", "2026-10-20")).toHaveLength(NEWS_MAX);
  });
});

describe("dayPosts (1.20 «Сегодня важно»)", () => {
  it("the day's manual posts, filled parts only; empty posts dropped", () => {
    const posts = dayPosts([
      { id: 1, date: "2026-10-20", createdBy: "Ольга Н.", marketTheme: " Полупроводники ", whatWorksNow: "", bestTickers: "nvda, AMD;  smci", notes: null },
      { id: 2, date: "2026-10-20T00:00:00Z", marketTheme: "", whatWorksNow: "", whatDoesntWork: "", bestTickers: "", notes: "" },
      { id: 3, date: "2026-10-19", marketTheme: "Вчера" },
    ], "2026-10-20");
    expect(posts).toEqual([{ id: 1, author: "Ольга Н.", theme: "Полупроводники", works: null, doesntWork: null, tickers: ["NVDA", "AMD", "SMCI"], notes: null }]);
  });
});

describe("showRuleSuggestion (1.9)", () => {
  const prefill: PlanPrefill = {
    date: "2026-10-21", focus: null,
    rule: { mistake: "behavior:fatigue", costNet: -240.9, count: 40, days: 6, window: { from: "2026-10-07", to: "2026-10-20" } },
  };
  it("offered while the contract's rule is something else; gone once accepted", () => {
    expect(showRuleSuggestion(prefill, undefined)).toBe(true);
    expect(showRuleSuggestion(prefill, "behavior:martingale")).toBe(true);
    expect(showRuleSuggestion(prefill, "behavior:fatigue")).toBe(false);
    expect(showRuleSuggestion({ ...prefill, rule: null }, undefined)).toBe(false);
    expect(showRuleSuggestion(null, undefined)).toBe(false);
  });
  it("reads «Сделки на усталости: −$241 за 2 недели · 40 раз»", () => {
    const line = gpI18n.t("suggest.line", { rule: "Сделки на усталости", cost: "−$241", times: gpI18n.t("suggest.times", { count: 40 }) });
    expect(line).toBe("Сделки на усталости: −$241 за 2 недели · 40 раз");
  });
});
