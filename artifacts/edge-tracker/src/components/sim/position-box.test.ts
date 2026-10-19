import { describe, it, expect } from "vitest";
import { autoBracket, lineStat, placeInPosition, placeKind, planBox, positionBox } from "./position-box";

describe("position box — zones and labels", () => {
  it("long: red risk zone entry→stop, green reward zone entry→target, $ and R on each line", () => {
    const b = positionBox({ pos: 200, avg: 10, stop: 9.4, target: 11.2, unit: 0.6 })!;
    expect(b.dir).toBe(1);
    expect(b.risk).toEqual({ from: 10, to: 9.4 });
    expect(b.reward).toEqual({ from: 10, to: 11.2 });
    expect(b.stop!.usd).toBeCloseTo(-120);
    expect(b.stop!.r).toBeCloseTo(-1);
    expect(b.target!.usd).toBeCloseTo(240);
    expect(b.target!.r).toBeCloseTo(2);
  });

  it("short mirrors; a stop moved past the entry has no risk zone", () => {
    const b = positionBox({ pos: -100, avg: 50, stop: 49.5, target: 48, unit: 0.5 })!;
    expect(b.dir).toBe(-1);
    expect(b.risk).toBeNull();
    expect(b.stop!.usd).toBeCloseTo(50);
    expect(b.target!.r).toBeCloseTo(4);
    expect(positionBox({ pos: 0, avg: null, stop: null, target: null, unit: 1 })).toBeNull();
  });

  it("plan while flat: the side follows the stop, 1R = the stop distance", () => {
    const b = planBox({ price: 20, stop: 19.5, target: 21, qty: 100, riskUnit: 0.3 })!;
    expect(b.dir).toBe(1);
    expect(b.stop!.r).toBeCloseTo(-1);
    expect(b.target!.r).toBeCloseTo(2);
    expect(b.target!.usd).toBeCloseTo(100);
    const t = planBox({ price: 20, stop: null, target: 19, qty: 10, riskUnit: 0.5 })!;
    expect(t.dir).toBe(-1);
    expect(t.target!.r).toBeCloseTo(2);
    expect(planBox({ price: 20, stop: null, target: null, qty: 10, riskUnit: 0.5 })).toBeNull();
  });

  it("lineStat with no unit reports 0R", () => {
    expect(lineStat(1, 10, 5, 6, 0)).toEqual({ price: 6, usd: 10, r: 0 });
  });
});

describe("position box — automatic bracket", () => {
  const levels = [{ key: "pdl", price: 9.6 }, { key: "pml", price: 9.85 }, { key: "pdh", price: 11 }, { key: "vwap", price: null }];

  it("stop just beyond the nearest level on the loss side within 0.25–2 units, target 2× the distance", () => {
    // pml 0.15 away (< 0.25 × 0.8) is too close; pdl 0.4 away fits; buffer 0.08 beyond it.
    expect(autoBracket(1, 10, 0.8, levels)).toEqual({ stop: 9.52, target: 10.96, level: "pdl" });
  });

  it("falls back to 1 risk unit when no level fits; shorts mirror", () => {
    expect(autoBracket(1, 10, 0.05, levels)).toEqual({ stop: 9.95, target: 10.1, level: null });
    expect(autoBracket(1, 10, 0.1, levels)).toEqual({ stop: 9.84, target: 10.32, level: "pml" });
    expect(autoBracket(-1, 10, 0.8, levels)).toEqual({ stop: 11.08, target: 7.84, level: "pdh" });
    expect(autoBracket(1, 10, 0, levels)).toBeNull();
  });
});

describe("position box — placing lines by click", () => {
  it("Shift = stop, Alt = target, both or none = nothing", () => {
    expect(placeKind({ shiftKey: true })).toBe("stop");
    expect(placeKind({ altKey: true })).toBe("target");
    expect(placeKind({ shiftKey: true, altKey: true })).toBeNull();
    expect(placeKind({})).toBeNull();
  });

  it("in a position a line lands only on its own side of the price", () => {
    const cur = { stop: 9.5, target: null };
    expect(placeInPosition("stop", 9.734, 100, 10, cur)).toEqual({ stop: 9.73, target: null });
    expect(placeInPosition("stop", 10.2, 100, 10, cur)).toBeNull();
    expect(placeInPosition("target", 11, 100, 10, cur)).toEqual({ stop: 9.5, target: 11 });
    expect(placeInPosition("target", 11, -100, 10, cur)).toBeNull();
    expect(placeInPosition("stop", 11, 0, 10, cur)).toBeNull();
  });
});

describe("position box — R text", () => {
  it("short R labels", async () => {
    const { rShort } = await import("./position-box");
    expect(rShort(-1)).toBe("1R");
    expect(rShort(2.04)).toBe("2R");
    expect(rShort(1.46)).toBe("1.5R");
    expect(rShort(0)).toBe("0R");
  });
});
