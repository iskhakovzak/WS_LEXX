import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { bucketHref, bucketLabel, bucketValue, isPeriod, nextPlanDate, reviewState, sectionsOf, totalsLine, winText } from "../model";
import type { MyReview } from "../api";

afterEach(async () => {
  await setLang("ru", { source: "init" });
});

const review = (over: Partial<MyReview> = {}): MyReview => ({
  trader: "Kirill", days: 30, from: "2026-09-21", to: "2026-10-20",
  totals: { trades: 41, net: 830, r: null, winRate: 0.6 },
  earn: { setup: [{ key: "ORB", trades: 6, net: 420, r: 3.5, winRate: 0.667 }], ticker: [], hour: [{ key: "09", trades: 20, net: 400, r: null, winRate: 0.6 }] },
  lose: { patterns: [], setup: [], ticker: [{ key: "TSLA", trades: 7, net: -260, r: null, winRate: 0.286 }], hour: [] },
  rule: null, generatedAt: "2026-10-20T20:00:00Z", ...over,
});

describe("«Мой разбор» view model (2.9)", () => {
  it("labels: hours as a range, setups as named", () => {
    expect(bucketLabel("hour", "09")).toBe("09:00–10:00");
    expect(bucketLabel("hour", "23")).toBe("23:00–00:00");
    expect(bucketLabel("setup", "ORB")).toBe("ORB");
  });

  it("rows link to the period's trades of that setup / ticker; hours do not link", () => {
    const r = review();
    expect(bucketHref("setup", "ORB", r)).toContain("/trades?");
    expect(bucketHref("setup", "ORB", r)).toContain("setup=ORB");
    expect(bucketHref("ticker", "TSLA", r)).toContain("ticker=TSLA");
    expect(bucketHref("ticker", "TSLA", r)).toContain("from=2026-09-21");
    expect(bucketHref("hour", "09", r)).toBeNull();
  });

  it("values: net first, R only when known; win share", () => {
    expect(bucketValue({ net: 420, r: 3.5 })).toBe("+$420.00 · +3.5R");
    expect(bucketValue({ net: -260, r: null })).toBe("−$260.00");
    expect(winText(0.667)).toBe("67%");
    expect(winText(null)).toBe("—");
  });

  it("totals line leaves R out when unknown", () => {
    expect(totalsLine(review().totals)).toBe("41 сделка · +$830.00 · 60% побед");
    expect(totalsLine({ trades: 3, net: -12, r: -1.25, winRate: 1 / 3 })).toBe("3 сделки · −$12.00 · −1.3R · 33% побед");
  });

  it("state and sections", () => {
    expect(reviewState(undefined)).toBe("loading");
    expect(reviewState(review({ totals: { trades: 0, net: 0, r: null, winRate: null } }))).toBe("empty");
    expect(reviewState(review())).toBe("ready");
    expect(sectionsOf(review().earn).map((s) => s.dim)).toEqual(["setup", "hour"]);
    expect(sectionsOf(review().lose).map((s) => s.dim)).toEqual(["ticker"]);
  });

  it("periods and tomorrow's plan date (weekends skipped)", () => {
    expect([isPeriod(30), isPeriod(90), isPeriod(14), isPeriod("30")]).toEqual([true, true, false, false]);
    expect(nextPlanDate("2026-10-16")).toBe("2026-10-19");
    expect(nextPlanDate("2026-10-20")).toBe("2026-10-21");
  });

  it("follows the UI language", async () => {
    await setLang("en", { source: "init" });
    expect(totalsLine(review().totals)).toContain("wins");
  });
});
