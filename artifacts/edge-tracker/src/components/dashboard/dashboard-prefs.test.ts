// Dashboard view prefs: scope (owner rule 2026-10-21: everyone opens on «Мои»; a «Команда» saved as the old staff
// default moves to «Мои» once, a scope switched by hand is kept), the curve's window and unit. The layout itself is
// tested in layout-model.test.ts.
import { describe, expect, it } from "vitest";
import { defaultPrefs, sanitizeDashboardPrefs } from "./dashboard-prefs";

describe("sanitizeDashboardPrefs", () => {
  it("defaults to «Мои», a week, net", () => {
    expect(sanitizeDashboardPrefs(null, "me")).toEqual(defaultPrefs("me"));
    expect(defaultPrefs("me")).toEqual({ scope: "me", period: "week", metric: "pnl" });
  });

  it("an old auto-saved staff «Команда» becomes «Мои»", () => {
    const p = sanitizeDashboardPrefs({ scope: "team", hidden: ["streaks"] }, "me");
    expect(p.scope).toBe("me");
    expect(p.scopePicked).toBe(false);
  });

  it("keeps a scope picked by hand and the curve's window / unit (v6 prefs carry over)", () => {
    const p = sanitizeDashboardPrefs({ scope: "team", scopePicked: true, period: "90d", metric: "r", order: ["recent"] }, "me");
    expect(p).toEqual({ scope: "team", scopePicked: true, period: "90d", metric: "r" });
  });

  it("garbage window / unit → defaults", () => {
    const p = sanitizeDashboardPrefs({ period: "decade", metric: "usd" }, "me");
    expect(p.period).toBe("week");
    expect(p.metric).toBe("pnl");
  });
});
