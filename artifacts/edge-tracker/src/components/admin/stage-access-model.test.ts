// «Доступ по ступеням» model: what is in force (incl. the legacy names switch), switches, «Открыть всё», the PUT batch,
// and the generic settings form hiding the stage rows (they have this screen).
import { describe, expect, it } from "vitest";
import { formRows, type AnySettingRow } from "./desk-settings-model";
import { auditValueText } from "./desk-settings-text";
import {
  accessChanges, closedCount, isOpen, namesInForce, normalizeSections, openAll, readAccess, seesNames, setNames, setOpen, setRowOpen, unknownClosed,
} from "./stage-access-model";

const row = (key: string, def: AnySettingRow["def"], value: AnySettingRow["value"] = null): AnySettingRow => ({
  key, def, value, effective: value ?? def.default, default: def.default, updatedBy: null, updatedAt: null,
});
const sectionsDef: AnySettingRow["def"] = { group: "access", type: "sectionStages", default: {}, maxSections: 60, hidden: true };
const namesDef: AnySettingRow["def"] = { group: "privacy", type: "stages", default: [], hidden: true };
const legacyDef: AnySettingRow["def"] = { group: "privacy", type: "boolean", default: true, hidden: true };
const rows = (o: { sections?: AnySettingRow["value"]; names?: AnySettingRow["value"]; legacy?: boolean | null } = {}) => [
  row("access.sections", sectionsDef, o.sections ?? null),
  row("privacy.namesVisibleTo", namesDef, o.names ?? null),
  row("privacy.hideNamesFromTraders", legacyDef, o.legacy ?? null),
  row("daily.focusWindowDays", { group: "daily", type: "number", default: 10, min: 3, max: 30, step: 1 }),
];

describe("readAccess / namesInForce", () => {
  it("defaults: everything open, names hidden (legacy switch on)", () => {
    expect(readAccess(rows())).toEqual({ sections: {}, names: [] });
  });

  it("legacy switch off → every stage sees names until a list is saved; a saved list wins", () => {
    expect(namesInForce(rows({ legacy: false }))).toEqual(["junior", "trader", "senior"]);
    expect(namesInForce(rows({ legacy: false, names: ["senior"] }))).toEqual(["senior"]);
    expect(namesInForce(rows({ legacy: true, names: [] }))).toEqual([]);
  });

  it("normalizes the stored map (sorted, ladder order, unknown stages and empty lists dropped)", () => {
    expect(normalizeSections({ "/z": ["senior", "junior"], "/a": [], "/b": ["lead", "trader"] })).toEqual({ "/b": ["trader"], "/z": ["junior", "senior"] });
    expect(normalizeSections(null)).toEqual({});
    expect(normalizeSections(["/a"])).toEqual({});
  });
});

describe("editing", () => {
  it("cells, rows, names, «Открыть всё» (names untouched)", () => {
    let d = readAccess(rows());
    d = setOpen(d, "/top-results", "junior", false);
    d = setOpen(d, "/top-results", "trader", false);
    expect(isOpen(d, "/top-results", "junior")).toBe(false);
    expect(isOpen(d, "/top-results", "senior")).toBe(true);
    expect(d.sections).toEqual({ "/top-results": ["junior", "trader"] });
    d = setOpen(d, "/top-results", "junior", true);
    expect(d.sections).toEqual({ "/top-results": ["trader"] });
    d = setRowOpen(d, "/office", false);
    expect(closedCount(d)).toBe(4);
    d = setNames(d, "senior", true);
    expect(seesNames(d, "senior")).toBe(true);
    const opened = openAll(d);
    expect(opened.sections).toEqual({});
    expect(opened.names).toEqual(["senior"]);
  });

  it("the PUT batch: only what changed; an all-open map goes as null; names always as a list", () => {
    const r = rows({ sections: { "/office": ["junior"] } });
    expect(accessChanges(r, readAccess(r))).toEqual([]);
    expect(accessChanges(r, openAll(readAccess(r)))).toEqual([{ key: "access.sections", value: null }]);
    const d = setNames(setOpen(readAccess(r), "/benchmark", "trader", false), "senior", true);
    expect(accessChanges(r, d)).toEqual([
      { key: "access.sections", value: { "/benchmark": ["trader"], "/office": ["junior"] } },
      { key: "privacy.namesVisibleTo", value: ["senior"] },
    ]);
    // Legacy off = everyone sees names: turning juniors off saves the list explicitly.
    const legacyOff = rows({ legacy: false });
    expect(accessChanges(legacyOff, setNames(readAccess(legacyOff), "junior", false))).toEqual([{ key: "privacy.namesVisibleTo", value: ["trader", "senior"] }]);
  });

  it("closed hrefs the table has no row for are kept and listed", () => {
    const d = readAccess(rows({ sections: { "/old-page": ["junior"], "/office": ["junior"] } }));
    expect(unknownClosed(d, [{ id: "team", label: "", sections: [{ href: "/office", label: "", parent: null }] }])).toEqual(["/old-page"]);
  });
});

describe("generic settings form and audit text", () => {
  it("the form skips hidden rows and unknown field types", () => {
    expect(formRows(rows()).map((r) => r.key)).toEqual(["daily.focusWindowDays"]);
  });

  it("audit values: stage lists and section maps read as text", () => {
    expect(auditValueText(["junior", "senior"])).toBe("Джун, Сеньор");
    expect(auditValueText([])).toBe("никто");
    expect(auditValueText({})).toBe("всё открыто");
    expect(auditValueText({ "/office": ["junior", "trader"] })).toBe("/office: Джун/Трейдер");
  });
});
