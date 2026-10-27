/**
 * Achievements v2 — the trickiest rules (pure): a leak closed (fixed vs. a lucky streak, avoided vs. trading less), setup
 * mastery by a confirmed edge (tag coverage, the whole book, decay), anti-gaming of the process lines (clean week sample,
 * comeback reset by a violation) and the capital signal (reset by a violation, lost tiers, positive-only composite).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

const { leakState, slicePoints } = await import("../achievements/leaks");
const { setupMastery } = await import("../achievements/mastery");
const { cleanWeeks, comebacksAfterStops } = await import("../achievements/process");
const { achievementSignal } = await import("../achievements/signal");
const { compositeOf } = await import("../capital/engine");
type EdgeTrade = import("../edgeMap").EdgeTrade;
type MasteryTrade = import("../achievements/mastery").MasteryTrade;

/** Weekdays from `from`. */
function weekdays(n: number, from = "2026-01-05"): string[] {
  const out: string[] = [];
  let x = new Date(`${from}T12:00:00Z`);
  while (out.length < n) {
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(x.toISOString().slice(0, 10));
    x = new Date(x.getTime() + 86_400_000);
  }
  return out;
}

/** A day of trades: trade k (1-based) nets `bps(k)` bps of a $10,000 notional. */
function day(d: string, count: number, bps: (k: number) => number, ticker = "AAA"): EdgeTrade[] {
  return Array.from({ length: count }, (_, i) => ({
    trader: "T", day: d, entryMin: 600 + i * 20, exitMin: 600 + i * 20 + 5, seq: i + 1, net: (bps(i + 1) * 10_000) / 1e4,
    notional: 10_000, price: 50, side: "long" as const, ticker, sizeRel: 1,
  }));
}

const RULES = { minTrades: 30, minDays: 10 };
const flagOn = (d: string) => ({ sliceKey: "seq:4-5", firstFlag: d, lastFlag: d, thetaBps: -20, priorTau: 5 });

describe("leak closed", () => {
  const pre = weekdays(30);
  const post = weekdays(25, "2026-03-02");
  const before = pre.flatMap((d) => day(d, 5, (k) => (k >= 4 ? -40 : 5)));

  it("fixed: enough slice trades after the flag and no longer negative (shrunk toward the old loss)", () => {
    const after = post.flatMap((d) => day(d, 5, (k) => (k >= 4 ? 30 : 5)));
    const s = leakState(flagOn(pre[pre.length - 1]!), slicePoints([...before, ...after]), RULES, "T");
    expect(s.method).toBe("fixed");
    expect(s.closedOn).not.toBeNull();
    expect(s.closedOn! > pre[pre.length - 1]!).toBe(true);
    expect(s.reopenedOn).toBeNull();
  });

  it("a noisy break-even run is not enough: the posterior stays pulled to the old loss", () => {
    // +2 bps per trade on average, but whole days swing ±50: the day-clustered se is large, the prior (−20) wins.
    const after = post.flatMap((d, i) => day(d, 5, (k) => (k >= 4 ? (i % 2 === 0 ? 52 : -48) : 5)));
    const s = leakState(flagOn(pre[pre.length - 1]!), slicePoints([...before, ...after]), RULES, "T");
    expect(s.closedOn).toBeNull();
    expect(s.progress.trades).toBe(50);
  });

  it("too few slice trades after the flag: still open, with the progress", () => {
    const after = post.slice(0, 5).flatMap((d) => day(d, 5, (k) => (k >= 4 ? 30 : 5)));
    const s = leakState(flagOn(pre[pre.length - 1]!), slicePoints([...before, ...after]), RULES, "T");
    expect(s.closedOn).toBeNull();
    expect(s.progress).toEqual({ trades: 10, days: 5, need: 30 });
  });

  it("avoided: the trader kept trading but stopped taking trades #4–5", () => {
    const after = post.flatMap((d) => day(d, 3, () => 5));
    const s = leakState(flagOn(pre[pre.length - 1]!), slicePoints([...before, ...after]), RULES, "T");
    expect(s.method).toBe("avoided");
  });

  it("trading less overall is not avoiding: no volume, no closure", () => {
    const after = post.slice(0, 8).flatMap((d) => day(d, 1, () => 5));
    const s = leakState(flagOn(pre[pre.length - 1]!), slicePoints([...before, ...after]), RULES, "T");
    expect(s.closedOn).toBeNull();
  });
});

describe("setup mastery by a confirmed edge", () => {
  const days = weekdays(60);
  const rules = { trades: [30, 60, 100] as const, tagShare: 0.8, windowDays: 250, tauBps: 10, tauR: 0.25 };
  const mk = (d: string, k: number, bps: number, setupId: number | null): MasteryTrade => ({ day: d, net: bps, notional: 10_000, r: null, setupId });

  it("a steady positive edge on enough trades reaches gold; the earned days are checkpoints", () => {
    const trades = days.flatMap((d, i) => [0, 1].map((k) => mk(d, k, 40 + ((i + k) % 3) * 10 - 10, 1)));
    const [m] = setupMastery(trades, days[days.length - 1]!, rules);
    expect(m!.held).toBe("gold");
    expect(m!.earnedOn.bronze! <= m!.earnedOn.gold!).toBe(true);
  });

  it("anti-gaming: tagging only some trades (coverage below the setting) gives nothing", () => {
    const trades = days.flatMap((d, i) => [mk(d, 0, 40 + (i % 3) * 10, 1), mk(d, 1, -30, null), mk(d, 2, -30, null)]);
    const [m] = setupMastery(trades, days[days.length - 1]!, rules);
    expect(m!.tagShare).toBeLessThan(0.8);
    expect(m!.held).toBeNull();
  });

  it("anti-gaming: winners tagged as one setup, losers as another — the losing book blocks silver and gold", () => {
    const trades = days.flatMap((d, i) => [mk(d, 0, 40 + (i % 3) * 10, 1), mk(d, 1, 40 + (i % 2) * 10, 1), mk(d, 2, -150, 2), mk(d, 3, -150, 2)]);
    const m = setupMastery(trades, days[days.length - 1]!, rules).find((x) => x.setupId === 1)!;
    expect(m.held).toBe("bronze");
  });

  it("decay: the edge faded — the earned tier stays, the held one drops", () => {
    const later = weekdays(60, "2026-04-06");
    const good = days.flatMap((d, i) => [0, 1].map((k) => mk(d, k, 40 + ((i + k) % 3) * 10 - 10, 1)));
    const bad = later.flatMap((d, i) => [0, 1].map((k) => mk(d, k, -60 + ((i + k) % 3) * 10, 1)));
    const [m] = setupMastery([...good, ...bad], later[later.length - 1]!, rules);
    expect(m!.earnedOn.gold).not.toBeNull();
    expect(m!.held === null || m!.held === "bronze").toBe(true);
  });
});

describe("process lines: anti-gaming", () => {
  const base = {
    asOf: "2026-02-27", ledger: [], reviews: [], plansBeforeOpen: [], violationDays: [] as string[], breachDays: [] as string[], guardComplied: [], trades: [],
    disciplineDays: [], cleanMonths: [], rules: { cleanWeekMinDays: 3, revengeMinutes: 10, comebackDays: 5 },
  };
  const ok = (date: string) => ({ date, trough: -10, limit: 100 });

  it("a clean week needs enough traded days; a violation spoils it", () => {
    const wk1 = ["2026-02-02", "2026-02-03"].map(ok); // 2 days: too few
    const wk2 = ["2026-02-09", "2026-02-10", "2026-02-11"].map(ok);
    const wk3 = ["2026-02-16", "2026-02-17", "2026-02-18"].map(ok);
    const out = cleanWeeks({ ...base, stops: [...wk1, ...wk2, ...wk3], violationDays: ["2026-02-17"] });
    expect(out).toEqual(["2026-02-13"]);
  });

  it("the comeback after a stop: N clean days in a row; a violation restarts the count", () => {
    const stop = { date: "2026-02-02", trough: -120, limit: 100 };
    const days = weekdays(8, "2026-02-03").map(ok);
    const done = comebacksAfterStops({ ...base, stops: [stop, ...days] });
    expect(done.done).toEqual([days[4]!.date]);
    const broken = comebacksAfterStops({ ...base, stops: [stop, ...days.slice(0, 6)], violationDays: [days[2]!.date] });
    expect(broken.done).toEqual([]);
    expect(broken.open).toEqual({ since: "2026-02-02", days: 3, need: 5 });
  });
});

describe("capital signal", () => {
  const rules = { weights: { setupBronze: 0.3, setupSilver: 0.6, setupGold: 1, leakClosed: 0.4, cleanMonth: 0.3, comeback: 0.2 }, windowDays: 90, resetDays: 10 };

  it("held mastery and a closed leak count; a lost tier and a reopened leak do not", () => {
    const s = achievementSignal([
      { line: "setup:1", tier: "gold", date: "2026-08-01", lostOn: "2026-10-01" },
      { line: "setup:1", tier: "silver", date: "2026-07-01", lostOn: null },
      { line: "leak:seq:4-5", tier: "gold", date: "2026-10-01", lostOn: null },
      { line: "leak:rapid:yes", tier: "gold", date: "2026-10-02", lostOn: "2026-10-20" },
    ], [], "2026-10-27", rules);
    expect(s.parts.map((p) => `${p.kind}:${p.tier}`).sort()).toEqual(["leak:gold", "setup:silver"]);
    expect(s.value).toBe(1);
  });

  it("a fresh violation zeroes the signal", () => {
    const s = achievementSignal([{ line: "clean_month", tier: "bronze", date: "2026-10-01", lostOn: null }], ["2026-10-22"], "2026-10-27", rules);
    expect(s).toMatchObject({ value: 0, resetBy: "2026-10-22" });
  });

  it("positive-only in the composite: no achievements never pulls the score down", () => {
    const edge = { trades: 50, days: 20, r: null, u: null, score: 0.5, proven: true, negative: false };
    const disc = { score: 80, parts: { index: 80, violations: 100, closed: 100, stops: 100 } };
    const w = { edge: 0.5, regime: 0.25, discipline: 0.25, achievements: 0.15 };
    const none = compositeOf(edge, null, disc, w, 0);
    expect(none).toBeCloseTo(compositeOf(edge, null, disc, { ...w, achievements: 0 })!, 10);
    expect(compositeOf(edge, null, disc, w, 1)!).toBeGreaterThan(none!);
  });
});
