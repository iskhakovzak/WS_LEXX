import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { payoffOf } from "@/lib/trade-math";
import { moneyStats } from "./use-trades-page";

const tr = (id: number, result: string, pnl: number, fees = 0): Trade =>
  ({ id, date: "2026-10-01", result, pnl, fees, ticker: "AAPL" }) as unknown as Trade;

describe("moneyStats (local fallback of the /trades/page summary, MAKSIM-08)", () => {
  it("averages wins / losses by the sign of net, so payoff matches the canonical payoffOf", () => {
    // A gross «win» of +$1 with $3 fees is a −$2 trade: it belongs to the losses.
    const list = [tr(1, "win", 10), tr(2, "win", 1, 3), tr(3, "loss", -4), tr(4, "loss", -6)];
    const s = moneyStats(list);
    expect(s.avgWinNet).toBe(10);
    expect(s.avgLossNet).toBe(-4);
    const nets = [10, -2, -4, -6];
    expect(s.avgWinNet! / Math.abs(s.avgLossNet!)).toBeCloseTo(payoffOf(nets)!, 10);
  });
});
