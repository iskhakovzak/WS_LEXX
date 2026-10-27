/**
 * The day state: precedence (stopped > paused > newcomer > time of day) and the silence signal's findings, with NYSE
 * holidays skipped in the silent-day count. Synthetic traders only.
 */
import { describe, expect, it } from "vitest";
import { backlogOf, resolveState, silenceFindings, type StateFacts } from "../model";

const CFG = { pausedDays: 3, newcomerTrades: 20, newcomerMaxDays: 45, staleStepDays: 3 };
const day = (date: string, trades = 2) => ({ date, trades, pnl: 10 });

function facts(over: Partial<StateFacts> = {}): StateFacts {
  return {
    trader: "Trader A",
    today: "2026-10-27", // Tuesday
    phase: "session",
    staff: false,
    halted: false,
    stopState: null,
    closedTrades: 120,
    accountAgeDays: 200,
    tradeDays: [day("2026-10-23"), day("2026-10-26")],
    closedReviewDays: new Set(["2026-10-23", "2026-10-26"]),
    marketClosed: new Set(),
    ...over,
  };
}

describe("day state precedence", () => {
  it("follows the clock for an active trader", () => {
    expect(resolveState(facts({ phase: "premarket" }), CFG).state).toBe("premarket");
    expect(resolveState(facts({ phase: "session" }), CFG).state).toBe("session");
    expect(resolveState(facts({ phase: "afterclose" }), CFG).state).toBe("after_session");
    expect(resolveState(facts({ phase: "closed", today: "2026-10-25" }), CFG).state).toBe("premarket"); // Sunday
  });

  it("a stop wins over silence and the newcomer path", () => {
    const s = resolveState(facts({ halted: true, stopState: "drawdown", closedTrades: 3, tradeDays: [day("2026-10-15")] }), CFG);
    expect(s.state).toBe("stopped");
    expect(s.stop).toEqual({ state: "drawdown" });
    expect(s.silentDays).toBe(7); // Oct 16, 19–23, 26: the session of the 27th is not over yet
  });

  it("paused after N trading days without trades, and paused wins over newcomer", () => {
    // Last trade Thu 22: in the session of Tue 27 the silent days are 23 and 26; after the close the 27th counts too.
    expect(resolveState(facts({ tradeDays: [day("2026-10-22")] }), CFG)).toMatchObject({ state: "session", silentDays: 2 });
    expect(resolveState(facts({ tradeDays: [day("2026-10-22")], phase: "afterclose" }), CFG)).toMatchObject({ state: "paused", silentDays: 3 });
    expect(resolveState(facts({ tradeDays: [day("2026-10-21")] }), CFG).state).toBe("paused");
    expect(resolveState(facts({ tradeDays: [day("2026-10-21")], closedTrades: 4, accountAgeDays: 10 }), CFG).state).toBe("paused");
  });

  it("newcomer: few closed trades, a trader (not staff), within the first weeks; never traded is not «paused»", () => {
    const young = { accountAgeDays: 10 };
    expect(resolveState(facts({ ...young, closedTrades: 0, tradeDays: [] }), CFG).state).toBe("newcomer");
    expect(resolveState(facts({ ...young, closedTrades: 5 }), CFG).newcomer).toEqual({ trades: 5, target: 20 });
    expect(resolveState(facts({ ...young, closedTrades: 5, staff: true }), CFG).state).toBe("session");
    expect(resolveState(facts({ closedTrades: 5, accountAgeDays: 90 }), CFG).state).toBe("session");
    expect(resolveState(facts({ closedTrades: 5, accountAgeDays: 90 }), { ...CFG, newcomerMaxDays: 0 }).state).toBe("newcomer");
  });

  it("skips full-day market holidays when counting silence", () => {
    const s = resolveState(facts({ tradeDays: [day("2026-10-21")], marketClosed: new Set(["2026-10-23"]) }), CFG);
    expect(s.silentDays).toBe(2); // 22, 26 (23 is a holiday)
    expect(s.state).toBe("session");
  });
});

describe("review backlog and the stale next step", () => {
  it("counts unclosed finished days of the last 30 days and marks the ones older than staleStepDays trading days", () => {
    const b = backlogOf(facts({
      tradeDays: [day("2026-09-01"), day("2026-10-15"), day("2026-10-20"), day("2026-10-23"), day("2026-10-26"), day("2026-10-27")],
      closedReviewDays: new Set(["2026-10-20"]),
    }), 3);
    expect(b.freshFrom).toBe("2026-10-22");
    // Sept 1 is history, Oct 20 closed, Oct 27 still in session.
    expect(b).toMatchObject({ count: 3, stale: 1, oldest: "2026-10-15", latest: "2026-10-26" });
  });
});

describe("silence signal", () => {
  it("finds silent traders (not stopped ones) and review backlogs", () => {
    const quiet = resolveState(facts({ trader: "Quiet", tradeDays: [day("2026-10-15")], closedReviewDays: new Set(["2026-10-15"]) }), CFG);
    const stopped = resolveState(facts({ trader: "Stopped", halted: true, stopState: "stop", tradeDays: [day("2026-10-15")], closedReviewDays: new Set(["2026-10-15"]) }), CFG);
    const active = resolveState(facts({ trader: "Active" }), CFG);
    const backlog = resolveState(facts({ trader: "Backlog", tradeDays: [day("2026-10-21"), day("2026-10-22"), day("2026-10-23"), day("2026-10-26")], closedReviewDays: new Set() }), CFG);
    const never = resolveState(facts({ trader: "New", tradeDays: [], closedTrades: 0, accountAgeDays: 3 }), CFG);
    expect(silenceFindings([quiet, stopped, active, backlog, never], { pausedDays: 3, missedReviewDays: 3 })).toEqual([
      { kind: "silence", trader: "Quiet", days: 7, last: "2026-10-15" },
      { kind: "reviews", trader: "Backlog", count: 4, oldest: "2026-10-21" },
    ]);
  });
});
