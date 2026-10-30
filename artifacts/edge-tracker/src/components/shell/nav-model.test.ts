// Simple menu for new traders (nav-model.ts): who gets it per tier / desk setting, which rows are primary, and that
// nothing is lost — every page of the full menu is a primary row or sits in «Ещё».
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { ALL_NAV_ITEMS } from "./nav";
import { TIERS, isSimpleNav, mobileTabs, navFeatureOn, pinnedNavItems, simpleNav, visibleNav, type NavPrefs } from "./nav-model";

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

  it("«Ещё» keeps the full-menu order; the ratings' pages become rows", () => {
    expect(s.more.map((r) => r.href)).toEqual([
      // «Лента» is the one child of «Обсуждения» left (the team feed moved into /notifications) → its own row.
      "/risk", "/analytics", "/rules", "/events", "/themes", "/watchlist", "/discussions", "/dailyfeed", "/trade-ideas",
      "/benchmark", "/top-results", "/trade-idea-stats", "/office",
    ]);
    const analytics = s.more.find((r) => r.href === "/analytics")!;
    expect(analytics.children!.map((i) => i.href)).toEqual(["/stats", "/behavior", "/what-if", "/chart-lab", "/ask"]);
    // No staff group for a junior.
    expect(groups.map((g) => g.id)).toEqual(["today", "review", "market", "team", "learn"]);
  });

  it("the hint names the tier the full menu opens at: Трейдер", () => {
    expect(s.opensAt).toBe("trader");
    expect(simpleNav(groups, { simpleUntilTier: "trainee" }).opensAt).toBe("trader");
  });

  it("1.5: the old «Сводка джунов» has no menu entry (the evening summary is the journal); 1.20: the feeds stay in «Ещё»", () => {
    const all = [...flat(s.primary), ...s.moreItems.map((i) => i.href)];
    expect(all).not.toContain("/junior-notes");
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).not.toContain("/junior-notes");
    expect(s.moreItems.map((i) => i.href)).toEqual(expect.arrayContaining(["/dailyfeed"]));
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

describe("mobileTabs (phone dock)", () => {
  it("everyone: Главная, Сделки, Дневник, Аналитика, Риск (6th slot = «Ещё»); juniors see the journal as «Вечер»", async () => {
    const groups = visibleNav(false);
    const simpleModel = simpleNav(groups);
    const dock = ["/", "/trades", "/journal", "/analytics", "/risk"];
    expect(mobileTabs(groups, null).map((i) => i.href)).toEqual(dock);
    expect(mobileTabs(visibleNav(true), null).map((i) => i.href)).toEqual(dock);
    expect(mobileTabs(groups, simpleModel).map((i) => i.href)).toEqual(dock);
    expect(mobileTabs(groups, null).map((i) => i.short ?? i.name)).toEqual(["Главная", "Сделки", "Дневник", "Аналитика", "Риск"]);
    expect(mobileTabs(groups, simpleModel).map((i) => i.short ?? i.name)[2]).toBe("Вечер");
    // Only the tab is relabelled: the sidebar rows keep «Дашборд» / «Дневник».
    expect(simpleModel.primary.find((i) => i.href === "/journal")!.name).toBe("Дневник");
    expect(groups[0]!.items.find((i) => i.href === "/")!.name).toBe("Дашборд");
    await setLang("en", { source: "init" });
    expect(mobileTabs(groups, null).map((i) => i.short ?? i.name)[0]).toBe("Home");
    expect(mobileTabs(groups, simpleModel).map((i) => i.short ?? i.name)[2]).toBe("Evening");
    await setLang("uz", { source: "init" });
    expect(mobileTabs(groups, null).map((i) => i.short ?? i.name)[0]).toBe("Asosiy");
    expect(mobileTabs(groups, simpleModel).map((i) => i.short ?? i.name)[2]).toBe("Kechqurun");
  });

  it("a screen closed for the stage is left out of the dock (reachable nowhere, so no dead tab)", () => {
    const nav = { blocked: ["/risk", "/analytics"] };
    expect(mobileTabs(visibleNav(false, nav), null).map((i) => i.href)).toEqual(["/", "/trades", "/journal"]);
  });

  it("the sheet lists the rest: dock screens out, their children kept (juniors' Разбор дня moves up)", async () => {
    const { withoutDock, simpleWithoutDock, sheetPrimaryItems } = await import("./nav-model");
    const groups = visibleNav(false);
    const dock = mobileTabs(groups, null).map((i) => i.href);
    const rest = withoutDock(groups, dock).flatMap((g) => g.items.map((i) => i.href));
    for (const h of dock) expect(rest).not.toContain(h);
    expect(rest).toEqual(expect.arrayContaining(["/stats", "/behavior", "/day-report", "/game-plan", "/playbook"]));
    expect(withoutDock(groups, dock)[0]!.label).toBe(groups[0]!.label);
    const s = simpleWithoutDock(simpleNav(groups), dock);
    const primary = sheetPrimaryItems(s).map((i) => i.href);
    expect(primary).toContain("/game-plan");
    expect(primary).toContain("/day-report");
    for (const h of dock) expect(primary).not.toContain(h);
    for (const h of dock) expect(s.moreItems.map((i) => i.href)).not.toContain(h);
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
  it("«Закреплённые»: pins this viewer may open, in pin order; staff-only, hidden and closed pages never show", () => {
    expect(pinnedNavItems(["/office", "/stats"], false, {}).map((i) => i.href)).toEqual(["/office", "/stats"]);
    expect(pinnedNavItems(["/scaling", "/office"], false, {}).map((i) => i.href)).toEqual(["/office"]);
    expect(pinnedNavItems(["/scaling"], true, {}).map((i) => i.href)).toEqual(["/scaling"]);
    expect(pinnedNavItems(["/junior-notes", "/nope"], true, {})).toEqual([]);
    expect(pinnedNavItems(["/office"], false, { blocked: ["/office"] })).toEqual([]);
    // Listed once: taken out of its row's list.
    const ratings = visibleNav(false).flatMap((g) => g.rows).find((r) => r.href === "/ratings")!;
    expect(withoutPinned(ratings.children!, ["/office"]).map((i) => i.href)).toEqual(["/benchmark", "/top-results", "/trade-idea-stats"]);
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

describe("nav-structure: menus per role", () => {
  const rows = (groups: ReturnType<typeof visibleNav>) => groups.map((g) => [g.id, g.rows.map((r) => r.href)]);

  it("trader / senior: five groups, 17 rows, no «Управление»", () => {
    const groups = visibleNav(false);
    expect(rows(groups)).toEqual([
      ["today", ["/", "/game-plan", "/trades", "/risk"]],
      ["review", ["/journal", "/analytics", "/playbook", "/rules"]],
      ["market", ["/events", "/themes", "/watchlist"]],
      ["team", ["/discussions", "/dailyfeed", "/trade-ideas", "/ratings"]],
      ["learn", ["/academy/my", "/trainer"]],
    ]);
    expect(groups.flatMap((g) => g.rows).length).toBe(17);
  });

  it("curator / admin: «Управление» right under «Сегодня», the cabinet first", () => {
    const groups = visibleNav(true);
    expect(groups.map((g) => g.id)).toEqual(["today", "manage", "review", "market", "team", "learn"]);
    const manage = groups[1]!;
    expect(manage.rows.map((r) => r.href)).toEqual(["/curator", "/admin"]);
    expect(manage.items.map((i) => i.href)).toEqual(["/curator", "/academy/mentor", "/scaling", "/admin", "/integrations", "/academy/content-admin"]);
    // The staff member's own learning stays with the trader pages.
    expect(groups.find((g) => g.id === "learn")!.items.map((i) => i.href)).toEqual([
      "/academy/my", "/academy/learn", "/academy/path", "/academy/challenges", "/academy/cohorts", "/guide", "/trainer",
    ]);
  });

  it("no single-item sub-menu: a row left with one open child lists it as a row right below", () => {
    const groups = visibleNav(false, { blocked: ["/analyst-actions"] });
    const market = groups.find((g) => g.id === "market")!;
    expect(market.rows.map((r) => r.href)).toEqual(["/events", "/offerings", "/themes", "/watchlist"]);
    expect(market.rows[0]!.children).toBeUndefined();
    // The shared item keeps its children (only the copy changes) and the copy keeps its label getter.
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/events")!.children!.length).toBe(2);
    expect(market.rows[0]!.name).toBe("Катализаторы");
    // Nothing anywhere opens a list of one, for either role.
    for (const staff of [false, true]) {
      for (const r of visibleNav(staff).flatMap((g) => g.rows)) expect(r.children === undefined || r.children.length > 1).toBe(true);
    }
  });

  it("every page of the full menu is reachable in at most two clicks (a row, or a row's child)", () => {
    for (const staff of [false, true]) {
      const groups = visibleNav(staff);
      const reach = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
      const all = ALL_NAV_ITEMS.filter((i) => !i.hidden && !i.feature && (staff || !i.staff)).map((i) => i.href);
      expect(all.filter((h) => !reach.has(h))).toEqual([]);
    }
  });
});
