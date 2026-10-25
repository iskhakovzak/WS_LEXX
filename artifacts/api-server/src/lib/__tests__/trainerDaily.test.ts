import { describe, it, expect } from "vitest";
import { buildRanking, dailyStreak, pickOrder, sortDaily, type DailyCandidate, type DailyGameRow, type PickRules } from "../trainer/dailyPick";
import { deskAliases } from "../deskAliases";

const RULES: PickRules = { minPrice: 5, minVolume: 2_000_000, minRangePct: 1.5, maxRangePct: 15, minGapPct: 7 };
const c = (ticker: string, day: string, over: Partial<DailyCandidate> = {}): DailyCandidate => ({
  ticker, day, open: 50, volume: 5_000_000, rangePct: 4, gapPct: 9.5, deskTraders: 0, catalyst: true, ...over,
});
const POOL: DailyCandidate[] = [
  c("AAA", "2026-10-01"), c("BBB", "2026-10-02", { rangePct: 5 }), c("CCC", "2026-10-05", { rangePct: 3 }),
  c("DDD", "2026-10-06", { deskTraders: 2 }), c("EEE", "2026-10-07", { open: 3 }), c("FFF", "2026-10-08", { volume: 100_000 }),
  c("GGG", "2026-10-09", { rangePct: 30 }), c("HHH", "2026-10-12", { rangePct: 4.4 }), c("III", "2026-10-13", { rangePct: 6 }),
];

describe("daily pick", () => {
  it("is deterministic per date and independent of the input order", () => {
    const a = pickOrder("2026-10-19", POOL, RULES, new Set(), new Set());
    const b = pickOrder("2026-10-19", [...POOL].reverse(), RULES, new Set(), new Set());
    expect(a.map((x) => x.ticker)).toEqual(b.map((x) => x.ticker));
    expect(a.length).toBeGreaterThan(0);
  });

  it("never offers a day a desk trader traded, an illiquid or a wild day, or a future day", () => {
    const order = pickOrder("2026-10-19", POOL, RULES, new Set(), new Set()).map((x) => x.ticker);
    for (const t of ["DDD", "EEE", "FFF", "GGG"]) expect(order).not.toContain(t);
    const early = pickOrder("2026-10-06", POOL, RULES, new Set(), new Set()).map((x) => x.day);
    expect(early.every((d) => d < "2026-10-06")).toBe(true);
  });

  it("skips ticker-days of the no-repeat window and the last challenge tickers", () => {
    const first = pickOrder("2026-10-19", POOL, RULES, new Set(), new Set())[0];
    const next = pickOrder("2026-10-19", POOL, RULES, new Set([`${first.ticker}:${first.day}`]), new Set());
    expect(next.map((x) => x.ticker)).not.toContain(first.ticker);
    const noRecent = pickOrder("2026-10-19", POOL, RULES, new Set(), new Set(["AAA", "BBB"]));
    expect(noRecent.map((x) => x.ticker)).not.toContain("AAA");
  });

  it("different dates spread over the pool (not always the same day)", () => {
    const firsts = new Set<string>();
    for (let d = 1; d <= 28; d++) firsts.add(pickOrder(`2026-11-${String(d).padStart(2, "0")}`, POOL, RULES, new Set(), new Set())[0].ticker);
    expect(firsts.size).toBeGreaterThan(2);
  });

  it("relaxes to the fewest desk traders when every day was traded", () => {
    const traded = [c("XXX", "2026-10-01", { deskTraders: 3 }), c("YYY", "2026-10-02", { deskTraders: 1 }), c("ZZZ", "2026-10-03", { deskTraders: 1 })];
    const order = pickOrder("2026-10-19", traded, RULES, new Set(), new Set());
    expect(order.map((x) => x.ticker).sort()).toEqual(["YYY", "ZZZ"]);
  });

  it("day rule: never a gap under the threshold (either way) or a day without a catalyst — at any relaxation level", () => {
    const pool = [
      c("SMALL", "2026-10-01", { gapPct: 6.99 }), c("NEG", "2026-10-02", { gapPct: -6.5 }), c("NULL", "2026-10-05", { gapPct: null }),
      c("NOCAT", "2026-10-06", { gapPct: 12 }), c("UNKNOWN", "2026-10-07", { gapPct: 12, catalyst: undefined }),
      c("UP", "2026-10-08", { gapPct: 7 }), c("DOWN", "2026-10-09", { gapPct: -18, deskTraders: 4, rangePct: 40 }),
    ].map((x) => (x.ticker === "NOCAT" ? { ...x, catalyst: false } : x));
    const order = pickOrder("2026-10-19", pool, RULES, new Set(), new Set()).map((x) => x.ticker);
    expect(order).toEqual(["UP"]);
    // Only gap-less / catalyst-less days left: no pick at all (the liquidity / range / desk levels never relax the rule).
    const bad = pool.filter((x) => x.ticker !== "UP" && x.ticker !== "DOWN");
    expect(pickOrder("2026-10-19", bad, RULES, new Set(), new Set())).toEqual([]);
    expect(pickOrder("2026-10-19", bad, { ...RULES, minPrice: 0, minVolume: 0, minRangePct: 0, maxRangePct: 1000 }, new Set(), new Set())).toEqual([]);
    // The relaxed desk level still takes the down gap with a catalyst.
    expect(pickOrder("2026-10-19", pool.filter((x) => x.ticker === "DOWN"), RULES, new Set(), new Set()).map((x) => x.ticker)).toEqual(["DOWN"]);
    // A higher desk threshold drops the 7 % day.
    expect(pickOrder("2026-10-19", pool, { ...RULES, minGapPct: 10 }, new Set(), new Set()).map((x) => x.ticker)).toEqual(["DOWN"]);
  });

  it("returns nothing for an empty archive", () => {
    expect(pickOrder("2026-10-19", [], RULES, new Set(), new Set())).toEqual([]);
  });
});

const g = (userId: number, name: string, r: number, trades: number): DailyGameRow => ({ userId, name, r, trades });

describe("daily ranking", () => {
  const rows = [g(1, "Анна", 1.5, 3), g(2, "Борис", 2.5, 4), g(3, "Вера", 2.5, 2), g(4, "Глеб", 0, 0), g(5, "Дина", -1, 1)];

  it("sorts by R, ties by fewer trades, no trades last (no R)", () => {
    expect(sortDaily(rows).map((r) => r.name)).toEqual(["Вера", "Борис", "Анна", "Дина", "Глеб"]);
  });

  it("names for staff / named mode; aliases t<n> for traders, own row by name", () => {
    const aliases = deskAliases(rows.map((r) => r.name), "2026-10-16");
    const named = buildRanking(rows, 1, "names", aliases, 10);
    expect(named.ranking.map((r) => r.label)).toEqual(["Вера", "Борис", "Анна", "Дина", "Глеб"]);
    const anon = buildRanking(rows, 1, "aliases", aliases, 10);
    expect(anon.ranking.find((r) => r.me)?.label).toBe("Анна");
    for (const r of anon.ranking.filter((x) => !x.me)) expect(r.label).toMatch(/^t\d+$/);
    expect(anon.ranking.find((r) => r.label === "Глеб")).toBeUndefined();
    expect(anon.ranking[4].r).toBeNull();
    expect(anon.my).toEqual({ r: 1.5, rank: 3, of: 5 });
  });

  it("shows the top N plus the viewer's own place only", () => {
    const aliases = deskAliases(rows.map((r) => r.name), "2026-10-16");
    const out = buildRanking(rows, 4, "aliases", aliases, 2);
    expect(out.ranking).toHaveLength(3);
    expect(out.ranking[2]).toMatchObject({ me: true, label: "Глеб", r: null });
    expect(out.my).toEqual({ r: null, rank: 5, of: 5 });
  });

  it("leaves out traders who traded the challenge day (relaxed pick)", () => {
    const out = buildRanking(rows, 2, "names", new Map(), 10, new Set(["Борис"]));
    expect(out.ranking.map((r) => r.label)).not.toContain("Борис");
    expect(out.my).toEqual({ r: 2.5, rank: null, of: 4 });
  });

  it("aliases are stable for a date and shuffled across dates", () => {
    const names = rows.map((r) => r.name);
    expect([...deskAliases(names, "2026-10-16")]).toEqual([...deskAliases([...names].reverse(), "2026-10-16")]);
  });
});

describe("daily streak", () => {
  const dates = ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"];
  it("counts challenge days in a row; today not played yet does not break it", () => {
    expect(dailyStreak(dates, new Set(["2026-10-16", "2026-10-15", "2026-10-13"]), "2026-10-16")).toBe(2);
    expect(dailyStreak(dates, new Set(["2026-10-15", "2026-10-14"]), "2026-10-16")).toBe(2);
    expect(dailyStreak(dates, new Set(["2026-10-14"]), "2026-10-16")).toBe(0);
    expect(dailyStreak([], new Set(), "2026-10-16")).toBe(0);
  });
});
