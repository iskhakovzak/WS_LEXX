// Sections closed per ladder stage (GET /api/permissions/me → nav.blocked): the menu drops them everywhere (a closed
// row's open pages move up as rows), the palette / pinned rule `navItemOpen` agrees, the route guard finds the closed
// section of a URL (own page, sub-paths, `also` paths, /desk-day), and the admin table lists what a trader can see.
import { describe, expect, it } from "vitest";
import { isSectionBlocked } from "@/lib/permissions";
import { ALL_NAV_ITEMS } from "./nav";
import { blockableSections, blockedSectionOf, navItemOpen, simpleNav, stageOfTier, visibleNav } from "./nav-model";

const flat = (groups: ReturnType<typeof visibleNav>) => groups.flatMap((g) => g.items.map((i) => i.href));
const item = (href: string) => ALL_NAV_ITEMS.find((i) => i.href === href)!;

describe("visibleNav with closed sections", () => {
  it("nothing closed (the default) → the same menu as without the flag", () => {
    expect(flat(visibleNav(false, { blocked: [] }))).toEqual(flat(visibleNav(false, {})));
    expect(flat(visibleNav(false, undefined))).toEqual(flat(visibleNav(false, { simpleForTrainees: true })));
  });

  it("a closed page is gone; a closed row keeps its open children as rows of their own", () => {
    const groups = visibleNav(false, { blocked: ["/top-results", "/ratings"] });
    const hrefs = flat(groups);
    expect(hrefs).not.toContain("/top-results");
    expect(hrefs).not.toContain("/ratings");
    expect(hrefs).toEqual(expect.arrayContaining(["/benchmark", "/office"]));
    const team = groups.find((g) => g.id === "team")!;
    expect(team.rows.map((r) => r.href)).toEqual(expect.arrayContaining(["/benchmark", "/office"]));
    // The simple menu loses «Мой прогресс» (it is the ratings page) and keeps the rest.
    const simple = simpleNav(groups);
    expect(simple.primary.map((i) => i.href)).not.toContain("/ratings");
    expect(simple.moreItems.map((i) => i.href)).toEqual(expect.arrayContaining(["/benchmark", "/office"]));
    expect(simple.moreItems.map((i) => i.href)).not.toContain("/top-results");
  });

  it("navItemOpen (palette, pinned): closed → false; staff pages and switches as before", () => {
    const nav = { blocked: ["/discussions"], authorNotes: false };
    expect(navItemOpen(item("/discussions"), false, nav)).toBe(false);
    expect(navItemOpen(item("/dailyfeed"), false, nav)).toBe(true);
    expect(navItemOpen(item("/author-notes"), false, nav)).toBe(false);
    expect(navItemOpen(item("/curator"), false, nav)).toBe(false);
    expect(navItemOpen(item("/curator"), true, nav)).toBe(true);
    expect(isSectionBlocked(nav, "/discussions")).toBe(true);
    expect(isSectionBlocked({ blocked: "nope" }, "/discussions")).toBe(false);
  });
});

describe("route guard: blockedSectionOf", () => {
  const nav = { blocked: ["/top-results", "/rules", "/trainer", "/desk-day", "/trade-ideas", "/"] };

  it("the page, its sub-paths and its `also` paths; never a page whose href merely starts the same", () => {
    expect(blockedSectionOf("/top-results", nav)).toBe("/top-results");
    expect(blockedSectionOf("/error-tracker", nav)).toBe("/rules");
    expect(blockedSectionOf("/simulator", nav)).toBe("/trainer");
    expect(blockedSectionOf("/desk-day/AAPL/2026-10-20", nav)).toBe("/desk-day");
    expect(blockedSectionOf("/trade-ideas", nav)).toBe("/trade-ideas");
    expect(blockedSectionOf("/trade-idea-stats", nav)).toBeNull();
    expect(blockedSectionOf("/trades", nav)).toBeNull();
  });

  it("the home page is never closed; nothing closed → null", () => {
    expect(blockedSectionOf("/", nav)).toBeNull();
    expect(blockedSectionOf("/top-results", {})).toBeNull();
    expect(blockedSectionOf("/top-results", undefined)).toBeNull();
  });

  it("the closed page names the viewer's stage (lead → senior, none → junior)", () => {
    expect(stageOfTier("lead")).toBe("senior");
    expect(stageOfTier("trader")).toBe("trader");
    expect(stageOfTier(null)).toBe("junior");
    expect(stageOfTier("trainee")).toBe("junior");
  });
});

describe("blockableSections (admin table rows)", () => {
  it("grouped as in the sidebar: no staff pages, no hidden ones, no desk switches, no home page; + /desk-day", () => {
    const groups = blockableSections();
    const hrefs = groups.flatMap((g) => g.sections.map((s) => s.href));
    expect(hrefs).not.toContain("/");
    expect(hrefs).not.toContain("/curator");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/junior-notes");
    expect(hrefs).not.toContain("/author-notes");
    expect(hrefs).toEqual(expect.arrayContaining(["/top-results", "/ratings", "/discussions", "/dailyfeed", "/office", "/benchmark", "/trade-ideas", "/desk-day"]));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(groups.map((g) => g.id)).not.toContain("manage");
    const team = groups.find((g) => g.id === "team")!;
    expect(team.sections.find((s) => s.href === "/benchmark")?.parent).toBe("/ratings");
    expect(team.sections.find((s) => s.href === "/ratings")?.parent).toBeNull();
    expect(team.sections.find((s) => s.href === "/top-results")?.label).toBeTruthy();
  });
});
