/**
 * Roadmap R2 — fee-aware coaching (acceptance tests, synthetic fixtures only):
 *  - one fee rule: fees ≥ max($5, 50 % × max(gross, 0)) — a red-gross day is flagged now, a healthy day is not;
 *  - weekly emission (Σ over the NY week ≥ $25) in the daily engine and the curator queue;
 *  - the per-band fee model: gross ÷ fees per share, the day-bootstrap upper bound, the flag, determinism;
 *  - the breakeven line (edge margin) shared with R1; /edge/costs by price band; the staff-only tariff what-if.
 */
import { afterEach, describe, expect, it } from "vitest";
import { feeCost } from "../feeRule";
import { detectDay, feeWeeks, HitBook, windowDays, type DetectInput } from "../daily/detectors";
import { feesReason, weekToDate } from "../daily/costQueue";
import { buildFeeModel, worstBand, type FeeModelTrade } from "../feeModel";
import { edgeMargin, edgeMarginOf } from "../breakeven";
import { dayClusterQuantile } from "../stats/dayBootstrap";
import { __loadSettingsCache } from "../settings/registry";
import type { BehaviorTrade } from "../behaviorEngine";
import { buildCostsQuery, parseCostsQuery, perShare } from "../../routes/edge";
import { feePlanAllowed } from "../../routes/whatif";

afterEach(() => __loadSettingsCache({}));

describe("the fee rule", () => {
  it("gross −20, fees 12 → flagged (the fees bought nothing); cost = every cent", () => {
    expect(feeCost(-20, 12, 5)).toBe(-12);
    expect(feesReason(-20, 12)).toMatchObject({ kind: "fees", costNet: -12 });
  });

  it("gross +100, fees 30 → not flagged (below half the gross)", () => {
    expect(feeCost(100, 30, 5)).toBeNull();
    expect(feesReason(100, 30)).toBeNull();
  });

  it("a positive gross: flagged from half, priced above the healthy quarter", () => {
    expect(feeCost(100, 60, 5)).toBe(-35);
    expect(feeCost(4, 3, 5)).toBeNull(); // under the $5 minimum
  });
});

let id = 0;
function bt(date: string, inMin: number, gross: number, fees: number): BehaviorTrade {
  const entryAt = Date.parse(`${date}T14:30:00Z`) + inMin * 60_000;
  const net = gross - fees;
  return {
    id: ++id, ticker: "SYN", date, side: "long", result: net > 0 ? "win" : net < 0 ? "loss" : "be", net, gross, qty: 100, entry: 12,
    entryAt, exitAt: entryAt + 120_000, entryMin: 570 + inMin, holdMin: 2, horizon: "intraday", setup: null,
  };
}
function dayFees(trades: BehaviorTrade[], from: string, to: string) {
  const input: DetectInput = { trades, from, to };
  const book = new HitBook();
  detectDay(input, book, windowDays(trades, from, to));
  return [...book.days].flatMap(([d, m]) => (m.get("day:fees") ? [[d, m.get("day:fees")!.costNet] as const] : []));
}

describe("weekly emission", () => {
  // Mon–Wed of one week: $4 / $9 / $14 of fees on red gross: per day only Tue and Wed pass the $5 minimum.
  const week = () => [bt("2026-03-09", 0, -2, 4), bt("2026-03-10", 0, -1, 9), bt("2026-03-11", 0, -3, 14)];

  it("sums the week (Σ fees $27 ≥ $25) and books one hit on its last traded day", () => {
    expect(dayFees(week(), "2026-03-09", "2026-03-13")).toEqual([["2026-03-11", -27]]);
  });

  it("per day when daily.feesWeekly is off (each day against the $5 minimum)", () => {
    __loadSettingsCache({ "daily.feesWeekly": false });
    expect(dayFees(week(), "2026-03-09", "2026-03-13")).toEqual([["2026-03-10", -9], ["2026-03-11", -14]]);
  });

  it("weeks are split at Monday", () => {
    expect(feeWeeks([{ date: "2026-03-13", gross: 1, fees: 2 }, { date: "2026-03-16", gross: 1, fees: 3 }]).map((w) => [w.monday, w.last])).toEqual([
      ["2026-03-09", "2026-03-13"], ["2026-03-16", "2026-03-16"],
    ]);
  });

  it("curator queue: week to date (Mon … day), gross ≤ 0 weeks included", () => {
    const rows = [{ date: "2026-03-09", gross: -5, fees: 10 }, { date: "2026-03-10", gross: 2, fees: 20 }, { date: "2026-03-06", gross: 0, fees: 99 }];
    const w = weekToDate(rows, "2026-03-10");
    expect(w).toEqual({ from: "2026-03-09", gross: -3, fees: 30 });
    expect(feesReason(w.gross, w.fees, w.from)).toMatchObject({ costNet: -30, text: { key: "costQueue.detail.feesWeekNoGross", params: { from: "2026-03-09" } } });
    expect(feesReason(5, 20, "2026-03-09")).toBeNull(); // under the $25 weekly minimum
  });
});

describe("fee model by price band", () => {
  /** `days` days × `perDay` trades of `qty` shares at `entry`, gross per share around `gps` (± `wobble`), fees `fps`/share. */
  function band(entry: number, days: number, perDay: number, gps: number, fps: number, wobble = 0): FeeModelTrade[] {
    const out: FeeModelTrade[] = [];
    for (let d = 0; d < days; d++) {
      for (let k = 0; k < perDay; k++) {
        const g = gps + (((d * 7 + k * 3) % 5) - 2) * wobble;
        out.push({ day: `2026-02-${String(d + 1).padStart(2, "0")}`, entry, qty: 200, gross: g * 200, fees: fps * 200 });
      }
    }
    return out;
  }

  it("flags a band whose gross per share does not clear 1.5 × its fees (even at the upper 80 % bound)", () => {
    const m = buildFeeModel([...band(15, 12, 3, 0.012, 0.01, 0.002), ...band(30, 12, 3, 0.08, 0.01, 0.01)]);
    const cheap = m.bands.find((b) => b.band === "10-20")!;
    const rich = m.bands.find((b) => b.band === "20-50")!;
    expect(cheap.trades).toBe(36);
    expect(cheap.fps).toBeCloseTo(0.01, 6);
    expect(cheap.ratio).toBeCloseTo(1.2, 1);
    expect(cheap.gpsHi80!).toBeGreaterThan(cheap.gps!);
    expect(cheap.gpsHi80!).toBeLessThan(1.5 * cheap.fps!);
    expect(cheap.flagged).toBe(true);
    expect(rich.ratio!).toBeGreaterThan(1.5);
    expect(rich.flagged).toBe(false);
    expect(m.flagged).toEqual(["10-20"]);
    expect(worstBand(m)?.band).toBe("10-20");
  });

  it("needs n ≥ 30 trades", () => {
    expect(buildFeeModel(band(15, 9, 3, 0.012, 0.01)).flagged).toEqual([]);
  });

  it("a losing band (gross per share < fees per share) has a ratio below 1", () => {
    const m = buildFeeModel(band(7, 10, 4, 0.005, 0.01, 0.001));
    expect(m.bands[0].band).toBe("5-10");
    expect(m.bands[0].ratio!).toBeLessThan(1);
    expect(m.bands[0].flagged).toBe(true);
  });

  it("the bootstrap is deterministic under the seed", () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ num: Math.sin(i + 1) * 3, den: 2 + (i % 3) }));
    expect(dayClusterQuantile(days, 0.9)).toBe(dayClusterQuantile(days, 0.9));
    expect(dayClusterQuantile(days, 0.9, 1000, 1)).not.toBe(dayClusterQuantile(days, 0.9, 1000, 2));
    expect(dayClusterQuantile(days.slice(0, 1), 0.9)).toBeNull();
  });
});

describe("breakeven line (edge margin, shared with R1)", () => {
  const nets = (wins: number, losses: number, avgWin: number, avgLoss: number) => [...Array(wins).fill(avgWin), ...Array(losses).fill(avgLoss)];

  it("WR 36 %, avg win 80, avg loss −40 → breakeven 33.3 %, margin +2.67 pp → pass (≥ 2)", () => {
    const m = edgeMargin(nets(36, 64, 80, -40))!;
    expect(m.breakevenWr).toBeCloseTo(33.33, 2);
    expect(m.marginPp).toBeCloseTo(2.67, 2);
    expect(m.marginPp).toBeGreaterThanOrEqual(2);
  });

  it("WR 60 %, payoff 0.5 → margin −6.7 pp → fail", () => {
    expect(edgeMarginOf(0.6, 50, -100)).toBeCloseTo(-6.67, 2);
    expect(edgeMargin(nets(12, 8, 50, -100))!.marginPp).toBeCloseTo(-6.67, 2);
  });

  it("fewer than 5 losses (or wins) → null", () => {
    expect(edgeMargin(nets(20, 4, 10, -10))).toBeNull();
    expect(edgeMargin(nets(4, 20, 10, -10))).toBeNull();
  });
});

describe("/edge/costs by price band", () => {
  it("groups by the trade-facet price band and reports gross ÷ fees per share", () => {
    const parsed = parseCostsQuery({ group: "price", trader: "Synthetic" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { sql, params } = buildCostsQuery(parsed.q, "Synthetic");
    expect(sql).toContain("WHEN t.entry < 20 THEN '10-20'");
    expect(params).toEqual(["Synthetic"]);
    expect(sql).toMatchSnapshot();
    expect(perShare(30, 20, 1000)).toEqual({ grossPerShare: 0.03, feeRatio: 1.5 });
    expect(perShare(30, 0, 0)).toEqual({ grossPerShare: null, feeRatio: null });
  });
});

describe("tariff what-if is staff-only", () => {
  const plan = [{ type: "commissionPlan" as const, perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002 }];
  it("staff may run it; a trader may not; other rules are for everyone", () => {
    expect(feePlanAllowed("curator", plan)).toBe(true);
    expect(feePlanAllowed("admin", plan)).toBe(true);
    expect(feePlanAllowed("trader", plan)).toBe(false);
    expect(feePlanAllowed("trader", [{ type: "priceRange", min: 20 }])).toBe(true);
  });
});
