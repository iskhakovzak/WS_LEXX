import { describe, expect, it } from "vitest";
import { buildTradeSummary } from "./trade-summary";
import type { ExcursionResult } from "../types";

const exc = (p: Partial<ExcursionResult>): ExcursionResult => ({
  mfe: 0.5, mae: 0.36, mfeUsd: null, maeUsd: null, mfePct: null, maePct: null, mfeR: 0.5, maeR: -0.36,
  mfeAt: null, maeAt: null, mfePrice: null, maePrice: null, approximate: false, barsUsed: 10, ...p,
});

describe("trade summary — MAE in R (DENIS-08)", () => {
  it("keeps the MAE as a size like MAE per share (the panel prints it with a minus: «−0.36R»)", () => {
    const s = buildTradeSummary({ side: "long", avgEntry: 10, avgExit: 10.2, risk: 1, excursion: exc({}), entryTime: null, exitTime: null, pnlUsd: null });
    expect(s.maeR).toBeCloseTo(0.36);
    expect(s.maePerShare).toBeCloseTo(0.36);
    const fromRisk = buildTradeSummary({ side: "short", avgEntry: 10, avgExit: 9.8, risk: 0.5, excursion: exc({ maeR: null }), entryTime: null, exitTime: null, pnlUsd: null });
    expect(fromRisk.maeR).toBeCloseTo(0.72);
  });
});
