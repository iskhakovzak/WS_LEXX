import { describe, expect, it } from "vitest";
import type { Suggestion } from "./api";
import { holdoutNote, removalLine, suggestionBadges, visibleCards } from "./suggestion-badges";

const sg = (p: Partial<Suggestion> = {}): Suggestion => ({
  rule: { type: "excludeSide", side: "long" }, label: "", improvement: 100, ci: { lo: -10, hi: 200 }, tradesLeft: 50, excluded: 10,
  scenarioNet: 0, scenarioWinRate: null, scenarioProfitFactor: null, robust: true, kind: "exante", picked: false, sameData: false,
  holdout: null, affected: 10, changed: 0, estimate: false, ...p,
});
const ctx = (p: Partial<{ smallSample: boolean; team: boolean }> = {}) => ({ smallSample: false, team: false, ...p });

describe("visible cards", () => {
  it("shows 5 and keeps the rest behind «Ещё N»", () => {
    const list = Array.from({ length: 8 }, (_, i) => i);
    expect(visibleCards(list, false)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 3 });
    expect(visibleCards(list, true)).toEqual({ shown: list, hidden: 0 });
    expect(visibleCards(list.slice(0, 5), false)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 0 });
  });
});

describe("pills", () => {
  it("the tier: robust / weak, replaced by «мало данных» on a small sample", () => {
    expect(suggestionBadges(sg(), ctx())).toEqual(["robust"]);
    expect(suggestionBadges(sg({ robust: false }), ctx())).toEqual(["weak"]);
    expect(suggestionBadges(sg({ robust: undefined }), ctx())).toEqual(["robust"]);
    expect(suggestionBadges(sg(), ctx({ smallSample: true }))).toEqual(["smallSample"]);
  });

  it("one qualifier by priority: same data > own marks > per trader", () => {
    const day = sg({ rule: { type: "dailyLossLimit", usd: 100 } });
    expect(suggestionBadges(day, ctx({ team: true }))).toEqual(["robust", "perTrader"]);
    expect(suggestionBadges(day, ctx())).toEqual(["robust"]);
    expect(suggestionBadges(sg({ rule: { type: "excludeSide", side: "long" } }), ctx({ team: true }))).toEqual(["robust"]);
    expect(suggestionBadges(sg({ kind: "label", rule: { type: "dailyProfitTarget", usd: 1 } }), ctx({ team: true }))).toEqual(["robust", "label"]);
    expect(suggestionBadges(sg({ kind: "label", sameData: true, robust: false }), ctx({ team: true }))).toEqual(["weak", "sameData"]);
  });

  it("never more than two", () => {
    const all = sg({ kind: "label", sameData: true, rule: { type: "maxTradesPerDay", n: 3 } });
    expect(suggestionBadges(all, ctx({ team: true, smallSample: true }))).toEqual(["smallSample", "sameData"]);
  });
});

describe("removal line", () => {
  it("removes trades, or scales them down (an estimate)", () => {
    expect(removalLine(sg({ excluded: 12 }))).toEqual({ kind: "removes", count: 12 });
    expect(removalLine(sg({ excluded: 0, changed: 7, estimate: true }))).toEqual({ kind: "changes", count: 7 });
    expect(removalLine(sg({ excluded: 4, changed: undefined }))).toEqual({ kind: "removes", count: 4 });
  });
});

describe("holdout note in the robust tooltip", () => {
  it("«picked on the first two thirds» only for a picked card; any other card only says the last third was in the plus", () => {
    const h = { delta: 40, days: 20, affected: 6 };
    expect(holdoutNote(sg({ picked: true, holdout: h }))).toEqual({ key: "holdoutHint", days: 20 });
    expect(holdoutNote(sg({ picked: false, holdout: h, rule: { type: "stopAfterLosses", n: 2 } }))).toEqual({ key: "holdoutTailHint", days: 20 });
    expect(holdoutNote(sg({ picked: true, holdout: { ...h, delta: 0 } }))).toBeNull();
    expect(holdoutNote(sg({ picked: true, holdout: null }))).toBeNull();
  });
});
