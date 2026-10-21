/**
 * routes/edge.ts /edge/matrix (Волна 2 п. 2.7): each cell carries the end-of-day max drawdown over ALL its trades
 * (maxDdR / maxDdNet), the same canonical number as «Обзор» (lib/tradeMath maxDrawdownByDay) — «Деск» no longer
 * measures it per trade or on the 400-value capped arrays.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
process.env.JWT_SECRET ??= "vitest-only-secret";
const { buildMatrixQuery, dayDrawdown } = await import("../edge");
const { maxDrawdownByDay } = await import("../../lib/tradeMath");

describe("edge matrix: drawdown by day close", () => {
  it("the query sums each cell per close day, uncapped", () => {
    const { sql } = buildMatrixQuery({ rows: "trader", cols: "trader" } as never, null, false);
    expect(sql).toMatch(/day_sums AS/);
    expect(sql).toMatch(/ARRAY_AGG\(day_net::float8 ORDER BY close_day\)/);
    expect(sql).not.toMatch(/day_net[^\n]*\[1:/); // the day arrays are not capped
  });
  it("equals the canonical drawdown where the per-trade path is deeper", () => {
    // Day 1: +100 then −130 (intraday dip, per-trade DD −130); day 2: −40 → end-of-day curve −30, −70 → DD −70.
    const trades = [
      { day: "2026-10-01", value: 100 }, { day: "2026-10-01", value: -130 }, { day: "2026-10-02", value: -40 },
    ];
    const perDay = [100 - 130, -40];
    expect(dayDrawdown(perDay)).toBe(maxDrawdownByDay(trades));
    expect(dayDrawdown(perDay)).toBe(-70);
    expect(dayDrawdown(null)).toBeNull();
    expect(dayDrawdown(["12.5", "-20"])).toBe(-20);
  });
});
