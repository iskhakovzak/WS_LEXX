/**
 * Bounded loads of the daily loop (review 2026-10-18): the rule trades of a window are read for the window only (not
 * the trader's whole history), and the «desk on this ticker» count uses the same exact ticker + date match as the
 * «Деск на тикере» page (indexed), never another trader's money. DailyMe's days around weekends and market holidays.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("COUNT(DISTINCT trader)")) return { rows: [{ n: 4 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));

const { fetchTrades } = await import("../rulesEngine");
const { deskTradersOn } = await import("../daily/load");
const { dailyDates } = await import("../daily/service");

beforeEach(() => {
  calls.length = 0;
});

describe("fetchTrades range", () => {
  it("without a range: the whole history, one parameter (rules page)", async () => {
    await fetchTrades("Кирилл Б.");
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.params).toEqual(["Кирилл Б."]);
      expect(c.sql).not.toContain("substring(t.date, 1, 10) >=");
    }
  });

  it("with a range: trades, their fills and the notional pass are bounded to the window days", async () => {
    await fetchTrades("Кирилл Б.", { from: "2026-07-06", to: "2026-10-16" });
    const [trades, fills] = calls;
    expect(trades!.params).toEqual(["Кирилл Б.", "2026-07-06", "2026-10-16"]);
    expect(trades!.sql).toContain("t.deleted_at IS NULL AND substring(t.date, 1, 10) >= $2 AND substring(t.date, 1, 10) <= $3");
    expect(trades!.sql).toContain("tt.deleted_at IS NULL AND substring(tt.date, 1, 10) >= $2 AND substring(tt.date, 1, 10) <= $3");
    expect(fills!.params).toEqual(["Кирилл Б.", "2026-07-06", "2026-10-16"]);
    expect(fills!.sql).toContain("substring(t.date, 1, 10) >= $2 AND substring(t.date, 1, 10) <= $3");
  });
});

describe("deskTradersOn", () => {
  it("exact ticker + date (the desk-day page's match), the viewer left out, a count only", async () => {
    expect(await deskTradersOn("amd", "2026-09-24", "Кирилл Б.")).toBe(4);
    expect(calls[0]!.params).toEqual(["AMD", "2026-09-24", "Кирилл Б."]);
    expect(calls[0]!.sql).toContain("WHERE ticker = $1 AND date = $2 AND deleted_at IS NULL");
    expect(calls[0]!.sql).not.toMatch(/pnl|qty/);
  });
});

describe("dailyDates (NY trading days)", () => {
  const none = new Set<string>();
  const thanksgiving = new Set(["2026-11-26"]);
  it("weekday: premarket / session → today's focus, the previous open day's card; after the close → today's card", () => {
    expect(dailyDates("2026-10-19", 8 * 60, none)).toEqual({ phase: "premarket", focusDate: "2026-10-19", eveningDate: "2026-10-16" });
    expect(dailyDates("2026-10-20", 11 * 60, none)).toEqual({ phase: "session", focusDate: "2026-10-20", eveningDate: "2026-10-19" });
    expect(dailyDates("2026-10-20", 16 * 60, none)).toEqual({ phase: "afterclose", focusDate: "2026-10-20", eveningDate: "2026-10-20" });
  });
  it("weekend: Monday's focus, Friday's card", () => {
    expect(dailyDates("2026-10-18", 12 * 60, none)).toEqual({ phase: "weekend", focusDate: "2026-10-19", eveningDate: "2026-10-16" });
  });
  it("a full-day holiday reads like a weekend; the day after shows the last open day's card, not the empty holiday", () => {
    expect(dailyDates("2026-11-26", 17 * 60, thanksgiving)).toEqual({ phase: "weekend", focusDate: "2026-11-27", eveningDate: "2026-11-25" });
    expect(dailyDates("2026-11-27", 9 * 60, thanksgiving)).toEqual({ phase: "premarket", focusDate: "2026-11-27", eveningDate: "2026-11-25" });
    expect(dailyDates("2026-09-08", 9 * 60, new Set(["2026-09-07"]))).toMatchObject({ eveningDate: "2026-09-04" }); // Labor Day Monday
  });
});

describe("curator focus options", () => {
  it("the focus in force is always among the options, flagged current (also outside the top 8)", async () => {
    const { focusOptions } = await import("../daily/curatorFocus");
    const cost = (id: string, costNet: number) => ({ id, count: 2, days: 2, costNet, examples: [] });
    const costs = Array.from({ length: 9 }, (_, i) => cost(`behavior:${["revenge", "martingale", "overtrading", "fatigue", "chase", "tilt", "disposition", "firstTrade", "euphoria"][i]}`, -500 + i * 10));
    const focus = { trader: "Кирилл Б.", date: "2026-10-19", mistake: "day:fees", window: { from: "2026-10-05", to: "2026-10-16" }, costNet: -108.87, count: 3, source: "auto" as const, text: { key: "focus.day:fees" } };
    const withFees = [...costs, cost("day:fees", -108.87)];
    const out = focusOptions(withFees, focus);
    expect(out).toHaveLength(9);
    expect(out.at(-1)).toMatchObject({ id: "day:fees", costNet: -108.87, current: true });
    expect(out.filter((o) => o.current)).toHaveLength(1);
    // In the top: flagged in place, nothing added.
    expect(focusOptions([cost("day:fees", -900), ...costs], focus)[0]).toMatchObject({ id: "day:fees", current: true });
    // Outside the window entirely (a curator's pick with no hits): from the focus itself.
    expect(focusOptions(costs, { ...focus, mistake: "structure:averaging" }).at(-1)).toMatchObject({ id: "structure:averaging", costNet: -108.87, current: true });
    expect(focusOptions(costs, null).some((o) => o.current)).toBe(false);
  });
});
