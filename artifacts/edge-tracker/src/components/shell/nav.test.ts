import { afterEach, describe, expect, it } from "vitest";
import { NAV_GROUPS, ALL_NAV_ITEMS, routeTitle } from "./nav";
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
  it("staff-only groups have a member label for what a trader still sees", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!;
    expect(admin.items.some((i) => !i.staff)).toBe(true);
    expect(admin.memberLabel).toBe("Аккаунт");
  });

  it("every item has a label and unique href / go key", () => {
    expect(ALL_NAV_ITEMS.every((i) => i.name && i.name !== `nav.${i.key}`)).toBe(true);
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.href)).size).toBe(ALL_NAV_ITEMS.length);
    const keys = ALL_NAV_ITEMS.flatMap((i) => (i.goKey ? [i.goKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
