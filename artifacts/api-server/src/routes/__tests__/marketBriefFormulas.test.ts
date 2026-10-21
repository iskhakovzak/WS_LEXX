/**
 * Morning brief formulas (routes/marketbrief.ts quoteFromChart / futuresPremarketPct / gapOf) and the sector «за день»
 * (lib/marketDataService sectorDayOf) — fixtures are the numbers of audit 2026-10-20 (market.md):
 *   sectors   SMH «за день» −6.08 % was the 6-day move; the previous session close gives +0.40 %
 *   futures   ES vs the cash SPX showed the basis (+0.6 %) as a premarket move; vs its own close it is +0.07 %
 *   gaps      MSTR «gap» +6.85 % was the day change; open vs previous close is −1.66 % (as in the watchlist)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));

const { quoteFromChart, futuresPremarketPct, gapOf } = await import("../marketbrief");
const { sectorDayOf } = await import("../../lib/marketDataService");

const TODAY = "2026-10-20";
/** Daily bar timestamps (09:30 NY) from 2026-10-14 to 2026-10-20. */
const days = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"];
const ts = (d: string) => Math.floor(Date.parse(`${d}T13:30:00Z`) / 1000);

describe("sector «за день» = price vs the previous session close (closes[-2])", () => {
  it("SMH: chartPreviousClose (before the 5-day window) gave −6.08 %, the previous session gives +0.40 %", () => {
    const r = {
      meta: { regularMarketPrice: 93.92, chartPreviousClose: 100 },
      indicators: { quote: [{ close: [96, 95, 94, 93.545, 93.92] }] },
    };
    const old = +(((93.92 - 100) / 100) * 100).toFixed(2);
    expect(old).toBe(-6.08);
    const s = sectorDayOf(r);
    expect(s.prevClose).toBe(93.545);
    expect(s.changePct).toBeCloseTo(0.401, 3);
    expect(s.trend5d).toBeCloseTo(-2.167, 3);
  });

  it("nulls in the closes are skipped; one close only → Yahoo's previousClose", () => {
    expect(sectorDayOf({ meta: { regularMarketPrice: 51 }, indicators: { quote: [{ close: [49, null, 50, null] }] } }).prevClose).toBe(49);
    expect(sectorDayOf({ meta: { regularMarketPrice: 51, previousClose: 50 }, indicators: { quote: [{ close: [51] }] } }).changePct).toBe(2);
  });
});

describe("brief futures: premarket % against the future's own previous close", () => {
  it("ES 6705 vs its close 6700 → +0.075 %, not +0.60 % against the cash SPX at 6665", () => {
    const es = quoteFromChart({
      meta: { regularMarketPrice: 6705 },
      timestamp: days.map(ts),
      indicators: { quote: [{ close: [6690, 6710, 6695, 6700, 6705], open: [6680, 6690, 6710, 6695, 6702] }] },
    }, TODAY);
    expect(es.lastClose).toBe(6700);
    expect(futuresPremarketPct(es)).toBe(0.075);
    const viaIndex = +(((6705 - 6665) / 6665) * 100).toFixed(2);
    expect(viaIndex).toBe(0.6);
  });

  it("no bar for today yet (weekend, before the session): the last close is the base", () => {
    const es = quoteFromChart({
      meta: { regularMarketPrice: 6700 },
      timestamp: days.slice(0, 4).map(ts),
      indicators: { quote: [{ close: [6690, 6710, 6695, 6700] }] },
    }, TODAY);
    expect(es.lastClose).toBe(6700);
    expect(futuresPremarketPct(es)).toBe(0);
  });
});

describe("brief «Гэпы · вотчлист»: open (before the open: premarket) vs the previous close", () => {
  it("MSTR: day change +6.85 % is not the gap; open 295.02 vs close 300 → −1.66 %", () => {
    const mstr = quoteFromChart({
      meta: { regularMarketPrice: 320.55 },
      timestamp: days.map(ts),
      indicators: { quote: [{ close: [310, 305, 302, 300, 320.55], open: [312, 309, 304, 301, 295.02] }] },
    }, TODAY);
    expect(mstr.changePct).toBe(6.85);
    expect(mstr.open).toBe(295.02);
    expect(gapOf(mstr, null)).toBe(-1.66);
  });

  it("before the open there is no today's bar: the premarket % is the gap; nothing known → null", () => {
    const mstr = quoteFromChart({
      meta: { regularMarketPrice: 300 },
      timestamp: days.slice(0, 4).map(ts),
      indicators: { quote: [{ close: [310, 305, 302, 300], open: [312, 309, 304, 301] }] },
    }, TODAY);
    expect(mstr.open).toBeNull();
    expect(mstr.lastClose).toBe(300);
    expect(gapOf(mstr, -1.66)).toBe(-1.66);
    expect(gapOf(mstr, null)).toBeNull();
  });
});
