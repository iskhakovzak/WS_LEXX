/**
 * The GET /whatif/suggestions contract as a pure function (lib/whatIfHonestyBody suggestionsBody): a ready honest verdict
 * keeps every legacy field and adds status / timing / out-of-sample / days needed; while it is computed the fast cards
 * are «предварительно» (polled every 4 s, every 30 s once it takes longer than 3 min); team scope, a period that can
 * never resolve a verdict (rolling / closed) and an unavailable job keep the fast path. No DB, no login.
 */
import { describe, expect, it } from "vitest";
import { HONESTY, computeHonesty } from "../../lib/whatIfHonesty";
import { HONESTY_BACKOFF_MS, HONESTY_POLL_MS, honestSuggestion, honestWindow, honestyKey, suggestionsBody } from "../../lib/whatIfHonestyBody";
import { findSuggestions } from "../../lib/whatIfSuggest";
import { noise, plant } from "../../lib/__tests__/whatIfHonestyFixtures";

const trades = plant(noise(1, 220), { seed: 1001, ticker: "BAD" });
const honest = computeHonesty(trades, { iters: 300, perms: 100 });
const fast = findSuggestions(trades, { lang: "ru" });
const head = { scope: "T0", period: {}, baselineNet: 0, trades: trades.length, days: 220, smallSample: false, generatedAt: "2026-10-22T00:00:00.000Z" };
const finishedAt = new Date("2026-10-21T22:00:00Z");

/** Every field an older web bundle reads (api.ts Suggestion before the honest path). */
const LEGACY = [
  "rule", "label", "improvement", "ci", "tradesLeft", "excluded", "scenarioNet", "scenarioWinRate", "scenarioProfitFactor", "robust",
  "removedNet", "kind", "picked", "sameData", "holdout", "affected", "changed", "estimate",
];

describe("ready honest verdict", () => {
  const body = suggestionsBody({ head, lang: "en", team: false, fast: null, row: { state: "ready", result: honest, finishedAt }, available: true });

  it("serves the honest cards with every legacy field, the new ones, and labels in the request language", () => {
    expect(honest.cards.length).toBeGreaterThan(0);
    expect(body.suggestions).toHaveLength(honest.cards.length);
    for (const [i, s] of body.suggestions.entries()) {
      const c = honest.cards[i];
      expect(Object.keys(s).sort()).toEqual([...LEGACY, "timing", "status", "oos", "needDays", "needDaysAtLeast", "fragile"].sort());
      expect(s.robust).toBe(s.status === "confirmed");
      expect(s.holdout).toBeNull();
      expect(s).toMatchObject({ rule: c.rule, status: c.status, timing: c.timing, oos: c.oos, needDays: c.needDays, improvement: c.improvement, ci: c.ci });
      expect(s.label).toBe(honestSuggestion(c, "en").label);
    }
    expect(body.suggestions[0]).toMatchObject({ status: "confirmed", timing: "exante", rule: { type: "excludeTickers", tickers: ["BAD"] } });
    expect(body.suggestions[0].label).not.toMatch(/[Ѐ-ӿ]/);
  });

  it("honesty: ready, the verdict's numbers, no polling; tested = the Romano–Wolf family", () => {
    expect(body.tested).toBe(honest.tested);
    expect(body.honesty).toEqual({
      state: "ready", version: HONESTY.version, computedAt: finishedAt.toISOString(), wfAvailable: honest.wfAvailable, months: honest.months,
      testDays: honest.testDays, confirmed: honest.confirmed, hypotheses: honest.hypotheses, pollMs: null, pendingMs: null,
    });
    expect(body).toMatchObject(head);
  });
});

describe("while the honest run is pending", () => {
  it("queued / running: the fast cards marked «предварительно», poll every 4 s", () => {
    for (const state of ["queued", "running"] as const) {
      const body = suggestionsBody({ head, lang: "ru", team: false, fast, row: { state, result: null, finishedAt: null }, available: true });
      expect(body.suggestions.map((s) => s.rule)).toEqual(fast.suggestions.map((s) => s.rule));
      expect(body.suggestions.every((s) => s.status === "preliminary" && (s.timing === "exante" || s.timing === "review"))).toBe(true);
      expect(body.suggestions.map((s) => s.robust)).toEqual(fast.suggestions.map((s) => s.robust)); // legacy fields as today
      expect(body.tested).toBe(fast.tested);
      expect(body.honesty).toMatchObject({ state, pollMs: 4000, confirmed: 0, hypotheses: 0, computedAt: null });
    }
  });

  it("pending for 3 min or more: poll every 30 s (never stop), and say how long it has been", () => {
    const now = new Date("2026-10-22T15:00:00Z");
    const at = (ms: number) => suggestionsBody({ head, lang: "ru", team: false, fast, now, available: true, row: { state: "running", result: null, finishedAt: null, requestedAt: new Date(now.getTime() - ms) } }).honesty;
    expect(at(60_000)).toMatchObject({ pollMs: HONESTY_POLL_MS, pendingMs: 60_000 });
    expect(at(3 * 60_000 - 1)).toMatchObject({ pollMs: HONESTY_POLL_MS });
    expect(at(3 * 60_000)).toMatchObject({ pollMs: HONESTY_BACKOFF_MS, pendingMs: 180_000 });
    expect(at(40 * 60_000)).toMatchObject({ pollMs: 30_000, pendingMs: 2_400_000 });
    expect(suggestionsBody({ head, lang: "ru", team: false, fast, row: null, available: true }).honesty).toMatchObject({ pollMs: 4000, pendingMs: 0 });
  });

  it("no row yet → queued; failed → failed (no polling); jobs off or table missing → unavailable", () => {
    expect(suggestionsBody({ head, lang: "ru", team: false, fast, row: null, available: true }).honesty?.state).toBe("queued");
    const failed = suggestionsBody({ head, lang: "ru", team: false, fast, row: { state: "failed", result: null, finishedAt: null }, available: true });
    expect(failed.honesty).toMatchObject({ state: "failed", pollMs: null });
    const off = suggestionsBody({ head, lang: "ru", team: false, fast, row: null, available: false });
    expect(off.honesty).toMatchObject({ state: "unavailable", pollMs: null });
    expect(off.suggestions.every((s) => s.status === "preliminary")).toBe(true);
  });
});

describe("team scope", () => {
  it("the fast cards as today (no status), timing on each, honesty.state = team", () => {
    const team = findSuggestions(trades, { lang: "ru", team: true });
    const body = suggestionsBody({ head: { ...head, scope: null }, lang: "ru", team: true, fast: team, row: null, available: false });
    expect(body.suggestions.every((s) => s.status === undefined && typeof s.timing === "string")).toBe(true);
    expect(body.honesty).toMatchObject({ state: "team", pollMs: null });
    // A ready row never leaks into team scope.
    const withRow = suggestionsBody({ head: { ...head, scope: null }, lang: "ru", team: true, fast: team, row: { state: "ready", result: honest, finishedAt }, available: true });
    expect(withRow.honesty?.state).toBe("team");
  });
});

describe("periods that can never resolve a verdict", () => {
  const TODAY = "2026-10-22";
  it("only a growing period is honest: all time, or a Jan 1 start with an open end", () => {
    expect(honestWindow(undefined, undefined, false, TODAY)).toEqual({ honest: true, reachDays: null });
    // «с начала года» on Oct 22 can still gather the weekdays to Dec 31 (Oct 23 … Dec 31: 50).
    expect(honestWindow("2026-01-01", undefined, false, TODAY)).toEqual({ honest: true, reachDays: 50 });
    expect(honestWindow("2025-01-01", undefined, false, TODAY)).toEqual({ honest: true, reachDays: null });
    // The page's 30 / 90 days move every day; the weekly review's 8 weeks are closed; another start is rolling too.
    expect(honestWindow("2026-09-22", undefined, true, TODAY)).toEqual({ honest: false });
    expect(honestWindow("2026-07-24", undefined, false, TODAY)).toEqual({ honest: false });
    expect(honestWindow("2026-08-24", "2026-10-16", false, TODAY)).toEqual({ honest: false });
    expect(honestWindow(undefined, "2026-10-16", false, TODAY)).toEqual({ honest: false });
    // On the one day a 30-day window starts on Jan 1, the page's flag still keeps it rolling.
    expect(honestWindow("2026-01-01", undefined, true, "2026-01-31")).toEqual({ honest: false });
  });

  it("window: the fast cards as in team scope (no status, no polling), even with a ready row", () => {
    const body = suggestionsBody({ head, lang: "ru", team: false, window: true, fast, row: { state: "ready", result: honest, finishedAt }, available: true });
    expect(body.suggestions.map((s) => s.rule)).toEqual(fast.suggestions.map((s) => s.rule));
    expect(body.suggestions.every((s) => s.status === undefined)).toBe(true);
    expect(body.honesty).toMatchObject({ state: "window", pollMs: null, pendingMs: null });
  });

  it("«Разрезы» on: the fast cards (the honest verdict is per whole book), even with a ready row", () => {
    const body = suggestionsBody({ head, lang: "ru", team: false, filtered: true, fast, row: { state: "ready", result: honest, finishedAt }, available: true });
    expect(body.suggestions.map((s) => s.rule)).toEqual(fast.suggestions.map((s) => s.rule));
    expect(body.honesty).toMatchObject({ state: "facets", pollMs: null, pendingMs: null });
  });

  it("«с начала года»: a card whose days outrun the year says «на всём периоде» instead of a number", () => {
    const hyp = { ...honest.cards[0], status: "hypothesis" as const, needDays: 60, needDaysAtLeast: true };
    expect(honestSuggestion(hyp, "ru", 50)).toMatchObject({ needDays: null, needDaysAtLeast: false, needAllTime: true });
    expect(honestSuggestion(hyp, "ru", 60)).toMatchObject({ needDays: 60, needDaysAtLeast: true });
    expect(honestSuggestion(hyp, "ru", null)).not.toHaveProperty("needAllTime");
  });
});

describe("cache key", () => {
  it("open ends are stored as '' and the engine version is part of the key", () => {
    expect(honestyKey("T0", undefined, "2026-10-01", "abc")).toEqual({ trader: "T0", from: "", to: "2026-10-01", sig: "abc", version: HONESTY.version });
  });
});
