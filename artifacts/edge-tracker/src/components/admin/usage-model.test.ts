import { describe, expect, it } from "vitest";
import type { FunnelTrader } from "./usage-api";
import { actionDictKey, cellMark, defaultFilter, filterTraders, stepBase } from "./usage-model";

const tr = (name: string, tier: string | null, pilot = false): FunnelTrader => ({
  name, tier, pilot,
  cells: {
    visit: [true, false, true], plan: [true, false, false], today: [false, false, true], traded: [true, false, true],
    reviewed: [false, false, true], tagged: ["part", null, "all"], trainer: [false, true, false],
  },
  totals: { visit: 2, plan: 1, today: 1, traded: 2, reviewed: 1, tagged: 1, trainer: 1 },
});

describe("usage model", () => {
  const rows = [tr("A", "trainee", true), tr("B", "junior"), tr("C", "trainee")];
  it("filters and picks the default filter", () => {
    expect(filterTraders(rows, "pilot").map((r) => r.name)).toEqual(["A"]);
    expect(filterTraders(rows, "trainees").map((r) => r.name)).toEqual(["A", "C"]);
    expect(filterTraders(rows, "all")).toHaveLength(3);
    expect(defaultFilter({ pilot: { names: ["A"], unknown: [] }, funnel: { days: [], traders: rows } })).toBe("pilot");
    expect(defaultFilter({ pilot: { names: [], unknown: [] }, funnel: { days: [], traders: rows } })).toBe("trainees");
    expect(defaultFilter({ pilot: { names: [], unknown: [] }, funnel: { days: [], traders: [tr("B", "senior")] } })).toBe("all");
  });
  it("marks cells; review / tags on a day without trades are blank", () => {
    const a = rows[0]!;
    expect(cellMark("plan", a, 0)).toBe("yes");
    expect(cellMark("plan", a, 1)).toBe("no");
    expect(cellMark("tagged", a, 0)).toBe("part");
    expect(cellMark("tagged", a, 1)).toBe("none");
    expect(cellMark("tagged", a, 2)).toBe("yes");
    expect(cellMark("reviewed", a, 0)).toBe("no");
    expect(cellMark("reviewed", a, 1)).toBe("none");
    expect(stepBase("reviewed", a)).toBe(2);
    expect(stepBase("visit", a)).toBe(3);
  });
  it("maps action keys to dictionary keys", () => {
    expect(actionDictKey("playbook.today")).toBe("playbook_today");
  });
});

describe("desk settings: the text type (usage.pilotUsers)", async () => {
  const { checkValue } = await import("./desk-settings-model");
  const def = { group: "usage", type: "text", default: "", maxLength: 10 } as const;
  it("accepts strings up to maxLength (trimmed), rejects other types", () => {
    expect(checkValue("usage.pilotUsers", def, "A, B")).toBeNull();
    expect(checkValue("usage.pilotUsers", def, "  0123456789  ")).toBeNull();
    expect(checkValue("usage.pilotUsers", def, "0123456789x")).toEqual({ key: "usage.pilotUsers", kind: "length", max: 10 });
    expect(checkValue("usage.pilotUsers", def, 5)).toEqual({ key: "usage.pilotUsers", kind: "type" });
  });
});
