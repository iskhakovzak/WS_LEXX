import { describe, expect, it } from "vitest";
import {
  NODATA, analystKeyOf, businessDaysApart, classifyIndexDays, dailyFromIntraday, earningsKeyOf, tickerDayContext,
  tkAtrKeyOf, tkGapKeyOf, tkRvolKeyOf, type MeDailyBar,
} from "../myEdge/market";
import { joinMarket, todayBasis, type MarketSources } from "../myEdge/marketJoin";
import { rthBounds } from "../candleDay";
import { addDays } from "../tradingDate";

/** Weekday days from `start` (skipping Sat / Sun). */
function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  for (let d = start; out.length < n; d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

/** Quiet index: 25 days of open = prev close, range 2 (ATR ≈ 2), body 0.4 → range days. */
function quietIndex(n = 25, start = "2026-03-02"): MeDailyBar[] {
  return weekdays(start, n).map((day) => ({ day, o: 500, h: 501, l: 499, c: 500.4, v: 1e6 }));
}

describe("regular-hours daily bar from intraday bars", () => {
  it("drops pre / post market, keeps open of 9:30 and close of the last regular bar (DST-aware)", () => {
    for (const day of ["2026-01-15", "2026-07-15"]) {
      const { open, close } = rthBounds(day);
      const bars = [
        { t: open - 3600, o: 90, h: 200, l: 1, c: 95, v: 5 }, // premarket spike must not count
        { t: open, o: 100, h: 104, l: 99, c: 103, v: 10 },
        { t: open + 3600, o: 103, h: 106, l: 102, c: 105, v: 20 },
        { t: close, o: 105, h: 300, l: 0.5, c: 110, v: 7 }, // 16:00 bar = after hours
      ];
      expect(dailyFromIntraday(day, bars, 98)).toEqual({ day, o: 100, h: 106, l: 99, c: 105, v: 30, prevClose: 98 });
    }
    expect(dailyFromIntraday("2026-01-15", [])).toBeNull();
    expect(dailyFromIntraday("bad", [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }])).toBeNull();
  });
});

describe("index regime classification", () => {
  it("quiet days are range / normal vol; ATR needs 10 prior days", () => {
    const m = classifyIndexDays(quietIndex());
    const days = [...m.values()];
    expect(days[0]!.vol).toBeNull(); // no history
    expect(days[0]!.gapPct).toBeNull();
    expect(days[24]!.trend).toBe("range");
    expect(days[24]!.vol).toBe("normal");
    expect(days[24]!.gap).toBe("flat"); // open 500 vs prev close 500.4 → −0.08 %
  });

  it("a wide day with a big body is a trend day with high vol; the next day's prevVol remembers it", () => {
    const bars = quietIndex(22);
    const last = bars[bars.length - 1]!;
    const trendDay = { day: weekdays(addDays(last.day, 1), 1)[0]!, o: 502, h: 507.5, l: 501.8, c: 507.2, v: 2e6 };
    const after = { day: weekdays(addDays(trendDay.day, 1), 1)[0]!, o: 507, h: 508, l: 506, c: 507.5, v: 1e6 };
    const m = classifyIndexDays([...bars, trendDay, after]);
    const td = m.get(trendDay.day)!;
    expect(td.trend).toBe("trendUp");
    expect(td.vol).toBe("high");
    expect(td.gap).toBe("up"); // 502 vs 500.4 = +0.32 %
    expect(m.get(after.day)!.prevVol).toBe("high");
    const down = classifyIndexDays([...bars, { ...trendDay, o: 498.8, h: 499, l: 493, c: 493.3 }]).get(trendDay.day)!;
    expect(down.trend).toBe("trendDown");
    expect(down.gap).toBe("down");
  });

  it("a stale previous bar (> 5 days back) is not «previous»: gap from the bar's own prevClose", () => {
    const m = classifyIndexDays([
      { day: "2026-03-02", o: 100, h: 101, l: 99, c: 100, v: 1 },
      { day: "2026-03-20", o: 110, h: 111, l: 109, c: 110, v: 1, prevClose: 100 },
      { day: "2026-03-30", o: 110, h: 111, l: 109, c: 110, v: 1 },
    ]);
    expect(m.get("2026-03-20")!.gapPct).toBe(10);
    expect(m.get("2026-03-30")!.gapPct).toBeNull();
  });
});

describe("ticker day context", () => {
  const bars: MeDailyBar[] = weekdays("2026-02-02", 21).map((day) => ({ day, o: 10, h: 10.5, l: 9.5, c: 10, v: 1000 }));
  const day = addDays(bars[bars.length - 1]!.day, 3);
  bars.push({ day, o: 11.2, h: 12, l: 11, c: 11.8, v: 5000 });

  it("gap %, relative volume vs the 20 prior days, ATR % of the previous close", () => {
    const c = tickerDayContext(bars, day)!;
    expect(c.gapPct).toBe(12);
    expect(c.rvol).toBe(5);
    expect(c.atrPct).toBe(10);
    expect(tickerDayContext(bars, "2030-01-01")).toBeNull();
  });

  it("bands", () => {
    expect([-6, -2, 0, 2, 7, 20].map(tkGapKeyOf)).toEqual(["dn5", "dn1", "flat", "up1", "up5", "up15"]);
    expect(tkGapKeyOf(null)).toBe(NODATA);
    expect([0.5, 1, 2, 5].map(tkRvolKeyOf)).toEqual(["low", "normal", "high", "extreme"]);
    expect([1, 3, 7, 12].map(tkAtrKeyOf)).toEqual(["calm", "normal", "wild", "extreme"]);
  });
});

describe("earnings / analyst buckets", () => {
  it("business days skip weekends", () => {
    expect(businessDaysApart("2026-05-08", "2026-05-11")).toBe(1); // Fri → Mon
    expect(businessDaysApart("2026-05-11", "2026-05-08")).toBe(1);
    expect(businessDaysApart("2026-05-04", "2026-05-06")).toBe(2);
  });

  it("earnings ±1 business day; before the calendar's coverage → nodata", () => {
    expect(earningsKeyOf("2026-05-11", ["2026-05-08"], "2026-04-06")).toBe("near");
    expect(earningsKeyOf("2026-05-13", ["2026-05-08"], "2026-04-06")).toBe("far");
    expect(earningsKeyOf("2026-05-13", undefined, "2026-04-06")).toBe("far");
    expect(earningsKeyOf("2026-01-13", ["2026-01-13"], "2026-04-06")).toBe(NODATA);
    expect(earningsKeyOf("2026-05-13", [], null)).toBe(NODATA);
  });

  it("analyst: downgrade wins, never-fetched ticker → nodata", () => {
    const m = new Map([["2026-05-04", ["up", "down"]], ["2026-05-05", ["up"]], ["2026-05-06", ["main"]]]);
    expect(analystKeyOf("2026-05-04", m)).toBe("down");
    expect(analystKeyOf("2026-05-05", m)).toBe("up");
    expect(analystKeyOf("2026-05-06", m)).toBe("other");
    expect(analystKeyOf("2026-05-07", m)).toBe("none");
    expect(analystKeyOf("2026-05-07", undefined)).toBe(NODATA);
  });
});

describe("join and today's basis", () => {
  const spy = classifyIndexDays(quietIndex());
  const spyDays = [...spy.keys()];
  const src: MarketSources = {
    spy, qqq: new Map(),
    tickerBars: new Map(),
    earnings: { days: new Map([["AAA", [spyDays[24]!]]]), coveredFrom: "2026-01-01" },
    analyst: new Map([["AAA", new Map()]]),
    sectors: new Map([["AAA", "Technology"]]),
    themes: new Map([["AAA", "AI"]]),
  };

  it("joins by entry day and ticker; missing sources are «nodata», themes default to none", () => {
    const keys = joinMarket([{ id: 1, entryDay: spyDays[24]!, ticker: "AAA" }, { id: 2, entryDay: "2025-01-01", ticker: "BBB" }], src);
    expect(keys.get(1)).toMatchObject({ spyTrend: "range", spyGap: "flat", spyVol: "normal", qqqTrend: NODATA, tkGap: NODATA, earnings: "near", analyst: "none", sector: "Technology", theme: "AI" });
    expect(keys.get(2)).toMatchObject({ spyTrend: NODATA, earnings: NODATA, analyst: NODATA, sector: NODATA, theme: "none" });
  });

  it("today: own session ⇒ its gap; else the last fresh session's vol; stale or none ⇒ null", () => {
    const lastDay = spyDays[24]!;
    expect(todayBasis(spy, lastDay)).toMatchObject({ basis: "gap", key: "flat", asOf: lastDay });
    expect(todayBasis(spy, addDays(lastDay, 1))).toMatchObject({ basis: "prevVol", key: "normal", asOf: lastDay });
    expect(todayBasis(spy, addDays(lastDay, 30))).toMatchObject({ basis: null });
    expect(todayBasis(new Map(), "2026-05-01")).toEqual({ basis: null, dim: null, key: null, asOf: null });
  });
});
