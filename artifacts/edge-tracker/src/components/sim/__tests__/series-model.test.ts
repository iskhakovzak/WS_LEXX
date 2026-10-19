// «Серия из 10» pure logic: prefill from storage, the local fallback series, progress dots, the big result button's
// next step, summary picks (best / worst decision), the share of right decisions and the API normalizers.
import { describe, expect, it } from "vitest";
import {
  advanceLocal, choiceOf, gameSeriesOf, gameVerdictOf, goodShare, inSeries, isLocalSeries, localSeries, nextAction, progressDots, recordResult,
  resultOfGame, seriesPos, summaryPicks,
} from "../series-model";
import { normalizeSeries, normalizeVerdict, routeMissing, totalsOf, type SeriesResult, type SeriesState } from "../series-api";

const res = (gameId: number, outcome: SeriesResult["outcome"], r: number | null, correct: boolean | null = null): SeriesResult => ({ gameId, outcome, r, correct });
const state = (over: Partial<SeriesState> = {}): SeriesState => {
  const results = over.results ?? [];
  return { id: 7, size: 10, index: results.length, finished: false, results, totals: totalsOf(results), gameId: 100 + results.length, ...over };
};

describe("choiceOf (prefill)", () => {
  it("remembered level + bar size", () => {
    expect(choiceOf("hard", "1m")).toEqual({ mode: "intraday", difficulty: "hard", tf: "1m" });
    expect(choiceOf("medium", "1d")).toEqual({ mode: "swing", difficulty: "medium", tf: null });
  });
  it("garbage in storage → easy · 5m", () => {
    expect(choiceOf(null, undefined)).toEqual({ mode: "intraday", difficulty: "easy", tf: "5m" });
    expect(choiceOf("insane", "3m")).toEqual({ mode: "intraday", difficulty: "easy", tf: "5m" });
  });
});

describe("local fallback series", () => {
  it("records each finished game once and advances to the end", () => {
    let s = localSeries(11, 3);
    expect(isLocalSeries(s)).toBe(true);
    expect(s.index).toBe(0);
    s = recordResult(s, resultOfGame(11, 2, 1.234));
    s = recordResult(s, resultOfGame(11, 2, 1.234));
    expect(s.results).toEqual([res(11, "traded", 1.23)]);
    s = advanceLocal(s, 12);
    expect(s).toMatchObject({ index: 1, gameId: 12, finished: false });
    s = recordResult(s, resultOfGame(12, 0, 0));
    expect(s.results[1]).toEqual(res(12, "no_trade", null));
    s = advanceLocal(advanceLocal(s, 13), 14);
    expect(s).toMatchObject({ finished: true, gameId: null });
    expect(s.totals).toMatchObject({ traded: 1, noTrade: 1, skipped: 0, netR: 1.23 });
  });
  it("server series are not local", () => expect(isLocalSeries(state())).toBe(false));
});

describe("progress", () => {
  it("dots by outcome, the current game, the rest ahead", () => {
    const s = state({ results: [res(1, "traded", 2), res(2, "traded", -1), res(3, "no_trade", 0, true), res(4, "no_trade", 0, false), res(5, "skipped", null), res(6, "traded", 0.01)] });
    expect(progressDots(s)).toEqual(["win", "loss", "good", "miss", "skip", "even", "current", "todo", "todo", "todo"]);
    expect(progressDots({ ...s, finished: true })[6]).toBe("todo");
  });
  it("«3 / 10» from the 0-based index, clamped", () => {
    expect(seriesPos(state({ index: 2 }))).toEqual({ n: 3, size: 10 });
    expect(seriesPos(state({ index: 12 }))).toEqual({ n: 10, size: 10 });
    // A reviewed game of the series: its own place, not the current one.
    expect(seriesPos(state({ index: 9, results: [res(1, "traded", 1), res(2, "skipped", null), res(3, "traded", -1)] }), 3)).toEqual({ n: 3, size: 10 });
  });
});

describe("nextAction — the big result button", () => {
  it("a series game → next until the last one, then the summary", () => {
    expect(nextAction(state({ index: 2, gameId: 50 }), 50)).toBe("next");
    expect(nextAction(state({ index: 9, gameId: 50 }), 50)).toBe("summary");
    expect(nextAction(state({ finished: true, results: [res(50, "traded", 1)], gameId: null }), 50)).toBe("summary");
  });
  it("a game tagged with the series id counts as a series game", () => {
    expect(inSeries(state({ gameId: 1 }), 99, 7)).toBe(true);
    expect(nextAction(state({ gameId: 1, index: 3 }), 99, 7)).toBe("next");
    expect(nextAction(state({ gameId: 1 }), 99, 8)).toBeNull();
  });
  it("not a series game → null (the usual «again»)", () => {
    expect(nextAction(null, 5)).toBeNull();
    expect(nextAction(state({ gameId: 1 }), 5)).toBeNull();
  });
});

describe("summary picks", () => {
  it("best = biggest win, worst = biggest loss; skips never count", () => {
    const p = summaryPicks([res(1, "traded", 0.5), res(2, "skipped", null), res(3, "traded", 2.4), res(4, "traded", -1.2), res(5, "no_trade", 0, false)]);
    expect(p.best).toEqual({ result: res(3, "traded", 2.4), n: 3 });
    expect(p.worst).toEqual({ result: res(4, "traded", -1.2), n: 4 });
  });
  it("no wins → a correct «no trade» is the best; no losses → a missed move is the worst", () => {
    const p = summaryPicks([res(1, "traded", 0), res(2, "no_trade", 0, true), res(3, "no_trade", 0, false)]);
    expect(p.best?.n).toBe(2);
    expect(p.worst?.n).toBe(3);
  });
  it("only losing trades: the least bad is the best, the worst differs", () => {
    const p = summaryPicks([res(1, "traded", -0.4), res(2, "traded", -2)]);
    expect(p.best?.n).toBe(1);
    expect(p.worst?.n).toBe(2);
  });
  it("one trade only → no separate worst; nothing played → nothing", () => {
    expect(summaryPicks([res(1, "traded", -1)])).toEqual({ best: { result: res(1, "traded", -1), n: 1 }, worst: null });
    expect(summaryPicks([res(1, "skipped", null)])).toEqual({ best: null, worst: null });
  });
  it("share of right decisions (scored ones only)", () => {
    expect(goodShare([res(1, "traded", 1), res(2, "traded", -1), res(3, "no_trade", 0, true), res(4, "no_trade", 0, null), res(5, "skipped", null)])).toBeCloseTo(2 / 3);
    expect(goodShare([res(1, "skipped", null)])).toBeNull();
  });
});

describe("API normalizers", () => {
  it("series: currentGameId, totals recomputed when absent, unknown outcomes dropped, level kept", () => {
    const s = normalizeSeries({
      id: 4, size: 10, index: 2, finished: false, currentGameId: 77, mode: "intraday", difficulty: "hard", tf: "1m",
      results: [{ gameId: 1, outcome: "traded", r: 1.5, correct: null }, { gameId: 2, outcome: "weird" }, { gameId: 3, outcome: "no_trade", r: 0, correct: true }],
    });
    expect(s).toMatchObject({ id: 4, index: 2, gameId: 77, mode: "intraday", difficulty: "hard", tf: "1m" });
    expect(s?.results.map((x) => x.gameId)).toEqual([1, 3]);
    expect(s?.totals).toEqual({ traded: 1, noTrade: 1, skipped: 0, netR: 1.5, correctNoTrade: 1 });
    expect(normalizeSeries({ id: 1, mode: "swing", tf: "1d" })?.tf).toBeNull();
    expect(normalizeSeries(null)).toBeNull();
    expect(normalizeSeries({ size: 3 })).toBeNull();
  });
  it("verdict: reason fallback from the missed side; junk → null", () => {
    expect(normalizeVerdict({ correct: false, bestR: 2.3, reasonKey: "noTrade.missedShort", missed: { side: "short", entry: 10, extreme: 9.5, r: 2.3 } }))
      .toEqual({ correct: false, bestR: 2.3, reasonKey: "noTrade.missedShort", missed: { side: "short", entry: 10, extreme: 9.5, r: 2.3 } });
    expect(normalizeVerdict({ correct: false, bestR: 2, reasonKey: "x", missed: { side: "short" } })?.reasonKey).toBe("noTrade.missedShort");
    expect(normalizeVerdict({ correct: true, bestR: 0.8 })).toEqual({ correct: true, bestR: 0.8, reasonKey: "noTrade.correct", missed: null });
    expect(normalizeVerdict({ bestR: 1 })).toBeNull();
  });
  it("snapshot fields: series tag and the stored verdict", () => {
    expect(gameSeriesOf({ series: { id: 3, index: 1, size: 10 } })).toEqual({ id: 3, index: 1, size: 10 });
    expect(gameSeriesOf({ series: null })).toBeNull();
    expect(gameSeriesOf({})).toBeNull();
    expect(gameVerdictOf({ noTrade: { correct: true, bestR: 1.1, reasonKey: "noTrade.correct" } })?.correct).toBe(true);
    expect(gameVerdictOf({ noTrade: null })).toBeNull();
  });
  it("route missing = 404 / 405 / 501 (fall back), other errors are real", () => {
    expect(routeMissing({ status: 404 })).toBe(true);
    expect(routeMissing({ status: 405 })).toBe(true);
    expect(routeMissing({ status: 409 })).toBe(false);
    expect(routeMissing(null)).toBe(false);
  });
});
