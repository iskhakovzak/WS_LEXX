import { describe, it, expect } from "vitest";
import { MAX_DRAWINGS, drawingsSchema, normalizeDrawings } from "../trainer/drawings";

const ok = (x: unknown) => drawingsSchema.safeParse(x).success;
const h = (id: string, over: object = {}) => ({ id, kind: "hline", points: [{ t: 1760621400, p: 42.5 }], ...over });

describe("chart drawings validation", () => {
  it("accepts the three kinds with the right number of points", () => {
    expect(ok([
      h("a", { label: "PDH", color: "accent" }),
      { id: "b", kind: "trend", points: [{ t: 1760621400, p: 42 }, { t: 1760625000, p: 43.1 }], color: "up" },
      { id: "c", kind: "rect", points: [{ t: 1760621400, p: 42 }, { t: 1760625000, p: 41 }], label: null, color: null },
    ])).toBe(true);
    expect(ok([])).toBe(true);
  });

  it("rejects wrong point counts, unknown kinds / colors, hex colors, bad points, long ids / labels, extra keys", () => {
    expect(ok([h("a", { points: [{ t: 1, p: 1 }, { t: 2, p: 2 }] })])).toBe(false);
    expect(ok([{ id: "b", kind: "trend", points: [{ t: 1, p: 1 }] }])).toBe(false);
    expect(ok([h("a", { kind: "circle" })])).toBe(false);
    expect(ok([h("a", { color: "#ff0000" })])).toBe(false);
    expect(ok([h("a", { points: [{ t: 1.5, p: 1 }] })])).toBe(false);
    expect(ok([h("a", { points: [{ t: 1, p: -1 }] })])).toBe(false);
    expect(ok([h("x".repeat(41))])).toBe(false);
    expect(ok([h("a", { label: "x".repeat(81) })])).toBe(false);
    expect(ok([h("a", { html: "<b>" })])).toBe(false);
    expect(ok([h("a"), h("a")])).toBe(false);
  });

  it("caps the count", () => {
    expect(ok(Array.from({ length: MAX_DRAWINGS }, (_, i) => h(`d${i}`)))).toBe(true);
    expect(ok(Array.from({ length: MAX_DRAWINGS + 1 }, (_, i) => h(`d${i}`)))).toBe(false);
  });

  it("normalises to explicit nulls", () => {
    const parsed = drawingsSchema.parse([h("a")]);
    expect(normalizeDrawings(parsed)).toEqual([{ id: "a", kind: "hline", points: [{ t: 1760621400, p: 42.5 }], label: null, color: null }]);
  });
});
