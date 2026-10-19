import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAWING_POINTS, MAX_DRAWINGS, drawingsStorageKey, fromApiDrawing, isValidDrawing, loadDrawings, makeDrawing, moveDrawing, movePoint,
  parseDrawingsResponse, saveDrawings, toApiDrawing,
} from "./drawings";
import { logicalX } from "../primitives/canvas";
import { priceFormatFor, refPrice, topMargin } from "./chart-options";

const T0 = 1_792_160_000;

describe("drawings model", () => {
  it("makes drawings with the points each tool needs and a theme role", () => {
    const h = makeDrawing("hline", [{ time: T0, price: 10 }, { time: T0 + 60, price: 11 }]);
    expect(h.points).toHaveLength(DRAWING_POINTS.hline);
    expect(h.role).toBe("accent");
    const z = makeDrawing("rect", [{ time: T0, price: 10 }, { time: T0 + 300, price: 12 }], "warn");
    expect(z.points).toHaveLength(2);
    expect(z.role).toBe("warn");
    expect(isValidDrawing(z)).toBe(true);
    expect(isValidDrawing({ ...z, type: "fib" })).toBe(false);
    expect(isValidDrawing({ ...z, points: [{ time: T0, price: -1 }, { time: T0, price: 2 }] })).toBe(false);
  });

  it("maps to the API contract and back (ChartDrawing: kind, points {t, p}, colour role)", () => {
    const d = makeDrawing("trend", [{ time: T0 + 0.4, price: 3.4912 }, { time: T0 + 600, price: 3.52 }], "down");
    const api = toApiDrawing(d);
    expect(api).toEqual({ id: d.id, kind: "trend", points: [{ t: T0, p: 3.4912 }, { t: T0 + 600, p: 3.52 }], label: null, color: "down" });
    const back = fromApiDrawing(api);
    expect(back).toMatchObject({ id: d.id, type: "trend", role: "down", points: [{ time: T0, price: 3.4912 }, { time: T0 + 600, price: 3.52 }] });
    // Unknown colours fall back to the accent role; junk is dropped.
    expect(fromApiDrawing({ ...api, color: "#ff0000" })?.role).toBe("accent");
    expect(fromApiDrawing({ id: "x", kind: "circle", points: [] })).toBeNull();
  });

  it("reads { drawings } or a bare array and caps the count", () => {
    const one = toApiDrawing(makeDrawing("hline", [{ time: T0, price: 5 }]));
    expect(parseDrawingsResponse({ drawings: [one] })).toHaveLength(1);
    expect(parseDrawingsResponse([one, { bad: true }])).toHaveLength(1);
    expect(parseDrawingsResponse(null)).toEqual([]);
    const many = Array.from({ length: MAX_DRAWINGS + 7 }, (_, i) => ({ ...one, id: `d${i}` }));
    expect(parseDrawingsResponse({ drawings: many })).toHaveLength(MAX_DRAWINGS);
  });

  it("moves a whole drawing (a level only in price) and reshapes one handle", () => {
    const h = makeDrawing("hline", [{ time: T0, price: 10 }]);
    expect(moveDrawing(h, 600, 0.5).points[0]).toEqual({ time: T0, price: 10.5 });
    const z = makeDrawing("rect", [{ time: T0, price: 10 }, { time: T0 + 300, price: 12 }]);
    expect(moveDrawing(z, 60, -1).points).toEqual([{ time: T0 + 60, price: 9 }, { time: T0 + 360, price: 11 }]);
    expect(movePoint(z, 1, { time: T0 + 900, price: 13 }).points).toEqual([{ time: T0, price: 10 }, { time: T0 + 900, price: 13 }]);
    expect(movePoint(z, 5, { time: 0, price: 1 })).toBe(z);
  });
});

describe("drawings browser fallback", () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
    });
  });
  it("stores per ticker-day and clears the key when empty", () => {
    const d = makeDrawing("rect", [{ time: T0, price: 10 }, { time: T0 + 300, price: 12 }], "up");
    expect(saveDrawings("intc", "2026-10-16", [d])).toBe(true);
    expect(localStorage.getItem(drawingsStorageKey("INTC", "2026-10-16"))).not.toBeNull();
    expect(loadDrawings("INTC", "2026-10-16")).toMatchObject([{ id: d.id, type: "rect", role: "up" }]);
    expect(loadDrawings("INTC", "2026-10-15")).toEqual([]);
    saveDrawings("INTC", "2026-10-16", []);
    expect(localStorage.getItem(drawingsStorageKey("INTC", "2026-10-16"))).toBeNull();
  });
});

describe("chart options", () => {
  it("uses 4 decimals only for sub-dollar stocks", () => {
    const sub = priceFormatFor(0.42);
    const reg = priceFormatFor(1.91);
    expect(sub.minMove).toBe(0.0001);
    expect(reg.minMove).toBe(0.01);
    const fmt = (f: typeof sub, v: number) => (f.type === "custom" ? (f.formatter as (p: number) => string)(v) : null);
    expect(fmt(sub, 0.4213)).toBe("0.4213");
    expect(fmt(reg, 1.9)).toBe("1.90");
    expect(priceFormatFor(null).minMove).toBe(0.01);
  });
  it("takes the median close as the reference price", () => {
    expect(refPrice([1, 100, 2, NaN, 3])).toBe(3);
    expect(refPrice([])).toBeNull();
  });
  it("keeps the candles clear of the legend", () => {
    expect(topMargin(500, 40)).toBeCloseTo(48 / 500, 6);
    expect(topMargin(100, 40)).toBe(0.3);
    expect(topMargin(0)).toBe(0.1);
  });
});

describe("logicalX", () => {
  // lightweight-charts answers 0 for fractional logicals; the helper interpolates between whole bars.
  const ts = { logicalToCoordinate: (l: number) => (Number.isInteger(l) ? (l >= 0 && l <= 10 ? 100 + l * 8 : null) : 0) } as unknown as Parameters<typeof logicalX>[0];
  it("interpolates bar edges", () => {
    expect(logicalX(ts, 3)).toBe(124);
    expect(logicalX(ts, 2.5)).toBe(120);
    expect(logicalX(ts, -0.5)).toBeNull();
    expect(logicalX(ts, 10.5)).toBe(180);
    expect(logicalX(ts, Number.NaN)).toBeNull();
  });
});
