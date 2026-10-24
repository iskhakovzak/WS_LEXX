import { describe, expect, it } from "vitest";
import { EMPTY_FACET_VIEW } from "@/lib/trade-facets";
import {
  afterLossStats, byRealisation, daySequenceOf, greenDayStreak, holdStats, holdVerdict, onlyFacet, seqStats, streaksOf,
  weekdayKey, weekdayStats, type InsightTrade,
} from "./model";

let nextId = 1;
/** A closed intraday trade; `pnl` is gross, fees 0 unless given; `sec` = entry second of the NY day. */
function tr(day: string, pnl: number, o: Partial<InsightTrade> & { sec?: number } = {}): InsightTrade {
  const { sec, ...rest } = o;
  return {
    id: nextId++,
    ticker: "AAPL",
    date: day,
    result: pnl > 0 ? "win" : pnl < 0 ? "loss" : "be",
    pnl,
    fees: 0,
    entrySec: sec ?? 34_200 + nextId,
    holdSec: 60,
    ...rest,
  };
}
/** W / L / B sequence on one day, in order. */
function seq(day: string, s: string): InsightTrade[] {
  return [...s].map((c, i) => tr(day, c === "W" ? 100 : c === "L" ? -100 : 0, { sec: 34_200 + i * 60 }));
}

describe("streaksOf — current / best / worst", () => {
  it("counts the current winning streak from the newest trade", () => {
    const s = streaksOf([...seq("2026-10-20", "LWW"), ...seq("2026-10-21", "WWWWW")], 0);
    expect(s.current).toEqual({ type: "win", count: 7 });
    expect(s.bestWin).toBe(7);
    expect(s.worstLoss).toBe(1);
  });

  it("a losing streak is current when the newest trades lost", () => {
    const s = streaksOf(seq("2026-10-21", "WWWLLL"), 0);
    expect(s.current).toEqual({ type: "loss", count: 3 });
    expect(s.bestWin).toBe(3);
    expect(s.worstLoss).toBe(3);
  });

  it("orders by realisation (close day, exit second), not by input order", () => {
    const a = tr("2026-10-21", 100, { sec: 36_000 });
    const b = tr("2026-10-21", -100, { sec: 35_000 });
    const c = tr("2026-10-20", -100, { sec: 40_000 });
    expect(byRealisation([a, b, c]).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    // A swing closed today counts on its exit day.
    const swing = tr("2026-10-01", 100, { exitDate: "2026-10-22", horizon: "swing" });
    expect(byRealisation([swing, a]).map((t) => t.id)).toEqual([a.id, swing.id]);
  });

  it("open trades are left out", () => {
    const s = streaksOf([...seq("2026-10-21", "WW"), { ...tr("2026-10-21", 0), result: "open", pnl: null }], 0);
    expect(s.closed).toBe(2);
    expect(s.current).toEqual({ type: "win", count: 2 });
  });

  it("keeps the last 20 for the strip, oldest first", () => {
    const list = seq("2026-10-21", "L".repeat(5) + "W".repeat(20));
    const s = streaksOf(list, 0);
    expect(s.recent).toHaveLength(20);
    expect(s.recent[19].id).toBe(list[24].id);
    expect(s.recent.every((x) => x.outcome === "win")).toBe(true);
  });
});

describe("streaksOf — break-even handling", () => {
  it("a stored break-even neither extends nor breaks a streak", () => {
    const s = streaksOf(seq("2026-10-21", "WWBWW"), 0);
    expect(s.current).toEqual({ type: "win", count: 4 });
    expect(s.bestWin).toBe(4);
  });

  it("the «Вид» break-even range turns a small win into BE (shown grey, skipped)", () => {
    const list = [tr("2026-10-21", -100), tr("2026-10-21", 3), tr("2026-10-21", 100)];
    expect(streaksOf(list, 0).current).toEqual({ type: "win", count: 2 });
    const ranged = streaksOf(list, 5);
    expect(ranged.recent.map((x) => x.outcome)).toEqual(["loss", "be", "win"]);
    expect(ranged.current).toEqual({ type: "win", count: 1 });
  });

  it("the range uses the net (gross − fees)", () => {
    const t = tr("2026-10-21", 8, { fees: 5 }); // net $3
    expect(streaksOf([t], 5).recent[0].outcome).toBe("be");
    expect(streaksOf([t], 2).recent[0].outcome).toBe("win");
  });

  it("only break-evens → no streak", () => {
    expect(streaksOf(seq("2026-10-21", "BBB"), 0).current).toEqual({ type: "none", count: 0 });
  });
});

describe("green-day streak", () => {
  it("counts green days from the newest back to the first red one", () => {
    const list = [
      ...seq("2026-10-16", "W"), ...seq("2026-10-19", "LL"), ...seq("2026-10-20", "WL W".replace(" ", "")), ...seq("2026-10-21", "W"),
    ];
    expect(streaksOf(list, 0).greenDays).toBe(2);
  });

  it("a flat day ends the run without a range, a break-even day inside the range is skipped", () => {
    const flat = [...seq("2026-10-19", "W"), ...seq("2026-10-20", "WL"), ...seq("2026-10-21", "W")];
    expect(streaksOf(flat, 0).greenDays).toBe(1);
    const small = [...seq("2026-10-19", "W"), tr("2026-10-20", 4), ...seq("2026-10-21", "W")];
    expect(streaksOf(small, 0).greenDays).toBe(3);
    expect(streaksOf(small, 5).greenDays).toBe(2); // the $4 day is break-even: skipped, not counted
  });

  it("days without P&L fall back to wins − losses", () => {
    const list = [
      { id: 1, ticker: "X", day: "2026-10-20", net: null, outcome: "win" as const },
      { id: 2, ticker: "X", day: "2026-10-21", net: null, outcome: "win" as const },
    ];
    expect(greenDayStreak(list, 0)).toBe(2);
  });
});

describe("seqStats", () => {
  it("buckets by daySeq and names the best and the worst", () => {
    const list: InsightTrade[] = [];
    for (let d = 1; d <= 4; d++) {
      const day = `2026-10-0${d + 4}`;
      list.push(tr(day, 200, { daySeq: 1 }), tr(day, 50, { daySeq: 2 }), tr(day, -30, { daySeq: 3 }), tr(day, -120, { daySeq: 6 }));
    }
    const s = seqStats(list);
    expect(s.enough).toBe(true);
    expect(s.best).toBe("1");
    expect(s.worst).toBe("6+");
    expect(s.buckets.find((b) => b.key === "6+")?.net).toBe(-480);
    expect(s.buckets.find((b) => b.key === "4-5")?.trades).toBe(0);
  });

  it("falls back to the trader-day order when daySeq is missing", () => {
    const a = tr("2026-10-21", 10, { sec: 40_000 }), b = tr("2026-10-21", 10, { sec: 35_000 });
    const m = daySequenceOf([a, b]);
    expect(m.get(b.id)).toEqual({ seq: 1, prev: "first" });
    expect(m.get(a.id)).toEqual({ seq: 2, prev: "after-win" });
  });

  it("says «мало данных» under the threshold", () => {
    expect(seqStats(seq("2026-10-21", "WWLLW")).enough).toBe(false);
  });
});

describe("holdStats", () => {
  it("compares the median hold of winners and losers (intraday only)", () => {
    const w = [60, 90, 120, 60, 90].map((h) => tr("2026-10-21", 100, { holdSec: h }));
    const l = [300, 240, 200, 400, 240].map((h) => tr("2026-10-21", -100, { holdSec: h }));
    const swing = tr("2026-10-01", -100, { holdSec: 999_999, horizon: "swing" });
    const s = holdStats([...w, ...l, swing]);
    expect(s.winners).toBe(90);
    expect(s.losers).toBe(240);
    expect(s.nLoss).toBe(5);
    expect(holdVerdict(s.ratio)).toBe("bad");
    expect(holdVerdict(0.5)).toBe("good");
    expect(holdVerdict(1.1)).toBe("even");
  });
});

describe("weekdayStats", () => {
  it("ISO weekday of the entry date", () => {
    expect(weekdayKey("2026-10-19")).toBe("1");
    expect(weekdayKey("2026-10-25T10:00:00")).toBe("7");
  });

  it("best and worst day by net, Mon–Fri always listed", () => {
    const list = [
      ...seq("2026-10-19", "WWW"), ...seq("2026-10-20", "LL"), ...seq("2026-10-21", "WL"), ...seq("2026-10-22", "WWL"),
    ];
    const s = weekdayStats(list);
    expect(s.days.map((d) => d.key)).toEqual(["1", "2", "3", "4", "5"]);
    expect(s.best).toBe("1");
    expect(s.worst).toBe("2");
  });
});

describe("afterLossStats", () => {
  it("win rate of the next trade after a loss vs after a win", () => {
    const list: InsightTrade[] = [];
    for (let d = 10; d < 16; d++) list.push(...seq(`2026-10-${d}`, "WWLL"));
    const s = afterLossStats(list);
    // After W: W, L (×6 days) → 50 %; after L: L (×6) → 0 %.
    expect(s.afterWin.trades).toBe(12);
    expect(s.afterLoss.trades).toBe(6);
    expect(s.verdict).toBe("tilt");
  });
});

describe("onlyFacet", () => {
  it("checks only the kept keys of one column, other columns and IMX untouched", () => {
    const v = onlyFacet({ ...EMPTY_FACET_VIEW, excludeImx: true, off: { years: ["2024"] } }, "seq", ["6+"]);
    expect(v.excludeImx).toBe(true);
    expect(v.off.years).toEqual(["2024"]);
    expect(v.off.seq).toEqual(["1", "2", "3", "4-5", "unknown"]);
  });
});
