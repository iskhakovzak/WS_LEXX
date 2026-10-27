/**
 * Plateau detector (roadmap R6, lib/plateau.ts) on synthetic daily series only (made-up traders and numbers).
 * Acceptance: a flat trader (μ $5, σ $200, 300 days) is PLATEAU; an improver (μ ramps 0 → 45 over 300 days) is not
 * after the ramp; dip suppression; the 30-trading-day escalation dedupe; severity by tenure; no look-ahead.
 */
import { describe, expect, it } from "vitest";
import { addWeekdays, computePlateau, runKindOn, severityOf, weekdaysBetween, type PlateauContext, type TraderSeries } from "../plateau";
import { randNormal, rngFor } from "../stats";
import { weekdays } from "./fixtures/edgeSynth";

const PACE = 1500 / 40; // the Джун net window: $37.5 a day

function series(trader: string, n: number, mu: (i: number) => number, sigma: number, seed: number): TraderSeries {
  const rng = rngFor(seed, "plateau", trader);
  return { trader, stage: "junior", stageSince: null, days: weekdays(n).map((day, i) => ({ day, net: mu(i) + sigma * randNormal(rng) })) };
}

const ctx = (asOf: string, over: Partial<PlateauContext> = {}): PlateauContext => ({
  asOf, kind: "monthly", minTenure: 120, paceOf: (s) => (s === "junior" ? PACE : null), B: 400, ...over,
});

describe("plateau verdict", () => {
  it("a flat trader (μ $5, σ $200, 300 days) is PLATEAU (fixed fixture; ≥ 70% of 20 seeds)", () => {
    const fixture = series("Flat", 300, () => 5, 200, 1);
    expect(computePlateau([fixture], ctx(fixture.days[299].day))[0]).toMatchObject({ plateau: true, severity: "stuck", pace: PACE });
    // Not 100%: by design ~10% of flat traders look «improving» (p_impr ≥ 0.9) and ~10% reach hi80 ≥ π by chance.
    let hits = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = series("Flat", 300, () => 5, 200, seed);
      const [r] = computePlateau([s], ctx(s.days[299].day));
      if (r.plateau) hits++;
      expect(r.tenure).toBe(300);
      expect(r.nDays).toBe(250);
    }
    expect(hits).toBeGreaterThanOrEqual(14);
  });

  it("an improver (μ ramps 0 → 45 over 300 days) is not PLATEAU after the ramp — in ≥ 90% of seeds", () => {
    let plateaus = 0;
    for (let seed = 1; seed <= 20; seed++) {
      // the ramp, then two months at the new level
      const s = series("Up", 340, (i) => Math.min(45, (45 * i) / 300), 120, seed);
      const [r] = computePlateau([s], ctx(s.days[339].day));
      if (r.plateau) plateaus++;
    }
    expect(plateaus).toBeLessThanOrEqual(2);
  });

  it("below the minimum tenure, or without a pace target, there is no verdict", () => {
    const s = series("New", 100, () => -20, 100, 1);
    expect(computePlateau([s], ctx(s.days[99].day))[0]).toMatchObject({ plateau: false, severity: null, mean: null });
    const other = { ...series("Senior", 300, () => 0, 100, 1), stage: "senior" };
    expect(computePlateau([other], ctx(other.days[299].day))[0].plateau).toBe(false);
  });

  it("tenure counts only active days at the current stage", () => {
    const s = series("Promoted", 300, () => 0, 100, 2);
    const since = s.days[250].day;
    expect(computePlateau([{ ...s, stageSince: since }], ctx(s.days[299].day))[0].tenure).toBe(50);
  });

  it("severity by tenure: < 250 slow, 250–499 stuck, ≥ 500 stuck_long", () => {
    expect([severityOf(120), severityOf(249), severityOf(250), severityOf(499), severityOf(500)]).toEqual(["slow", "slow", "stuck", "stuck", "stuck_long"]);
    // a slow decline (the previous window was better): PLATEAU regardless of the noise draw
    const s = series("Long", 520, (i) => (i < 270 ? 20 : 0), 150, 3);
    const [r] = computePlateau([s], ctx(s.days[519].day));
    expect(r.plateau).toBe(true);
    expect(r.severity).toBe("stuck_long");
  });
});

describe("escalation", () => {
  const s = series("Flat", 300, () => 0, 150, 4);
  const asOf = s.days[299].day;
  const monthAgo = s.days[278].day; // the previous monthly run, 21 trading days earlier

  it("escalates on the 2nd consecutive monthly PLATEAU only; a weekly run never escalates", () => {
    expect(computePlateau([s], ctx(asOf))[0]).toMatchObject({ plateau: true, escalated: false });
    const prior = new Map([["Flat", [{ asOf: monthAgo, plateau: true, escalated: false }]]]);
    expect(computePlateau([s], ctx(asOf, { priorRuns: prior }))[0].escalated).toBe(true);
    expect(computePlateau([s], ctx(asOf, { priorRuns: prior, kind: "weekly" }))[0].escalated).toBe(false);
    const notPlateau = new Map([["Flat", [{ asOf: monthAgo, plateau: false, escalated: false }]]]);
    expect(computePlateau([s], ctx(asOf, { priorRuns: notPlateau }))[0].escalated).toBe(false);
  });

  it("at most once per 30 trading days", () => {
    const recent = new Map([["Flat", [{ asOf: monthAgo, plateau: true, escalated: true }]]]);
    expect(weekdaysBetween(monthAgo, asOf)).toBeLessThan(30);
    expect(computePlateau([s], ctx(asOf, { priorRuns: recent }))[0].escalated).toBe(false);
    const older = s.days[265].day; // > 30 trading days ago, and a plateau in the previous monthly run
    const ok = new Map([["Flat", [{ asOf: older, plateau: true, escalated: true }, { asOf: monthAgo, plateau: true, escalated: false }]]]);
    expect(computePlateau([s], ctx(asOf, { priorRuns: ok }))[0].escalated).toBe(true);
  });

  it("dip suppression: a method change in the last 30 trading days suppresses escalation for 40 trading days", () => {
    const prior = new Map([["Flat", [{ asOf: monthAgo, plateau: true, escalated: false }]]]);
    const change = s.days[285].day;
    const [r] = computePlateau([s], ctx(asOf, { priorRuns: prior, methodChange: new Map([["Flat", change]]) }));
    expect(r.plateau).toBe(true);
    expect(r.escalated).toBe(false);
    expect(r.suppressedUntil).toBe(addWeekdays(change, 40));
    // a change older than 30 trading days does not suppress
    const old = s.days[250].day;
    expect(computePlateau([s], ctx(asOf, { priorRuns: prior, methodChange: new Map([["Flat", old]]) }))[0]).toMatchObject({ escalated: true, suppressedUntil: null });
  });

  it("admin escalation: stuck_long and 3 escalations with no curator intervention since", () => {
    const long = series("Long", 560, () => 0, 150, 5);
    const at = long.days[559].day;
    const runs = [long.days[440].day, long.days[480].day, long.days[537].day].map((d, i) => ({ asOf: d, plateau: true, escalated: i < 2 }));
    const prior = new Map([["Long", runs]]);
    expect(computePlateau([long], ctx(at, { priorRuns: prior }))[0]).toMatchObject({ escalated: true, adminEscalated: true, severity: "stuck_long" });
    const acted = new Map([["Long", long.days[500].day]]);
    expect(computePlateau([long], ctx(at, { priorRuns: prior, lastIntervention: acted }))[0].adminEscalated).toBe(false);
  });
});

describe("determinism and look-ahead", () => {
  it("the output for month M does not change when later data is appended", () => {
    const full = series("Flat", 400, () => 5, 200, 6);
    const asOf = full.days[299].day;
    const cut = { ...full, days: full.days.slice(0, 300) };
    expect(computePlateau([full], ctx(asOf))).toEqual(computePlateau([cut], ctx(asOf)));
    expect(computePlateau([cut], ctx(asOf))).toEqual(computePlateau([cut], ctx(asOf)));
  });

  it("shrinks toward the peers at the same stage and tenure bucket when there are ≥ 10", () => {
    const peers = Array.from({ length: 12 }, (_, i) => series(`P${i}`, 300, () => 10 * (i - 6), 150, 7));
    const asOf = peers[0].days[299].day;
    const rows = computePlateau(peers, ctx(asOf));
    expect(rows.every((r) => r.shrunk)).toBe(true);
    const few = computePlateau(peers.slice(0, 5), ctx(asOf));
    expect(few.every((r) => !r.shrunk)).toBe(true);
  });

  it("run kind: the first trading day of a month is monthly, other Mondays weekly", () => {
    expect(runKindOn("2026-06-01")).toBe("monthly"); // a Monday, 1st weekday of June
    expect(runKindOn("2026-11-02")).toBe("monthly"); // Monday 2 Nov (1 Nov is a Sunday)
    expect(runKindOn("2026-11-09")).toBe("weekly");
    expect(runKindOn("2026-11-10")).toBeNull();
    expect(runKindOn("2026-01-02", new Set(["2026-01-01"]))).toBe("monthly"); // New Year's Day closed
    expect(runKindOn("2026-11-07")).toBeNull(); // Saturday
  });
});
