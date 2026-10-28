import { describe, expect, it } from "vitest";
import { DEFAULT_SEASON, eventsOf, inWindow, lastWeekday, seasonOf, thirdFriday } from "../season";
import { effectiveDailyLimit, suggestedDayLimit } from "../../marketRegime/regimes";

describe("season calendar (feature 10)", () => {
  it("quad witching / S&P on the third Friday of the quarter month, MSCI on the last weekday of Feb / May / Aug / Nov", () => {
    expect([3, 6, 9, 12].map((m) => thirdFriday(2026, m))).toEqual([20, 19, 18, 18]);
    expect([2, 5, 8, 11].map((m) => lastWeekday(2026, m))).toEqual([27, 29, 31, 30]);
    expect(eventsOf("2026-09-18")).toEqual(["quad_witching", "sp_rebalance"]);
    expect(eventsOf("2026-11-30")).toEqual(["msci_rebalance"]);
    expect(eventsOf("2026-11-27")).toEqual([]);
  });

  it("off-season days are quiet (× quietFactor), event days and prime weeks are not", () => {
    expect(seasonOf("2026-09-01", DEFAULT_SEASON)).toMatchObject({ offSeason: true, quiet: true, factor: 0.75, trim: true, prime: false });
    expect(seasonOf("2026-09-18", DEFAULT_SEASON)).toMatchObject({ offSeason: true, quiet: false, factor: 1, events: ["quad_witching", "sp_rebalance"] });
    expect(seasonOf("2026-10-29", DEFAULT_SEASON)).toMatchObject({ prime: true, quiet: false, factor: 1 });
    expect(seasonOf("2026-11-10", DEFAULT_SEASON).prime).toBe(false);
    expect(seasonOf("2026-11-27", DEFAULT_SEASON, { earlyClose: true })).toMatchObject({ holidayEve: true, quiet: true });
    expect(seasonOf("2026-09-01", { ...DEFAULT_SEASON, trimLimits: false })).toMatchObject({ quiet: true, trim: false });
    expect(seasonOf("2026-09-01", { ...DEFAULT_SEASON, enabled: false })).toMatchObject({ quiet: false, factor: 1, events: [] });
  });

  it("windows may wrap the new year; bad bounds never match", () => {
    expect(inWindow("2027-01-02", "12-20", "01-05")).toBe(true);
    expect(inWindow("2026-12-10", "12-20", "01-05")).toBe(false);
    expect(inWindow("2026-09-01", "8-15", "10-05")).toBe(false);
  });

  it("a trimmed quiet day changes the stops on its own; the regime multiplier stacks on top when applied", () => {
    const quiet = { quiet: true, factor: 0.75, trim: true };
    expect(effectiveDailyLimit(1000, { regime: null, multiplier: 1, apply: false, season: quiet })).toBe(750);
    expect(effectiveDailyLimit(1000, { regime: "range", multiplier: 0.5, apply: true, season: quiet })).toBe(375);
    expect(effectiveDailyLimit(1000, { regime: "range", multiplier: 0.5, apply: false, season: { ...quiet, trim: false } })).toBe(1000);
    expect(suggestedDayLimit(1000, { regime: null, multiplier: 1, apply: false, season: { ...quiet, trim: false } })).toBe(750);
  });
});
