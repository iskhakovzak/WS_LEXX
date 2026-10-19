/**
 * routes/psychologyanalytics.ts — MAKSIM-33: an insight headline is phrased by the sign of its effect. The headline
 * metric leads the text, and a ΔR / Δ win rate pair pointing in opposite directions is a mixed (neutral) effect, not
 * a «sleep hurts» headline over «win rate is higher» text.
 */
import { describe, expect, it } from "vitest";
import { compareGroups, phraseOf, rankComparison } from "../psychologyanalytics";

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
