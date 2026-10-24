import { describe, expect, it } from "vitest";
import { StoredAppearanceSchema, MAX_LOOKS } from "../people/appearanceSchema";

const current = {
  accent: "blue",
  textTone: "navy",
  lines: "theme",
  font: "geist",
  money: { win: "#22c55e", loss: null, be: null, beRange: 5 },
  guard: { mode: "daily", color: null },
  bg: { kind: "smoke", panels: "frosted" },
  density: "spacious",
};

const look = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Look ${id}`, theme: "platinum", settings: current, ...extra });

describe("users.settings.appearance schema", () => {
  it("accepts a full block with presets, custom hex colours and looks", () => {
    const r = StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, accent: "#123abc", lines: "#ff0000" }, looks: [look("a"), look("b")] });
    expect(r.success).toBe(true);
  });

  it("drops unknown keys instead of storing them", () => {
    const r = StoredAppearanceSchema.parse({ v: 1, current: { ...current, evil: "<script>" }, looks: [], extra: 1 });
    expect(r.current).not.toHaveProperty("evil");
    expect(r).not.toHaveProperty("extra");
  });

  it("rejects values outside the known sets", () => {
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, accent: "purple" }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, font: "comic" }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, money: { ...current.money, win: "red" } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, money: { ...current.money, win: "url(x)" } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, bg: { kind: "video", panels: "glass" } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 2, current, looks: [] }).success).toBe(false);
  });

  it("bounds the break-even range", () => {
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, money: { ...current.money, beRange: -1 } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, money: { ...current.money, beRange: 1001 } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, money: { ...current.money, beRange: 1000 } }, looks: [] }).success).toBe(true);
  });

  it("keeps at most 5 looks with unique ids and short names", () => {
    const five = Array.from({ length: MAX_LOOKS }, (_, i) => look(String(i)));
    expect(StoredAppearanceSchema.safeParse({ v: 1, current, looks: five }).success).toBe(true);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current, looks: [...five, look("x")] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current, looks: [look("a"), look("a")] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current, looks: [look("a", { name: "x".repeat(33) })] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current, looks: [look("a", { theme: "sepia" })] }).success).toBe(false);
  });

  it("accepts the WS originals scenes and chip colours; rejects unknown chip keys and bad colours", () => {
    const chips = { strategy: { on: true, colors: { OPG: "#3b82f6" } }, tag: { on: false, colors: {} }, horizon: { on: true, colors: { swing: "#a855f7" } } };
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, bg: { kind: "laocoon", panels: "glass" }, chips }, looks: [] }).success).toBe(true);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, bg: { kind: "porsche-gt3rs", panels: "solid" } }, looks: [] }).success).toBe(true);
    for (const kind of ["porsche-gt3", "carrera-gt", "ferrari-f40", "parthenon", "nike", "riace", "matterhorn", "manhattan", "nyse"]) {
      expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, bg: { kind, panels: "glass", brightness: 0.6 } }, looks: [] }).success, kind).toBe(true);
    }
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, chips: { ...chips, strategy: { on: true, colors: { XYZ: "#ffffff" } } } }, looks: [] }).success).toBe(false);
    expect(StoredAppearanceSchema.safeParse({ v: 1, current: { ...current, chips: { ...chips, tag: { on: true, colors: { setup: "red" } } } }, looks: [] }).success).toBe(false);
  });
});
