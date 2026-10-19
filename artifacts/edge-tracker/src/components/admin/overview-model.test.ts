import { describe, expect, it } from "vitest";
import { backupProblem, isWeekendYmd, overdueByCurator } from "./overview-model";
import type { ReviewLoad } from "./console-api";

describe("admin overview model", () => {
  it("weekends (OWNER-27)", () => {
    expect(isWeekendYmd("2026-10-18")).toBe(true); // Sunday
    expect(isWeekendYmd("2026-10-17")).toBe(true); // Saturday
    expect(isWeekendYmd("2026-10-16")).toBe(false); // Friday
  });

  it("says who the overdue reviews belong to (OWNER-05)", () => {
    const load: ReviewLoad = {
      slaHours: 24, windowDays: 14,
      curators: [
        { name: "Ольга Н.", wards: 10, count: 20, overdue: 15 },
        { name: "Руслан А.", wards: 0, count: 0, overdue: 0 },
      ],
      unassigned: { traders: 13, count: 9, overdue: 8 },
    };
    const text = overdueByCurator(load) ?? "";
    expect(text).toContain("15");
    expect(text).toContain("8");
    expect(text).not.toContain("Руслан");
    expect(overdueByCurator({ ...load, curators: [], unassigned: { traders: 0, count: 0, overdue: 0 } })).toBeUndefined();
    expect(overdueByCurator(null)).toBeUndefined();
  });

  it("flags a missing fresh backup only when the server checked (OWNER-14)", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(backupProblem(undefined, now)).toBeNull();
    expect(backupProblem({ backup: null }, now)).toBeNull();
    expect(backupProblem({ backup: { lastAt: "2026-10-19T03:15:00Z" } }, now)).toBeNull();
    expect(backupProblem({ backup: { lastAt: "2026-10-17T03:15:00Z" } }, now)).toEqual({ lastAt: "2026-10-17T03:15:00Z" });
    expect(backupProblem({ backup: { lastAt: null } }, now)).toEqual({ lastAt: null });
  });
});
