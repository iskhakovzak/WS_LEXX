/**
 * «Настройки деска» pilot filter (Волна 2 п. 2.4): by default only the settings the server flags `pilot: true`
 * (fallback PILOT_KEYS for an API without the flag); «Показать все» shows every row; unsaved / invalid rows never hide.
 */
import { describe, expect, it } from "vitest";
import { PILOT_KEYS, groupRows, pilotRowsOf, visibleRows, type SettingDef, type SettingRow } from "./desk-settings-model";

const def = (group: string, pilot?: true): SettingDef => ({ group, type: "boolean", default: true, ...(pilot ? { pilot } : {}) });
const row = (key: string, d: SettingDef): SettingRow => ({ key, def: d, value: null, effective: d.default, default: d.default, updatedBy: null, updatedAt: null });

const flagged = [
  row("telegram.morningTime", def("telegram", true)),
  row("telegram.morningEnabled", def("telegram")),
  row("quests.enabled", def("quests")),
  row("usage.pilotUsers", def("usage", true)),
];

describe("pilot settings filter", () => {
  it("pilot rows come from the server flag, in registry order", () => {
    expect(pilotRowsOf(flagged).map((r) => r.key)).toEqual(["telegram.morningTime", "usage.pilotUsers"]);
  });

  it("without the flag (older API) the PILOT_KEYS list is used", () => {
    const old = [row("quests.enabled", def("quests")), row(PILOT_KEYS[0], def("daily")), row("usage.pilotUsers", def("usage"))];
    expect(pilotRowsOf(old).map((r) => r.key)).toEqual([PILOT_KEYS[0], "usage.pilotUsers"]);
  });

  it("pilot only by default; «Показать все» shows every row; group menu follows what is shown", () => {
    expect(visibleRows(flagged, false).map((r) => r.key)).toEqual(["telegram.morningTime", "usage.pilotUsers"]);
    expect(visibleRows(flagged, true)).toHaveLength(4);
    expect(groupRows(visibleRows(flagged, false)).map((g) => g.group)).toEqual(["telegram", "usage"]);
    expect(groupRows(visibleRows(flagged, true)).map((g) => g.group)).toEqual(["quests", "telegram", "usage"]);
  });

  it("a row with an unsaved edit or a server problem stays visible in the pilot view", () => {
    expect(visibleRows(flagged, false, new Set(["quests.enabled"])).map((r) => r.key)).toEqual(["telegram.morningTime", "quests.enabled", "usage.pilotUsers"]);
  });

  it("no pilot row known → everything is shown (never an empty form)", () => {
    const none = [row("quests.enabled", def("quests")), row("finviz.enabled", def("finviz"))];
    expect(visibleRows(none, false)).toHaveLength(2);
  });
});
