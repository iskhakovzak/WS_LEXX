/**
 * Library of analogues — the similarity ranking (lib/analogues/model): gap bands, the gap as the stand-in direction,
 * weights per trait, the minimum score, the order (score → recency → ticker), the query day excluded, quiz choices.
 * Synthetic tickers only.
 */
import { describe, expect, it } from "vitest";
import { directionOf, gapBand, parseBands, quizChoices, rankAnalogues, similarity, type Profile } from "../analogues/model";

const W = { setup: 3, kind: 2, gap: 2, direction: 2, strength: 1, regime: 1 };
const BANDS = parseBands("2,5,10,20");
const p = (o: Partial<Profile> & Pick<Profile, "ticker" | "day">): Profile => ({ setupId: null, kind: null, direction: null, strength: null, gapPct: null, regime: null, ...o });
const Q = p({ ticker: "QRY", day: "2026-10-28", setupId: 7, kind: "earnings", direction: "bull", strength: "strong", gapPct: 8, regime: "trend" });

describe("gap bands and direction", () => {
  it("parses the desk's band edges and places |gap| between them", () => {
    expect(parseBands("10, 2;5 x 20 -1 5")).toEqual([2, 5, 10, 20]);
    expect([0.5, 2, 4.9, 5, -12, 25, null].map((g) => gapBand(g, BANDS))).toEqual([0, 1, 1, 2, 3, 4, null]);
  });

  it("the gap stands in for an unmarked direction (not under the first edge)", () => {
    expect(directionOf({ direction: null, gapPct: -6 }, BANDS)).toBe("bear");
    expect(directionOf({ direction: null, gapPct: 1 }, BANDS)).toBeNull();
    expect(directionOf({ direction: "bull", gapPct: -6 }, BANDS)).toBe("bull");
  });
});

describe("similarity and ranking", () => {
  it("adds the weight of every matching trait; the next gap band counts half", () => {
    expect(similarity(Q, p({ ticker: "A", day: "2026-01-05", setupId: 7, kind: "earnings", direction: "bull", strength: "strong", gapPct: 7, regime: "trend" }), W, BANDS))
      .toEqual({ score: 11, matched: ["setup", "kind", "gap", "direction", "strength", "regime"] });
    expect(similarity(Q, p({ ticker: "B", day: "2026-01-05", gapPct: 12 }), W, BANDS)).toEqual({ score: 3, matched: ["gapNear", "direction"] });
    expect(similarity(Q, p({ ticker: "C", day: "2026-01-05", gapPct: -30, kind: "news" }), W, BANDS)).toEqual({ score: 0, matched: [] });
  });

  it("ranks by score, then the more recent case; drops the query day and weak matches", () => {
    const cands = [
      p({ ticker: "OLD", day: "2025-03-10", setupId: 7, kind: "earnings", gapPct: 6 }), // 3 + 2 + 2 + 2 = 9
      p({ ticker: "NEW", day: "2026-09-10", setupId: 7, kind: "earnings", gapPct: 9 }), // 9, more recent
      p({ ticker: "KIND", day: "2026-09-11", kind: "earnings" }), // 2
      p({ ticker: "QRY", day: "2026-10-28", setupId: 7, kind: "earnings" }), // the query day itself
      p({ ticker: "REG", day: "2026-09-12", regime: "trend", strength: "strong", kind: "earnings" }), // 2 + 1 + 1 = 4
    ];
    const out = rankAnalogues(Q, cands, { weights: W, bands: BANDS, minScore: 3, limit: 10 });
    expect(out.map((c) => [c.ticker, c.score])).toEqual([["NEW", 9], ["OLD", 9], ["REG", 4]]);
    expect(rankAnalogues(Q, cands, { weights: W, bands: BANDS, minScore: 3, limit: 1 }).map((c) => c.ticker)).toEqual(["NEW"]);
  });

  it("the weights are the desk's: a zero weight ignores its trait", () => {
    const cands = [p({ ticker: "SET", day: "2026-01-02", setupId: 7 }), p({ ticker: "REG", day: "2026-01-03", regime: "trend", kind: "earnings" })];
    expect(rankAnalogues(Q, cands, { weights: { ...W, setup: 0 }, bands: BANDS, minScore: 0, limit: 5 }).map((c) => c.ticker)).toEqual(["REG"]);
  });
});

describe("quiz choices", () => {
  it("always holds the right setup, at most n options, no duplicates", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pool = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `S${id}` }));
    for (let i = 0; i < 20; i++) {
      const c = quizChoices(pool[2], pool, 4, rand);
      expect(c).toHaveLength(4);
      expect(c.some((x) => x.id === 3)).toBe(true);
      expect(new Set(c.map((x) => x.id)).size).toBe(4);
    }
    expect(quizChoices(pool[0], pool.slice(0, 2), 4, rand)).toHaveLength(2);
  });
});
