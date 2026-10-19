/**
 * Review fixes 2026-10-18: market-closed days (no risk breach on a weekend / holiday), the top of the day by the CLOSE
 * day with one alias roster for the top and the desk-day chart, stored RU alert texts rendered per reader.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM holiday_calendar") && params[0] === "2026-11-26") return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));

const { isMarketClosed } = await import("../marketDays");
const { CLOSE_DAY, loadCalendarRows, loadDayRows, loadDaySideRows } = await import("../topDayStore");
const { deskRoster } = await import("../deskDayStore");

beforeEach(() => {
  calls.length = 0;
});

describe("isMarketClosed", () => {
  it("weekends without a query; a full-day holiday from the calendar (read once); an ordinary weekday is open", async () => {
    expect(await isMarketClosed("2026-10-17")).toBe(true);
    expect(await isMarketClosed("2026-10-18")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await isMarketClosed("2026-11-26")).toBe(true);
    expect(await isMarketClosed("2026-11-26")).toBe(true);
    expect(await isMarketClosed("2026-10-16")).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toContain("description ILIKE 'market closed%'");
  });
});

describe("top of the day by the close day", () => {
  it("calendar, day lists and the trader-day group by the close day (realised P&L of the day)", async () => {
    expect(CLOSE_DAY).toBe("LEFT(COALESCE(NULLIF(t.exit_date, ''), t.date), 10)");
    await loadCalendarRows("2026-10", "Кирилл Б.");
    await loadDayRows("2026-10-16");
    await loadDaySideRows("2026-10-16");
    const trades = calls.filter((c) => c.sql.includes("FROM trades"));
    expect(trades).toHaveLength(3);
    for (const c of trades) {
      expect(c.sql).toContain(CLOSE_DAY);
      expect(c.sql).not.toMatch(/WHERE t\.date [=>]/);
    }
  });

  it("the alias roster covers traders who traded or closed a trade that day (one number on both pages)", async () => {
    await deskRoster("2026-10-16");
    expect(calls[0]!.sql).toContain("WHERE date = $1");
    expect(calls[0]!.sql).toContain(`UNION`);
    expect(calls[0]!.sql).toContain(`${CLOSE_DAY} = $1`);
  });
});

describe("stored alert texts per reader", () => {
  it("halted kinds are rebuilt from kind, used and limit in every language (app money format); others keep the stored text", async () => {
    const { alertMessage } = await import("../../routes/risk");
    const row = { kind: "drawdown", used: 3631.2, limit: 2000, message: "Макс. просадка достигнута" };
    const en = alertMessage(row, "en");
    expect(en).not.toMatch(/[А-Яа-яЁё]/);
    expect(en).toContain("$2,000");
    expect(en).toContain("$3,631.20");
    expect(alertMessage(row, "uz")).not.toMatch(/[А-Яа-яЁё]/);
    const ru = alertMessage({ kind: "stop", used: 318.76, limit: 300, message: "Дневной убыток 318.76$ достиг лимита 300$" }, "ru");
    expect(ru).toContain("$318.76");
    expect(ru).toContain("$300");
    expect(ru).not.toContain("318.76$");
    expect(alertMessage({ kind: "positions", used: 6, limit: 5, message: "Открытые позиции" }, "en")).toBe("Открытые позиции");
  });
});
