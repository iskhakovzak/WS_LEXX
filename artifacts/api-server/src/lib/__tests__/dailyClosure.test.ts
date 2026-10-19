/**
 * Evening closure and the trader's own focus (persona triage 2026-10-19, ILYA-06 / DENIS-03):
 *   isDayClosed = the evening card reviewed OR the journal «Закрыть день» (eod_days.closed_at) — GAMIFY's quest reads it;
 *   the journal «Фокус на завтра» becomes the shown focus (curator > own > auto).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as { sql: string; params: unknown[] }[], closed: false, fail: false }));
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      if (state.fail) throw new Error("db down");
      if (sql.includes("AS closed")) return { rows: [{ closed: state.closed }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));

const { isDayClosed, ownFocusLine, withOwnFocus } = await import("../daily/service");
import type { DailyFocus } from "../daily/types";

beforeEach(() => {
  state.calls.length = 0;
  state.closed = false;
  state.fail = false;
});

describe("isDayClosed", () => {
  it("reads both the evening review and the journal close (read-only), for that trader and date", async () => {
    state.closed = true;
    expect(await isDayClosed("Илья Ш.", "2026-10-16")).toBe(true);
    const { sql, params } = state.calls[0]!;
    expect(params).toEqual(["Илья Ш.", "2026-10-16"]);
    expect(sql).toContain("daily_reviews");
    expect(sql).toContain("reviewed_at IS NOT NULL");
    expect(sql).toContain("eod_days");
    expect(sql).toContain("closed_at IS NOT NULL");
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
  it("not closed → false; a failed read is «not closed», never a throw", async () => {
    expect(await isDayClosed("Илья Ш.", "2026-10-16")).toBe(false);
    state.fail = true;
    await expect(isDayClosed("Илья Ш.", "2026-10-16")).resolves.toBe(false);
  });
});

describe("own focus (journal «Фокус на завтра»)", () => {
  it("first meaningful line: bullets and template headers dropped, long text cut", () => {
    expect(ownFocusLine("• Максимум 2 попытки на тикер\n• Стоп до входа")).toBe("Максимум 2 попытки на тикер");
    expect(ownFocusLine("Фокус-лист:\n-\n- Только A+ сетапы\n")).toBe("Только A+ сетапы");
    expect(ownFocusLine("1) Пауза после убытка")).toBe("Пауза после убытка");
    expect(ownFocusLine("   \n")).toBeNull();
    expect(ownFocusLine(null)).toBeNull();
    expect(ownFocusLine("x".repeat(300))!.length).toBe(200);
  });
  const auto: DailyFocus = {
    trader: "Денис Ф.", date: "2026-10-19", mistake: "behavior:revenge", window: { from: "2026-10-05", to: "2026-10-16" },
    costNet: -120, count: 4, source: "auto", text: { key: "focus.behavior:revenge", params: { cost: 120, count: 4, days: 3 } },
  };
  it("own pick wins over the engine, the curator wins over the own pick", () => {
    const f = withOwnFocus(auto, "Максимум 2 попытки на тикер");
    expect(f).toMatchObject({ source: "own", mistake: null, ownText: "Максимум 2 попытки на тикер", text: { key: "focus.own", params: { text: "Максимум 2 попытки на тикер" } } });
    expect(withOwnFocus({ ...auto, source: "curator" }, "моё")).toMatchObject({ source: "curator", mistake: "behavior:revenge" });
    expect(withOwnFocus(auto, null)).toBe(auto);
  });
});
