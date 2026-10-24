// Dashboard prefs: scope (owner rule 2026-10-21: everyone opens on «Мои»; a «Команда» saved as the old staff default
// moves to «Мои» once, a scope switched by hand is kept) and the composed layout (2026-10-25, v6): every earlier layout
// moves to the new default once, removed ids are dropped, the extras a viewer had switched on stay on.
import { describe, expect, it } from "vitest";
import { defaultPrefs, migrateDashboardPrefs, sanitizeDashboardPrefs } from "./dashboard-prefs";
import { DEFAULT_ORDER } from "./use-dashboard";

describe("sanitizeDashboardPrefs", () => {
  it("defaults to «Мои»", () => {
    expect(sanitizeDashboardPrefs(null, "me").scope).toBe("me");
  });

  it("an old auto-saved staff «Команда» becomes «Мои» with the trader blocks back", () => {
    const p = sanitizeDashboardPrefs({ scope: "team", hidden: ["streaks", "checkin", "brief"] }, "me");
    expect(p.scope).toBe("me");
    expect(p.scopePicked).toBe(false);
    expect(p.hidden).toEqual(["brief"]);
  });

  it("keeps a scope picked by hand", () => {
    const p = sanitizeDashboardPrefs({ scope: "team", scopePicked: true, hidden: ["streaks"] }, "me");
    expect(p.scope).toBe("team");
    expect(p.scopePicked).toBe(true);
    expect(p.hidden).toEqual(["streaks"]);
  });

  it("drops unknown / removed ids and appends missing ones to the order", () => {
    const p = sanitizeDashboardPrefs({ order: ["recent", "todayTile", "nope", "attention"], hidden: ["todayTile", "fees"] }, "me");
    expect(p.order.slice(0, 2)).toEqual(["recent", "attention"]);
    expect(p.order).not.toContain("todayTile");
    expect([...p.order].sort()).toEqual([...DEFAULT_ORDER].sort());
    expect(p.hidden).toEqual(["fees"]);
  });
});

describe("defaultPrefs (the composed dashboard)", () => {
  it("«Мои»: the edge without «Дни недели», no «Сегодня» tile, extras off but the morning check-in", () => {
    const p = defaultPrefs("me");
    expect(p.order).not.toContain("todayTile");
    expect(p.order.indexOf("leaks")).toBeLessThan(p.order.indexOf("streaks"));
    expect(p.hidden).toContain("weekdays");
    expect(p.hidden).not.toContain("leaks");
    expect(p.hidden).not.toContain("checkin");
    expect(p.hidden).toEqual(expect.arrayContaining(["brief", "quote", "sectors", "macro", "dna", "psychology"]));
  });

  it("«Команда»: no own tiles, no extras", () => {
    const p = defaultPrefs("team");
    expect(p.hidden).toEqual(expect.arrayContaining(["leaks", "streaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays", "checkin"]));
    expect(p.hidden).not.toContain("attention");
    expect(p.hidden).not.toContain("desk");
  });
});

describe("migrateDashboardPrefs (v5 / v4 → v6, once)", () => {
  it("v5: the new default order and tiles; scope, period, metric and the extras switched on are kept", () => {
    const v5 = {
      order: ["recent", "todayTile", "weekdays", "attention", "brief"],
      hidden: ["leaks", "fees", "quote", "sectors", "macro", "dna", "psychology"],
      scope: "team",
      scopePicked: true,
      period: "90d",
      metric: "r",
    };
    const p = migrateDashboardPrefs(v5, "me", true);
    expect(p.order).toEqual(DEFAULT_ORDER);
    expect(p.scope).toBe("team");
    expect(p.period).toBe("90d");
    expect(p.metric).toBe("r");
    // The team default hides the own tiles; the brief the viewer had on stays on.
    expect(p.hidden).toContain("leaks");
    expect(p.hidden).not.toContain("brief");
    expect(p.hidden).not.toContain("todayTile");
  });

  it("v5 «Мои»: hidden tiles come back with the new default («Дни недели» quiet)", () => {
    const p = migrateDashboardPrefs({ hidden: ["leaks", "fees", "brief"], period: "week" }, "me", true);
    expect(p.hidden).not.toContain("leaks");
    expect(p.hidden).not.toContain("fees");
    expect(p.hidden).toContain("weekdays");
    // «brief» was hidden in v5 → still hidden; extras never switched on stay off.
    expect(p.hidden).toContain("brief");
  });

  it("v4 (everything was saved on): extras are not carried over", () => {
    const p = migrateDashboardPrefs({ order: ["ritual", "market"], hidden: [] }, "me", false);
    expect(p.hidden).toEqual(defaultPrefs("me").hidden);
  });

  it("garbage → the default", () => {
    expect(migrateDashboardPrefs("x", "me", true)).toEqual(defaultPrefs("me"));
  });
});
