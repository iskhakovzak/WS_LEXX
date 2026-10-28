import { afterEach, describe, expect, it } from "vitest";
import { NAV_GROUPS, ALL_NAV_ITEMS, GO_KEYS, GO_KEYS_RU_LAYOUT, groupOf, parentOf, routeTitle } from "./nav";
import { setLang } from "@/i18n";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

describe("routeTitle", () => {
  it("names sections from the nav", () => {
    expect(routeTitle("/watchlist")).toBe("Вотчлист");
    expect(routeTitle("/trade-idea-stats")).toBe("Статистика идей");
    expect(routeTitle("/error-tracker")).toBe("Правила");
    expect(routeTitle("/nope")).toBeNull();
  });

  it("tells /academy/lesson sub-views apart by the query string", () => {
    expect(routeTitle("/academy/lesson", "?quiz=3")).toBe("Тест");
    expect(routeTitle("/academy/lesson", "?assignment=7&user=x")).toBe("Задание");
    expect(routeTitle("/academy/lesson", "?id=2")).toBe("Урок");
    expect(routeTitle("/academy/lesson")).toBe("Урок");
  });

  it("follows the UI language", async () => {
    await setLang("en", { source: "init" });
    expect(routeTitle("/watchlist")).toBe("Watchlist");
    expect(routeTitle("/academy/lesson", "?quiz=3")).toBe("Quiz");
    await setLang("uz", { source: "init" });
    expect(routeTitle("/trades")).toBe("Savdolar");
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/trades")!.ruName).toBe("Сделки");
  });
});

describe("nav groups", () => {
  const rows = (staff: boolean) => NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.hidden && (staff || !i.staff));

  it("keeps the sidebar short: ~15 rows for a trader, a few more for staff", () => {
    expect(rows(false).length).toBeLessThanOrEqual(16);
    expect(rows(true).length).toBeLessThanOrEqual(18);
    // Every page but the header ones (settings, notifications) is reachable from the sidebar in one or two clicks.
    expect(ALL_NAV_ITEMS.filter((i) => !i.hidden).every((i) => rows(true).includes(i) || !!parentOf(i))).toBe(true);
  });

  it("second-level pages know their row and group", () => {
    expect(parentOf(ALL_NAV_ITEMS.find((i) => i.href === "/stats")!)!.name).toBe("Аналитика");
    expect(parentOf(ALL_NAV_ITEMS.find((i) => i.href === "/trade-idea-stats")!)!.href).toBe("/ratings");
    expect(groupOf(ALL_NAV_ITEMS.find((i) => i.href === "/scaling")!)!.id).toBe("manage");
    expect(groupOf(ALL_NAV_ITEMS.find((i) => i.href === "/settings")!)).toBeUndefined();
  });

  it("nav-structure: five groups for a trader, six for staff, in the order of the day", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["today", "manage", "review", "market", "team", "learn"]);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Сегодня", "Управление", "Разбор", "Рынок", "Команда", "Обучение"]);
    const rowsOf = (id: string) => NAV_GROUPS.find((g) => g.id === id)!.items.map((i) => i.href);
    expect(rowsOf("today")).toEqual(["/", "/game-plan", "/trades", "/risk"]);
    expect(rowsOf("manage")).toEqual(["/curator", "/admin"]);
    expect(rowsOf("review")).toEqual(["/journal", "/analytics", "/playbook", "/rules"]);
    expect(rowsOf("team")).toEqual(["/discussions", "/trade-ideas", "/ratings"]);
    expect(rowsOf("learn")).toEqual(["/academy/my", "/trainer"]);
    // «Управление» is staff only, page by page (a trader never gets an empty group).
    expect(NAV_GROUPS.find((g) => g.id === "manage")!.items.flatMap((r) => [r, ...(r.children ?? [])]).every((i) => i.staff)).toBe(true);
  });

  it("every analysis tool sits under «Аналитика»; the old «Инструменты» grab-bag is gone", () => {
    const kids = (href: string) => ALL_NAV_ITEMS.find((i) => i.href === href)!.children!.map((c) => c.href);
    expect(kids("/analytics")).toEqual(["/stats", "/behavior", "/what-if", "/chart-lab", "/ask"]);
    expect(kids("/journal")).toEqual(["/day-report", "/weekly-review", "/season-report", "/my-review", "/coach"]);
    expect(kids("/ratings")).toEqual(["/benchmark", "/top-results", "/trade-idea-stats", "/office"]);
    expect(kids("/watchlist")).toEqual(["/big7", "/indicators", "/calculator"]);
    expect(kids("/curator")).toEqual(["/academy/mentor", "/scaling"]);
    expect(kids("/admin")).toEqual(["/integrations", "/academy/content-admin"]);
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/risk")!.children).toBeUndefined();
    expect(ALL_NAV_ITEMS.find((i) => i.href === "/trade-ideas")!.children).toBeUndefined();
  });

  it("one icon per page (no two sections share a glyph)", () => {
    const shown = ALL_NAV_ITEMS.filter((i) => !i.hidden);
    expect(new Set(shown.map((i) => i.icon)).size).toBe(shown.length);
  });

  it("«Темы рынка» is a row of the market group, between catalysts and the watchlist", async () => {
    const market = NAV_GROUPS.find((g) => g.id === "market")!;
    expect(market.items.map((i) => i.href)).toEqual(["/events", "/themes", "/watchlist"]);
    expect(routeTitle("/themes")).toBe("Темы рынка");
    await setLang("en", { source: "init" });
    expect(routeTitle("/themes")).toBe("Market themes");
  });

  it("every item has a label and unique href / go key", () => {
    expect(ALL_NAV_ITEMS.every((i) => i.name && i.name !== `nav.${i.key}`)).toBe(true);
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.href)).size).toBe(ALL_NAV_ITEMS.length);
    const keys = ALL_NAV_ITEMS.flatMap((i) => (i.goKey ? [i.goKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every quick-jump letter also works on the Russian layout", () => {
    const mapped = new Set(Object.values(GO_KEYS_RU_LAYOUT));
    expect(Object.keys(GO_KEYS).filter((k) => !mapped.has(k))).toEqual([]);
  });
});
