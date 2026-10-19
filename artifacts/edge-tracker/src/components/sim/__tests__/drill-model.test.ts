import { describe, expect, it } from "vitest";
import { clampPick, pickDiff, runSummary, scoreTone } from "../drill-model";
import { drill } from "./trainer-fixtures";

describe("«Найди вход» model", () => {
  it("a click lands inside the window and inside the bar's range", () => {
    const d = drill();
    expect(clampPick(d, 12, 99)).toEqual({ barIndex: 30, price: d.bars[30].h });
    expect(clampPick(d, 34.4, 0)).toEqual({ barIndex: 34, price: d.bars[34].l });
    expect(clampPick(d, 99, 21.8)).toEqual({ barIndex: 39, price: 21.8 });
    expect(clampPick(drill({ bars: [] }), 3, 1)).toBeNull();
    expect(clampPick(d, 33, Number.NaN)).toBeNull();
  });

  it("run summary", () => {
    expect(runSummary([])).toEqual({ count: 0, accuracy: null, hits: 0, mastery: 0, best: null });
    const s = runSummary([
      { drillId: 1, setupName: "a", score: 100, masteryDelta: 1 },
      { drillId: 2, setupName: "a", score: 69, masteryDelta: 0 },
      { drillId: 3, setupName: "a", score: 70, masteryDelta: 0.25 },
    ]);
    expect(s).toEqual({ count: 3, accuracy: 80, hits: 2, mastery: 1.25, best: 100 });
  });

  it("tones and timing", () => {
    expect(scoreTone(70)).toBe("up");
    expect(scoreTone(40)).toBe("warn");
    expect(scoreTone(10)).toBe("down");
    expect(pickDiff({ ideal: { barIndex: 10, price: 20 }, yours: { barIndex: 8, price: 20.2 } })).toEqual({ when: "early", bars: 2, pricePct: 1 });
    expect(pickDiff({ ideal: { barIndex: 10, price: 20 }, yours: { barIndex: 10, price: 19.9 } })).toEqual({ when: "onTime", bars: 0, pricePct: -0.5 });
  });
});
