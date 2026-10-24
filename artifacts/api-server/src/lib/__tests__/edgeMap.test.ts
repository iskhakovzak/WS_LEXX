/**
 * Edge map (roadmap R4, lib/edgeMap.ts) on synthetic traders only (fixtures/edgeSynth.ts — made-up names and numbers).
 *
 *   - slice keys are pre-trade observable and never look ahead (after a win / loss, day-P&L zone, rapid fire, ticker
 *     familiarity, trade number);
 *   - determinism under the seed; appending later trades never changes an earlier as-of;
 *   - shrinkage limits and BH are covered in stats.test.ts; here the verdict gates are exercised end to end;
 *   - NULL simulation: 200 traders with zero true edge and σ_trade = $60 → false LEAK rate ≤ 5% per slice-month;
 *   - POWER simulation: a −$8/trade slice over 120 trades is detected with ≥ 60% probability (see the configuration
 *     note at that test: the $3/active-day cost gate and BH make power depend on σ_trade and on how often the trader is
 *     active — at σ_trade = $60 power is far lower; the measured curve is in the test output and the report).
 */
import { describe, expect, it } from "vitest";
import { computeEdgeMap, sliceKeysOf, visibleVerdicts, type EdgeMapRow, type EdgeTrade } from "../edgeMap";
import { randInt, randNormal, rngFor } from "../stats";
import { isMidday, synthTrader, weekdays } from "./fixtures/edgeSynth";

const base = (over: Partial<EdgeTrade>): EdgeTrade => ({
  trader: "T", day: "2026-03-02", entryMin: 600, exitMin: 605, seq: 0, net: 0, notional: 5000, price: 12, side: "long", ticker: "SYN1", sizeRel: 1, ...over,
});

describe("slice keys (pre-trade observable, no look-ahead)", () => {
  it("after a win / after a loss within 10 minutes, trade number, rapid fire, familiarity", () => {
    const day = "2026-03-02";
    const trades = [
      base({ day, entryMin: 600, exitMin: 605, seq: 0, net: 30, ticker: "AAA" }), // 10:00 win, closes 10:05
      base({ day, entryMin: 608, exitMin: 640, seq: 1, net: -20, ticker: "AAA" }), // 3 min after the win
      base({ day, entryMin: 609, exitMin: 700, seq: 2, net: 5, ticker: "BBB" }), // still after the win (loss not closed yet)
      base({ day, entryMin: 612, exitMin: 615, seq: 3, net: 1, ticker: "AAA" }), // 3 entries in the previous 15 min
      base({ day, entryMin: 645, exitMin: 650, seq: 4, net: 1, ticker: "CCC" }), // 5 min after the loss (closed 10:40)
    ];
    const k = sliceKeysOf(trades);
    expect(k[0]).toContain("seq:1");
    expect(k[0]).toContain("familiar:0");
    expect(k[0].some((x) => x.startsWith("state:"))).toBe(false);
    expect(k[1]).toContain("state:after_win_10");
    expect(k[1]).toContain("familiar:1-3");
    expect(k[2]).toContain("state:after_win_10");
    expect(k[3]).toContain("rapid:yes");
    expect(k[3]).toContain("seq:4-5");
    expect(k[4]).toContain("state:after_loss_10");
    expect(k[4]).not.toContain("rapid:yes");
    expect(k[4]).toContain("time:10:10-11:15");
    expect(k[4]).toContain("session:rth");
    // a trade's own outcome never decides its slices: flip every net, same keys except the states it causes later
    const flipped = sliceKeysOf(trades.map((t) => ({ ...t, net: t === trades[4] ? -t.net : t.net })));
    expect(flipped[4]).toEqual(k[4]);
  });

  it("day-P&L zone in units of the median |daily net| of the previous days (none before 10 days of history)", () => {
    const days = weekdays(12);
    const trades: EdgeTrade[] = days.map((day, i) => base({ day, entryMin: 600, exitMin: 610, seq: 0, net: i % 2 ? 100 : -100 }));
    // day 12: +100 (closed 10:10) then −350 (closed 10:50) → the 11:00 entry is at −250 = −2.5u (u = 100); the 10:20
    // entry saw only the +100 → +1u
    trades.push(base({ day: days[11], entryMin: 620, exitMin: 650, seq: 1, net: -350 }), base({ day: days[11], entryMin: 660, exitMin: 670, seq: 2 }));
    const k = sliceKeysOf(trades);
    expect(k[0].some((x) => x.startsWith("zone:"))).toBe(false);
    expect(k[trades.length - 1]).toContain("zone:le_m2");
    expect(k[trades.length - 2]).toContain("zone:p05_2");
  });

  it("premarket / after-hours sessions; unknown times give no time-based slices", () => {
    const k = sliceKeysOf([base({ entryMin: 8 * 60 }), base({ entryMin: 16 * 60 + 5, seq: 1 }), base({ entryMin: null, exitMin: null, seq: 2 })]);
    expect(k[0]).toEqual(expect.arrayContaining(["session:pre", "time:before-8:30"]));
    expect(k[1]).toEqual(expect.arrayContaining(["session:ah", "time:after-16:00"]));
    expect(k[2].some((x) => /^(time|session|state|zone|rapid):/.test(x))).toBe(false);
  });
});

const OPTS = { asOf: "2099-01-01", tauDefaultBps: 3, minUsdPerDay: 3, B: 300 };

describe("computeEdgeMap", () => {
  const desk = Array.from({ length: 8 }, (_, i) => synthTrader({ trader: `S${i}`, days: 120, perDay: 4, seed: 5 })).flat();

  it("is deterministic under the seed", () => {
    expect(computeEdgeMap(desk, OPTS)).toEqual(computeEdgeMap(desk, OPTS));
  });

  it("no look-ahead: appending later trades does not change an earlier as-of", () => {
    const asOf = weekdays(100)[99];
    const later = synthTrader({ trader: "S0", days: 140, perDay: 4, seed: 99 }).filter((t) => t.day > asOf);
    expect(computeEdgeMap([...desk, ...later], { ...OPTS, asOf })).toEqual(computeEdgeMap(desk, { ...OPTS, asOf }));
  });

  it("a slice under the n / days floor is never a verdict and has no q", () => {
    const rows = computeEdgeMap(desk, OPTS);
    for (const r of rows.filter((x) => x.n < 30 || x.days < 10)) {
      expect(r.q).toBeNull();
      expect(r.verdict).toBe("NONE");
    }
  });

  it("visibleVerdicts: at most 3 per side, costliest first; NONE never shown", () => {
    const mk = (sliceKey: string, verdict: EdgeMapRow["verdict"], costPerDay: number) => ({ sliceKey, verdict, costPerDay });
    const v = visibleVerdicts([mk("a", "LEAK", -2), mk("b", "LEAK", -9), mk("c", "LEAK", -5), mk("d", "LEAK", -4), mk("e", "STRENGTH", 7), mk("f", "NONE", -99)]);
    expect(v.lose.map((r) => r.sliceKey)).toEqual(["b", "c", "d"]);
    expect(v.earn.map((r) => r.sliceKey)).toEqual(["e"]);
  });
});

describe("simulations", () => {
  it("NULL: 200 traders, zero true edge, σ_trade = $60 → false LEAK rate ≤ 5% per slice-month", () => {
    const trades = Array.from({ length: 200 }, (_, i) => synthTrader({ trader: `N${i}`, days: 250, perDay: 4, sigmaUsd: 60, seed: 7 })).flat();
    const rows = computeEdgeMap(trades, { ...OPTS, B: 400 });
    const eligible = rows.filter((r) => r.q != null);
    const leaks = rows.filter((r) => r.verdict === "LEAK").length;
    const strengths = rows.filter((r) => r.verdict === "STRENGTH").length;
    const rate = leaks / eligible.length;
    console.info(`[edge-map null] eligible slice-months ${eligible.length}, false LEAK ${leaks} (${(rate * 100).toFixed(2)}%), false STRENGTH ${strengths}`);
    expect(eligible.length).toBeGreaterThan(5000);
    expect(rate).toBeLessThanOrEqual(0.05);
    // per slice too: no slice family is a false-alarm magnet
    const bySlice = new Map<string, { n: number; leak: number }>();
    for (const r of eligible) {
      const s = bySlice.get(r.sliceKey) ?? { n: 0, leak: 0 };
      s.n++;
      if (r.verdict === "LEAK") s.leak++;
      bySlice.set(r.sliceKey, s);
    }
    for (const s of bySlice.values()) expect(s.leak / s.n).toBeLessThanOrEqual(0.05);
  }, 120_000);

  /**
   * The target trader is active on ~160 of the 250 window days, two regular trades a day plus a midday entry
   * (11:15–13:30) on exactly 120 of those days carrying −$8/trade; σ_trade = $25. The desk (15 synthetic traders,
   * σ = $60) has a heterogeneous midday effect (−$5…+$5/trade), so the prior's τ is estimated, not floored.
   * Measured during development (R = 30, B = 300): σ $25 → 83% (active 160) / 57% (active 250); σ $30 → 67% / 43%;
   * σ $45 → 43% / 20%; σ $60 → 33% / 10%. Power is limited by BH across ~38 slices (needs p ≲ 0.003 for a lone signal)
   * and by the $3/active-day cost gate on a shrunk θ — the gates that keep the null rate at ~0.
   */
  it("POWER: a −$8/trade slice over 120 trades is detected with ≥ 60% probability", () => {
    const deskTrades = Array.from({ length: 15 }, (_, i) => {
      const eff = ((i * 7919) % 11) - 5;
      return synthTrader({ trader: `D${i}`, days: 250, perDay: 4, sigmaUsd: 60, seed: 3, edge: ({ entryMin }) => (isMidday(entryMin) ? eff : 0) });
    }).flat();
    const R = 30;
    let hits = 0;
    for (let r = 0; r < R; r++) {
      const target = leakyTrader(1000 + r, { sigma: 25, effect: -8, sliceTrades: 120, activeDays: 160 });
      const row = computeEdgeMap([...deskTrades, ...target], OPTS).find((x) => x.trader === "TGT" && x.sliceKey === "time:11:15-13:30");
      if (row?.verdict === "LEAK") hits++;
    }
    console.info(`[edge-map power] σ $25, 120 slice trades, −$8/trade: detected ${hits}/${R} (${Math.round((hits / R) * 100)}%)`);
    expect(hits / R).toBeGreaterThanOrEqual(0.6);
  }, 180_000);
});

function leakyTrader(seed: number, o: { sigma: number; effect: number; sliceTrades: number; activeDays: number }): EdgeTrade[] {
  const rng = rngFor(seed, "leaky");
  const active = weekdays(250).filter(() => rng() < o.activeDays / 250);
  const slice = new Set<string>();
  while (slice.size < Math.min(o.sliceTrades, active.length)) slice.add(active[randInt(rng, active.length)]);
  const out: EdgeTrade[] = [];
  for (const day of active) {
    const mins = [9 * 60 + 40 + rng() * 80, 14 * 60 + rng() * 80];
    if (slice.has(day)) mins.push(11 * 60 + 20 + rng() * 120);
    mins.sort((a, b) => a - b).forEach((m, k) => out.push({
      trader: "TGT", day, entryMin: m, exitMin: m + 5, seq: k, net: (isMidday(m) ? o.effect : 0) + o.sigma * randNormal(rng),
      notional: 5000 * (0.5 + rng()), price: 15, side: "long", ticker: "SYN1", sizeRel: 1,
    }));
  }
  return out;
}
