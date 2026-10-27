import { describe, expect, it } from "vitest";
import {
  dayPnlBefore, dayPnlKeyOf, familiarityKeyOf, strengthKeyOf, strengthKeys, typicalDay, type MeTrade,
} from "../myEdge/facts";
import { buildTradesQuery } from "../myEdge/load";
import { compareSelf, metricOf, type CompareTrade } from "../myEdge/compare";

const T = (o: Partial<MeTrade> & { id: number }): MeTrade => ({
  day: "2026-05-04", entryDay: "2026-05-04", ticker: "AAA", side: "long", setup: null, strategy: null, entry: 12,
  entrySec: null, holdSec: null, overnight: false, daySeq: null, prevKind: null, sizeRel: null, net: 0, gross: 0, fees: 0,
  priorOnTicker: 0, pass: true, ...o,
});

describe("day P&L before the entry", () => {
  it("counts only same-day trades that EXITED before this entry (timed), hidden ones too", () => {
    const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
    const trades = [
      T({ id: 1, entrySec: h(9, 31), holdSec: 120, net: -50, daySeq: 1, pass: false }), // exits 9:33, filtered out
      T({ id: 2, entrySec: h(9, 32), holdSec: 3600, net: 80, daySeq: 2 }), // exits 10:32
      T({ id: 3, entrySec: h(9, 40), holdSec: 60, net: 10, daySeq: 3 }),
      T({ id: 4, entrySec: h(11, 0), holdSec: 60, net: 5, daySeq: 4 }),
      T({ id: 5, entryDay: "2026-05-05", day: "2026-05-05", entrySec: h(9, 35), holdSec: 60, net: 1, daySeq: 1 }),
    ];
    const b = dayPnlBefore(trades);
    expect(b.get(1)).toBeNull();
    expect(b.get(2)).toBeNull(); // #1 exits at 9:33, after 9:32
    expect(b.get(3)).toBe(-50); // #1 closed; #2 still open
    expect(b.get(4)).toBe(-50 + 80 + 10);
    expect(b.get(5)).toBeNull(); // another day
  });

  it("without times falls back to day_seq order", () => {
    const b = dayPnlBefore([T({ id: 1, daySeq: 1, net: 30 }), T({ id: 2, daySeq: 2, net: -10 }), T({ id: 3, daySeq: 3, net: 1 })]);
    expect([b.get(1), b.get(2), b.get(3)]).toEqual([null, 30, 20]);
  });

  it("zones of the typical day D", () => {
    expect(dayPnlKeyOf(null, 100)).toBe("first");
    expect(dayPnlKeyOf(-100, 100)).toBe("deepDown");
    expect(dayPnlKeyOf(-30, 100)).toBe("down");
    expect(dayPnlKeyOf(-20, 100)).toBe("flat");
    expect(dayPnlKeyOf(20, 100)).toBe("flat");
    expect(dayPnlKeyOf(21, 100)).toBe("up");
    expect(dayPnlKeyOf(100, 100)).toBe("bigUp");
  });

  it("typical day = median |close-day net|, at least $1", () => {
    expect(typicalDay([T({ id: 1, day: "a", net: 100 }), T({ id: 2, day: "b", net: -300 }), T({ id: 3, day: "c", net: 50 })])).toBe(100);
    expect(typicalDay([T({ id: 1, net: 0 })])).toBe(1);
  });
});

describe("pre-trade buckets", () => {
  it("familiarity bands", () => {
    expect([0, 1, 4, 5, 19, 20].map(familiarityKeyOf)).toEqual(["new", "few", "few", "known", "known", "home"]);
  });

  it("each dimension reads its column; unknown when missing", () => {
    const t = T({ id: 1, entrySec: 9 * 3600 + 40 * 60, daySeq: 5, prevKind: "after-loss", entry: 3.2, strategy: "", setup: " ORB ", side: "short", sizeRel: 2.1, holdSec: 200, priorOnTicker: 7 });
    const ctx = { before: -500, D: 200 };
    expect(strengthKeyOf("time", t, ctx)).toBe("9:30-9:50");
    expect(strengthKeyOf("seq", t, ctx)).toBe("4-5");
    expect(strengthKeyOf("prev", t, ctx)).toBe("after-loss");
    expect(strengthKeyOf("dayPnl", t, ctx)).toBe("deepDown");
    expect(strengthKeyOf("price", t, ctx)).toBe("lt5");
    expect(strengthKeyOf("strategy", t, ctx)).toBe("unknown");
    expect(strengthKeyOf("setup", t, ctx)).toBe("ORB");
    expect(strengthKeyOf("familiarity", t, ctx)).toBe("known");
    expect(strengthKeyOf("side", t, ctx)).toBe("short");
    expect(strengthKeyOf("sizeRel", t, ctx)).toBe("x2");
    expect(strengthKeyOf("hold", t, ctx)).toBe("1-5m");
    expect(strengthKeyOf("setup", T({ id: 2 }), ctx)).toBe("none");
    expect(strengthKeyOf("time", T({ id: 2 }), ctx)).toBe("unknown");
  });

  it("strengthKeys keys only passing trades, with D from them", () => {
    const { keys, D } = strengthKeys([T({ id: 1, net: 100, day: "a" }), T({ id: 2, net: -40, day: "b", pass: false })]);
    expect([...keys.keys()]).toEqual([1]);
    expect(D).toBe(100);
  });
});

describe("trades query (shape, no DB)", () => {
  it("filters only flag `pass`; the window and trader restrict the rows; facets append placeholders", () => {
    const { sql, params } = buildTradesQuery("Ann", {
      from: "2026-01-01", to: "2026-03-31", side: "short", setup: "__none__",
      facets: { off: { seq: ["6+"] }, excludeImx: false, deskTags: [] },
    });
    expect(params[0]).toBe("Ann");
    expect(params).toContain("2026-01-01");
    expect(params).toContain("s%");
    expect(sql).toMatch(/AS pass/);
    expect(sql).toMatch(/ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING/);
    expect(sql).toMatch(/NULLIF\(trim\(t\.setup\), ''\) IS NULL/);
    // facet predicate lives inside the pass expression, not the WHERE
    const where = sql.slice(sql.lastIndexOf("WHERE"));
    expect(where).not.toMatch(/day_seq/);
    expect(sql).toMatch(/day_seq/);
  });
});

describe("compare with self", () => {
  const C = (day: string, net: number, o: Partial<CompareTrade> = {}): CompareTrade => ({ day, net, gross: net + 1, fees: 1, holdSec: 300, overnight: false, ...o });

  it("metric formulas", () => {
    const tot = { n: 4, sum: 60, wins: 2, losses: 2, winSum: 100, lossSum: -40, fees: 8, grossWins: 102, holdSum: 20, holdN: 4, days: 2 };
    expect(metricOf("expectancy", tot)).toBe(15);
    expect(metricOf("winRate", tot)).toBe(0.5);
    expect(metricOf("payoff", tot)).toBe(2.5);
    expect(metricOf("feesShare", tot)).toBeCloseTo(8 / 102);
    expect(metricOf("tradesPerDay", tot)).toBe(2);
    expect(metricOf("holdMin", tot)).toBe(5);
  });

  it("a real jump in expectancy is «changed», the same distribution is not", () => {
    const cur: CompareTrade[] = [];
    const prev: CompareTrade[] = [];
    const same: CompareTrade[] = [];
    for (let d = 0; d < 25; d++) {
      const day = `2026-04-${String(d + 1).padStart(2, "0")}`;
      const pday = `2026-03-${String(d + 1).padStart(2, "0")}`;
      for (let k = 0; k < 3; k++) {
        const noise = ((d * 7 + k * 13) % 11) - 5;
        cur.push(C(day, 60 + noise * 4));
        prev.push(C(pday, -10 + noise * 4));
        same.push(C(day, -10 + noise * 4));
      }
    }
    const up = compareSelf(cur, prev, { iters: 400 });
    expect(up.rows.find((r) => r.metric === "expectancy")!.changed).toBe(true);
    expect(up.rows.find((r) => r.metric === "tradesPerDay")!.changed).toBe(false);
    const flat = compareSelf(same, prev, { iters: 400 });
    expect(flat.rows.find((r) => r.metric === "expectancy")!.changed).toBe(false);
    expect(up.days).toEqual({ current: 25, previous: 25 });
  });

  it("an empty previous period gives no diff and never «changed»", () => {
    const r = compareSelf([C("2026-04-01", 10)], [], { iters: 50 });
    expect(r.rows.every((x) => x.diff == null && !x.changed && x.previous == null)).toBe(true);
  });
});
