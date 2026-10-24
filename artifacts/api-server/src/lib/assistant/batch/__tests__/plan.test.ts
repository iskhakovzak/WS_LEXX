/**
 * Nightly AI review batches — the pure rules: which reviews are due, when the desk's day counts as closed, the unit
 * estimate, the nightly cap with its priority order (missing day reviews first, then juniors), the polling backoff, the
 * morning notice window, the batch request shape (no fallbacks, the 1-hour cache, the advisor beta only when needed).
 */
import { describe, expect, it } from "vitest";
import {
  AFTER_CLOSE_MIN, byPriority, dayClosed, estimateUnits, inNotifyWindow, nextPollDelay, nightTargets, nyClock, periodStart, pickWithinCap, previousMonthStart,
  type Candidate, type Clock,
} from "../plan";
import { batchBetas } from "../../batchClient";
import { betasFor } from "../../client";
import { reviewParams } from "../../review/run";
import { periodBounds } from "../../review/gather";

const ALL = { day: true, week: true, month: true };
const clock = (today: string, hhmm: string, weekday: number): Clock => ({ today, nowMin: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), weekday });
const S = { defaultModel: "claude-haiku-5-5" as const, multiplier: 5 };

describe("nyClock", () => {
  it("reads New York wall time across the DST switch", () => {
    expect(nyClock(new Date("2026-10-22T21:05:00Z"))).toEqual({ today: "2026-10-22", nowMin: 17 * 60 + 5, weekday: 4 }); // EDT
    expect(nyClock(new Date("2026-11-03T02:30:00Z"))).toEqual({ today: "2026-11-02", nowMin: 21 * 60 + 30, weekday: 1 }); // EST
  });
});

describe("nightTargets", () => {
  it("the day after the post-close sync on weekdays only; the week on Fridays (Monday's date)", () => {
    expect(nightTargets(clock("2026-10-22", "16:00", 4), ALL)).toEqual([]);
    expect(nightTargets(clock("2026-10-22", "16:15", 4), ALL).map((t) => t.kind)).toEqual(["day"]);
    expect(nightTargets(clock("2026-10-23", "21:00", 5), ALL)).toEqual([
      { kind: "day", period: "2026-10-23", from: "2026-10-23", to: "2026-10-23" },
      { kind: "week", period: "2026-10-19", from: "2026-10-19", to: "2026-10-23" },
    ]);
    expect(nightTargets(clock("2026-10-24", "21:00", 6), ALL)).toEqual([]);
  });
  it("the month on the 1st (also on a weekend) covers the previous month; scopes switch kinds off", () => {
    expect(nightTargets(clock("2026-11-01", "21:00", 0), ALL)).toEqual([{ kind: "month", period: "2026-10-01", from: "2026-10-01", to: "2026-10-31" }]);
    expect(nightTargets(clock("2026-01-01", "09:00", 4), ALL)[0]).toMatchObject({ kind: "month", period: "2025-12-01" });
    expect(nightTargets(clock("2026-10-23", "21:00", 5), { day: true, week: false, month: false }).map((t) => t.kind)).toEqual(["day"]);
    expect(previousMonthStart("2026-03-01")).toBe("2026-02-01");
  });
  it("period bounds: a Monday–Friday week, a calendar month; the period of a date", () => {
    expect(periodBounds("week", "2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-23" });
    expect(periodBounds("month", "2024-02-01")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodStart("week", "2026-10-23")).toBe("2026-10-19");
    expect(periodStart("week", "2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(periodStart("month", "2026-10-23")).toBe("2026-10-01");
  });
});

describe("dayClosed", () => {
  const thu = (hhmm: string) => clock("2026-10-22", hhmm, 4);
  it("every trader who traded closed the EOD (after 16:15), or the cutoff passed — whichever is first", () => {
    expect(dayClosed(thu("17:00"), 21 * 60, 3, 2)).toBe(false);
    expect(dayClosed(thu("17:00"), 21 * 60, 3, 3)).toBe(true);
    expect(dayClosed(thu("16:10"), 21 * 60, 3, 3)).toBe(false); // before the post-close sync
    expect(dayClosed(thu("21:00"), 21 * 60, 3, 0)).toBe(true);
    expect(dayClosed(thu("17:00"), 21 * 60, 0, 0)).toBe(false); // nobody traded: wait for the cutoff (a month night)
    expect(AFTER_CLOSE_MIN).toBe(16 * 60 + 15);
  });
});

describe("units and the nightly cap", () => {
  it("estimate: input + output at the executor weight, the advisor at the multiplier; a recent average wins", () => {
    const plain = estimateUnits({ promptChars: 32_000, model: "claude-haiku-5-5", advisor: null, recentAverage: null }, S);
    expect(plain).toBe(10_000 + 2_500);
    const advised = estimateUnits({ promptChars: 32_000, model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", recentAverage: null }, S);
    expect(advised).toBe(12_500 + (10_000 + 1_200) * 5);
    expect(estimateUnits({ promptChars: 32_000, model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", recentAverage: 40_000 }, S)).toBe(44_000);
  });
  it("priority: day reviews (still missing) first, then juniors, then week before month, more trades first", () => {
    const c = (kind: Candidate["kind"], trader: string, junior: boolean, trades = 5): Candidate => ({ kind, trader, junior, trades, estUnits: 10 });
    const order = [c("month", "M", true), c("week", "W", false), c("day", "Senior", false, 9), c("week", "Wj", true), c("day", "Junior", true, 1)].sort(byPriority);
    expect(order.map((x) => x.trader)).toEqual(["Junior", "Senior", "Wj", "M", "W"]);
  });
  it("what does not fit the cap is skipped; a smaller later one may still fit", () => {
    const cands: Candidate[] = [
      { kind: "day", trader: "A", junior: true, trades: 3, estUnits: 600 },
      { kind: "day", trader: "B", junior: false, trades: 9, estUnits: 600 },
      { kind: "week", trader: "C", junior: true, trades: 3, estUnits: 300 },
    ];
    const r = pickWithinCap(cands, 1000);
    expect(r.picked.map((x) => x.trader)).toEqual(["A", "C"]);
    expect(r.skipped.map((x) => x.trader)).toEqual(["B"]);
    expect(pickWithinCap(cands, -5).picked).toEqual([]);
  });
});

describe("polling and notices", () => {
  it("backoff 5, 10, then 15 minutes", () => {
    expect([0, 1, 2, 30].map((n) => nextPollDelay(n) / 60_000)).toEqual([5, 10, 15, 15]);
  });
  it("notices only from the morning send time until 20:00 NY", () => {
    const morning = 8 * 60 + 45;
    expect(inNotifyWindow(clock("2026-10-23", "03:00", 5), morning)).toBe(false);
    expect(inNotifyWindow(clock("2026-10-23", "08:45", 5), morning)).toBe(true);
    expect(inNotifyWindow(clock("2026-10-23", "20:00", 5), morning)).toBe(false);
  });
});

describe("batch request shape", () => {
  const msgs = [{ role: "user" as const, content: "x" }];
  it("the same review request with the 1-hour cache; the advisor beta only when a request carries the advisor", () => {
    const advised = reviewParams("day", { model: "claude-haiku-5-5", advisor: "claude-sonnet-5-5", format: true }, msgs, { cacheTtl: "1h" });
    expect(advised.system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(advised.output_config.format?.type).toBe("json_schema");
    expect(JSON.stringify(advised)).not.toContain("fallbacks");
    expect(batchBetas([{ custom_id: "r1", params: advised }])).toEqual(["advisor-tool-2026-03-01"]);
    const plain = reviewParams("week", { model: "claude-sonnet-5-5", advisor: null, format: true }, msgs, { cacheTtl: "1h" });
    expect(plain.tools).toBeUndefined();
    expect(batchBetas([{ custom_id: "r2", params: plain }])).toEqual([]); // never the fallback beta in a batch
    expect(plain.system[0]!.text).toContain("ONE TRADING WEEK");
    const live = reviewParams("day", { model: "claude-haiku-5-5", advisor: null, format: true }, msgs);
    expect(live.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(betasFor(live)).toEqual([]); // a review without the advisor has no `tools` at all (used to throw)
  });
});
