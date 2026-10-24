/**
 * Roadmap R3 — one definition per behaviour threshold: the quick re-entry («revenge») minutes and the size-up factor
 * come from lib/behaviorEngine DEFAULTS in every module; a win between a loss and a bigger trade resets the rules-engine
 * size-up chain (as the behaviour engine's martingale does); the discipline thresholds of the ladder seeds are settings.
 * Synthetic fixtures only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULTS, dayTimeline, patternFlags, type BehaviorTrade } from "../behaviorEngine";
import { buildDayReport, type DayTrade } from "../dayReport";
import { evalRule, type RuleRow, type TradeForRule } from "../rulesEval";
import { DEFAULT_CRITERIA } from "../promotionEngine";
import { DEFAULT_RULES } from "../scalingSeed";
import { __loadSettingsCache } from "../settings/registry";

const DAY = "2026-03-10";
const at = (min: number) => Date.UTC(2026, 2, 10, 14, 30) + min * 60_000; // 09:30 NY (EST) + min

function bt(id: number, inMin: number, holdMin: number, net: number): BehaviorTrade {
  return {
    id, ticker: `T${id}`, date: DAY, side: "long", result: net > 0 ? "win" : net < 0 ? "loss" : "be", net, gross: net, qty: 100, entry: 10,
    entryAt: at(inMin), exitAt: at(inMin + holdMin), entryMin: 570 + inMin, holdMin, horizon: "intraday", setup: null,
  };
}
function dt(id: number, inMin: number, holdMin: number, net: number): DayTrade {
  return {
    id, ticker: `T${id}`, side: "long", setup: null, playbookId: null, result: net > 0 ? "win" : net < 0 ? "loss" : "be",
    gross: net, fees: 0, net, qty: 100, entry: 10, exit: 10, entryAt: at(inMin), exitAt: at(inMin + holdMin), timeSource: "executions",
  };
}

/** A loss closed at minute 2, then a re-entry `gap` minutes later. */
const pair = (gap: number) => ({ loss: [1, 0, 2, -50] as const, next: [2, 2 + gap, 3, -10] as const });

describe("quick re-entry after a loss — one threshold everywhere", () => {
  it("the canonical window is 10 minutes", () => {
    expect(DEFAULTS.revengeMin).toBe(10);
  });

  for (const gap of [DEFAULTS.revengeMin - 1, DEFAULTS.revengeMin + 1]) {
    it(`a re-entry ${gap} min after a loss: behaviour engine, day timeline and day report agree`, () => {
      const p = pair(gap);
      const beh = [bt(...p.loss), bt(...p.next)];
      const engine = (patternFlags(beh).get("revenge")?.ids ?? []).includes(2);
      const timeline = dayTimeline(beh, DAY).trades.find((t) => t.id === 2)!.flags.some((f) => f.key === "revenge");
      const report = buildDayReport({ trader: "t", date: DAY, trades: [dt(...p.loss), dt(...p.next)], history: [], dailyLossLimit: null });
      const day = (report.leaks.find((l) => l.kind === "revenge")?.tradeIds ?? []).includes(2);
      const expected = gap < DEFAULTS.revengeMin;
      expect({ engine, timeline, day }).toEqual({ engine: expected, timeline: expected, day: expected });
    });
  }

  it("the day timeline reports the same norm", () => {
    expect(dayTimeline([bt(1, 0, 2, -5)], DAY).norms.revengeMin).toBe(DEFAULTS.revengeMin);
  });
});

describe("rules engine: size-up after a loss", () => {
  const trade = (id: number, inMin: number, holdMin: number, result: "win" | "loss", notional: number): TradeForRule => ({
    id, trader: "t", date: DAY, closeDate: DAY, result, pnl: result === "win" ? 40 : -40, netPnl: result === "win" ? 39 : -41,
    signedR: null, entry: 10, stop: null, qty: notional / 10, riskUsd: null, horizon: "intraday", source: null, playbookId: null,
    setupScore: null, maxNotional: null, checklistRuns: 0, entryAt: at(inMin), exitAt: at(inMin + holdMin),
  });
  const rule: RuleRow = { id: 1, trader: "t", name: "size", kind: "no_size_up_after_loss", threshold: { factor: DEFAULTS.martingaleRatio }, enabled: true };
  const flagged = (trades: TradeForRule[]) => evalRule(rule, trades).map((v) => v.tradeId);

  it("a bigger trade right after a closed loss is flagged", () => {
    expect(flagged([trade(1, 0, 5, "loss", 1000), trade(2, 10, 5, "loss", 2000)])).toEqual([2]);
  });

  it("a win closed in between resets the chain", () => {
    expect(flagged([trade(1, 0, 5, "loss", 1000), trade(2, 10, 5, "win", 1000), trade(3, 20, 5, "loss", 2000)])).toEqual([]);
  });

  it("a loss still open when the bigger trade goes in does not count", () => {
    expect(flagged([trade(1, 0, 30, "loss", 1000), trade(2, 10, 5, "win", 2000)])).toEqual([]);
  });
});

describe("discipline thresholds of the ladder seeds — one setting per place", () => {
  afterEach(() => __loadSettingsCache({}));
  const promotion = () => DEFAULT_CRITERIA.find((c) => c.fromStage === "junior" && c.metric === "discipline_index")!;
  const scaling = () => DEFAULT_RULES.find((r) => r.kind === "promote" && r.metric === "discipline")!;

  it("defaults keep today's values (promotion 75, scaling 70 — unifying them is an owner decision)", () => {
    expect(promotion().value).toBe(75);
    expect(promotion().label).not.toBeNull();
    expect(scaling().value).toBe(70);
  });

  it("each seed reads its own key", () => {
    __loadSettingsCache({ "discipline.promotionMinIndex": 72, "discipline.scalingMinIndex": 72 });
    expect(promotion().value).toBe(72);
    expect(promotion().label).toBeNull(); // the seed label quotes 75
    expect({ ...scaling() }.value).toBe(72);
  });
});
