/**
 * Filters panel v2 — the pure parts: bucket keys of every new column (lib/tradeFacetBuckets: TS + the SQL text), the
 * derived per-trade values (lib/tradeFacetDerive: hold, overnight, entry / exit kind, notional, trader-day sequence),
 * exclusion parsing of the new params and the bucket labels.
 */
import { describe, expect, it } from "vitest";
import {
  HOLD_ORDER, bucketSql, holdKeyOf, holdSql, priceKeyOf, resultKeyOf, resultSql, seqKeyOf, sizeKeyOf, PRICE_BUCKETS,
} from "../tradeFacetBuckets";
import {
  daySequence, deriveFacetValues, entryKindOf, exitKindOf, holdOf, notionalOf, parseHoldTime, type FacetDeriveInput,
} from "../tradeFacetDerive";
import { FACET_DIMS, FACET_PARAMS, facetKeySql, parseFacetQuery } from "../tradeFacetsSql";
import { orderBuckets } from "../tradeFacetsQuery";

describe("bucket keys (TS)", () => {
  it("seq: 1 | 2 | 3 | 4-5 | 6+, unknown below 1", () => {
    expect([1, 2, 3, 4, 5, 6, 38].map(seqKeyOf)).toEqual(["1", "2", "3", "4-5", "4-5", "6+", "6+"]);
    expect([null, 0, -1, "x"].map(seqKeyOf)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });
  it("hold: exclusive upper bounds, overnight first, negative = unknown", () => {
    const keys = [0, 59, 60, 299, 300, 899, 900, 3599, 3600, 14_399, 14_400, 90_000].map((s) => holdKeyOf(s, false));
    expect(keys).toEqual(["lt1m", "lt1m", "1-5m", "1-5m", "5-15m", "5-15m", "15-60m", "15-60m", "1-4h", "1-4h", "gt4h", "gt4h"]);
    expect(holdKeyOf(30, true)).toBe("overnight");
    expect(holdKeyOf(null, null)).toBe("unknown");
    expect(holdKeyOf(-5, false)).toBe("unknown");
    expect(HOLD_ORDER.at(-1)).toBe("unknown");
  });
  it("price and size: positive values only", () => {
    expect([4.99, 5, 9.99, 10, 19.99, 20, 50, 100, 199.99, 200, 1500].map(priceKeyOf))
      .toEqual(["lt5", "5-10", "5-10", "10-20", "10-20", "20-50", "50-100", "100-200", "100-200", "gt200", "gt200"]);
    expect([null, 0, -3, "12.5000"].map(priceKeyOf)).toEqual(["unknown", "unknown", "unknown", "10-20"]);
    expect([1999.99, 2000, 4999, 5000, 10_000, 25_000, 50_000, 99_999, 100_000].map(sizeKeyOf))
      .toEqual(["lt2k", "2-5k", "2-5k", "5-10k", "10-25k", "25-50k", "50-100k", "50-100k", "gt100k"]);
    expect(sizeKeyOf(0)).toBe("unknown");
  });
  it("result by the net (pnl − |fees|), unknown without pnl", () => {
    expect(resultKeyOf(10, 2)).toBe("win");
    expect(resultKeyOf(2, -2)).toBe("be");
    expect(resultKeyOf(0.1, 0.30000000000000004)).toBe("loss");
    expect(resultKeyOf(0.3, 0.1 + 0.2)).toBe("be");
    expect(resultKeyOf(null, 1)).toBe("unknown");
  });
});

describe("bucket keys (SQL text)", () => {
  it("bucketSql: NULL / below min → unknown, one arm per finite bound, last bucket in ELSE", () => {
    const sql = bucketSql(PRICE_BUCKETS, "t.entry", 0, false);
    expect(sql).toContain("t.entry IS NULL OR t.entry <= 0 THEN 'unknown'");
    expect(sql).toContain("WHEN t.entry < 5 THEN 'lt5'");
    expect(sql).toContain("ELSE 'gt200' END");
    expect(holdSql("t")).toMatch(/^\(CASE WHEN t\.overnight IS TRUE THEN 'overnight'/);
    expect(resultSql("t")).toContain("(t.pnl - ABS(COALESCE(t.fees, 0))) > 0 THEN 'win'");
  });
  it("every new scalar column has a key expression on its column", () => {
    expect(facetKeySql("seq")).toContain("t.day_seq");
    expect(facetKeySql("prev")).toBe("COALESCE(t.prev_kind, 'unknown')");
    expect(facetKeySql("entry")).toBe("COALESCE(t.entry_kind, 'unknown')");
    expect(facetKeySql("exit")).toBe("COALESCE(t.exit_kind, 'unknown')");
    expect(facetKeySql("tickers", "x")).toBe("COALESCE(NULLIF(UPPER(TRIM(x.ticker)), ''), 'unknown')");
    expect(facetKeySql("price")).toContain("t.entry");
    expect(facetKeySql("size")).toContain("t.notional");
    expect(facetKeySql("accounts")).toBe("COALESCE(NULLIF(TRIM(t.broker_account), ''), 'manual')");
    expect(facetKeySql("result")).toContain("t.pnl IS NULL");
  });
});

describe("exclusions of the new params", () => {
  it("one x-param per column; new params parse like the old ones", () => {
    expect(Object.keys(FACET_PARAMS).sort()).toEqual([...FACET_DIMS].sort());
    const f = parseFacetQuery({ xSeq: "1,6+", xPrev: "after-loss", xEntry: "reentry", xExit: "stopped", xHold: "overnight,lt1m", xTickers: "AAPL, TSLA", xPrice: "lt5", xSize: "gt100k", xAccounts: "manual", xResult: "be" }, []);
    expect(f.off).toEqual({
      seq: ["1", "6+"], prev: ["after-loss"], entry: ["reentry"], exit: ["stopped"], hold: ["overnight", "lt1m"],
      tickers: ["AAPL", "TSLA"], price: ["lt5"], size: ["gt100k"], accounts: ["manual"], result: ["be"],
    });
  });
  it("a long ticker list (none = every ticker) is kept up to 1000 keys", () => {
    const many = Array.from({ length: 1200 }, (_, i) => `T${i}`).join(",");
    expect(parseFacetQuery({ xTickers: many }, []).off.tickers).toHaveLength(1000);
  });
});

describe("bucket order", () => {
  const b = (key: string, count = 1) => ({ key, label: key, count, net: 0 });
  it("natural order for buckets, fixed order for kinds, count for tickers / accounts, unknown last", () => {
    expect(orderBuckets("hold", ["unknown", "overnight", "gt4h", "lt1m", "5-15m"].map((k) => b(k)), []).map((x) => x.key))
      .toEqual(["lt1m", "5-15m", "gt4h", "overnight", "unknown"]);
    expect(orderBuckets("seq", ["6+", "1", "4-5"].map((k) => b(k)), []).map((x) => x.key)).toEqual(["1", "4-5", "6+"]);
    expect(orderBuckets("prev", ["after-be", "first", "after-loss", "after-win"].map((k) => b(k)), []).map((x) => x.key))
      .toEqual(["first", "after-win", "after-loss", "after-be"]);
    expect(orderBuckets("exit", ["stopped", "whole", "partials"].map((k) => b(k)), []).map((x) => x.key)).toEqual(["whole", "partials", "stopped"]);
    expect(orderBuckets("result", ["be", "loss", "win"].map((k) => b(k)), []).map((x) => x.key)).toEqual(["win", "loss", "be"]);
    expect(orderBuckets("price", ["gt200", "lt5", "20-50"].map((k) => b(k)), []).map((x) => x.key)).toEqual(["lt5", "20-50", "gt200"]);
    expect(orderBuckets("tickers", [b("AAPL", 2), b("TSLA", 5), b("unknown", 9)], []).map((x) => x.key)).toEqual(["TSLA", "AAPL", "unknown"]);
  });
});

const base: FacetDeriveInput = {
  id: 1, trader: "Ann", date: "2026-06-10", exitDate: null, deleted: false, result: "win", pnl: 10, fees: 1, qty: 100, entry: 10,
  holdTime: null, openedAt: null, closedAt: null, structure: null, reentryOf: null, entrySec: 36_000,
};

describe("derived values", () => {
  it("parseHoldTime reads the broker spellings", () => {
    expect(parseHoldTime("19s")).toBe(19);
    expect(parseHoldTime("27m")).toBe(1620);
    expect(parseHoldTime("3min")).toBe(180);
    expect(parseHoldTime("4h 59m")).toBe(4 * 3600 + 59 * 60);
    expect(parseHoldTime("1d 2h")).toBe(86_400 + 7200);
    expect(parseHoldTime("")).toBeNull();
    expect(parseHoldTime("n/a")).toBeNull();
  });
  it("hold: structure first → last fill, else the broker's open → close, else hold_time; overnight by NY date", () => {
    expect(holdOf({ ...base, structure: { firstAt: "2026-06-10T14:00:00.000Z", lastAt: "2026-06-10T14:27:00.000Z" }, holdTime: "1h" }))
      .toEqual({ holdSec: 1620, overnight: false });
    expect(holdOf({ ...base, openedAt: "2026-06-10T09:27:41", closedAt: "2026-06-10T09:28:00" })).toEqual({ holdSec: 19, overnight: false });
    // 15:50 NY → next day 09:35 NY: overnight
    expect(holdOf({ ...base, structure: { firstAt: "2026-06-10T19:50:00Z", lastAt: "2026-06-11T13:35:00Z" } }))
      .toEqual({ holdSec: 17 * 3600 + 45 * 60, overnight: true });
    expect(holdOf({ ...base, holdTime: "4h 59m" })).toEqual({ holdSec: 17_940, overnight: false });
    expect(holdOf({ ...base, holdTime: "2h", exitDate: "2026-06-12" })).toEqual({ holdSec: 7200, overnight: true });
    expect(holdOf(base)).toEqual({ holdSec: null, overnight: null });
    expect(holdOf({ ...base, result: "open", holdTime: "5m" })).toEqual({ holdSec: null, overnight: null });
  });
  it("entry kind: reentry > scaled > single; exit kind: stopped > partials > whole; NULL without a structure", () => {
    expect(entryKindOf({ adds: 2 }, 7)).toBe("reentry");
    expect(entryKindOf({ adds: 1 }, null)).toBe("scaled");
    expect(entryKindOf({ adds: 0, scaledEntryLikely: true }, null)).toBe("scaled");
    expect(entryKindOf({ adds: 0 }, null)).toBe("single");
    expect(entryKindOf(null, null)).toBeNull();
    expect(exitKindOf({ stopHit: true, partials: 2 }, "loss")).toBe("stopped");
    expect(exitKindOf({ partials: 1 }, "win")).toBe("partials");
    expect(exitKindOf({ partials: 0, scaledExitLikely: true }, "win")).toBe("partials");
    expect(exitKindOf({ partials: 0 }, "win")).toBe("whole");
    expect(exitKindOf({ partials: 0 }, "open")).toBeNull();
    expect(exitKindOf(null, "win")).toBeNull();
  });
  it("notional: max position × avg entry, else |qty × entry|", () => {
    expect(notionalOf({ maxPosition: 300, avgEntry: 12.5 }, 100, 12)).toBe(3750);
    expect(notionalOf(null, "-100", "12.3456")).toBe(1234.56);
    expect(notionalOf({ maxPosition: null }, 0, 10)).toBeNull();
  });
  it("day sequence: per trader + NY day, by entry second (unknown last) then id; prev = the previous net result", () => {
    const rows: FacetDeriveInput[] = [
      { ...base, id: 10, entrySec: 40_000, pnl: -5, fees: 0 },
      { ...base, id: 11, entrySec: 36_000, pnl: 5, fees: 0 },
      { ...base, id: 12, entrySec: null, pnl: 1, fees: 1 },
      { ...base, id: 13, entrySec: 36_000, pnl: 0, fees: 0 },
      { ...base, id: 14, entrySec: 30_000, deleted: true },
      { ...base, id: 15, trader: "Bob", entrySec: 50_000 },
      { ...base, id: 16, date: "2026-06-11 09:30", entrySec: 50_000 },
      { ...base, id: 17, entrySec: 45_000, pnl: null },
      { ...base, id: 18, entrySec: 46_000 },
    ];
    const s = daySequence(rows);
    const at = (id: number) => s.get(id);
    expect(at(11)).toEqual({ daySeq: 1, prevKind: "first" });
    expect(at(13)).toEqual({ daySeq: 2, prevKind: "after-win" });
    expect(at(10)).toEqual({ daySeq: 3, prevKind: "after-be" });
    expect(at(17)).toEqual({ daySeq: 4, prevKind: "after-loss" });
    expect(at(18)).toEqual({ daySeq: 5, prevKind: null }); // the previous one has no result yet
    expect(at(12)).toEqual({ daySeq: 6, prevKind: "after-win" });
    expect(at(14)).toEqual({ daySeq: null, prevKind: null });
    expect(at(15)).toEqual({ daySeq: 1, prevKind: "first" });
    expect(at(16)).toEqual({ daySeq: 1, prevKind: "first" });
    expect(deriveFacetValues(rows).get(11)).toMatchObject({ daySeq: 1, prevKind: "first", notional: 1000, entryKind: null, exitKind: null });
  });
});

describe("bucket labels (routes/trade-facets facetLabeler)", () => {
  it("new columns in the reader's language; price / size ranges the same everywhere", async () => {
    const { facetLabeler } = await import("../../routes/trade-facets");
    const en = facetLabeler("en");
    expect(en("prev", "first")).toBe("First of the day");
    expect(en("entry", "scaled")).toBe("Scaled in");
    expect(en("exit", "stopped")).toBe("Stopped out");
    expect(en("hold", "1-5m")).toBe("1–5 min");
    expect(en("hold", "overnight")).toBe("Overnight");
    expect(en("result", "be")).toBe("Breakeven");
    expect(en("accounts", "manual")).toBe("Manual");
    expect(en("accounts", "31206884")).toBe("31206884");
    expect(en("seq", "4-5")).toBe("4–5");
    expect(en("price", "lt5")).toBe("< $5");
    expect(en("price", "5-10")).toBe("$5–10");
    expect(en("price", "gt200")).toBe("> $200");
    expect(en("size", "lt2k")).toBe("< $2k");
    expect(en("size", "10-25k")).toBe("$10–25k");
    expect(en("size", "gt100k")).toBe("> $100k");
    expect(en("tickers", "AAPL")).toBe("AAPL");
    expect(en("hold", "unknown")).toBe("No data");
    const ru = facetLabeler("ru");
    const uz = facetLabeler("uz");
    for (const [d, k] of [["prev", "after-win"], ["entry", "reentry"], ["exit", "whole"], ["hold", "gt4h"], ["result", "win"], ["accounts", "manual"]] as const) {
      expect(ru(d, k)).not.toBe(en(d, k));
      expect(uz(d, k)).not.toBe(en(d, k));
    }
  });
});
