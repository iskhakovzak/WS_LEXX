/**
 * Model routing (owner 2026-10-25: «большинство задач — Haiku, если нужно умнее — Sonnet»), prices and budgets.
 */
import { describe, expect, it } from "vitest";
import {
  LONG_CONTEXT_CHARS, MAX_CHEAP_DATA_CALLS, budgetTokens, escalateAfter, initialRoute, requestCostUsd, type RouteSettings,
} from "../models";
import { budgetOf, type AssistantSettings } from "../store";

const S: RouteSettings = { defaultModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", autoEscalate: true };
const base = { settings: S, mode: "chat" as const, smart: false, contextChars: 500, smartBudgetLeft: true };

describe("initialRoute", () => {
  it("plain chat starts on the cheap default model", () => {
    expect(initialRoute(base)).toMatchObject({ model: "claude-haiku-5-5", cls: "default", reason: "default", escalated: false });
  });
  it("the «Умнее» toggle escalates, even with auto-escalation off", () => {
    expect(initialRoute({ ...base, smart: true })).toMatchObject({ model: "claude-sonnet-5-5", reason: "manual", escalated: true });
    expect(initialRoute({ ...base, smart: true, settings: { ...S, autoEscalate: false } })).toMatchObject({ model: "claude-sonnet-5-5", reason: "manual" });
  });
  it("«✦ Помочь», heavy intents and long context escalate automatically", () => {
    expect(initialRoute({ ...base, mode: "assist" }).reason).toBe("assist");
    for (const intent of ["draft_playbook", "draft_plan", "draft_eod", "analysis"]) expect(initialRoute({ ...base, intent }).model).toBe("claude-sonnet-5-5");
    expect(initialRoute({ ...base, intent: "chat" }).model).toBe("claude-haiku-5-5");
    expect(initialRoute({ ...base, contextChars: LONG_CONTEXT_CHARS + 1 }).reason).toBe("long_context");
  });
  it("auto-escalation off keeps everything but the toggle on the default model", () => {
    const off = { ...base, settings: { ...S, autoEscalate: false } };
    expect(initialRoute({ ...off, mode: "assist" }).model).toBe("claude-haiku-5-5");
    expect(initialRoute({ ...off, intent: "draft_playbook" }).model).toBe("claude-haiku-5-5");
  });
  it("an exhausted escalation budget falls back to the default model", () => {
    expect(initialRoute({ ...base, smart: true, smartBudgetLeft: false })).toMatchObject({ model: "claude-haiku-5-5", reason: "smart_budget" });
  });
  it("admin-chosen models are honoured (e.g. Opus as the escalation model)", () => {
    expect(initialRoute({ ...base, smart: true, settings: { ...S, smartModel: "claude-opus-5-5" } }).model).toBe("claude-opus-5-5");
  });
});

describe("escalateAfter (mid-turn)", () => {
  const cheap = initialRoute(base);
  const sig = { dataCalls: 1, whatif: false, draftRequested: false };
  it("tool calls on the cheap path stay on the cheap model", () => {
    expect(escalateAfter(cheap, S, sig, true)).toBeNull();
    expect(escalateAfter(cheap, S, { ...sig, dataCalls: MAX_CHEAP_DATA_CALLS }, true)).toBeNull();
  });
  it("a draft request re-runs the step on the escalation model", () => {
    expect(escalateAfter(cheap, S, { ...sig, draftRequested: true }, true)).toMatchObject({ model: "claude-sonnet-5-5", reason: "draft", rerun: true });
  });
  it("more than 2 data tools or run_whatif → the escalation model writes the analysis (tools still ran cheap)", () => {
    expect(escalateAfter(cheap, S, { ...sig, dataCalls: MAX_CHEAP_DATA_CALLS + 1 }, true)).toMatchObject({ reason: "heavy_tools", rerun: false });
    expect(escalateAfter(cheap, S, { ...sig, whatif: true }, true)).toMatchObject({ model: "claude-sonnet-5-5", rerun: false });
  });
  it("never escalates twice, without auto-escalation, or without escalation budget", () => {
    const smart = initialRoute({ ...base, smart: true });
    expect(escalateAfter(smart, S, { ...sig, draftRequested: true }, true)).toBeNull();
    expect(escalateAfter(cheap, { ...S, autoEscalate: false }, { ...sig, draftRequested: true }, true)).toBeNull();
    expect(escalateAfter(cheap, S, { ...sig, whatif: true }, false)).toBeNull();
    expect(escalateAfter(cheap, { ...S, smartModel: "claude-haiku-5-5" }, { ...sig, whatif: true }, true)).toBeNull();
  });
});

describe("prices and budgets", () => {
  it("costs per the 2026 rate cards (Haiku long-prompt card above 100K)", () => {
    expect(requestCostUsd("claude-haiku-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.5, 6); // > 100K prompt
    expect(requestCostUsd("claude-haiku-5-5", { input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.0015, 6);
    expect(requestCostUsd("claude-sonnet-5-5", { input: 10_000, output: 1_000, cacheRead: 5_000, cacheWrite: 0 })).toBeCloseTo(0.031, 6);
    expect(requestCostUsd("claude-opus-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(20, 6);
  });
  it("budget tokens = input + cache writes + output", () => {
    expect(budgetTokens({ input: 10, output: 5, cacheRead: 1000, cacheWrite: 7 })).toBe(22);
  });
  it("budgets are per model class", () => {
    const s = { ...S, enabled: true, juniorsEnabled: true, dailyTokensDefault: 1000, dailyTokensSmart: 100, auditBodies: false } satisfies AssistantSettings;
    const used = { "claude-haiku-5-5": 999, "claude-sonnet-5-5": 100 };
    expect(budgetOf("default", s, used)).toEqual({ used: 999, limit: 1000, left: true });
    expect(budgetOf("default", s, used, 1).left).toBe(false);
    expect(budgetOf("smart", s, used).left).toBe(false);
    expect(budgetOf("smart", { ...s, dailyTokensSmart: 0 }, {}).left).toBe(false); // 0 = the class is off
  });
});
