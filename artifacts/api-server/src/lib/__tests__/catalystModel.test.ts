/**
 * Catalyst direction × strength (lib/catalyst/model, lib/strategyFormula): the automatic trade ↔ mark link, the slice
 * by strength × direction with its «no catalyst marked» bucket and the per-setup cells on the shared $ math, the
 * insight line, the day-two selection and the formula check. Synthetic traders and trades only.
 */
import { describe, expect, it } from "vitest";
import {
  bucketOf, catalystEdge, dayTwoHints, dayTwoSetup, formulaBreaks, hintFrom, linkMarks,
  type CatalystMark, type CatalystTrade, type SetupLite,
} from "../catalyst/model";
import { computeUsdStats } from "../playbookEdge";
import { isCompleteFormula, normFormula } from "../strategyFormula";

const mark = (o: Partial<CatalystMark> & Pick<CatalystMark, "ticker">): CatalystMark => ({
  trader: "Synth A", day: "2026-10-20", direction: null, strength: null, kind: null, source: "plan", suggested: false, ...o,
});
let nextId = 1;
const trade = (o: Partial<CatalystTrade> & Pick<CatalystTrade, "ticker" | "pnl">): CatalystTrade => ({
  id: nextId++, trader: "Synth A", day: "2026-10-20", result: Number(o.pnl) > 0 ? "win" : Number(o.pnl) < 0 ? "loss" : "be",
  fees: 1, setupId: 10, setupName: "Opening Drive", ...o,
});

describe("trade ↔ mark link", () => {
  it("matches by trader, entry day and ticker only (no trade input)", () => {
    const t1 = trade({ ticker: "TMUS", pnl: 100 });
    const t2 = trade({ ticker: "TMUS", pnl: 50, day: "2026-10-21" });
    const t3 = trade({ ticker: "TMUS", pnl: 50, trader: "Synth B" });
    const m = mark({ ticker: "TMUS", strength: "strong", direction: "bear" });
    const link = linkMarks([t1, t2, t3], [m]);
    expect(link.get(t1.id)).toBe(m);
    expect(link.get(t2.id)).toBeNull();
    expect(link.get(t3.id)).toBeNull();
  });

  it("a cleared mark (both taps null) is «no catalyst marked»", () => {
    expect(bucketOf(mark({ ticker: "X" }))).toBe("none");
    expect(bucketOf(null)).toBe("none");
    expect(bucketOf(mark({ ticker: "X", strength: "weak" }))).toBe("weak_unset");
    expect(bucketOf(mark({ ticker: "X", strength: "strong", direction: "bull" }))).toBe("strong_bull");
  });
});

describe("catalystEdge", () => {
  const marks = [
    mark({ ticker: "AAA", strength: "strong", direction: "bull" }),
    mark({ ticker: "BBB", strength: "weak", direction: "bear" }),
    mark({ ticker: "CCC", strength: "weak", direction: "bull" }),
    mark({ ticker: "DDD", strength: "weak", direction: "bull" }),
  ];
  const trades = [
    trade({ ticker: "AAA", pnl: 300 }),
    trade({ ticker: "AAA", pnl: -100 }),
    trade({ ticker: "BBB", pnl: -80 }),
    trade({ ticker: "CCC", pnl: -60 }),
    trade({ ticker: "DDD", pnl: -40 }),
    trade({ ticker: "EEE", pnl: 20 }), // no mark
    trade({ ticker: "FFF", pnl: -10, setupId: null, setupName: null }), // no mark, no setup
  ];
  const edge = catalystEdge(trades, marks);

  it("buckets by strength × direction with the shared $ math, «none» honestly last", () => {
    expect(edge.total).toBe(7);
    expect(edge.marked).toBe(5);
    expect(edge.buckets.map((b) => b.key)).toEqual(["strong_bull", "weak_bull", "weak_bear", "none"]);
    const strongBull = edge.buckets.find((b) => b.key === "strong_bull")!;
    expect(strongBull).toMatchObject(computeUsdStats(trades.slice(0, 2)));
    expect(strongBull).toMatchObject({ n: 2, wins: 1, losses: 1, net: 198, expectancy: 99, winrate: 0.5 });
    expect(edge.buckets.find((b) => b.key === "none")).toMatchObject({ n: 2, net: 8, strength: null, direction: null });
  });

  it("per setup × strength, and the costliest cell with enough trades is the insight", () => {
    expect(edge.bySetup).toHaveLength(1);
    const od = edge.bySetup[0]!;
    expect(od).toMatchObject({ setupId: 10, setupName: "Opening Drive", n: 6 });
    expect(od.cells.map((c) => [c.strength, c.n, c.net])).toEqual([["strong", 2, 198], ["weak", 3, -183], ["none", 1, 19]]);
    expect(edge.insight).toEqual({ setupId: 10, setupName: "Opening Drive", strength: "weak", n: 3, net: -183 });
  });

  it("no insight below the minimum sample", () => {
    expect(catalystEdge(trades.slice(0, 2), marks).insight).toBeNull();
  });
});

describe("suggestions", () => {
  it("event first, then earnings with the gap, then the gap alone", () => {
    const events = [
      { ticker: "AAA", kind: "news" as const, direction: "bear" as const, movePct: -6, source: "event" as const },
      { ticker: "BBB", kind: "earnings" as const, direction: null, movePct: null, source: "earnings" as const },
    ];
    expect(hintFrom("AAA", events, 3)).toMatchObject({ direction: "bear", kind: "news", source: "event" });
    expect(hintFrom("BBB", events, 4.2)).toMatchObject({ direction: "bull", kind: "earnings", source: "earnings" });
    expect(hintFrom("CCC", events, -2.5)).toMatchObject({ direction: "bear", kind: null, source: "gap" });
    expect(hintFrom("DDD", events, 0.5)).toBeNull();
  });
});

describe("day two", () => {
  const setups: SetupLite[] = [
    { id: 1, name: "Opening Drive", setupType: "Opening Drive", formula: null },
    { id: 2, name: "Second Day Play", setupType: "Second Day Play", formula: normFormula({ catalyst: { strength: "strong", direction: "bear" }, setup: "x", trade: "y" }) },
    { id: 3, name: "Gap continuation", setupType: null, formula: normFormula({ catalyst: { strength: "strong", direction: "bull" }, setup: "x", trade: "y" }) },
  ];

  it("picks yesterday's strong catalysts that moved big, in their direction, and links the setup", () => {
    const hints = dayTwoHints({
      marks: [
        mark({ ticker: "TMUS", strength: "strong", direction: "bear" }),
        mark({ ticker: "WEAK", strength: "weak", direction: "bull" }),
        mark({ ticker: "SMALL", strength: "strong", direction: "bull" }),
        mark({ ticker: "AGAINST", strength: "strong", direction: "bull" }),
      ],
      events: [
        { ticker: "WEAK", kind: "news", direction: "bull", movePct: 9, source: "event" }, // the trader called it weak
        { ticker: "NVDA", kind: "earnings", direction: null, movePct: null, source: "earnings" },
      ],
      moves: new Map([["TMUS", -7.5], ["WEAK", 9], ["SMALL", 1.2], ["AGAINST", -6], ["NVDA", 5.1]]),
      minMovePct: 4,
      setups,
    });
    expect(hints.map((h) => [h.ticker, h.direction, h.source, h.setupId])).toEqual([
      ["TMUS", "bear", "mark", 2],
      ["NVDA", "bull", "earnings", 3],
    ]);
  });

  it("the day-two setup matches the direction; a formula pointing the other way is never offered", () => {
    expect(dayTwoSetup(setups, "bear")?.id).toBe(2);
    expect(dayTwoSetup(setups, "bull")?.id).toBe(3);
    expect(dayTwoSetup(setups.slice(0, 1), "bull")).toBeNull();
  });
});

describe("strategy formula", () => {
  it("normalises to codes and trimmed lines; empty is null", () => {
    expect(normFormula({ catalyst: { kind: "earnings", strength: "strong", direction: "sideways" }, setup: "  Opening   Drive ", trade: "" })).toEqual({
      catalyst: { kind: "earnings", strength: "strong", direction: null }, setup: "Opening Drive", trade: null,
    });
    expect(normFormula({ catalyst: {}, setup: " ", trade: null })).toBeNull();
    expect(normFormula("text")).toBeNull();
    expect(isCompleteFormula(normFormula({ catalyst: { strength: "strong" }, setup: "a", trade: "b" }))).toBe(true);
    expect(isCompleteFormula(normFormula({ setup: "a", trade: "b" }))).toBe(false);
  });

  it("flags trades entered without the catalyst the formula needs", () => {
    const f = normFormula({ catalyst: { strength: "strong", direction: "bull" }, setup: "a", trade: "b" })!;
    const t = (id: number, ticker: string) => ({ id, trader: "Synth A", day: "2026-10-20", ticker, setupId: 7, setupName: "ORB" });
    const out = formulaBreaks(
      [t(1, "OK"), t(2, "NONE"), t(3, "WEAK"), t(4, "BEAR")],
      new Map([[7, f]]),
      [mark({ ticker: "OK", strength: "strong", direction: "bull" }), mark({ ticker: "WEAK", strength: "weak", direction: "bull" }), mark({ ticker: "BEAR", strength: "strong", direction: "bear" })],
    );
    expect(out.map((b) => [b.ticker, b.reason])).toEqual([["NONE", "unmarked"], ["WEAK", "strength"], ["BEAR", "direction"]]);
  });
});
