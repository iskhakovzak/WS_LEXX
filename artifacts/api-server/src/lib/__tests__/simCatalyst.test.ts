/**
 * Trainer day rules (owner 2026-10-25): |gap| ≥ trainer.minGapPct (default 7) with a catalyst for every exercise,
 * spoiler-safe catalyst views, market cap bucketing. Synthetic fixtures only.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("../trainer/eligibilityStore", () => ({ blockedTickerDays: vi.fn(async () => new Set<string>()), _resetEligibilityMemo: vi.fn() }));
import { SETTINGS, setting } from "../settings/registry";
import {
  DEFAULT_MIN_GAP_PCT, capBucket, capView, catalystView, isGapDay, maskHeadline, nameVariants, parseLarge, round2, type Catalyst,
} from "../sim/catalyst";
import { eligibleDays, gapDayIndexes } from "../sim/pick";
import { INTRADAY_SPECS } from "../sim/scenario";

describe("gap threshold setting", () => {
  it("defaults to 7 % in the trainer group", () => {
    expect(SETTINGS["trainer.minGapPct"]).toMatchObject({ group: "trainer", type: "number", default: 7, unit: "pct" });
    expect(setting("trainer.minGapPct")).toBe(7);
    expect(DEFAULT_MIN_GAP_PCT).toBe(7);
  });
});

describe("gap day", () => {
  it("either way, inclusive, unknown never qualifies", () => {
    expect(isGapDay(7, 7)).toBe(true);
    expect(isGapDay(-7, 7)).toBe(true);
    expect(isGapDay(6.99, 7)).toBe(false);
    expect(isGapDay(-6.99, 7)).toBe(false);
    expect(isGapDay(null, 7)).toBe(false);
    expect(isGapDay(Number.NaN, 7)).toBe(false);
  });

  it("no level filter asks for a small gap any more (the easy level used to want |gap| < 2.5 %)", () => {
    expect(INTRADAY_SPECS.easy.filter({ gapPct: 12, rangePct: 8 })).toBe(true);
    expect(INTRADAY_SPECS.easy.filter({ gapPct: -9, rangePct: 8 })).toBe(true);
    expect(INTRADAY_SPECS.medium.filter({ gapPct: -20, rangePct: 6 })).toBe(true);
    expect(INTRADAY_SPECS.hard.filter({ gapPct: 25, rangePct: 6 })).toBe(true);
  });
});

describe("picker never deals a small gap or a day without a catalyst", () => {
  const days = [
    { ticker: "AAA", day: "2026-10-01", gapPct: 3 },
    { ticker: "BBB", day: "2026-10-02", gapPct: -6.9 },
    { ticker: "CCC", day: "2026-10-05", gapPct: 15 }, // no catalyst
    { ticker: "DDD", day: "2026-10-06", gapPct: null },
    { ticker: "EEE", day: "2026-10-07", gapPct: -11 },
    { ticker: "FFF", day: "2026-10-08", gapPct: 8 },
  ];
  const cats = new Set(["AAA:2026-10-01", "BBB:2026-10-02", "DDD:2026-10-06", "EEE:2026-10-07", "FFF:2026-10-08"]);

  it("keeps only gapped days with a catalyst", () => {
    const { list, relaxed } = eligibleDays(days, 7, cats, new Set());
    expect(list.map((d) => d.ticker)).toEqual(["EEE", "FFF"]);
    expect(relaxed).toBe(false);
  });

  it("relaxes the recency (seen days come back), never the day rule", () => {
    const { list, relaxed } = eligibleDays(days, 7, cats, new Set(["EEE:2026-10-07", "FFF:2026-10-08"]));
    expect(list.map((d) => d.ticker)).toEqual(["EEE", "FFF"]);
    expect(relaxed).toBe(true);
    expect(eligibleDays(days, 7, new Set(), new Set()).list).toEqual([]);
    expect(eligibleDays(days, 20, cats, new Set()).list).toEqual([]);
  });

  it("random pools: every eligible day passes both rules", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 50; n++) {
      const pool = Array.from({ length: 40 }, (_, i) => ({ ticker: `T${i}`, day: "2026-10-01", gapPct: (rnd() - 0.5) * 40 }));
      const withCat = new Set(pool.filter(() => rnd() > 0.5).map((d) => `${d.ticker}:${d.day}`));
      for (const d of eligibleDays(pool, 7, withCat, new Set()).list) {
        expect(Math.abs(d.gapPct)).toBeGreaterThanOrEqual(7);
        expect(withCat.has(`${d.ticker}:${d.day}`)).toBe(true);
      }
    }
  });

  it("swing: windows start on daily gap days only", () => {
    const bar = (o: number, c: number) => ({ t: 0, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 });
    const bars = [bar(10, 10), bar(10.5, 10.4), bar(11.2, 11), bar(10, 10.1), bar(9.39, 9.5), bar(9.5, 9.6)];
    // 10 → 10.5 is +5 %, 10.4 → 11.2 is +7.7 %, 11 → 10 is −9.1 %, 10.1 → 9.39 is −7.03 %.
    expect(gapDayIndexes(bars, 7)).toEqual([2, 3, 4]);
    expect(gapDayIndexes(bars, 8)).toEqual([3]);
  });
});

describe("spoiler masking", () => {
  const names = ["Kodiak Sciences Inc", "Kodiak Sciences Inc."];

  it("masks the ticker, the company names (any case, possessive), dates and years", () => {
    const m = maskHeadline("Kodiak Sciences (NASDAQ: KOD) soars after KODIAK's Phase 3 data on October 27, 2026", "KOD", names)!;
    expect(m).not.toMatch(/kod/i);
    expect(m).not.toMatch(/october|2026|27,/i);
    expect(m).toContain("Phase 3 data");
  });

  it("drops the headline when the company name is unknown or still readable", () => {
    expect(maskHeadline("Nvidia beats on revenue", "NVDA", [])).toBeNull();
    expect(maskHeadline("NVDA and its peers rally on AI demand", "NVDA", ["NVIDIA Corporation"])).not.toMatch(/NVDA|nvidia/i);
    expect(maskHeadline("Kodiak", "KOD", names)).toBeNull();
  });

  it("a lower-case word equal to a ticker is not touched", () => {
    expect(maskHeadline("ServiceNow is the best stock to own now, says analyst", "NOW", ["ServiceNow Inc"])).toContain("to own now");
  });

  it("company name variants: full, without suffixes, first word", () => {
    expect(nameVariants(["Salesforce, Inc."])).toEqual(expect.arrayContaining(["Salesforce Inc.", "Salesforce"]));
  });

  const cats: Catalyst[] = [
    { kind: "news", source: "news", timing: "pre", at: "2026-10-27T11:00:00Z", headline: "Kodiak Sciences stock jumps on KOD trial win", publisher: "Wire", url: "https://x/kod-2026" },
    { kind: "news", source: "news", timing: "session", at: "2026-10-27T15:00:00Z", headline: "Why trial results sent shares sharply higher today", publisher: "Wire", url: null },
    { kind: "earnings", source: "earnings", timing: "prevAfter", at: "2026-10-26", headline: null, publisher: "Finviz", url: null },
    { kind: "news", source: "analyst", timing: "pre", at: "2026-10-27T12:00:00Z", headline: null, publisher: "Firm", url: null, analyst: { action: "up", firm: "Firm", from: "Hold", to: "Buy" } },
  ];

  it("pre-reveal views carry no ticker, no name, no time, no link; session news has no text", () => {
    const views = cats.map((c) => catalystView(c, false, "KOD", names));
    const json = JSON.stringify(views);
    expect(json).not.toMatch(/KOD|kodiak|2026|https/i);
    expect(views[0].headline).toContain("trial win");
    expect(views[1].headline).toBeNull();
    expect(views.every((v) => v.full === null)).toBe(true);
    expect(views[3].analyst).toMatchObject({ action: "up", to: "Buy" });
  });

  it("after the reveal: the full text, time and link", () => {
    const v = catalystView(cats[0], true, "KOD", names);
    expect(v.full).toEqual({ headline: cats[0].headline, at: cats[0].at, url: cats[0].url });
    expect(v.headline).toBe(cats[0].headline);
  });
});

describe("market cap", () => {
  it("buckets", () => {
    expect(capBucket(20e6)).toBe("nano");
    expect(capBucket(50e6)).toBe("micro");
    expect(capBucket(299e6)).toBe("micro");
    expect(capBucket(1.2e9)).toBe("small");
    expect(capBucket(2e9)).toBe("mid");
    expect(capBucket(55e9)).toBe("large");
    expect(capBucket(3.1e12)).toBe("mega");
  });

  it("shares × previous close first (basis day), else the latest cap (now), 2 significant digits", () => {
    expect(capView({ shares: 62_830_000, price: 19.4, capNow: 5.5e9 }, false)).toEqual({ usd: 1.2e9, bucket: "small", basis: "day" });
    expect(capView({ shares: null, price: 19.4, capNow: 5_483_610_000 }, false)).toEqual({ usd: 5.5e9, bucket: "mid", basis: "now" });
    expect(capView({ shares: null, price: null, capNow: null }, false)).toBeNull();
  });

  it("a mega cap shows the bucket only before the reveal", () => {
    expect(capView({ shares: 24e9, price: 130, capNow: null }, false)).toEqual({ usd: null, bucket: "mega", basis: "day" });
    expect(capView({ shares: 24e9, price: 130, capNow: null }, true)?.usd).toBe(3.1e12);
  });

  it("parses stored text numbers", () => {
    expect(parseLarge("14.59B")).toBe(14.59e9);
    expect(parseLarge("474.96M")).toBeCloseTo(474.96e6);
    expect(parseLarge("62830000")).toBe(62_830_000);
    expect(parseLarge("n/a")).toBeNull();
    expect(round2(1_234_567)).toBe(1_200_000);
  });
});
