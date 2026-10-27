import { describe, expect, it } from "vitest";
import type { HonestyInfo, HonestyState, Suggestion, SuggestionsResponse } from "./api";
import { cardLine, holdoutNote, needLine, preliminaryHintKey, removalLine, sectionNote, suggestionBadges, timingOf, visibleCards } from "./suggestion-badges";

const sg = (p: Partial<Suggestion> = {}): Suggestion => ({
  rule: { type: "excludeSide", side: "long" }, label: "", improvement: 100, ci: { lo: -10, hi: 200 }, tradesLeft: 50, excluded: 10,
  scenarioNet: 0, scenarioWinRate: null, scenarioProfitFactor: null, robust: true, kind: "exante", picked: false, sameData: false,
  holdout: null, affected: 10, changed: 0, estimate: false, ...p,
});
const ctx = (p: Partial<{ smallSample: boolean; team: boolean; honesty: HonestyInfo }> = {}) => ({ smallSample: false, team: false, ...p });
const honesty = (state: HonestyState, p: Partial<HonestyInfo> = {}): HonestyInfo => ({
  state, version: 1, computedAt: null, wfAvailable: null, months: null, testDays: null, confirmed: 0, hypotheses: 0, pollMs: null, ...p,
});
const resp = (h: HonestyInfo | undefined, suggestions: Suggestion[] = [sg()]): SuggestionsResponse => ({
  scope: "T0", period: { from: null, to: null, withEntryTime: 0, withHold: 0, withR: 0, withQty: 0 }, baselineNet: 0, trades: 100, days: 50,
  smallSample: false, suggestions, generatedAt: "", ...(h ? { honesty: h } : {}),
});

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

  it("one qualifier by priority: rests on a few days > same data > per trader; no own-marks pill (the review eyebrow says it)", () => {
    const day = sg({ rule: { type: "dailyLossLimit", usd: 100 } });
    expect(suggestionBadges(day, ctx({ team: true }))).toEqual(["robust", "perTrader"]);
    expect(suggestionBadges(day, ctx())).toEqual(["robust"]);
    expect(suggestionBadges(sg({ rule: { type: "excludeSide", side: "long" } }), ctx({ team: true }))).toEqual(["robust"]);
    expect(suggestionBadges(sg({ kind: "label", rule: { type: "dailyProfitTarget", usd: 1 } }), ctx({ team: true }))).toEqual(["robust", "perTrader"]);
    expect(suggestionBadges(sg({ kind: "label", rule: { type: "excludeSetups", setups: ["x"] } }), ctx())).toEqual(["robust"]);
    expect(suggestionBadges(sg({ kind: "label", sameData: true, robust: false }), ctx({ team: true }))).toEqual(["weak", "sameData"]);
    const fragile = sg({ fragile: { reason: "topDays", days: 3 }, sameData: true, rule: { type: "maxTradesPerDay", n: 2 } });
    expect(suggestionBadges(fragile, ctx({ team: true }))).toEqual(["robust", "fragile"]);
  });

  it("never more than two", () => {
    const all = sg({ kind: "label", sameData: true, fragile: { reason: "fewDays", days: 9 }, rule: { type: "maxTradesPerDay", n: 3 } });
    expect(suggestionBadges(all, ctx({ team: true, smallSample: true }))).toEqual(["smallSample", "fragile"]);
    for (const st of ["ready", "queued", "running", "failed", "unavailable", "team", "window"] as const) {
      expect(suggestionBadges({ ...all, status: "hypothesis" }, ctx({ team: true, smallSample: true, honesty: honesty(st) })).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("honest tier", () => {
  it("ready: confirmed / hypothesis by the card's status, even on a small sample", () => {
    const ready = ctx({ honesty: honesty("ready"), smallSample: true });
    expect(suggestionBadges(sg({ status: "confirmed" }), ready)).toEqual(["confirmed"]);
    expect(suggestionBadges(sg({ status: "hypothesis", robust: false, fragile: { reason: "fewDays", days: 7 } }), ready)).toEqual(["hypothesis", "fragile"]);
  });

  it("queued / running / failed / unavailable: every fast card is preliminary", () => {
    for (const st of ["queued", "running", "failed", "unavailable"] as const) {
      expect(suggestionBadges(sg({ status: "preliminary" }), ctx({ honesty: honesty(st) }))).toEqual(["preliminary"]);
      expect(suggestionBadges(sg({ robust: false }), ctx({ honesty: honesty(st), smallSample: true }))).toEqual(["preliminary"]);
    }
  });

  it("«предварительно» says «ещё считается» only while it is computed; failed / unavailable say the check is unavailable", () => {
    expect(preliminaryHintKey("queued")).toBe("preliminaryHint");
    expect(preliminaryHintKey("running")).toBe("preliminaryHint");
    expect(preliminaryHintKey("failed")).toBe("preliminaryUnavailableHint");
    expect(preliminaryHintKey("unavailable")).toBe("preliminaryUnavailableHint");
  });

  it("team scope, a rolling / closed period (window) and an older API (no honesty) keep today's pills", () => {
    expect(suggestionBadges(sg({ robust: false }), ctx({ honesty: honesty("window") }))).toEqual(["weak"]);
    expect(suggestionBadges(sg(), ctx({ honesty: honesty("window") }))).toEqual(["robust"]);
    expect(suggestionBadges(sg({ robust: false }), ctx({ honesty: honesty("team") }))).toEqual(["weak"]);
    expect(suggestionBadges(sg(), ctx({ honesty: honesty("team"), smallSample: true }))).toEqual(["smallSample"]);
    expect(suggestionBadges(sg({ robust: true }), ctx())).toEqual(["robust"]);
  });
});

describe("timing, card line, days needed", () => {
  it("timing from the server, else from kind (older API)", () => {
    expect(timingOf(sg({ timing: "inTrade" }))).toBe("inTrade");
    expect(timingOf(sg({ timing: undefined, kind: "label" }))).toBe("review");
    expect(timingOf(sg({ timing: undefined, kind: "exante" }))).toBe("exante");
    expect(timingOf(sg({ timing: undefined, kind: undefined }))).toBe("exante");
  });

  it("out of sample when the server sent it; else the 95% range — without a probability on an honest-era card (picked on these days)", () => {
    expect(cardLine(sg({ oos: { sum: 120, months: 5, positive: 4, testDays: 90 } }))).toBe("oos");
    expect(cardLine(sg({ oos: null }))).toBe("range");
    expect(cardLine(sg())).toBe("range");
    expect(cardLine(sg({ status: "hypothesis", oos: null, picked: true }))).toBe("rangeInSample");
    expect(cardLine(sg({ status: "preliminary" }))).toBe("rangeInSample");
    expect(cardLine(sg({ status: "confirmed", oos: { sum: 1, months: 6, positive: 5, testDays: 90 } }))).toBe("oos");
  });

  it("a hypothesis's next step: the days needed, «на всём периоде» when this period cannot gather them, a review for «разбор»", () => {
    expect(needLine(sg({ status: "hypothesis", needDays: 42, needDaysAtLeast: true }))).toEqual({ kind: "days", days: 42, atLeast: true });
    expect(needLine(sg({ status: "hypothesis", needDays: 21 }))).toEqual({ kind: "days", days: 21, atLeast: false });
    expect(needLine(sg({ status: "hypothesis", needDays: null }))).toBeNull();
    expect(needLine(sg({ status: "hypothesis", needDays: null, needAllTime: true }))).toEqual({ kind: "allTime" });
    // «разбор»: no number of days can confirm it — never a days line, even if an older server sent one.
    expect(needLine(sg({ status: "hypothesis", timing: "review", kind: "label", needDays: 21 }))).toEqual({ kind: "review" });
    expect(needLine(sg({ status: "hypothesis", timing: undefined, kind: "label", needDays: 21 }))).toEqual({ kind: "review" });
    expect(needLine(sg({ status: "confirmed", needDays: 30 }))).toBeNull();
    expect(needLine(sg({ status: "preliminary", needDays: 30 }))).toBeNull();
  });
});

describe("section note", () => {
  it("computing / unavailable / team / no confirmed rule yet; the plain hint otherwise", () => {
    expect(sectionNote(undefined)).toBeNull();
    expect(sectionNote(resp(undefined))).toBeNull();
    expect(sectionNote(resp(honesty("queued")))).toBe("computing");
    expect(sectionNote(resp(honesty("running")))).toBe("computing");
    expect(sectionNote(resp(honesty("failed")))).toBe("unavailable");
    expect(sectionNote(resp(honesty("unavailable")))).toBe("unavailable");
    expect(sectionNote(resp(honesty("team")))).toBe("team");
    expect(sectionNote(resp(honesty("window")))).toBe("window");
    // Pending for 3 min or more: no spinner promise («обычно до минуты»), the check is taking longer.
    expect(sectionNote(resp(honesty("running", { pendingMs: 3 * 60_000, pollMs: 30_000 })))).toBe("slow");
    expect(sectionNote(resp(honesty("queued", { pendingMs: 179_000 })))).toBe("computing");
    expect(sectionNote(resp(honesty("ready", { confirmed: 0, hypotheses: 2 })))).toBe("noConfirmed");
    expect(sectionNote(resp(honesty("ready", { confirmed: 1 })))).toBeNull();
    // Ready with no card at all: the honest empty state says it, the note stays plain.
    expect(sectionNote(resp(honesty("ready"), []))).toBeNull();
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
