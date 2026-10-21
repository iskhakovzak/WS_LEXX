import { describe, expect, it } from "vitest";
import type { LoopRow } from "./loop-yesterday-api";
import { cellOf, fixOf, gapsOf, pilotVerdict, profileHref, sortRows, totalsOf, waitParts } from "./loop-yesterday-model";

const row = (name: string, o: Partial<LoopRow> = {}): LoopRow => ({
  name, group: null, plan: true, planBeforeOpen: true, trades: 2, closed: true, closedAt: "2026-10-19T20:30:00.000Z",
  reviewed: true, reviewedBy: "Curator C.", reviewHours: 5, overSla: false, telegram: true, ...o,
});
const DATE = "2026-10-19";

describe("loop yesterday model", () => {
  it("cell states per column", () => {
    expect(cellOf("plan", row("a"))).toBe("ok");
    expect(cellOf("plan", row("a", { planBeforeOpen: false }))).toBe("late");
    expect(cellOf("plan", row("a", { plan: false, planBeforeOpen: false }))).toBe("miss");
    expect(cellOf("closed", row("a", { closed: false, reviewed: false, reviewHours: null }))).toBe("miss");
    expect(cellOf("closed", row("a", { trades: 0, closed: false, reviewed: false, reviewHours: null }))).toBe("na");
    expect(cellOf("review", row("a", { closed: false, reviewed: false, reviewHours: null }))).toBe("na");
    expect(cellOf("review", row("a", { reviewed: false, reviewHours: 10 }))).toBe("wait");
    expect(cellOf("review", row("a", { reviewed: false, reviewHours: 30, overSla: true }))).toBe("overdue");
    expect(cellOf("review", row("a", { reviewHours: 30, overSla: true }))).toBe("late");
    expect(cellOf("telegram", row("a", { telegram: false }))).toBe("miss");
  });

  it("gaps: missing / waiting / overdue cells; a day without trades is not a gap", () => {
    expect(gapsOf(row("a"))).toBe(0);
    expect(gapsOf(row("a", { plan: false, planBeforeOpen: false, telegram: false }))).toBe(2);
    expect(gapsOf(row("a", { trades: 0, closed: false, reviewed: false, reviewHours: null }))).toBe(0);
    expect(gapsOf(row("a", { reviewed: false, reviewHours: 3 }))).toBe(1);
  });

  it("rows that break the loop first, overdue before waiting, then by name", () => {
    const rows = [
      row("Ann"),
      row("Bob", { reviewed: false, reviewHours: 3 }),
      row("Cid", { reviewed: false, reviewHours: 40, overSla: true }),
      row("Dan", { plan: false, planBeforeOpen: false, telegram: false }),
    ];
    expect(sortRows(rows).map((r) => r.name)).toEqual(["Dan", "Cid", "Bob", "Ann"]);
  });

  it("a ✗ links to the screen that fixes it", () => {
    const open = row("Ann", { closed: false, reviewed: false, reviewHours: null });
    expect(fixOf("closed", open, DATE)).toEqual({ href: `/journal?date=${DATE}&trader=Ann` });
    expect(fixOf("review", row("Ann", { reviewed: false, reviewHours: 3 }), DATE)).toEqual({ href: `/journal?date=${DATE}&trader=Ann` });
    expect(fixOf("telegram", row("Ann", { telegram: false }), DATE)).toEqual({ tab: "people" });
    expect(fixOf("plan", row("Ann", { plan: false }), DATE)).toBeNull();
    expect(fixOf("closed", row("Ann"), DATE)).toBeNull();
    expect(profileHref("Ann B.")).toBe("/curator?trader=Ann+B.");
  });

  it("waiting time reads like the queue", () => {
    expect(waitParts(5.4)).toEqual({ d: 0, h: 5 });
    expect(waitParts(30)).toEqual({ d: 1, h: 6 });
    expect(waitParts(null)).toEqual({ d: 0, h: 0 });
  });

  it("totals: «closed» out of who traded (or closed anyway), «reviewed» out of closed", () => {
    const rows = [row("a"), row("b", { trades: 0, closed: false, reviewed: false, reviewHours: null }), row("c", { closed: false, reviewed: false, reviewHours: null })];
    const t = totalsOf(rows, { traders: 3, plan: 3, planBeforeOpen: 3, traded: 2, trades: 4, closed: 1, reviewed: 1, waiting: 0, overdue: 0, telegram: 3 });
    expect(t).toEqual({
      plan: { n: 3, of: 3, beforeOpen: 3 }, trades: { sum: 4, traded: 2 }, closed: { n: 1, of: 2 },
      review: { n: 1, of: 1, waiting: 0, overdue: 0 }, telegram: { n: 3, of: 3 },
    });
  });

  it("pilot verdict: measured lines only; the «плохо» ones are named", () => {
    expect(pilotVerdict([
      { key: "plan", value: 3, total: 4, good: true },
      { key: "today", value: 1, total: 4, good: false },
      { key: "focus", value: null, total: 4, good: null },
      { key: "inactive", value: 2, total: 4, good: false },
    ])).toEqual({ good: 1, measured: 3, bad: ["today", "inactive"] });
    expect(pilotVerdict([])).toEqual({ good: 0, measured: 0, bad: [] });
  });
});
