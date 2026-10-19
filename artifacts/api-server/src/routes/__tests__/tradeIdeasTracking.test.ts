/**
 * Idea tracking is frozen at the outcome (ROMAN-08): after the stop the idea is −1R, the excursions stop moving, and
 * the max adverse excursion is never smaller than «now». Pure function, no network (bars are given).
 */
import { describe, expect, it } from "vitest";
import { evaluateTracking, ideaLevels, type Series } from "../tradeideas";

const H = 60 * 60 * 1000;
const since = new Date("2026-10-12T13:34:06Z");
const t0 = Date.parse("2026-10-12T13:30:00Z");
const bar = (i: number, h: number, l: number, c: number) => ({ t: t0 + i * H, h, l, c });

// Like idea 570: AAL long, entry 12.60–12.64, stop 12.49, target 12.97 (1R = $0.13).
const lv = ideaLevels({ side: "Long", entryZone: "12.6–12.64", stop: "12.49", target: "12.97" })!;

describe("idea tracking — frozen at the outcome", () => {
  it("after the stop: −1R now, max adverse −1R, no tracking past the stop", () => {
    const series: Series = { price: 11.88, bars: [bar(0, 12.7, 12.58, 12.6), bar(1, 12.6, 12.33, 12.4), bar(2, 12.4, 11.8, 11.9)] };
    const tr = evaluateTracking(lv, series, since, "AAL");
    expect(tr.hit).toBe("stop");
    expect(tr.rNow).toBe(-1);
    expect(tr.maeR).toBe(-1);
    expect(tr.mfeR).toBe(0.62);
    expect(tr.price).toBe(11.88); // the live price is still shown as a price
  });

  it("after a target: now = the target's R, favorable capped there", () => {
    const series: Series = { price: 14, bars: [bar(0, 12.7, 12.58, 12.6), bar(1, 13.5, 12.6, 13.4)] };
    const tr = evaluateTracking(lv, series, since, "AAL");
    expect(tr.hit).toBe("final_target");
    expect(tr.rNow).toBe(2.69);
    expect(tr.mfeR).toBe(2.69);
  });

  it("open idea: the live price counts in the excursions (max adverse ≤ now)", () => {
    const series: Series = { price: 12.52, bars: [bar(0, 12.7, 12.58, 12.6)] };
    const tr = evaluateTracking(lv, series, since, "AAL");
    expect(tr.hit).toBeNull();
    expect(tr.rNow).toBe(-0.77);
    expect(tr.maeR).toBe(-0.77);
  });
});
