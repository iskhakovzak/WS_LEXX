// Simple menu for new traders (nav-model.ts): who gets it per tier / desk setting, which rows are primary, and that
// nothing is lost — every page of the full menu is a primary row or sits in «Ещё».
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { ALL_NAV_ITEMS, rowChildren } from "./nav";
import { TIERS, isSimpleNav, mobileTabs, navFeatureOn, simpleNav, visibleNav, type NavPrefs } from "./nav-model";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const flat = (rows: { href: string; children?: { href: string }[] }[]) => rows.flatMap((r) => [r.href, ...(r.children ?? []).map((c) => c.href)]);

describe("isSimpleNav", () => {
  const who = (tier: string | null, prefs?: Partial<NavPrefs> | null, role = "trader") => isSimpleNav({ role, tier, prefs });

  it("1.11: juniors (the stage default) get the simple menu; a trader without a resolved tier counts as a junior", () => {
    expect(TIERS.filter((t) => who(t))).toEqual(["trainee", "junior"]);
    expect(who("junior")).toBe(true);
    expect(who(null)).toBe(true);
    expect(who(undefined as unknown as null)).toBe(true);
  });

  it("experienced traders (Трейдер, Сеньор, lead) keep the full menu", () => {
    expect(who("trader")).toBe(false);
    expect(who("senior")).toBe(false);
    expect(who("lead")).toBe(false);
  });

  it("an old «trainee» desk setting still means newcomers = juniors; the setting off → full menu for everyone", () => {
    expect(TIERS.filter((t) => who(t, { simpleUntilTier: "trainee" }))).toEqual(["trainee", "junior"]);
    expect(TIERS.filter((t) => who(t, { simpleUntilTier: "junior" }))).toEqual(["trainee", "junior"]);
    expect(TIERS.filter((t) => who(t, { simpleForTrainees: false }))).toEqual([]);
    expect(who(null, { simpleForTrainees: false })).toBe(false);
  });

  it("staff and guests always keep the full menu", () => {
    for (const role of ["curator", "admin", "guest"]) expect(who("trainee", { simpleUntilTier: "junior" }, role)).toBe(false);
  });
});

describe("simpleNav", () => {
  const groups = visibleNav(false);
  const s = simpleNav(groups);

  it("eight primary rows in the owner's order, labels adapted", () => {
    expect(s.primary.map((i) => i.href)).toEqual(["/", "/game-plan", "/playbook", "/trainer", "/academy/my", "/journal", "/trades", "/ratings"]);
    expect(s.primary.map((i) => i.name)).toEqual(["Дашборд", "План дня", "Плейбук", "Тренажёр", "Моё обучение", "Дневник", "Сделки", "Квесты и достижения"]);
    const progress = s.primary.at(-1)!;
    expect(progress.to).toBe("/ratings?tab=quests");
    expect(progress.children).toBeUndefined();
    // The shared nav items keep their own names (the copies are relabelled, not the originals).
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/")!.name).toBe("Дашборд");
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/ratings")!.name).toBe("Рейтинги");
  });

  it("nothing removed: every page of the full menu is primary or in «Ещё», once", () => {
    const full = groups.flatMap((g) => g.items.map((i) => i.href));
    const simpleAll = [...flat(s.primary), ...s.moreItems.map((i) => i.href)];
    expect([...simpleAll].sort()).toEqual([...full].sort());
    expect(new Set(simpleAll).size).toBe(simpleAll.length);
    expect(s.moreItems.map((i) => i.href)).toEqual(flat(s.more));
  });

  it("«Ещё» keeps the full-menu order; the trainer leaves the tools hub, the ratings' pages become rows", () => {
    expect(s.more.map((r) => r.href)).toEqual([
      "/risk", "/rules", "/analytics", "/chart-lab", "/events", "/themes", "/watchlist", "/discussions", "/trade-ideas",
      "/benchmark", "/top-results", "/office",
    ]);
    const tools = s.more.find((r) => r.href === "/chart-lab")!;
    expect(rowChildren(tools).map((i) => i.href)).toEqual(["/chart-lab", "/calculator"]);
    // The full menu is untouched.
    expect(rowChildren(ALL_NAV_ITEMS.find((i) => i.href === "/chart-lab")!).map((i) => i.href)).toEqual(["/chart-lab", "/trainer", "/calculator"]);
  });

  it("the hint names the tier the full menu opens at: Трейдер", () => {
    expect(s.opensAt).toBe("trader");
    expect(simpleNav(groups, { simpleUntilTier: "trainee" }).opensAt).toBe("trader");
  });

  it("1.5: the old «Сводка джунов» has no menu entry (the evening summary is the journal); 1.20: the feeds stay in «Ещё»", () => {
    const all = [...flat(s.primary), ...s.moreItems.map((i) => i.href)];
    expect(all).not.toContain("/junior-notes");
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).not.toContain("/junior-notes");
    expect(s.moreItems.map((i) => i.href)).toEqual(expect.arrayContaining(["/dailyfeed", "/activity"]));
    expect(s.primary.map((i) => i.href)).not.toContain("/dailyfeed");
    // The legacy page is still titled (old links keep working).
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/junior-notes")!.hidden).toBe(true);
  });

  it("labels follow the UI language", async () => {
    await setLang("uz", { source: "init" });
    expect(s.primary[0]!.name).toBe("Boshqaruv paneli");
    expect(s.primary.at(-1)!.name).toBe("Kvestlar va yutuqlar");
  });
});

describe("mobileTabs", () => {
  it("juniors: Дашборд, План, Вечер (the journal), Сделки; full: Дашборд, План, Сделки, Дневник (5th slot = «Ещё»)", async () => {
    const groups = visibleNav(false);
    const simpleModel = simpleNav(groups);
    const simple = mobileTabs(groups, simpleModel);
    expect(simple.map((i) => i.href)).toEqual(["/", "/game-plan", "/journal", "/trades"]);
    expect(simple.map((i) => i.short ?? i.name)).toEqual(["Дашборд", "План", "Вечер", "Сделки"]);
    // Only the tab is relabelled: the sidebar row keeps «Дневник».
    expect(simpleModel.primary.find((i) => i.href === "/journal")!.name).toBe("Дневник");
    await setLang("en", { source: "init" });
    expect(mobileTabs(groups, simpleModel).map((i) => i.short ?? i.name)[2]).toBe("Evening");
    await setLang("uz", { source: "init" });
    expect(mobileTabs(groups, simpleModel).map((i) => i.short ?? i.name)[2]).toBe("Kechqurun");
    await setLang("ru", { source: "init" });
    expect(mobileTabs(groups, null).map((i) => i.href)).toEqual(["/", "/game-plan", "/trades", "/journal"]);
    expect(mobileTabs(visibleNav(true), null).map((i) => i.href)).toEqual(["/", "/game-plan", "/trades", "/journal"]);
  });
});

describe("phone sheet (ILYA-18, OWNER-28)", async () => {
  const { sheetPrimaryItems, withoutPinned } = await import("./nav-model");
  const groups = visibleNav(false);
  const s = simpleNav(groups);
  it("lists every primary row with its children, like the desktop sidebar", () => {
    const hrefs = sheetPrimaryItems(s).map((i) => i.href);
    expect(hrefs).toEqual(flat(s.primary));
    for (const r of s.primary) for (const c of r.children ?? []) expect(hrefs).toContain(c.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("desktop row: a pinned child is rendered once, open or closed", async () => {
    const { rowKidLists } = await import("./nav-model");
    const kids = [{ href: "/ratings" }, { href: "/office" }];
    const pinned = (h: string) => h === "/office";
    expect(rowKidLists(kids, true, pinned)).toEqual({ list: kids, pinned: [] });
    expect(rowKidLists(kids, false, pinned)).toEqual({ list: [{ href: "/ratings" }], pinned: [{ href: "/office" }] });
  });
  it("a pinned page shows once (in favourites)", () => {
    const items = [{ href: "/a" }, { href: "/office" }, { href: "/b" }];
    expect(withoutPinned(items, ["/office"]).map((i) => i.href)).toEqual(["/a", "/b"]);
    expect(withoutPinned(items, [])).toEqual(items);
  });
});

describe("sections behind a desk switch (Волна 2 п. 2.15)", () => {
  const hrefs = (nav?: unknown) => visibleNav(true, nav).flatMap((g) => g.items.map((i) => i.href));

  it("«Сводка автора» is in the menu only while nav.authorNotes is on (default off)", () => {
    expect(hrefs()).not.toContain("/author-notes");
    expect(hrefs({ simpleForTrainees: true, simpleUntilTier: "junior" })).not.toContain("/author-notes");
    expect(hrefs({ authorNotes: false })).not.toContain("/author-notes");
    expect(hrefs({ authorNotes: true })).toContain("/author-notes");
  });

  it("an item without a switch is always on", () => {
    expect(navFeatureOn(undefined, null)).toBe(true);
    expect(navFeatureOn("authorNotes", { authorNotes: "yes" })).toBe(false);
  });
});
