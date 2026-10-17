import { describe, expect, it } from "vitest";
import { ASK_BOOK_COLS, askBookQuery, askBookResponse, askBookTuple, type AskBookDbRow } from "../askBook";
import type { MoneyViewer } from "../playbookPrivacy";

const alex: MoneyViewer = { name: "Алекс", staff: false };
const curator: MoneyViewer = { name: "Ориф", staff: true };
const guest: MoneyViewer = { name: null, staff: false };

function row(over: Partial<AskBookDbRow> = {}): AskBookDbRow {
  return {
    id: 1, ticker: "nvda", date: "2026-03-02", exit_date: "", side: "Long", trader: "Алекс", setup: "Пробой",
    hold_time: "2h 29m", qty: null, result: "win", entry: "101.5000", exit: "104.2500", stop: null, r_multiple: "2.40",
    pnl: "275.00", fees: "-6.60", risk_usd: "110.00", horizon: "intraday",
    opened_at: "2026-03-02T09:41:00", closed_at: "2026-03-02T12:10:00", snap_qty: "100",
    ...over,
  };
}

const col = (t: unknown[], k: (typeof ASK_BOOK_COLS)[number]) => t[ASK_BOOK_COLS.indexOf(k)];

describe("askBookQuery", () => {
  it("whole desk: no trader filter, limit + 1 to detect truncation", () => {
    const q = askBookQuery(null, 100);
    expect(q.sql).toContain("deleted_at IS NULL");
    expect(q.sql).not.toContain("trader =");
    expect(q.params).toEqual([101]);
  });
  it("one trader: parameterised, never interpolated", () => {
    const q = askBookQuery("O'Brien; DROP", 10);
    expect(q.sql).toContain("trader = $1");
    expect(q.sql).toContain("LIMIT $2");
    expect(q.sql).not.toContain("O'Brien");
    expect(q.params).toEqual(["O'Brien; DROP", 11]);
  });
});

describe("askBookTuple", () => {
  it("own trade: numbers parsed, ticker upper-cased, snapshot qty folded in", () => {
    const t = askBookTuple(row(), alex);
    expect(t).toHaveLength(ASK_BOOK_COLS.length);
    expect(col(t, "ticker")).toBe("NVDA");
    expect(col(t, "entry")).toBe(101.5);
    expect(col(t, "rMultiple")).toBe(2.4);
    expect(col(t, "pnl")).toBe(275);
    expect(col(t, "fees")).toBe(-6.6);
    expect(col(t, "qty")).toBe(100);
    expect(col(t, "riskUsd")).toBe(110);
    expect(col(t, "exitDate")).toBeNull();
    expect(col(t, "stop")).toBeNull();
    expect(col(t, "openedAt")).toBe("2026-03-02T09:41:00");
  });
  it("column qty wins over the snapshot", () => {
    expect(col(askBookTuple(row({ qty: "250.00" }), alex), "qty")).toBe(250);
  });
  it("someone else's trade: $ nulled for a trader, R and prices stay", () => {
    const t = askBookTuple(row({ trader: "Сеня" }), alex);
    expect(col(t, "pnl")).toBeNull();
    expect(col(t, "fees")).toBeNull();
    expect(col(t, "qty")).toBeNull();
    expect(col(t, "riskUsd")).toBeNull();
    expect(col(t, "rMultiple")).toBe(2.4);
    expect(col(t, "entry")).toBe(101.5);
  });
  it("staff see every trade's $", () => {
    expect(col(askBookTuple(row({ trader: "Сеня" }), curator), "pnl")).toBe(275);
  });
  it("guest sees no $", () => {
    expect(col(askBookTuple(row(), guest), "pnl")).toBeNull();
  });
});

describe("askBookResponse", () => {
  it("truncates to the limit and flags it", () => {
    const rows = [row({ id: 3 }), row({ id: 2 }), row({ id: 1 })];
    const r = askBookResponse(rows, alex, "Алекс", 2);
    expect(r.truncated).toBe(true);
    expect(r.rows.map((t) => t[0])).toEqual([3, 2]);
    expect(r.cols).toBe(ASK_BOOK_COLS);
    expect(r.scope).toBe("Алекс");
    expect(r.redacted).toBe(false);
  });
  it("flags redaction when any row lost its $", () => {
    const r = askBookResponse([row(), row({ id: 2, trader: "Сеня" })], alex, null);
    expect(r.truncated).toBe(false);
    expect(r.redacted).toBe(true);
  });
  it("empty book", () => {
    expect(askBookResponse([], guest, null)).toMatchObject({ rows: [], truncated: false, redacted: false });
  });
});
