// Dashboard scope (owner rule 2026-10-21): everyone opens on «Мои»; a «Команда» saved as the old staff default moves
// to «Мои» once (with streaks / check-in back on), a scope switched by hand is kept.
import { describe, expect, it } from "vitest";
import { sanitizeDashboardPrefs } from "./dashboard-prefs";

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
});
