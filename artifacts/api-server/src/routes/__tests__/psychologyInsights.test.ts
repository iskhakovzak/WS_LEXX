/**
 * routes/psychologyanalytics.ts — MAKSIM-33: an insight headline is phrased by the sign of its effect. The headline
 * metric leads the text, and a ΔR / Δ win rate pair pointing in opposite directions is a mixed (neutral) effect, not
 * a «sleep hurts» headline over «win rate is higher» text.
 */
import { describe, expect, it } from "vitest";
import { MIN_WR_PP, compareGroups, extremeStates, phraseOf, rankComparison } from "../psychologyanalytics";

type Row = Parameters<typeof compareGroups>[2][number];
let id = 0;
const trade = (result: "win" | "loss", r: number): Row =>
  ({ id: ++id, result, rMultiple: String(r), date: "2026-10-01", ticker: "AAPL" }) as unknown as Row;

describe("psychology insights: headline by effect sign (MAKSIM-33)", () => {
  // With the factor: 6 W / 4 L, avg +0.07R. Without: 5 W / 5 L, avg +0.13R → WR +10 pp, R −0.06.
  const withF = [...Array.from({ length: 6 }, () => trade("win", 0.5)), ...Array.from({ length: 4 }, () => trade("loss", 0.575))];
  const withoutF = [...Array.from({ length: 5 }, () => trade("win", 0.85)), ...Array.from({ length: 5 }, () => trade("loss", 0.59))];

  it("the R part leads the text, the win-rate part follows", () => {
    const c = compareGroups("sleepWell", phraseOf("factors", "sleepWell", "ru"), withF, withoutF, "ru")!;
    expect(c.deltaR).toBeCloseTo(-0.06, 2);
    expect(c.deltaWinRatePp).toBe(10);
    expect(c.text.indexOf("+0.07R")).toBeGreaterThan(-1);
    expect(c.text.indexOf("+0.07R")).toBeLessThan(c.text.indexOf("10"));
  });

  it("opposite ΔR and Δ win rate → neutral tone (mixed), never a red headline", () => {
    const c = compareGroups("sleepWell", phraseOf("factors", "sleepWell", "ru"), withF, withoutF, "ru")!;
    const r = rankComparison(c, "ru");
    expect(r.tone).toBe("neutral");
    expect(r.title).toContain("0.06R");
  });

  it("agreeing signs keep the tone of the effect", () => {
    const worse = [...Array.from({ length: 3 }, () => trade("win", 0.5)), ...Array.from({ length: 7 }, () => trade("loss", 1))];
    const better = [...Array.from({ length: 7 }, () => trade("win", 1)), ...Array.from({ length: 3 }, () => trade("loss", 1))];
    const down = rankComparison(compareGroups("tilted", phraseOf("factors", "tilted", "en"), worse, better, "en")!, "en");
    const up = rankComparison(compareGroups("focused", phraseOf("factors", "focused", "en"), better, worse, "en")!, "en");
    expect(down.tone).toBe("down");
    expect(up.tone).toBe("up");
  });
  it("phrases the headline in words by the sign (worse / better / mixed)", () => {
    const worse = [...Array.from({ length: 3 }, () => trade("win", 0.5)), ...Array.from({ length: 7 }, () => trade("loss", 1))];
    const better = [...Array.from({ length: 7 }, () => trade("win", 1)), ...Array.from({ length: 3 }, () => trade("loss", 1))];
    const down = rankComparison(compareGroups("tilted", phraseOf("factors", "tilted", "ru"), worse, better, "ru")!, "ru");
    expect(down.title).toMatch(/хуже на сделку$/);
    expect(down.title).not.toContain("−");
    const mixed = rankComparison(compareGroups("sleepWell", phraseOf("factors", "sleepWell", "ru"), withF, withoutF, "ru")!, "ru");
    expect(mixed.title).toContain("смешанный");
  });
});

describe("psychology insights: no conclusions from noise (IMPROVEMENT_PLAN 2.7)", () => {
  const book = (wins: number, losses: number, r = 0) => [
    ...Array.from({ length: wins }, () => trade("win", r)), ...Array.from({ length: losses }, () => trade("loss", r)),
  ];

  it("a 3–4 pp win-rate gap with no R difference is no insight (audit: samples of 45 and 78 trades)", () => {
    // 45 trades at 47 % vs 78 trades at 44 % (≈ 3 pp), equal R per trade.
    expect(compareGroups("afterLoss", phraseOf("behavior", "afterLoss", "ru"), book(21, 24), book(34, 44), "ru")).toBeNull();
    // 4 pp: still noise.
    expect(compareGroups("overtrading", phraseOf("behavior", "overtrading", "en"), book(12, 13), book(11, 14), "en")).toBeNull();
  });

  it(`from ${MIN_WR_PP} pp it is an insight; a sub-threshold win-rate gap next to a real R effect is «about the same», not «mixed»`, () => {
    expect(compareGroups("overtrading", phraseOf("behavior", "overtrading", "en"), book(11, 9), book(9, 11), "en")?.deltaWinRatePp).toBe(10);
    const withF = book(13, 12).map((x, i) => ({ ...x, rMultiple: i < 13 ? "1" : "0.5" })); // +1R wins, −0.5R losses
    const withoutF = book(12, 13, 0.4);
    const c = compareGroups("focused", phraseOf("factors", "focused", "en"), withF, withoutF, "en")!;
    expect(Math.abs(c.deltaWinRatePp!)).toBeLessThan(MIN_WR_PP);
    expect(c.text).toContain("about the same");
    expect(rankComparison(c, "en").title).not.toContain("mixed");
  });

  it("«best state» is never «normal» and needs a marked state ≥ 5 pp above the overall win rate", () => {
    // The audit case: no check-in matched a trade — only «normal» (WR 45 %) has trades.
    expect(extremeStates([{ state: "normal", count: 40, winRate: 0.45 }, { state: "focused", count: 0, winRate: null }], 0.45)).toEqual({ best: null, worst: null });
    // A marked state 3 pp above the overall one is noise.
    expect(extremeStates([{ state: "focused", count: 30, winRate: 0.48 }, { state: "stressed", count: 20, winRate: 0.42 }], 0.45)).toEqual({ best: null, worst: null });
    // Real gaps: best / worst among marked states; sleepWell and too-small groups are skipped.
    expect(extremeStates([
      { state: "focused", count: 20, winRate: 0.6 }, { state: "tilted", count: 10, winRate: 0.3 },
      { state: "sleepWell", count: 50, winRate: 0.9 }, { state: "anxious", count: 2, winRate: 1 }, { state: "normal", count: 50, winRate: 0.7 },
    ], 0.45)).toEqual({ best: "focused", worst: "tilted" });
    expect(extremeStates([{ state: "focused", count: 20, winRate: 0.6 }], null)).toEqual({ best: null, worst: null });
  });
});
