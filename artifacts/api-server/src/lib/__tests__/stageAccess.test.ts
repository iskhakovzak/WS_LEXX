/**
 * Stage access (owner 2026-10-21): the two desk settings (access.sections, privacy.namesVisibleTo) validate like every
 * other setting; the names helper (lib/access/names) follows the saved list per stage and falls back to the legacy
 * switch privacy.hideNamesFromTraders while the list was never saved; the section table (lib/access/sections) maps API
 * paths to web sections by the longest prefix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tiers = vi.hoisted(() => ({ map: {} as Record<string, string | null>, calls: 0 }));
vi.mock("../playbookToday/tier", () => ({
  viewerTier: vi.fn(async (name: string) => { tiers.calls++; return tiers.map[name] ?? null; }),
  forgetTier: vi.fn(),
}));

const { __loadSettingsCache, setting, settingStored } = await import("../settings/registry");
const { sameStored, validateBatch, validateSetting } = await import("../settings/validate");
const { namesVisible, namesVisibleFor, namesVisibleStages } = await import("../access/names");
const { accessStageOf } = await import("../access/stage");
const { blockedSectionsFor, isSectionBlocked, sectionOfApiPath } = await import("../access/sections");

beforeEach(() => { tiers.map = { "Джун А.": "junior", "Трейдер Б.": "trader", "Сеньор В.": "senior", "Лид Г.": "lead", "Стажёр Д.": "trainee" }; tiers.calls = 0; });
afterEach(() => __loadSettingsCache({}));

describe("settings validation", () => {
  it("privacy.namesVisibleTo: a list of known stages, stored once each in ladder order", () => {
    expect(validateSetting("privacy.namesVisibleTo", ["senior", "junior", "senior"])).toEqual({ ok: true, value: ["junior", "senior"] });
    expect(validateSetting("privacy.namesVisibleTo", [])).toEqual({ ok: true, value: [] });
    expect(validateSetting("privacy.namesVisibleTo", ["lead"])).toMatchObject({ ok: false, problem: { kind: "option" } });
    expect(validateSetting("privacy.namesVisibleTo", "senior")).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("privacy.namesVisibleTo", [1])).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("privacy.namesVisibleTo", null)).toEqual({ ok: true, value: null });
  });

  it("access.sections: href → stages; sorted, empty lists dropped; bad href / stage / shape / size rejected", () => {
    expect(validateSetting("access.sections", { "/top-results": ["trader", "junior"], "/benchmark": [], "/academy/learn": ["senior"] }))
      .toEqual({ ok: true, value: { "/academy/learn": ["senior"], "/top-results": ["junior", "trader"] } });
    expect(validateSetting("access.sections", {})).toEqual({ ok: true, value: {} });
    expect(validateSetting("access.sections", { "/": ["junior"] })).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("access.sections", { "top": ["junior"] })).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("access.sections", { "/Top": ["junior"] })).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("access.sections", { "/top-results": ["guest"] })).toMatchObject({ ok: false, problem: { kind: "option" } });
    expect(validateSetting("access.sections", { "/top-results": "junior" })).toMatchObject({ ok: false, problem: { kind: "type" } });
    expect(validateSetting("access.sections", ["/top-results"])).toMatchObject({ ok: false, problem: { kind: "type" } });
    const many = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`/s${i}`, ["junior"]]));
    expect(validateSetting("access.sections", many)).toMatchObject({ ok: false, problem: { kind: "length", max: 60 } });
  });

  it("a batch with both keys passes; sameStored compares lists and maps by content", () => {
    expect(validateBatch([{ key: "access.sections", value: { "/office": ["junior"] } }, { key: "privacy.namesVisibleTo", value: ["senior"] }]).ok).toBe(true);
    expect(sameStored(["junior"], ["junior"])).toBe(true);
    expect(sameStored({ "/a": ["junior"] }, { "/a": ["junior"] })).toBe(true);
    expect(sameStored({ "/a": ["junior"] }, { "/a": ["trader"] })).toBe(false);
    expect(sameStored([], null)).toBe(false);
  });

  it("defaults: everything open, names follow the legacy switch (stored → settingStored)", () => {
    expect(setting("access.sections")).toEqual({});
    expect(setting("privacy.namesVisibleTo")).toEqual([]);
    expect(settingStored("privacy.namesVisibleTo")).toBe(false);
    __loadSettingsCache({ "privacy.namesVisibleTo": ["senior"] });
    expect(settingStored("privacy.namesVisibleTo")).toBe(true);
  });
});

describe("names helper", () => {
  const traders = ["Джун А.", "Трейдер Б.", "Сеньор В."];
  const seen = async () => Promise.all(traders.map((name) => namesVisible({ name, staff: false })));

  it("legacy fallback: switch on (default) → nobody; off → every stage (no stage lookups)", async () => {
    expect(namesVisibleStages()).toEqual([]);
    expect(await seen()).toEqual([false, false, false]);
    __loadSettingsCache({ "privacy.hideNamesFromTraders": false });
    expect(namesVisibleStages()).toEqual(["junior", "trader", "senior"]);
    expect(await seen()).toEqual([true, true, true]);
    expect(await namesVisible({ name: null, staff: false })).toBe(true); // a guest too, exactly as the old «off»
    expect(tiers.calls).toBe(0);
  });

  it("a saved list wins over the legacy switch, per stage («lead» counts as senior)", async () => {
    __loadSettingsCache({ "privacy.namesVisibleTo": ["senior"], "privacy.hideNamesFromTraders": false });
    expect(await seen()).toEqual([false, false, true]);
    expect(await namesVisible({ name: "Лид Г.", staff: false })).toBe(true);
    expect(await namesVisible({ name: null, staff: false })).toBe(false);
    __loadSettingsCache({ "privacy.namesVisibleTo": [], "privacy.hideNamesFromTraders": false });
    expect(await seen()).toEqual([false, false, false]);
  });

  it("staff always see names; a trader without a stage counts as junior; legacy «trainee» is junior", async () => {
    __loadSettingsCache({ "privacy.namesVisibleTo": ["junior"] });
    expect(await namesVisible({ name: "Куратор", staff: true })).toBe(true);
    expect(await namesVisible({ name: "Новичок", staff: false })).toBe(true);
    expect(await namesVisible({ name: "Стажёр Д.", staff: false })).toBe(true);
    expect(await namesVisible({ name: "Трейдер Б.", staff: false })).toBe(false);
    expect(namesVisibleFor({ staff: true, stage: null }, [])).toBe(true);
    expect(namesVisibleFor({ staff: false, stage: null }, ["junior"])).toBe(false);
    expect(accessStageOf("lead")).toBe("senior");
    expect(accessStageOf(null)).toBe("junior");
  });
});

describe("section table", () => {
  it("longest prefix wins; /dailyfeed/stream is never blocked; no false prefix matches", () => {
    expect(sectionOfApiPath("/top/day/2026-10-20")).toBe("/top-results");
    expect(sectionOfApiPath("/top")).toBe("/top-results");
    expect(sectionOfApiPath("/topics")).toBeNull();
    expect(sectionOfApiPath("/trade-ideas/12/comments")).toBe("/trade-ideas");
    expect(sectionOfApiPath("/trade-ideas/stats")).toBe("/trade-idea-stats");
    expect(sectionOfApiPath("/dailyfeed/5")).toBe("/dailyfeed");
    expect(sectionOfApiPath("/dailyfeed/stream")).toBeNull();
    expect(sectionOfApiPath("/dailyfeed/stream/seen")).toBeNull();
    expect(sectionOfApiPath("/leaderboard")).toBe("/ratings");
    expect(sectionOfApiPath("/office-stats/capital")).toBe("/office");
    expect(sectionOfApiPath("/desk-day/AAPL/2026-10-20")).toBe("/desk-day");
    expect(sectionOfApiPath("/trades")).toBeNull();
  });

  it("blocked hrefs per stage; staff (null) never", () => {
    __loadSettingsCache({ "access.sections": { "/top-results": ["junior", "trader"], "/office": ["junior"] } });
    expect(blockedSectionsFor("junior")).toEqual(["/office", "/top-results"]);
    expect(blockedSectionsFor("trader")).toEqual(["/top-results"]);
    expect(blockedSectionsFor("senior")).toEqual([]);
    expect(blockedSectionsFor(null)).toEqual([]);
    expect(isSectionBlocked("/office", "junior")).toBe(true);
    expect(isSectionBlocked("/office", null)).toBe(false);
    expect(isSectionBlocked(null, "junior")).toBe(false);
  });
});
