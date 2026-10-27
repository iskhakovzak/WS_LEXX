/** The regime limit multiplier (lib/marketRegime/regimes): suggestion vs applied, bounds, and the settings defaults. */
import { describe, expect, it } from "vitest";
import {
  MULT_MAX, MULT_MIN, NO_ADJ, REGIME_KEYS, effectiveDailyLimit, multiplierOf, multiplierSetting, suggestedLimit, withRegimeLimits,
} from "../marketRegime/regimes";
import { SETTINGS } from "../settings/registry";

describe("regime limit multiplier", () => {
  it("defaults: range 0.5, macro 0.75, every other regime 1; applying is off", () => {
    const d = Object.fromEntries(REGIME_KEYS.map((k) => [k, SETTINGS[multiplierSetting(k)].default]));
    expect(d).toEqual({ theme_bull: 1, macro: 0.75, range: 0.5, panic: 1, idiosyncratic: 1, euphoria: 1 });
    expect(SETTINGS["regime.applyLimits"].default).toBe(false);
    for (const k of REGIME_KEYS) expect([SETTINGS[multiplierSetting(k)].min, SETTINGS[multiplierSetting(k)].max]).toEqual([MULT_MIN, MULT_MAX]);
  });

  it("reads the regime's multiplier; no regime or an out-of-bounds value counts as 1", () => {
    const read = (k: string) => ({ range: 0.5, macro: 5, panic: "x" } as Record<string, unknown>)[k] ?? 1;
    expect(multiplierOf("range", read)).toBe(0.5);
    expect(multiplierOf("macro", read)).toBe(1);
    expect(multiplierOf("panic", read)).toBe(1);
    expect(multiplierOf(null, read)).toBe(1);
  });

  it("suggests base × multiplier (cents) and needs a positive base", () => {
    expect(suggestedLimit(500, 0.75)).toBe(375);
    expect(suggestedLimit(333.33, 0.5)).toBe(166.67);
    expect(suggestedLimit(null, 0.5)).toBeNull();
    expect(suggestedLimit(0, 0.5)).toBeNull();
  });

  it("changes the effective limit only when applying is on and the day has a regime; stored limits stay untouched", () => {
    const limits = { trader: "T", dailyLossLimit: 400, weeklyLossLimit: 1000 };
    const range = { regime: "range" as const, multiplier: 0.5, apply: false };
    expect(effectiveDailyLimit(400, range)).toBe(400);
    expect(withRegimeLimits(limits, range)).toBe(limits);
    expect(withRegimeLimits(limits, { ...range, apply: true })).toEqual({ ...limits, dailyLossLimit: 200 });
    expect(limits.dailyLossLimit).toBe(400);
    expect(withRegimeLimits(limits, { regime: null, multiplier: 1, apply: true })).toBe(limits);
    expect(withRegimeLimits({ ...limits, dailyLossLimit: null }, { ...range, apply: true })).toEqual({ ...limits, dailyLossLimit: null });
    expect(withRegimeLimits(null, { ...range, apply: true })).toBeNull();
    expect(effectiveDailyLimit(400, NO_ADJ)).toBe(400);
  });
});
