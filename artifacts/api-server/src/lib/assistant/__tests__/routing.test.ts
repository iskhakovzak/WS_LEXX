/**
 * Model routing (default model for most work; boost = the stronger model; heavy work = the advisor, or with the advisor
 * off the escalation model), prices, the unified budget (1x / multiplier x, advisor tokens included) and the tiers
 * members see instead of model names.
 */
import { describe, expect, it } from "vitest";
import {
  LONG_CONTEXT_CHARS, MAX_CHEAP_DATA_CALLS, advisorFor, budgetTokens, escalateAfter, initialRoute, requestCostUsd, tierOf, unitWeight, unitsOf,
  type RouteSettings,
} from "../models";
import { budgetOf, cacheHitRatio, unitsUsed, type AssistantSettings } from "../store";
import { usagesOf } from "../usage";
import { betasFor } from "../client";

const OLD: RouteSettings = { defaultModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", autoEscalate: true, advisorEnabled: false, advisorModel: "claude-sonnet-5-5", multiplier: 5 };
const S: RouteSettings = { ...OLD, advisorEnabled: true };
const base = { settings: S, mode: "chat" as const, boost: false, contextChars: 500, budgetLeft: true };

describe("initialRoute", () => {
  it("plain chat starts on the default model, no advisor", () => {
    expect(initialRoute(base)).toMatchObject({ model: "claude-haiku-5-5", cls: "default", reason: "default", escalated: false, advisor: null });
  });
  it("boost runs the stronger model, even with auto-escalation off", () => {
    expect(initialRoute({ ...base, boost: true })).toMatchObject({ model: "claude-sonnet-5-5", reason: "manual", escalated: true, advisor: null });
    expect(initialRoute({ ...base, boost: true, settings: { ...S, autoEscalate: false } })).toMatchObject({ model: "claude-sonnet-5-5", reason: "manual" });
  });
  it("heavy work (Help, heavy intents, long context) gets the advisor on the default model", () => {
    expect(initialRoute({ ...base, mode: "assist" })).toMatchObject({ model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", reason: "assist" });
    for (const intent of ["draft_playbook", "draft_plan", "draft_eod", "analysis"]) expect(initialRoute({ ...base, intent }).advisor).toBe("claude-sonnet-5-5");
    expect(initialRoute({ ...base, intent: "chat" }).advisor).toBeNull();
    expect(initialRoute({ ...base, contextChars: LONG_CONTEXT_CHARS + 1 })).toMatchObject({ reason: "long_context", advisor: "claude-sonnet-5-5" });
  });
  it("with the advisor off heavy work moves to the escalation model (the old routing)", () => {
    expect(initialRoute({ ...base, settings: OLD, intent: "analysis" })).toMatchObject({ model: "claude-sonnet-5-5", advisor: null, escalated: true });
  });
  it("auto-escalation off keeps everything but boost plain", () => {
    const off = { ...base, settings: { ...S, autoEscalate: false } };
    expect(initialRoute({ ...off, mode: "assist" })).toMatchObject({ model: "claude-haiku-5-5", advisor: null });
    expect(initialRoute({ ...off, intent: "draft_playbook" }).advisor).toBeNull();
  });
  it("not enough budget for the stronger path → the default model alone", () => {
    expect(initialRoute({ ...base, boost: true, budgetLeft: false })).toMatchObject({ model: "claude-haiku-5-5", reason: "budget", advisor: null });
    expect(initialRoute({ ...base, intent: "analysis", budgetLeft: false })).toMatchObject({ reason: "budget", advisor: null });
  });
  it("an advisor that is not stronger than the executor is never used", () => {
    expect(advisorFor({ ...S, defaultModel: "claude-sonnet-5-5", advisorModel: "claude-sonnet-5-5" })).toBeNull();
    expect(advisorFor({ ...S, defaultModel: "claude-sonnet-5-5", advisorModel: "claude-opus-5-5" })).toBe("claude-opus-5-5");
    expect(advisorFor({ ...S, advisorModel: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });
});

describe("escalateAfter (mid-turn)", () => {
  const plain = initialRoute(base);
  const sig = { dataCalls: 1, whatif: false, draftRequested: false };
  it("tool calls on the plain path stay plain", () => {
    expect(escalateAfter(plain, S, sig, true)).toBeNull();
    expect(escalateAfter(plain, S, { ...sig, dataCalls: MAX_CHEAP_DATA_CALLS }, true)).toBeNull();
  });
  it("a draft request re-runs the step with the advisor (advisor on) or on the escalation model (advisor off)", () => {
    expect(escalateAfter(plain, S, { ...sig, draftRequested: true }, true)).toMatchObject({ model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", reason: "draft", rerun: true });
    expect(escalateAfter(initialRoute({ ...base, settings: OLD }), OLD, { ...sig, draftRequested: true }, true)).toMatchObject({ model: "claude-sonnet-5-5", reason: "draft", rerun: true });
  });
  it("more than 2 data tools or run_whatif → the stronger path writes the analysis (tools already ran)", () => {
    expect(escalateAfter(plain, S, { ...sig, dataCalls: MAX_CHEAP_DATA_CALLS + 1 }, true)).toMatchObject({ reason: "heavy_tools", rerun: false, advisor: "claude-sonnet-5-5" });
    expect(escalateAfter(plain, S, { ...sig, whatif: true }, true)).toMatchObject({ rerun: false });
  });
  it("never escalates twice, without auto-escalation, without budget, or with nothing stronger", () => {
    expect(escalateAfter(initialRoute({ ...base, boost: true }), S, { ...sig, draftRequested: true }, true)).toBeNull();
    expect(escalateAfter(initialRoute({ ...base, intent: "analysis" }), S, { ...sig, draftRequested: true }, true)).toBeNull();
    expect(escalateAfter(plain, { ...S, autoEscalate: false }, { ...sig, draftRequested: true }, true)).toBeNull();
    expect(escalateAfter(plain, S, { ...sig, whatif: true }, false)).toBeNull();
    expect(escalateAfter(plain, { ...OLD, smartModel: "claude-haiku-5-5" }, { ...sig, whatif: true }, true)).toBeNull();
  });
});

describe("tiers instead of model names", () => {
  it("boost / deep / standard", () => {
    expect(tierOf(initialRoute({ ...base, boost: true }))).toBe("boost");
    expect(tierOf(initialRoute({ ...base, intent: "analysis" }))).toBe("deep");
    expect(tierOf(initialRoute({ ...base, settings: OLD, intent: "analysis" }))).toBe("deep");
    expect(tierOf(initialRoute(base))).toBe("standard");
    expect(tierOf(initialRoute({ ...base, boost: true, budgetLeft: false }))).toBe("standard");
  });
});

describe("prices", () => {
  it("costs per the 2026 rate cards (Haiku long-prompt card above 100K; Sonnet 5.5 cache reads $0.10)", () => {
    expect(requestCostUsd("claude-haiku-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.5, 6); // > 100K prompt
    expect(requestCostUsd("claude-haiku-5-5", { input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.0015, 6);
    expect(requestCostUsd("claude-sonnet-5-5", { input: 10_000, output: 1_000, cacheRead: 5_000, cacheWrite: 0 })).toBeCloseTo(0.0305, 6);
    expect(requestCostUsd("claude-opus-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(20, 6);
  });
});

describe("budget arithmetic (1M units: default model 1x, everything stronger x multiplier)", () => {
  const settings: AssistantSettings = { ...S, enabled: true, juniorsEnabled: true, dailyUnits: 1_000_000, auditBodies: false };
  it("budget tokens = input + cache writes + output (cache reads free)", () => {
    expect(budgetTokens({ input: 10, output: 5, cacheRead: 1000, cacheWrite: 7 })).toBe(22);
  });
  it("weights: the default model 1x; boost, escalation and advisor models x5; the multiplier is a setting", () => {
    expect(unitWeight("claude-haiku-5-5", settings)).toBe(1);
    expect(unitWeight("claude-sonnet-5-5", settings)).toBe(5);
    expect(unitWeight("claude-opus-5-5", settings)).toBe(5);
    expect(unitWeight("claude-sonnet-5-5", { ...settings, multiplier: 8 })).toBe(8);
    expect(unitWeight("claude-sonnet-5-5", { ...settings, multiplier: 0 })).toBe(1); // never below 1x
    expect(unitsOf({ "claude-haiku-5-5": { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 }, "claude-sonnet-5-5": { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 } }, settings)).toBe(1200 + 200 * 5);
  });
  it("one shared daily budget: units used, share left, exhausted", () => {
    expect(unitsUsed({ "claude-haiku-5-5": 200_000, "claude-sonnet-5-5": 40_000 }, settings)).toBe(400_000);
    expect(budgetOf(settings, { "claude-haiku-5-5": 200_000, "claude-sonnet-5-5": 40_000 })).toEqual({ used: 400_000, limit: 1_000_000, left: true, leftShare: 0.6, multiplier: 5 });
    expect(budgetOf(settings, { "claude-haiku-5-5": 999_999 }).left).toBe(true);
    expect(budgetOf(settings, { "claude-haiku-5-5": 999_999 }, 1).left).toBe(false); // the running turn counts
    expect(budgetOf(settings, { "claude-sonnet-5-5": 200_000 })).toMatchObject({ used: 1_000_000, left: false, leftShare: 0 });
    expect(budgetOf({ ...settings, dailyUnits: 0 }, {}).left).toBe(false); // 0 = off
  });
  it("the admin changes the default model: the old default's tokens now weigh x multiplier", () => {
    expect(unitsUsed({ "claude-haiku-5-5": 1000 }, { ...settings, defaultModel: "claude-sonnet-5-5" })).toBe(5000);
  });
  it("advisor iterations are counted as the advisor model, the top-level usage as the executor", () => {
    const m = { usage: {
      input_tokens: 1760, output_tokens: 531, cache_read_input_tokens: 412, cache_creation_input_tokens: 0,
      iterations: [
        { type: "message", input_tokens: 412, output_tokens: 89, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        { type: "advisor_message", model: "claude-sonnet-5-5", input_tokens: 823, output_tokens: 1612, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        { type: "message", input_tokens: 1348, output_tokens: 442, cache_read_input_tokens: 412, cache_creation_input_tokens: 0 },
      ],
    } } as never;
    const u = usagesOf("claude-haiku-5-5", m, "claude-sonnet-5-5");
    expect(u).toEqual([
      { model: "claude-haiku-5-5", advisor: false, usage: { input: 1760, output: 531, cacheRead: 412, cacheWrite: 0 } },
      { model: "claude-sonnet-5-5", advisor: true, usage: { input: 823, output: 1612, cacheRead: 0, cacheWrite: 0 } },
    ]);
    expect(unitsOf({ "claude-haiku-5-5": u[0]!.usage, "claude-sonnet-5-5": u[1]!.usage }, settings)).toBe(1760 + 531 + (823 + 1612) * 5);
  });
  it("an advisor iteration without a known model id is billed as the configured advisor, never as the cheap executor", () => {
    const m = { usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: "advisor_message", model: "claude-future-9", input_tokens: 10, output_tokens: 10 }] } } as never;
    expect(usagesOf("claude-haiku-5-5", m, "claude-opus-5-5")[1]).toMatchObject({ model: "claude-opus-5-5", advisor: true });
  });
});

describe("request headers and cache stats", () => {
  it("the advisor beta only when the advisor tool is on the request; the fallback beta on Sonnet / Opus", () => {
    expect(betasFor({ model: "claude-haiku-5-5", tools: [{ name: "get_trades" }] })).toEqual([]);
    expect(betasFor({ model: "claude-haiku-5-5", tools: [{ type: "advisor_20260301", name: "advisor" }] })).toEqual(["advisor-tool-2026-03-01"]);
    expect(betasFor({ model: "claude-sonnet-5-5", tools: [] })).toEqual(["server-side-fallback-2026-07-01"]);
  });
  it("cache hit ratio = cache reads / all prompt tokens", () => {
    expect(cacheHitRatio({ input: 100, cacheRead: 900, cacheWrite: 0 })).toBeCloseTo(0.9, 6);
    expect(cacheHitRatio({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});
