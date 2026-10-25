/**
 * lib/profile/attributes — the eight scouting-card attributes on synthetic books: bounds, monotonic direction of each
 * formula, the low-sample honesty rules and the desk median.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE, archetypeOf, daysOf, deskMedians, deskTradesPerDay, maxDrawdownOf, scoreAttributes, summaryOf, withDeskMedians,
} from "../profile/attributes";
import type { AttrInput, AttrKey, Attribute, ProfileTrade } from "../profile/types";

/** Day n (0-based) of a synthetic weekday calendar starting 2026-01-05 (Monday). */
function dayN(n: number): string {
  const d = new Date(Date.UTC(2026, 0, 5));
  const weeks = Math.floor(n / 5);
  d.setUTCDate(d.getUTCDate() + weeks * 7 + (n % 5));
  return d.toISOString().slice(0, 10);
}

function trade(day: string, net: number, over: Partial<ProfileTrade> = {}): ProfileTrade {
  return {
    day, seq: 34200, net, result: net > 0 ? "win" : net < 0 ? "loss" : "be", side: "long", horizon: "intraday",
    holdSec: 300, entrySec: 34200, ticker: "AAA", setup: null, price: 25, ...over,
  };
}

/** `days` trading days with the given per-day trade nets (seq increases within the day). */
function book(days: number, perDay: (d: number) => number[]): ProfileTrade[] {
  const out: ProfileTrade[] = [];
  for (let d = 0; d < days; d++) perDay(d).forEach((net, i) => out.push(trade(dayN(d), net, { seq: 34200 + i * 600, entrySec: 34200 + i * 600 })));
  return out;
}

const base = (trades: ProfileTrade[], over: Partial<AttrInput> = {}): AttrInput => ({
  trades, violations: 0, rulesActive: 3, limits: null, deskTradesPerDay: 3, edgePrior: null, seed: "Trader T.", ...over,
});

const get = (list: Attribute[], k: AttrKey) => list.find((a) => a.key === k)!;

describe("daysOf / maxDrawdownOf", () => {
  it("aggregates by day in order with the intraday peak", () => {
    const d = daysOf([trade("2026-01-06", -5, { seq: 2 }), trade("2026-01-06", 20, { seq: 1 }), trade("2026-01-05", 3)]);
    expect(d.map((x) => x.day)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(d[1]).toMatchObject({ net: 15, n: 2, wins: 1, losses: 1, peak: 20 });
  });
  it("drawdown is the deepest fall of the cumulative curve", () => {
    expect(maxDrawdownOf([10, -4, -8, 30, -5])).toBe(12);
    expect(maxDrawdownOf([])).toBe(0);
    expect(maxDrawdownOf([-10, 5])).toBe(10);
  });
});

describe("scoreAttributes", () => {
  const steady = book(40, (d) => [d % 3 === 0 ? -20 : 30, 10, d % 4 === 0 ? -15 : 5]);

  it("returns all eight keys with scores in 0..100", () => {
    const list = scoreAttributes(base(steady));
    expect(list.map((a) => a.key)).toEqual(["discipline", "risk", "stability", "edge", "patience", "execution", "recovery", "growth"]);
    for (const a of list) {
      expect(a.score === null || (a.score >= 0 && a.score <= 100)).toBe(true);
      expect(a.minSample).toBe(MIN_SAMPLE[a.key]);
    }
  });

  it("an empty book: every score null and low (no fake precision)", () => {
    const list = scoreAttributes(base([]));
    for (const a of list) {
      expect(a.score).toBeNull();
      expect(a.low).toBe(true);
    }
  });

  it("a short book is low but still bounded once it has 3 units", () => {
    const list = scoreAttributes(base(book(5, () => [10, -5])));
    expect(get(list, "stability").low).toBe(true);
    expect(get(list, "stability").score).not.toBeNull();
    expect(get(list, "growth").score).toBeNull(); // 2 days per half < 3 units
  });

  it("discipline falls with violations per day; no rules and no violations is «мало данных»", () => {
    const clean = get(scoreAttributes(base(steady)), "discipline");
    const some = get(scoreAttributes(base(steady, { violations: 10 })), "discipline");
    const many = get(scoreAttributes(base(steady, { violations: 40 })), "discipline");
    expect(clean.score).toBe(100);
    expect(some.score!).toBeLessThan(clean.score!);
    expect(many.score!).toBeLessThan(some.score!);
    expect(get(scoreAttributes(base(steady, { violations: 10 })), "discipline").inputs.perDay).toBe(0.25);
    expect(some.score).toBe(50);
    const noRules = get(scoreAttributes(base(steady, { rulesActive: 0 })), "discipline");
    expect(noRules.basis).toBe("noRules");
    expect(noRules.low).toBe(true);
  });

  it("risk with limits: breaching the daily stop and a deep drawdown lower it", () => {
    const calm = get(scoreAttributes(base(steady, { limits: { dailyLoss: 500, maxDrawdown: 2000 } })), "risk");
    expect(calm.basis).toBe("limits");
    expect(calm.score).toBe(100);
    const wild = book(40, (d) => [d % 5 === 0 ? -600 : 120]);
    const bad = get(scoreAttributes(base(wild, { limits: { dailyLoss: 500, maxDrawdown: 700 } })), "risk");
    expect(bad.score!).toBeLessThan(calm.score!);
    expect(bad.inputs.breaches).toBe(8);
  });

  it("risk without limits uses the left tail", () => {
    const fat = book(40, (d) => [d % 10 === 7 ? -900 : 20]);
    const thin = book(40, (d) => [d % 2 ? -20 : 25]);
    const a = get(scoreAttributes(base(fat)), "risk");
    const b = get(scoreAttributes(base(thin)), "risk");
    expect(a.basis).toBe("tail");
    expect(b.score!).toBeGreaterThan(a.score!);
  });

  it("stability: more green days and a narrower spread score higher", () => {
    const good = get(scoreAttributes(base(book(30, (d) => [d % 10 === 0 ? -10 : 20]))), "stability");
    const bad = get(scoreAttributes(base(book(30, (d) => [d % 2 ? -200 : 180]))), "stability");
    expect(good.score!).toBeGreaterThan(bad.score!);
  });

  it("edge: a clearly positive book is near 100, a clearly negative one near 0; reproducible per seed", () => {
    const pos = get(scoreAttributes(base(book(30, () => [12, 8, -3]))), "edge");
    const neg = get(scoreAttributes(base(book(30, () => [-12, -8, 3]))), "edge");
    expect(pos.score!).toBeGreaterThan(90);
    expect(neg.score!).toBeLessThan(10);
    expect(pos.unit).toBe("trades");
    expect(get(scoreAttributes(base(book(30, () => [12, 8, -3]))), "edge")).toEqual(pos);
  });

  it("edge shrinks toward the desk prior (a pessimistic prior lowers a thin positive edge)", () => {
    const thin = book(12, (d) => [d % 2 ? 15 : -10, 4, -2]);
    const raw = get(scoreAttributes(base(thin)), "edge");
    const shrunk = get(scoreAttributes(base(thin, { edgePrior: { mu: -5, tau: 1 } })), "edge");
    expect(shrunk.basis).toBe("shrunk");
    expect(shrunk.score!).toBeLessThan(raw.score!);
    expect(raw.low).toBe(true); // 36 trades but only 12 days: still «мало данных»
  });

  it("patience: trading far more than the desk lowers it; overtrading days too", () => {
    const calm = get(scoreAttributes(base(book(20, () => [5, 5]), { deskTradesPerDay: 4 })), "patience");
    const busy = get(scoreAttributes(base(book(20, () => Array(16).fill(1)), { deskTradesPerDay: 4 })), "patience");
    expect(calm.score).toBe(100);
    expect(busy.score!).toBeLessThan(40);
    const bursts = get(scoreAttributes(base(book(20, (d) => (d % 4 === 0 ? Array(10).fill(1) : [1, 1])), { deskTradesPerDay: 10 })), "patience");
    expect(bursts.inputs.overtradeShare).toBe(0.25);
    expect(bursts.score).toBe(75);
  });

  it("execution: giving back the intraday peak lowers it", () => {
    const keep = get(scoreAttributes(base(book(20, () => [40, 5]))), "execution");
    const give = get(scoreAttributes(base(book(20, () => [40, -35]))), "execution");
    expect(keep.score).toBe(100);
    expect(give.score!).toBeLessThan(20);
  });

  it("recovery: winning more often right after a loss raises it", () => {
    const tilt = get(scoreAttributes(base(book(30, (d) => (d % 2 ? [10, -5, -5, -5, 10] : [-5, -5, 10, 10, 10])))), "recovery");
    const calm = get(scoreAttributes(base(book(30, () => [-5, 10, -5, 10, 10]))), "recovery");
    expect(calm.score!).toBeGreaterThan(tilt.score!);
    expect(calm.unit).toBe("pairs");
  });

  it("growth: a better second half scores above 50, a worse one below", () => {
    const up = get(scoreAttributes(base(book(40, (d) => [d < 20 ? -10 + (d % 3) : 30 + (d % 3)]))), "growth");
    const down = get(scoreAttributes(base(book(40, (d) => [d < 20 ? 30 + (d % 3) : -10 + (d % 3)]))), "growth");
    expect(up.score!).toBeGreaterThan(80);
    expect(down.score!).toBeLessThan(20);
  });
});

describe("desk median, summary, archetype", () => {
  const a = (key: AttrKey, score: number | null, low = false): Attribute => ({ key, score, low, sample: 50, minSample: 10, unit: "days", basis: "days", inputs: {}, deskMedian: null });

  it("median over trusted scores only; null with fewer than 3 traders", () => {
    const m = deskMedians([[a("risk", 40)], [a("risk", 60)], [a("risk", 90)], [a("risk", 10, true)], [a("edge", 50)]]);
    expect(m.risk).toBe(60);
    expect(m.edge).toBeNull();
    expect(withDeskMedians([a("risk", 70)], m)[0]!.deskMedian).toBe(60);
  });

  it("desk trades per day needs 3 traders with enough days", () => {
    const t = (n: number) => book(12, () => Array(n).fill(1));
    expect(deskTradesPerDay([t(2), t(4), t(8)])).toBe(4);
    expect(deskTradesPerDay([t(2), t(4)])).toBeNull();
  });

  it("summary: two strongest ≥ 60, weakest < 60, low data flagged", () => {
    const list = [a("discipline", 90), a("risk", 75), a("stability", 70), a("edge", 40), a("patience", 10, true)];
    const s = summaryOf(list, book(30, () => [1]));
    expect(s.top).toEqual(["discipline", "risk"]);
    expect(s.weak).toBe("edge");
    expect(s.lowData).toBe(false);
    const thin = summaryOf([a("risk", 80), a("edge", 20, true)], []);
    expect(thin.lowData).toBe(true);
    expect(thin.archetype).toBe("newcomer");
    expect(summaryOf([a("risk", 80), a("edge", 70), a("growth", 65), a("stability", 61)], []).weak).toBeNull();
  });

  it("archetype by hold time and horizon", () => {
    expect(archetypeOf(book(10, () => [1, 1]).map((t) => ({ ...t, holdSec: 30 })))).toBe("scalper");
    expect(archetypeOf(book(10, () => [1, 1]))).toBe("daytrader");
    expect(archetypeOf(book(10, () => [1, 1]).map((t, i) => ({ ...t, horizon: i % 2 ? "swing" : "intraday" })))).toBe("swing");
    expect(archetypeOf(book(10, () => [1, 1]).map((t, i) => ({ ...t, horizon: i % 4 === 0 ? "overnight" : "intraday" })))).toBe("mixed");
  });
});
