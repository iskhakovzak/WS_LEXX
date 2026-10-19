import { describe, expect, it } from "vitest";
import { greeting, stoppedTraders } from "./today-hero";
import { dashboardI18n } from "@/i18n/ns/dashboard";

describe("today hero (OWNER-01, OWNER-29)", () => {
  it("counts each stopped trader once: the server's distinct `stopped`, else the larger overlapping count", () => {
    expect(stoppedTraders({ halted: 7, breach: 7, stopped: 7 })).toBe(7);
    expect(stoppedTraders({ halted: 7, breach: 7 })).toBe(7);
    expect(stoppedTraders({ halted: 2, breach: 5 })).toBe(5);
    expect(stoppedTraders({ halted: 0, breach: 0, stopped: 0 })).toBe(0);
  });

  it("greets by the New York clock, not the browser's zone", () => {
    // 20:02 UTC on a Sunday in October = 16:02 NY (EDT) — «Добрый день», though it is 01:02 in Tashkent.
    expect(greeting(new Date("2026-10-18T20:02:00Z"))).toBe(dashboardI18n.t("hero.greeting.day"));
    // 11:30 UTC = 07:30 NY → morning.
    expect(greeting(new Date("2026-10-19T11:30:00Z"))).toBe(dashboardI18n.t("hero.greeting.morning"));
  });
});
