import { describe, expect, it } from "vitest";
import { isCompleteFormula, suggestDirection, tapMark } from "./model";

describe("catalyst taps prefill", () => {
  it("suggests the plan's direction first, then the day's hint, then a big gap", () => {
    expect(suggestDirection({ planBias: "bear", hint: { ticker: "X", direction: "bull", kind: "news", source: "event", movePct: 5 } })?.direction).toBe("bear");
    expect(suggestDirection({ planBias: "neutral", hint: { ticker: "X", direction: "bull", kind: "earnings", source: "earnings", movePct: 5 } })).toMatchObject({ direction: "bull", source: "earnings" });
    expect(suggestDirection({ gapPct: -3.1 })).toMatchObject({ direction: "bear", source: "gap" });
    expect(suggestDirection({ gapPct: 0.4 })).toBeNull();
  });

  it("one strength tap confirms the suggested direction; a second tap on the same value clears it", () => {
    const s = { direction: "bear" as const, source: "plan" as const, kind: null, movePct: null };
    expect(tapMark(null, { strength: "strong" }, s)).toEqual({ direction: "bear", strength: "strong", suggested: true });
    expect(tapMark({ direction: "bear", strength: "strong" }, { strength: "strong" }, null)).toEqual({ direction: "bear", strength: null, suggested: false });
    expect(tapMark({ direction: null, strength: "weak" }, { strength: "strong" }, s)).toMatchObject({ direction: null, strength: "strong" });
    expect(tapMark(null, { direction: "bull" }, s)).toEqual({ direction: "bull", strength: null, suggested: false });
  });

  it("a formula is complete with a catalyst requirement, a setup and a trade", () => {
    expect(isCompleteFormula({ catalyst: { kind: null, strength: "strong", direction: null }, setup: "a", trade: "b" })).toBe(true);
    expect(isCompleteFormula({ catalyst: { kind: null, strength: null, direction: null }, setup: "a", trade: "b" })).toBe(false);
  });
});
