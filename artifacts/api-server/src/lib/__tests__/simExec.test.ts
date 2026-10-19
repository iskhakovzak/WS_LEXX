import { describe, it, expect } from "vitest";
import { simulate, type SimBar, type SimConfig, type SimEvent } from "../sim/engine";
import { execModelOf, marketPx, publicExec, riskQty, spreadOf, stopPx, type ExecSettings } from "../sim/exec";

const S: ExecSettings = { spreadCents: 2, spreadBps: 3, lowPriceUsd: 10, lowPriceMult: 2, lowAdvShares: 1_000_000, lowAdvMult: 2, slipCents: 1, stopSlipCents: 2 };

function bars(spec: ([number, number, number, number] | number)[]): SimBar[] {
  return spec.map((s, i) => {
    const [o, h, l, c] = typeof s === "number" ? [s, s, s, s] : s;
    return { t: 1000 + i * 60, o, h, l, c, v: 100 };
  });
}
let seq = 0;
const order = (idx: number, kind: "buy" | "sell" | "flat", qty = 100): SimEvent => ({ seq: ++seq, idx, type: "order", kind, qty });
const bracket = (idx: number, stop: number | null, target: number | null = null): SimEvent => ({ seq: ++seq, idx, type: "bracket", stop, target });
const exec = { halfSpread: 0.01, slip: 0.01, stopSlip: 0.02 };
const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({ startIdx: 0, endIdx: 9, feePerShare: 0, riskUnit: 1, exec, ...over });

describe("spread model", () => {
  it("takes the larger of cents and bps, wider for a low price and a low ADV", () => {
    expect(spreadOf(50, 5_000_000, S)).toBe(0.02); // 3 bps of $50 = 1.5¢ < 2¢
    expect(spreadOf(200, 5_000_000, S)).toBe(0.06); // 3 bps of $200 = 6¢
    expect(spreadOf(8, 5_000_000, S)).toBe(0.04); // under $10 → ×2
    expect(spreadOf(50, 400_000, S)).toBe(0.04); // low ADV → ×2
    expect(spreadOf(8, 400_000, S)).toBe(0.08); // both
    expect(spreadOf(50, null, S)).toBe(0.02); // unknown volume: no ADV widening
  });

  it("market fills pay half the spread + slip; stops slip against the position", () => {
    const m = execModelOf(200, 5_000_000, S);
    expect(m).toEqual({ halfSpread: 0.03, slip: 0.01, stopSlip: 0.02 });
    expect(marketPx(100, 1, m)).toBe(100.04);
    expect(marketPx(100, -1, m)).toBe(99.96);
    expect(stopPx(99, 100, m)).toBe(98.98); // a long's stop sells lower
    expect(stopPx(101, -100, m)).toBe(101.02); // a short's stop buys higher
    expect(marketPx(100, 1, null)).toBe(100);
    expect(publicExec(m)).toEqual({ perShare: 0.04, spread: 0.06 });
    expect(publicExec(undefined)).toBeNull();
  });

  it("sizes from 1R and the stop distance (rounded down, none on the wrong side)", () => {
    expect(riskQty(100, 50.02, 49.52, 1)).toBe(200);
    expect(riskQty(100, 50, 49.7, 1)).toBe(333);
    expect(riskQty(100, 50, 50.5, -1)).toBe(200);
    expect(riskQty(100, 50, 50.5, 1)).toBe(0);
    expect(riskQty(0, 50, 49, 1)).toBe(0);
  });
});

describe("sim engine with an execution model", () => {
  it("market orders fill at the close ± (half spread + slip) and report the slip", () => {
    const b = bars([10, 10, 11, 12, 12, 12, 12, 12, 12, 12]);
    const s = simulate(b, cfg(), [order(0, "buy", 100), order(3, "flat")], 9);
    expect(s.fills.map((f) => [f.price, f.qty, f.slip])).toEqual([[10.02, 100, 0.02], [11.98, -100, 0.02]]);
    expect(s.realized).toBe(196); // (11.98 − 10.02) × 100
  });

  it("partial exits (½) keep the rest open at the same average", () => {
    const b = bars([10, 11, 12, 12, 12, 12, 12, 12, 12, 12]);
    const s = simulate(b, cfg(), [order(0, "buy", 100), order(1, "sell", 50)], 2);
    expect(s.pos).toBe(50);
    expect(s.avg).toBe(10.02);
    expect(s.realized).toBe(48); // (10.98 − 10.02) × 50
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].closeIdx).toBeNull();
  });

  it("a stop fills at the stop minus the stop slip; a gap through it fills at the open minus the slip", () => {
    const b = bars([10, [10, 10.2, 9.4, 9.6], 10, 10, 10, 10, 10, 10, 10, 10]);
    const s = simulate(b, cfg(), [order(0, "buy", 100), bracket(0, 9.5)], 9);
    expect(s.fills[1]).toMatchObject({ price: 9.48, reason: "stop", slip: 0.02 });

    const g = bars([10, [9.2, 9.3, 9.0, 9.1], 10, 10, 10, 10, 10, 10, 10, 10]);
    const sg = simulate(g, cfg(), [order(0, "buy", 100), bracket(0, 9.5)], 9);
    expect(sg.fills[1]).toMatchObject({ price: 9.18, reason: "stop", slip: 0.02 });
  });

  it("a target is a resting limit: filled at the target, no slip", () => {
    const b = bars([10, [10, 11, 10, 10.8], 10, 10, 10, 10, 10, 10, 10, 10]);
    const s = simulate(b, cfg(), [order(0, "buy", 100), bracket(0, 9, 10.5)], 9);
    expect(s.fills[1]).toMatchObject({ price: 10.5, reason: "target" });
    expect(s.fills[1].slip).toBeUndefined();
  });

  it("old games (no model) still fill at the close and the stop exactly", () => {
    const b = bars([10, [10, 10.2, 9.4, 9.6], 10, 10, 10, 10, 10, 10, 10, 10]);
    const s = simulate(b, cfg({ exec: undefined }), [order(0, "buy", 100), bracket(0, 9.5)], 9);
    expect(s.fills.map((f) => [f.price, f.slip])).toEqual([[10, undefined], [9.5, undefined]]);
  });
});
