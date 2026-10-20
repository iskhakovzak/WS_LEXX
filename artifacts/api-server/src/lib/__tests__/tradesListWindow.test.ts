/** Волна 2 п. 2.15 — GET /api/trades never returns the whole book (lib/tradesListWindow). */
import { describe, expect, it } from "vitest";
import { TRADES_LIST_DEFAULT_LIMIT, TRADES_LIST_MAX_LIMIT, tradesListWindow } from "../tradesListWindow";

const TODAY = "2026-10-20";

describe("tradesListWindow", () => {
  it("no window and no limit → the newest 500", () => {
    expect(tradesListWindow({}, TODAY)).toEqual({ ok: true, limit: TRADES_LIST_DEFAULT_LIMIT });
    expect(tradesListWindow({ to: "2026-10-01" }, TODAY)).toEqual({ ok: true, limit: 500 });
  });

  it("an explicit limit wins and is clamped to 5000", () => {
    expect(tradesListWindow({ limit: 20 }, TODAY)).toEqual({ ok: true, limit: 20 });
    expect(tradesListWindow({ limit: 99_999 }, TODAY)).toEqual({ ok: true, limit: TRADES_LIST_MAX_LIMIT });
  });

  it("a date window up to 400 days has no row cap; wider → refused", () => {
    expect(tradesListWindow({ from: "2026-01-01", to: "2026-10-20" }, TODAY)).toEqual({ ok: true, limit: null });
    expect(tradesListWindow({ from: "2025-09-15", to: "2026-10-19" }, TODAY)).toEqual({ ok: true, limit: null }); // 399 days
    expect(tradesListWindow({ from: "2025-09-15", to: "2026-10-20" }, TODAY)).toEqual({ ok: true, limit: null }); // 400 days
    expect(tradesListWindow({ from: "2025-09-14", to: "2026-10-20" }, TODAY)).toEqual({ ok: false, tooLong: true, max: 400 });
  });

  it("`from` without `to` is measured to today (New York)", () => {
    expect(tradesListWindow({ from: "2025-10-20" }, TODAY).ok).toBe(true);
    expect(tradesListWindow({ from: "2024-01-01" }, TODAY)).toEqual({ ok: false, tooLong: true, max: 400 });
    expect(tradesListWindow({ from: "2026-10-01", limit: 10 }, TODAY)).toEqual({ ok: true, limit: 10 });
  });
});
