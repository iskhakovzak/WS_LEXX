/**
 * Breakdown panel v3 — the pure parts: aggressive entry (5 min / 3 adds, 3× the first fill, 60 s median gap with 2+
 * adds), adds kind (pyramid / average / mixed by the average so far, long and short), exit flip, has_stop, size vs the
 * trader's usual (60 days, 10-trade minimum, 0.5 / 1.5 / 3 boundaries), legs from fills, the refresh day ranges, the
 * new bucket keys / SQL / params / order and labels.
 */
import { describe, expect, it } from "vitest";
import * as B from "../tradeFacetBuckets";
import {
  addsKindOf, aggressiveEntry, deriveFacetValues, entryKindOf, exitKindOf, hasStopOf, isoDayOf, legsOf, shiftIsoDay, sizeRelations,
  type FacetDeriveInput, type FacetLeg, type SizeRow, type StructureLite,
} from "../tradeFacetDerive";
import { FACET_DIMS, FACET_PARAMS, facetKeySql, parseFacetQuery } from "../tradeFacetsSql";
import { orderBuckets } from "../tradeFacetsQuery";
import { dayRanges, strategySig } from "../tradeStrategyStore";
import { DEFAULT_IMX_WINDOW } from "../tradeStrategy";

const T0 = 1_780_000_000;
/** Legs: [role, price, qty, seconds after T0]; opening for entry / add / reentry / flip-in. */
const legs = (...xs: [string, number, number | null, number | null, boolean?][]): FacetLeg[] =>
  xs.map(([role, price, qty, dt, opening]) => ({
    role, price, qty, at: dt == null ? null : T0 + dt,
    opening: opening ?? ["entry", "add", "reentry"].includes(role),
  }));
const S: StructureLite = { adds: 0, partials: 0, stopHit: false, side: "long" };

describe("aggressive entry", () => {
  it("3+ adds within 5 minutes of the first fill (300 s inclusive)", () => {
    const at = (last: number) => legs(["entry", 10, 100, 0], ["add", 10, 10, 100], ["add", 10, 10, 200], ["add", 10, 10, last], ["exit", 11, 130, 2000]);
    expect(aggressiveEntry(at(300), S)).toBe(true);
    expect(aggressiveEntry(at(301), S)).toBe(false); // the third add is outside the window (and the gaps median is 100 s)
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 100], ["add", 10, 10, 250], ["exit", 11, 120, 900]), S)).toBe(false);
  });
  it("max position ≥ 3× the first fill's shares (needs an add)", () => {
    const l = legs(["entry", 10, 100, 0], ["add", 10, 200, 3600], ["exit", 11, 300, 7200]);
    expect(aggressiveEntry(l, { ...S, maxPosition: 300 })).toBe(true);
    expect(aggressiveEntry(l, { ...S, maxPosition: 299 })).toBe(false);
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["exit", 11, 100, 60]), { ...S, maxPosition: 300 })).toBe(false); // no add
    expect(aggressiveEntry(legs(["entry", 10, null, 0], ["add", 10, null, 3600]), { ...S, maxPosition: 900 })).toBe(false); // no qty
  });
  it("2+ adds with a median gap between consecutive opening legs under 60 s", () => {
    // gaps 50, 10 → median 30 (an even count: mean of the middle two)
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 50], ["add", 10, 10, 60]), S)).toBe(true);
    // gaps 59, 59 → 59 < 60
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 59], ["add", 10, 10, 118]), S)).toBe(true);
    // gaps 60, 60 → not under 60
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 60], ["add", 10, 10, 120]), S)).toBe(false);
    // one add only, 5 s after the entry: not enough adds for the gap rule
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 5]), S)).toBe(false);
    // gaps 10, 400, 10 → median 10 with 3 adds (the third add is 420 s in: outside the 5-minute rule)
    expect(aggressiveEntry(legs(["entry", 10, 100, 0], ["add", 10, 10, 10], ["add", 10, 10, 410], ["add", 10, 10, 420]), S)).toBe(true);
    // an untimed leg: no time rules
    expect(aggressiveEntry(legs(["entry", 10, 100, null], ["add", 10, 10, 1], ["add", 10, 10, 2]), S)).toBe(false);
  });
  it("precedence reentry > aggressive > scaled > single", () => {
    const fast = legs(["entry", 10, 100, 0], ["add", 10, 10, 10], ["add", 10, 10, 20]);
    expect(entryKindOf({ ...S, adds: 2 }, 5, fast)).toBe("reentry");
    expect(entryKindOf({ ...S, adds: 2 }, null, fast)).toBe("aggressive");
    expect(entryKindOf({ ...S, adds: 1 }, null, legs(["entry", 10, 100, 0], ["add", 10, 10, 3600]))).toBe("scaled");
    expect(entryKindOf({ ...S, scaledEntryLikely: true }, null, legs(["entry", 10.005, 100, 0], ["exit", 11, 100, 60]))).toBe("scaled");
    expect(entryKindOf(S, null, legs(["entry", 10, 100, 0], ["exit", 11, 100, 60]))).toBe("single");
    expect(entryKindOf(null, null, fast)).toBeNull();
  });
});

describe("adds kind", () => {
  it("long: pyramid above the average so far, average below, mixed both ways", () => {
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 10.5, 100, 60], ["add", 10.3, 100, 120]))).toBe("pyramid"); // 10.3 > avg 10.25
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 9.5, 100, 60], ["add", 9.7, 100, 120]))).toBe("average"); // 9.7 < avg 9.75
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 9.5, 100, 60], ["add", 9.8, 100, 120]))).toBe("mixed"); // 9.8 > avg 9.75
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 10.5, 100, 60], ["add", 10.1, 100, 120]))).toBe("mixed"); // 10.1 < avg 10.25
  });
  it("short: the trade's direction flips better / worse", () => {
    const sh = { ...S, side: "short" };
    expect(addsKindOf(sh, legs(["entry", 10, 100, 0], ["add", 9.5, 100, 60]))).toBe("pyramid");
    expect(addsKindOf(sh, legs(["entry", 10, 100, 0], ["add", 10.5, 100, 60]))).toBe("average");
  });
  it("partial exits keep the average; a re-entry inside the trade starts a new one; an add at the average is neither", () => {
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["partial_exit", 12, 50, 30, false], ["add", 10.2, 50, 60]))).toBe("pyramid");
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["exit", 9, 100, 30, false], ["reentry", 8, 100, 60], ["add", 8.5, 100, 90]))).toBe("pyramid");
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 10, 100, 60]))).toBe("mixed");
  });
  it("qty-weighted average; unit weights without qty", () => {
    // avg after 100@10 + 300@11 = 10.75; add at 10.8 > 10.75 → pyramid (unit weights would give 10.5 too, still above)
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 11, 300, 60], ["add", 10.8, 10, 90]))).toBe("pyramid");
    // 100@10, 300@11, add 10.6: qty-weighted avg 10.75 → below → mixed (unit-weighted would be 10.5 → above)
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["add", 11, 300, 60], ["add", 10.6, 10, 90]))).toBe("mixed");
    expect(addsKindOf(S, legs(["entry", 10, null, 0], ["add", 11, null, 60], ["add", 10.6, null, 90]))).toBe("pyramid");
  });
  it("none without adds; unknown (null) when adds exist without their prices or without a structure", () => {
    expect(addsKindOf(S, legs(["entry", 10, 100, 0], ["exit", 11, 100, 60, false]))).toBe("none");
    expect(addsKindOf(S, [])).toBe("none");
    expect(addsKindOf({ ...S, scaledEntryLikely: true }, legs(["entry", 10.005, 100, 0], ["exit", 11, 100, 60, false]))).toBeNull();
    expect(addsKindOf({ ...S, adds: 2 }, [])).toBeNull();
    expect(addsKindOf(null, legs(["entry", 10, 100, 0], ["add", 11, 100, 60]))).toBeNull();
  });
});

describe("exit kind and stop", () => {
  it("flip > stopped > partials > whole", () => {
    const plain = legs(["entry", 10, 100, 0], ["exit", 9, 100, 60, false]);
    expect(exitKindOf({ ...S, flipOut: true, stopHit: true, partials: 1 }, "loss", plain)).toBe("flip");
    expect(exitKindOf(S, "loss", legs(["entry", 10, 100, 0], ["flip", 9, 100, 60, false]))).toBe("flip");
    expect(exitKindOf(S, "loss", legs(["entry", 10, 100, 0], ["exit", 9, 300, 60, false]))).toBe("flip"); // sold 300 of 100: reversed
    expect(exitKindOf({ ...S, carriedIn: true }, "loss", legs(["entry", 10, 100, 0], ["exit", 9, 300, 60, false]))).toBe("whole");
    expect(exitKindOf({ ...S, stopHit: true, partials: 1 }, "loss", plain)).toBe("stopped");
    expect(exitKindOf({ ...S, partials: 1 }, "win", plain)).toBe("partials");
    expect(exitKindOf(S, "win", plain)).toBe("whole");
    expect(exitKindOf(S, "open", plain)).toBeNull();
    expect(exitKindOf(S, "win")).toBe("whole"); // no fills: the structure alone
  });
  it("has_stop: trades.stop or the structure's stop price", () => {
    expect(hasStopOf(null, "140.4")).toBe(true);
    expect(hasStopOf({ stopPrice: 9.5 }, null)).toBe(true);
    expect(hasStopOf({ stopPrice: null }, null)).toBe(false);
    expect(hasStopOf(null, "0")).toBe(false);
    expect(hasStopOf(null, null)).toBe(false);
  });
});

describe("size vs usual", () => {
  const day = (n: number) => shiftIsoDay("2026-06-01", n);
  let id = 0;
  const row = (d: string, notional: number | null, extra: Partial<SizeRow> = {}): SizeRow =>
    ({ id: ++id, trader: "Ann", date: d, entrySec: 36_000, deleted: false, notional, ...extra });

  it("10-trade minimum: 9 earlier trades → null, 10 → the ratio to their median", () => {
    const hist = Array.from({ length: 10 }, (_, i) => row(day(i), 1000 + i * 100)); // median of the first 9: 1400; of 10: 1450
    const t9 = row(day(9), 2800, { entrySec: 30_000 }); // opens before hist[9] that day → 9 earlier
    const t10 = row(day(10), 2900);
    expect(sizeRelations([...hist, t9], new Set([t9.id])).get(t9.id)).toBeNull();
    expect(sizeRelations([...hist, t10], new Set([t10.id])).get(t10.id)).toBe(2);
  });
  it("60 calendar days back inclusive; other traders, deleted trades and missing notionals do not count", () => {
    const t = row(day(70), 500);
    const inside = Array.from({ length: 10 }, () => row(day(10), 1000)); // day 70 − 60 = day 10: inside
    expect(sizeRelations([...inside, t], new Set([t.id])).get(t.id)).toBe(0.5);
    const outside = Array.from({ length: 10 }, () => row(day(9), 1000)); // 61 days back: outside
    const noise = [row(day(60), 1000, { trader: "Bob" }), row(day(60), 1000, { deleted: true }), row(day(60), null)];
    expect(sizeRelations([...outside, ...noise, t], new Set([t.id])).get(t.id)).toBeNull();
  });
  it("same day: only trades that opened before (entry second, then id)", () => {
    const hist = Array.from({ length: 9 }, () => row(day(0), 1000));
    const early = row(day(1), 1000, { entrySec: 30_000 });
    const t = row(day(1), 3000, { entrySec: 40_000 });
    const late = row(day(1), 1000, { entrySec: 50_000 });
    const out = sizeRelations([...hist, late, t, early], new Set([t.id, early.id, late.id]));
    expect(out.get(early.id)).toBeNull(); // 9 before it
    expect(out.get(t.id)).toBe(3);
    expect(out.get(late.id)).toBe(1); // 11 before: median 1000
    expect(sizeRelations([row(day(1), 1000, { deleted: true })], new Set([id])).get(id)).toBeNull();
  });
  it("bucket boundaries 0.5 / 1.5 / 3 on the stored ratio", () => {
    expect([0.4999, 0.5, 1.4999, 1.5, 2.9999, 3, 12].map(B.sizeRelKeyOf)).toEqual(["lt05", "normal", "normal", "x2", "x2", "x3", "x3"]);
    expect([null, 0, -1, "x"].map(B.sizeRelKeyOf)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    // ratios that land exactly on the boundaries
    const hist = Array.from({ length: 10 }, () => row(day(0), 1000));
    const ts = [499.9, 500, 1500, 3000].map((n) => row(day(1), n));
    const ratios = ts.map((x) => sizeRelations([...hist, x], new Set([x.id])).get(x.id));
    expect(ratios).toEqual([0.4999, 0.5, 1.5, 3]);
    expect(ratios.map(B.sizeRelKeyOf)).toEqual(["lt05", "normal", "x2", "x3"]);
  });
  it("deriveFacetValues reads the history passed next to the rows", () => {
    const base: FacetDeriveInput = {
      id: 9001, trader: "Ann", date: day(30), exitDate: null, deleted: false, result: "win", pnl: 10, fees: 0, qty: 100, entry: 20,
      holdTime: null, openedAt: null, closedAt: null, structure: null, reentryOf: null, entrySec: 36_000,
    };
    const history = Array.from({ length: 10 }, () => row(day(20), 1000));
    expect(deriveFacetValues([base], history).get(9001)).toMatchObject({ notional: 2000, sizeRel: 2, hasStop: false, addsKind: null });
    expect(deriveFacetValues([base]).get(9001)?.sizeRel).toBeNull();
  });
});

describe("legs from fills", () => {
  it("fills of one leg_index fold into one leg (VWAP, summed qty, first time); roles as stored", () => {
    const l = legsOf([
      { id: 3, kind: "entry", role: "add", leg_index: 1, price: "11", qty: "100", executed_at: "2026-06-10T14:01:00Z" },
      { id: 1, kind: "entry", role: "entry", leg_index: 0, price: "10", qty: "100", executed_at: "2026-06-10T14:00:00Z" },
      { id: 4, kind: "entry", role: "add", leg_index: 1, price: "12", qty: "300", executed_at: "2026-06-10T14:01:00Z" },
      { id: 5, kind: "exit", role: "exit", leg_index: 2, price: "13", qty: "500", executed_at: "2026-06-10T14:05:00Z" },
    ]);
    expect(l).toEqual([
      { role: "entry", opening: true, price: 10, qty: 100, at: Date.parse("2026-06-10T14:00:00Z") / 1000 },
      { role: "add", opening: true, price: 11.75, qty: 400, at: Date.parse("2026-06-10T14:01:00Z") / 1000 },
      { role: "exit", opening: false, price: 13, qty: 500, at: Date.parse("2026-06-10T14:05:00Z") / 1000 },
    ]);
  });
  it("without leg indexes: a leg per fill in time order, roles from the kind", () => {
    const l = legsOf([
      { kind: "exit", price: 12, qty: 200, executed_at: "2026-06-10T14:09:00Z" },
      { kind: "entry", price: 10, qty: 100, executed_at: "2026-06-10T14:00:00Z" },
      { kind: "entry", price: 11, qty: 100, executed_at: "2026-06-10T14:02:00Z" },
      { kind: "trim", price: 11.5, qty: 50, executed_at: "2026-06-10T14:05:00Z" },
    ]);
    expect(l.map((x) => [x.role, x.opening, x.qty])).toEqual([["entry", true, 100], ["add", true, 100], ["partial_exit", false, 50], ["exit", false, 200]]);
    expect(legsOf([])).toEqual([]);
  });
});

describe("refresh day ranges", () => {
  it("each seed day + the following 60 days, merged per trader; invalid days stay exact", () => {
    const r = dayRanges([{ tr: "Ann", d: "2026-06-01" }, { tr: "Ann", d: "2026-06-20" }, { tr: "Ann", d: "2026-12-01" }, { tr: "Bob", d: "" }], 0, 60);
    expect(r).toEqual({
      tr: ["Ann", "Ann", "Bob"], from: ["2026-06-01", "2026-12-01", ""], to: ["2026-08-19", "2027-01-30", ""],
    });
    const back = dayRanges([{ tr: "Ann", d: "2026-03-01" }], -60, -1);
    expect(back).toEqual({ tr: ["Ann"], from: ["2025-12-31"], to: ["2026-02-28"] });
    // adjacent ranges merge (06-01..07-31 and 08-01..)
    expect(dayRanges([{ tr: "A", d: "2026-06-01" }, { tr: "A", d: "2026-08-01" }], 0, 60).from).toEqual(["2026-06-01"]);
  });
  it("calendar helpers", () => {
    expect(isoDayOf("2026-02-30")).toBeNull();
    expect(isoDayOf("2026-06-11 09:30")).toBe("2026-06-11");
    expect(shiftIsoDay("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("signature v3 (every row re-derived once)", () => {
    expect(strategySig(DEFAULT_IMX_WINDOW)).toBe("v3|15:50-16:00");
  });
});

describe("new columns in the facet model", () => {
  it("keys, SQL, params, order", () => {
    expect(FACET_DIMS).toEqual(expect.arrayContaining(["adds", "stop", "sizeRel"]));
    expect(FACET_PARAMS.adds).toBe("xAdds");
    expect(FACET_PARAMS.stop).toBe("xStop");
    expect(FACET_PARAMS.sizeRel).toBe("xSizeRel");
    expect(facetKeySql("adds")).toBe("COALESCE(t.adds_kind, 'unknown')");
    expect(facetKeySql("stop")).toBe("(CASE WHEN t.has_stop IS TRUE THEN 'with' WHEN t.has_stop IS FALSE THEN 'none' ELSE 'unknown' END)");
    expect(facetKeySql("sizeRel")).toContain("WHEN t.size_rel < 0.5 THEN 'lt05'");
    expect(parseFacetQuery({ xAdds: "average", xStop: "none", xSizeRel: "x3,lt05", xEntry: "aggressive", xExit: "flip" }, []).off).toEqual({
      adds: ["average"], stop: ["none"], sizeRel: ["x3", "lt05"], entry: ["aggressive"], exit: ["flip"],
    });
    const b = (key: string) => ({ key, label: key, count: 1, net: 0 });
    const keys = (dim: Parameters<typeof orderBuckets>[0], ks: string[]) => orderBuckets(dim, ks.map(b), []).map((x) => x.key);
    expect(keys("entry", ["reentry", "aggressive", "single", "scaled"])).toEqual(["single", "scaled", "aggressive", "reentry"]);
    expect(keys("adds", ["unknown", "mixed", "average", "none", "pyramid"])).toEqual(["none", "pyramid", "average", "mixed", "unknown"]);
    expect(keys("exit", ["flip", "stopped", "whole", "partials"])).toEqual(["whole", "partials", "stopped", "flip"]);
    expect(keys("stop", ["none", "with"])).toEqual(["with", "none"]);
    expect(keys("sizeRel", ["x3", "unknown", "lt05", "x2", "normal"])).toEqual(["lt05", "normal", "x2", "x3", "unknown"]);
    expect([true, false, null, undefined, "true"].map(B.stopKeyOf)).toEqual(["with", "none", "unknown", "unknown", "unknown"]);
  });

  it("labels in ru / en / uz", async () => {
    const { facetLabeler } = await import("../../routes/trade-facets");
    const en = facetLabeler("en"), ru = facetLabeler("ru"), uz = facetLabeler("uz");
    expect(en("entry", "aggressive")).toBe("Aggressive adds");
    expect(en("adds", "pyramid")).toBe("Into profit (pyramid)");
    expect(en("exit", "flip")).toBe("Reversal");
    expect(en("sizeRel", "x3")).toBe("×3 or more");
    expect(en("stop", "none")).toBe("No stop");
    expect(en("adds", "unknown")).toBe("No data");
    for (const [d, k] of [["entry", "aggressive"], ["adds", "none"], ["adds", "pyramid"], ["adds", "average"], ["adds", "mixed"], ["exit", "flip"],
      ["sizeRel", "normal"], ["sizeRel", "x3"], ["stop", "with"], ["stop", "none"]] as const) {
      expect(ru(d, k)).not.toBe(k);
      expect(uz(d, k)).not.toBe(k);
      expect(en(d, k)).not.toBe(k);
    }
    expect(ru("sizeRel", "lt05")).toBe("< 0,5×");
    expect(ru("sizeRel", "x2")).toBe("×2");
  });
});
