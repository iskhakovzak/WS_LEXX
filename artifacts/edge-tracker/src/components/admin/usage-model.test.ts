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

describe("usage model: PILOT section 3 weekly card (OWNER-07)", async () => {
  const m = await import("./usage-model");
  const cells = (plan: boolean[], today: boolean[], traded: boolean[], reviewed: boolean[], trainer: boolean[]) => ({
    visit: plan.map(() => true), plan, today, traded, reviewed, tagged: plan.map(() => null), trainer,
  });
  const T = (name: string, c: ReturnType<typeof cells>): FunnelTrader => ({
    name, tier: "trainee", pilot: true, cells: c, totals: { visit: 0, plan: 0, today: 0, traded: 0, reviewed: 0, tagged: 0, trainer: 0 },
  });
  const y = true, n = false;
  const good = T("A", cells([n, y, y, y, y, y], [n, y, y, y, n, n], [y, y, y, y, y, n], [y, y, y, y, y, n], [n, y, n, y, n, n]));
  const weak = T("B", cells([y, n, n, y, n, n], [n, n, n, n, n, n], [n, n, n, n, y, n], [n, n, n, n, n, n], [n, n, n, n, n, n]));
  const idle = T("C", cells([n, n, n, n, n, n], [n, n, n, n, n, n], [n, n, n, n, n, n], [n, n, n, n, n, n], [n, n, n, n, n, n]));
  it("counts the last 5 trading days against the plan's thresholds", () => {
    const rows = m.pilotSummary([good, weak, idle], ["C"], false);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.plan).toEqual({ key: "plan", value: 1, total: 3, good: false });
    expect(by.today).toMatchObject({ value: 1, good: false });
    // review: only traders who traded count (A: 4 of 4 traded days; B: 0 of 1)
    expect(by.reviewed).toEqual({ key: "reviewed", value: 1, total: 2, good: false });
    expect(by.trainer).toMatchObject({ value: 1, good: false });
    expect(by.focus).toMatchObject({ value: null, good: null });
    expect(by.inactive).toMatchObject({ value: 1, good: true });
    expect(m.pilotSummary([good], [], false).find((r) => r.key === "plan")!.good).toBe(true);
  });
  it("low data: no inactive verdict", () => {
    expect(m.pilotSummary([good], [], true).find((r) => r.key === "inactive")).toMatchObject({ value: null, good: null });
  });
  it("lists menu screens nobody opened", () => {
    const items = [{ href: "/" }, { href: "/playbook" }, { href: "/trainer", also: ["/sim"] }, { href: "/journal" }, { href: "/academy/my" }];
    const never = m.neverOpened(items, ["/", "/playbook?mode=mine".split("?")[0]!, "/sim/:id", "/academy/my/lesson"]);
    expect(never.map((i) => i.href)).toEqual(["/journal"]);
  });
});
