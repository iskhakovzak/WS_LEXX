/**
 * lib/usage — the allow-list (route normalisation, action keys, meta), batch cleaning and the funnel math.
 */
import { describe, it, expect } from "vitest";
import { cleanBatch, cleanEvent, normaliseSegment, normaliseView } from "../usage/keys";
import {
  activitySeries, beforeOpen, funnelRow, funnelTotals, missedTradingDays, parsePilot, tagState, tierRank, type TraderFacts,
} from "../usage/funnel";

describe("normaliseView", () => {
  it("keeps plain routes", () => {
    expect(normaliseView("/")).toBe("/");
    expect(normaliseView("/playbook")).toBe("/playbook");
    expect(normaliseView("/academy/path")).toBe("/academy/path");
    expect(normaliseView("/desk-day")).toBe("/desk-day");
  });
  it("replaces ids, dates, tickers and names by placeholders", () => {
    expect(normaliseView("/trades/1234")).toBe("/trades/:id");
    expect(normaliseView("/day-report/2026-10-16")).toBe("/day-report/:date");
    expect(normaliseView("/chart/AAPL/2026-09-16")).toBe("/chart/:ticker/:date");
    expect(normaliseView("/chart/BRK.B")).toBe("/chart/:ticker");
    expect(normaliseView(`/trader/${encodeURIComponent("Кирилл Б.")}`)).toBe("/trader/:param");
    expect(normaliseView("/x/3f2a9c1e-0b7d-4a1e")).toBe("/x/:id");
  });
  it("drops every query value except short ?tab= / ?mode= slugs", () => {
    expect(normaliseView("/desk-day", "?ticker=META&date=2026-09-16")).toBe("/desk-day");
    expect(normaliseView("/ratings", "?tab=quests")).toBe("/ratings?tab=quests");
    expect(normaliseView("/playbook?mode=mine&id=42")).toBe("/playbook?mode=mine");
    expect(normaliseView("/admin", "?tab=" + encodeURIComponent("Кирилл"))).toBe("/admin");
    expect(normaliseView("/trades", "?trader=Kirill&tab=Notes")).toBe("/trades");
    expect(normaliseView("/x", "?mode=today&tab=season")).toBe("/x?tab=season&mode=today");
  });
  it("caps depth, rejects non-paths and is idempotent", () => {
    expect(normaliseView("/a/b/c/d/e/f")).toBe("/a/b/c/d");
    expect(normaliseView("trades")).toBeNull();
    expect(normaliseView("https://evil.example/x")).toBeNull();
    for (const k of ["/trades/:id", "/chart/:ticker/:date?tab=x", "/ratings?tab=quests&mode=a"]) expect(normaliseView(k)).toBe(k);
    expect(normaliseSegment(":param")).toBe(":param");
  });
});

describe("cleanEvent / cleanBatch", () => {
  const now = new Date("2026-10-19T13:00:00Z");
  it("accepts views (normalised) and allow-listed actions with allow-listed meta only", () => {
    expect(cleanEvent({ kind: "view", key: "/trades/77?trader=X" }, now)).toMatchObject({ kind: "view", key: "/trades/:id", meta: null });
    expect(cleanEvent({ kind: "action", key: "trainer.start", meta: { mode: "daily", extra: "x" } }, now)).toMatchObject({ meta: { mode: "daily" } });
    expect(cleanEvent({ kind: "action", key: "trainer.start", meta: { mode: "hack" } }, now)?.meta).toBeNull();
    expect(cleanEvent({ kind: "action", key: "playbook.cheat", meta: { code: "1.3" } }, now)?.meta).toEqual({ code: "1.3" });
    expect(cleanEvent({ kind: "action", key: "playbook.cheat", meta: { code: "Кирилл" } }, now)?.meta).toBeNull();
    expect(cleanEvent({ kind: "action", key: "daily.review", meta: { note: "secret" } }, now)?.meta).toBeNull();
  });
  it("drops unknown action keys, wrong kinds and junk", () => {
    expect(cleanEvent({ kind: "action", key: "admin.delete" }, now)).toBeNull();
    expect(cleanEvent({ kind: "click", key: "/trades" }, now)).toBeNull();
    expect(cleanEvent({ kind: "view", key: "nope" }, now)).toBeNull();
    expect(cleanEvent(null, now)).toBeNull();
    expect(cleanEvent("x", now)).toBeNull();
    expect(cleanEvent({ kind: "view", key: "/" + "a".repeat(400) }, now)).toBeNull();
  });
  it("trusts the client clock only within the window", () => {
    const t = now.getTime() - 20_000;
    expect(cleanEvent({ kind: "view", key: "/", t }, now)?.at.getTime()).toBe(t);
    expect(cleanEvent({ kind: "view", key: "/", t: now.getTime() - 3 * 3600_000 }, now)?.at.getTime()).toBe(now.getTime());
    expect(cleanEvent({ kind: "view", key: "/", t: now.getTime() + 30_000 }, now)?.at.getTime()).toBe(now.getTime());
    expect(cleanEvent({ kind: "view", key: "/", t: "soon" }, now)?.at.getTime()).toBe(now.getTime());
  });
  it("counts what it dropped", () => {
    const r = cleanBatch([{ kind: "view", key: "/a" }, { kind: "action", key: "x.y" }, { kind: "action", key: "quests.tab" }, 5], now);
    expect(r.events.map((e) => e.key)).toEqual(["/a", "quests.tab"]);
    expect(r.dropped).toBe(2);
  });
});

describe("funnel math", () => {
  const days = ["2026-10-15", "2026-10-16", "2026-10-19"];
  // 2026-10-15 13:20Z = 09:20 NY (EDT), 14:00Z = 10:00 NY
  const facts: TraderFacts = {
    visitDays: new Set(["2026-10-15", "2026-10-19"]),
    plans: new Map([
      ["2026-10-15", new Date("2026-10-15T13:20:00Z")], // 09:20 NY → before the open
      ["2026-10-16", new Date("2026-10-16T14:00:00Z")], // 10:00 NY → late
      ["2026-10-19", new Date("2026-10-18T22:00:00Z")], // the evening before → counts
    ]),
    todayOpens: [new Date("2026-10-15T12:00:00Z"), new Date("2026-10-16T15:00:00Z")],
    tags: new Map([["2026-10-15", { trades: 3, tagged: 3 }], ["2026-10-16", { trades: 4, tagged: 1 }]]),
    reviewedDays: new Set(["2026-10-15"]),
    trainerDays: new Set(["2026-10-19"]),
  };
  it("checks each step per day", () => {
    const c = funnelRow(days, facts);
    expect(c.visit).toEqual([true, false, true]);
    expect(c.plan).toEqual([true, false, true]);
    expect(c.today).toEqual([true, false, false]);
    expect(c.traded).toEqual([true, true, false]);
    expect(c.reviewed).toEqual([true, false, false]);
    expect(c.tagged).toEqual(["all", "part", null]);
    expect(c.trainer).toEqual([false, false, true]);
    expect(funnelTotals(c)).toEqual({ visit: 2, plan: 2, today: 1, traded: 2, reviewed: 1, tagged: 1, trainer: 1 });
  });
  it("beforeOpen / tagState", () => {
    expect(beforeOpen(new Date("2026-10-15T13:29:00Z"), "2026-10-15")).toBe(true);
    expect(beforeOpen(new Date("2026-10-15T13:30:00Z"), "2026-10-15")).toBe(false);
    expect(beforeOpen(new Date("2026-10-14T23:00:00Z"), "2026-10-15")).toBe(true);
    expect(tagState(undefined)).toBeNull();
    expect(tagState({ trades: 2, tagged: 0 })).toBe("none");
  });
  it("DAU by role and WAU over 7 days", () => {
    const s = activitySeries(["2026-10-18", "2026-10-19"], [
      { day: "2026-10-12", userId: 9, role: "trader" }, // in the week of 10-18, not of 10-19
      { day: "2026-10-13", userId: 1, role: "trader" },
      { day: "2026-10-19", userId: 2, role: "curator" },
      { day: "2026-10-19", userId: 3, role: "trader" },
    ]);
    expect(s[0]).toEqual({ day: "2026-10-18", dau: 0, wau: 2, byRole: { trader: 0, curator: 0, admin: 0 } });
    expect(s[1]).toEqual({ day: "2026-10-19", dau: 2, wau: 3, byRole: { trader: 1, curator: 1, admin: 0 } });
  });
  it("missed trading days never count today", () => {
    const td = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"];
    expect(missedTradingDays(td, "2026-10-16", "2026-10-19")).toBe(0);
    expect(missedTradingDays(td, "2026-10-13", "2026-10-19")).toBe(3);
    expect(missedTradingDays(td, null, "2026-10-19")).toBe(4);
  });
  it("parsePilot matches stored and Latin names, keeps unknown apart", () => {
    const people = [{ name: "Кирилл Б.", nameLatin: "Kirill B." }, { name: "Егор М." }];
    expect(parsePilot("Кирилл Б., kirill b.;  егор м.\nНикто", people)).toEqual({ names: ["Кирилл Б.", "Егор М."], unknown: ["Никто"] });
    expect(parsePilot("", people)).toEqual({ names: [], unknown: [] });
  });
  it("tier order: trainees first, unknown last", () => {
    expect(["senior", null, "trainee", "junior"].sort((a, b) => tierRank(a) - tierRank(b))).toEqual(["trainee", "junior", "senior", null]);
  });
});

describe("settings: the text type (usage.pilotUsers)", async () => {
  const { validateSetting } = await import("../settings/validate");
  it("trims, strips control characters, caps the length", () => {
    expect(validateSetting("usage.pilotUsers", "  A, B \n")).toEqual({ ok: true, value: "A, B" });
    expect(validateSetting("usage.pilotUsers", 5)).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("usage.pilotUsers", "x".repeat(2001))).toMatchObject({ ok: false, problem: { kind: "length", max: 2000 } });
    expect(validateSetting("usage.retentionDays", 7)).toMatchObject({ ok: false, problem: { kind: "range" } });
  });
});
