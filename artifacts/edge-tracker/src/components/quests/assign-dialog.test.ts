import { describe, expect, it } from "vitest";
import type { Quest } from "@/lib/quests/types";
import { activeDuplicate, remainingTradingDays, suggestedTarget } from "./assign-dialog";

const days = { unit: "days" as const, defaultTarget: 5, minTarget: 1, maxTarget: 60 };
const quest = (template: string, status: Quest["status"] = "active"): Quest => ({
  id: 1, scope: "weekly", template, title: { key: "k" }, description: { key: "k" }, progress: 0, target: 3, status, rewardPoints: 10,
  startsOn: "2026-10-19", endsOn: "2026-10-23", completedAt: null, assignedBy: null, note: null, href: null,
} as Quest);

describe("assign quest dialog (OLGA-10)", () => {
  it("counts the trading days left, both ends inclusive", () => {
    expect(remainingTradingDays("2026-10-19", "2026-10-23")).toBe(5);
    expect(remainingTradingDays("2026-10-17", "2026-10-23")).toBe(5); // Saturday → Friday
    expect(remainingTradingDays("2026-10-23", "2026-10-19")).toBe(0);
  });
  it("prefills a reachable target: days left − 2, min 1; counts keep the default", () => {
    expect(suggestedTarget(days, "2026-10-19", "2026-10-23")).toBe(3);
    expect(suggestedTarget(days, "2026-10-22", "2026-10-23")).toBe(1);
    expect(suggestedTarget(days, "2026-10-19", "2026-10-30")).toBe(5); // never above the catalog default
    expect(suggestedTarget({ ...days, unit: "count", defaultTarget: 2 }, "2026-10-22", "2026-10-23")).toBe(2);
  });
  it("finds a running quest of the same template, ignoring finished ones and manual tasks", () => {
    expect(activeDuplicate([quest("focus_absent_days")], "focus_absent_days")?.template).toBe("focus_absent_days");
    expect(activeDuplicate([quest("focus_absent_days", "done")], "focus_absent_days")).toBeNull();
    expect(activeDuplicate([quest("curator_task")], "curator_task")).toBeNull();
    expect(activeDuplicate(undefined, "contract_days")).toBeNull();
  });
});
