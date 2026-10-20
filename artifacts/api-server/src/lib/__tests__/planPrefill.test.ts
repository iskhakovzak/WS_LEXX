/**
 * Personal plan prefill (lib/planPrefill, GET /api/game-plan/my/prefill): the suggested own rule = the costliest pattern
 * of the last two weeks (Волна 1, item 1.9) and the own «Фокус на завтра» from the evening (item 1.5); plus the day a
 * late-closed day's focus is written for (lib/eodStore focusDayFor).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MistakeCost } from "../daily/types";

const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
vi.mock("@workspace/db", () => ({ db: {}, pool: { query: (sql: string, params?: unknown[]) => query(sql, params) } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
const costs = vi.fn(async (): Promise<MistakeCost[]> => []);
vi.mock("../daily/service", () => ({ mistakeCosts: () => costs() }));
process.env.JWT_SECRET ??= "vitest-only-secret";

const { pickSuggestedRule, focusTextOf, planPrefill, _resetPlanPrefill } = await import("../planPrefill");
const { focusDayFor } = await import("../eodStore");

const c = (id: string, costNet: number | null, count = 1, days = 1): MistakeCost => ({ id, costNet, count, days, examples: [] });
const W = { from: "2026-10-06", to: "2026-10-19" };

describe("pickSuggestedRule (1.9)", () => {
  it("the costliest priced pattern wins, even on a single day (the money says it)", () => {
    const r = pickSuggestedRule([c("behavior:martingale", -19, 3, 2), c("behavior:fatigue", -240.9, 40, 6), c("day:fees", -50, 5, 5)], W, { minCost: 10 });
    expect(r).toEqual({ mistake: "behavior:fatigue", costNet: -240.9, count: 40, days: 6, window: W });
    expect(pickSuggestedRule([c("behavior:revenge", -120, 1, 1)], W, { minCost: 10 })?.mistake).toBe("behavior:revenge");
  });

  it("skips noise under the floor, unpriced / profitable ones, disputed ones and unknown ids", () => {
    expect(pickSuggestedRule([c("behavior:fatigue", -5)], W, { minCost: 10 })).toBeNull();
    expect(pickSuggestedRule([c("behavior:fatigue", null, 9), c("behavior:chase", 30)], W, { minCost: 10 })).toBeNull();
    const disputed = new Set(["behavior:fatigue"]);
    expect(pickSuggestedRule([c("behavior:fatigue", -240), c("behavior:chase", -40)], W, { minCost: 10, disputed })?.mistake).toBe("behavior:chase");
    expect(pickSuggestedRule([c("weird:thing", -999)], W, { minCost: 10 })).toBeNull();
  });

  it("ties: more occurrences, then the id (stable)", () => {
    expect(pickSuggestedRule([c("behavior:chase", -50, 2), c("behavior:tilt", -50, 4)], W, { minCost: 10 })?.mistake).toBe("behavior:tilt");
    expect(pickSuggestedRule([c("behavior:tilt", -50, 2), c("behavior:chase", -50, 2)], W, { minCost: 10 })?.mistake).toBe("behavior:chase");
  });
});

describe("planPrefill (1.5 + 1.9)", () => {
  beforeEach(() => {
    _resetPlanPrefill();
    query.mockReset();
    query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    costs.mockReset();
    costs.mockImplementation(async () => []);
  });

  it("focus: the journal pick for the date first, else the last closed day's «tomorrow»; the rule from the window", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM journal_days")) return { rows: [{ plan: "  Не усредняю минус  " }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    costs.mockImplementation(async () => [c("behavior:fatigue", -240.9, 40, 6)]);
    const p = await planPrefill("chert", "2026-10-21");
    expect(p.focus).toEqual({ text: "Не усредняю минус", source: "journal", from: "2026-10-21" });
    expect(p.rule?.mistake).toBe("behavior:fatigue");
    expect((p.rule?.window.to ?? "9999") < "2026-10-21").toBe(true);
  });

  it("falls back to the close-day summary (eod_days.summary.tomorrow) and skips a disputed pattern", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM eod_days")) return { rows: [{ date: "2026-10-16", tomorrow: "Стоп после двух минусов" }], rowCount: 1 };
      if (sql.includes("FROM daily_reviews")) return { rows: [{ m: "behavior:fatigue" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    costs.mockImplementation(async () => [c("behavior:fatigue", -240.9, 40, 6), c("behavior:martingale", -19, 3, 2)]);
    const p = await planPrefill("chert", "2026-10-21");
    expect(p.focus).toEqual({ text: "Стоп после двух минусов", source: "eod", from: "2026-10-16" });
    expect(p.rule?.mistake).toBe("behavior:martingale");
  });

  it("nothing to hand over → nulls; an engine failure is no rule, not an error", async () => {
    costs.mockImplementation(async () => { throw new Error("db down"); });
    expect(await planPrefill("new", "2026-10-21")).toEqual({ date: "2026-10-21", focus: null, rule: null });
  });

  it("focusTextOf trims, skips blanks and caps the text", () => {
    expect(focusTextOf(null, "  ", " a ")).toBe("a");
    expect(focusTextOf("x".repeat(2500))?.length).toBe(2000);
  });
});

describe("focusDayFor (late close never writes the focus into the past)", () => {
  // New York: EDT (UTC−4) in October.
  const at = (date: string, hh: number) => new Date(`${date}T${String(hh + 4).padStart(2, "0")}:00:00Z`);
  it("the next trading day when closed on time; the session ahead when closed late", () => {
    expect(focusDayFor("2026-10-16", at("2026-10-16", 17))).toBe("2026-10-19"); // Friday evening → Monday
    expect(focusDayFor("2026-10-15", at("2026-10-15", 18))).toBe("2026-10-16");
    expect(focusDayFor("2026-10-16", at("2026-10-20", 10))).toBe("2026-10-20"); // Friday closed Tuesday morning → today
    expect(focusDayFor("2026-10-16", at("2026-10-20", 17))).toBe("2026-10-21"); // … Tuesday evening → Wednesday
  });
});
