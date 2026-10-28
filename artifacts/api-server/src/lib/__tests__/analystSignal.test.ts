/**
 * Analyst cluster → catalyst strength suggestion (lib/catalyst/analystSignal) and the day-two lines it feeds
 * (lib/catalyst/model dayTwoHints). Synthetic tickers and firms only.
 */
import { describe, expect, it } from "vitest";
import { analystSignals, dayTwoAnalyst, signalsForDay, withAnalystStrength, type AnalystAct, type HintLike } from "../catalyst/analystSignal";
import { dayTwoHints, type CatalystMark } from "../catalyst/model";

const OPTS = { clusterMin: 3, windowHours: 24, targetPct: 50 };
const act = (ticker: string, iso: string, firm: string, action: string, extra: Partial<AnalystAct> = {}): AnalystAct => ({ ticker, at: new Date(iso), firm, action, ...extra });

describe("analyst cluster → strength", () => {
  it("three firms upgrading within 24 h make a strong bullish suggestion; two do not", () => {
    const acts = [
      act("SYNA", "2026-10-26T11:00:00Z", "Firm A", "up"),
      act("SYNA", "2026-10-26T13:00:00Z", "Firm B", "up"),
      act("SYNA", "2026-10-27T10:00:00Z", "Firm C", "init", { toGrade: "Buy" }),
      act("SYNB", "2026-10-26T11:00:00Z", "Firm A", "up"),
      act("SYNB", "2026-10-26T12:00:00Z", "Firm B", "up"),
    ];
    const s = analystSignals(acts, OPTS);
    expect(s.map((x) => [x.ticker, x.direction, x.reason, x.count, x.strength])).toEqual([["SYNA", "bull", "cluster", 3, "strong"]]);
    expect(s[0].acts[0].at).toBe("2026-10-27T10:00:00.000Z"); // newest first, release time kept
  });

  it("the window and the firm count are honoured; the same firm twice counts once", () => {
    const spread = [
      act("SYNC", "2026-10-20T11:00:00Z", "Firm A", "down"),
      act("SYNC", "2026-10-21T13:00:00Z", "Firm B", "down"),
      act("SYNC", "2026-10-22T15:00:00Z", "Firm C", "down"),
    ];
    expect(analystSignals(spread, OPTS)).toEqual([]);
    expect(analystSignals(spread, { ...OPTS, windowHours: 72 })[0]).toMatchObject({ direction: "bear", count: 3 });
    const twice = [act("SYND", "2026-10-20T11:00:00Z", "Firm A", "up"), act("SYND", "2026-10-20T12:00:00Z", "firm a", "up"), act("SYND", "2026-10-20T13:00:00Z", "Firm B", "up")];
    expect(analystSignals(twice, OPTS)).toEqual([]);
    expect(analystSignals(twice, { ...OPTS, clusterMin: 2 })[0].count).toBe(2);
  });

  it("opposite clusters of the same size cancel out; a target change ≥ 50 % suggests on its own", () => {
    const mixed = [
      act("SYNE", "2026-10-20T11:00:00Z", "Firm A", "up"), act("SYNE", "2026-10-20T11:30:00Z", "Firm B", "up"), act("SYNE", "2026-10-20T12:00:00Z", "Firm C", "up"),
      act("SYNE", "2026-10-20T13:00:00Z", "Firm D", "down"), act("SYNE", "2026-10-20T14:00:00Z", "Firm E", "down"), act("SYNE", "2026-10-20T15:00:00Z", "Firm F", "down"),
    ];
    expect(analystSignals(mixed, OPTS)).toEqual([]);
    const pt = [
      act("SYNF", "2026-10-20T11:00:00Z", "Firm A", "main", { priceTarget: "30", priceTargetFrom: "20" }),
      act("SYNG", "2026-10-20T11:00:00Z", "Firm A", "main", { priceTarget: "$12", priceTargetFrom: "$25" }),
      act("SYNH", "2026-10-20T11:00:00Z", "Firm A", "main", { priceTarget: "28", priceTargetFrom: "20" }),
    ];
    const s = analystSignals(pt, OPTS);
    expect(s.map((x) => [x.ticker, x.direction, x.reason, x.targetPct])).toEqual([["SYNF", "bull", "target", 50], ["SYNG", "bear", "target", -52]]);
  });

  it("a plan day only takes the signals that react on it (after the close → the next session)", () => {
    const acts = [
      act("SYNA", "2026-10-26T20:30:00Z", "Firm A", "up"), // 16:30 NY Mon → reacts Tue
      act("SYNA", "2026-10-27T11:00:00Z", "Firm B", "up"),
      act("SYNA", "2026-10-27T12:00:00Z", "Firm C", "up"),
    ];
    expect(signalsForDay(acts, "2026-10-27", OPTS).map((s) => s.ticker)).toEqual(["SYNA"]);
    expect(signalsForDay(acts, "2026-10-26", OPTS)).toEqual([]);
  });

  it("pre-fills strength on the day's hints without overriding a contrary direction", () => {
    const signals = analystSignals([
      act("UPX", "2026-10-20T11:00:00Z", "A", "up"), act("UPX", "2026-10-20T12:00:00Z", "B", "up"), act("UPX", "2026-10-20T13:00:00Z", "C", "up"),
      act("CON", "2026-10-20T11:00:00Z", "A", "up"), act("CON", "2026-10-20T12:00:00Z", "B", "up"), act("CON", "2026-10-20T13:00:00Z", "C", "up"),
      act("NEW", "2026-10-20T11:00:00Z", "A", "main", { priceTarget: "90", priceTargetFrom: "40" }),
    ], OPTS);
    const hints: HintLike[] = [
      { ticker: "UPX", direction: null, kind: "earnings", source: "earnings", movePct: null },
      { ticker: "CON", direction: "bear", kind: "other", source: "gap", movePct: -4 },
    ];
    const out = withAnalystStrength(hints, signals, ["UPX", "CON", "NEW", "NONE"]);
    expect(out.map((h) => [h.ticker, h.direction, h.strength ?? null, h.source])).toEqual([
      ["UPX", "bull", "strong", "earnings"],
      ["CON", "bear", null, "gap"],
      ["NEW", "bull", "strong", "analyst"],
    ]);
  });
});

describe("analyst comments the day after a catalyst → day two", () => {
  const mark = (o: Partial<CatalystMark> & Pick<CatalystMark, "ticker">): CatalystMark => ({
    trader: "Synth A", day: "2026-10-26", direction: null, strength: null, kind: null, source: "plan", suggested: false, ...o,
  });

  it("a ticker with yesterday's catalyst and today's analyst comments is a candidate below the move bar", () => {
    const analyst = dayTwoAnalyst([
      act("CATX", "2026-10-27T11:00:00Z", "Firm A", "up"),
      act("NOCT", "2026-10-27T11:00:00Z", "Firm A", "up"), // no catalyst yesterday → not a day two
      act("OLDX", "2026-10-26T11:00:00Z", "Firm A", "up"), // reacts on the catalyst day itself
    ], "2026-10-27");
    expect([...analyst.keys()].sort()).toEqual(["CATX", "NOCT"]);
    const hints = dayTwoHints({
      marks: [mark({ ticker: "CATX", strength: "weak", direction: "bull" }), mark({ ticker: "OLDX", strength: "weak", direction: "bull" })],
      events: [],
      moves: new Map([["CATX", 1.2], ["OLDX", 1.1]]),
      minMovePct: 4,
      setups: [],
      analyst,
    });
    expect(hints.map((h) => [h.ticker, h.direction, h.source])).toEqual([["CATX", "bull", "analyst"]]);
  });
});
