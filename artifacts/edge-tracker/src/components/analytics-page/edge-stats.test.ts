import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { maxDrawdownByDay } from "@/lib/trade-math";
import { valueIn } from "./metrics";
import { toSimTrades } from "./edge-api";
import { applyWhatIf, kpisOf, maxDrawdownByDays, maxDrawdownOf } from "./edge-stats";

/** Same-day order makes a per-trade path dip deeper than the end-of-day curve. */
const ROWS: [string, number][] = [
  ["2026-10-12", 100], ["2026-10-12", -80], // day +20
  ["2026-10-13", -50], ["2026-10-13", 60], //  day +10
  ["2026-10-14", -40], //                       day −40
];
const trades = ROWS.map(([date, pnl], i) => ({ id: i + 1, date, pnl, fees: 0, result: pnl > 0 ? "win" : "loss", rMultiple: pnl / 50 }) as unknown as Trade);

describe("one «Макс. просадка» by day (IMPROVEMENT_PLAN 2.7)", () => {
  const values = ROWS.map(([, v]) => v);
  const days = ROWS.map(([d]) => d);

  it("the fixture differs per trade and per day", () => {
    expect(maxDrawdownOf(values)).toBe(-130);
    expect(maxDrawdownByDays(values, days)).toBe(-40);
  });

  it("«Что если» KPIs (base and simulated) equal the «Обзор» number (lib/trade-math maxDrawdownByDay)", () => {
    const overviewUsd = maxDrawdownByDay(trades, (t) => valueIn(t, "usd"));
    const overviewR = maxDrawdownByDay(trades, (t) => valueIn(t, "r"));
    expect(overviewUsd).toBe(-40);
    const sim = toSimTrades(trades);
    const base = sim.filter((s) => s.net != null);
    expect(kpisOf(base.map((s) => s.net as number), base.map((s) => s.day)).maxDrawdown).toBe(overviewUsd);
    const noRules = applyWhatIf(sim, new Set(), "usd");
    expect(kpisOf(noRules.values, noRules.days).maxDrawdown).toBe(overviewUsd);
    const inR = applyWhatIf(sim, new Set(), "r");
    expect(kpisOf(inR.values, inR.days).maxDrawdown).toBeCloseTo(overviewR as number, 9);
  });

  it("«Деск»: aligned close days give the by-day number; without days the old per-value path stays", () => {
    const shuffled = [4, 0, 3, 1, 2];
    expect(maxDrawdownByDays(shuffled.map((i) => values[i]), shuffled.map((i) => days[i]))).toBe(-40); // server order ≠ day order
    expect(maxDrawdownByDays(values, null)).toBe(-130);
    expect(maxDrawdownByDays(values, days.slice(1))).toBe(-130); // misaligned ⇒ not trusted
    expect(kpisOf(values).maxDrawdown).toBe(-130);
  });
});
