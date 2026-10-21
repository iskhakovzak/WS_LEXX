import { describe, expect, it } from "vitest";
import { DESK_AGGREGATE_MIN_TRADERS, canSeeDeskAggregate, redactOthersMoney, seesMoneyOf } from "../moneyVisibility";

const rows = [
  { trader: "Kirill", net: 120, totalPnl: 120, totalR: 2.5, winrate: 60, closed: 5, prev: { net: 40, totalPnl: 40, totalR: 1 } },
  { trader: "Roman", net: -300, totalPnl: -300, totalR: -1.5, winrate: 40, closed: 7, prev: { net: 10, totalPnl: 10, totalR: 0.2 } },
];

describe("redactOthersMoney", () => {
  it("a trader keeps their own $ and gets null $ for everyone else; R, %, counts stay", () => {
    const out = redactOthersMoney(rows, "Kirill", false, { nested: { prev: ["net", "totalPnl"] } });
    expect(out[0]).toEqual(rows[0]);
    expect(out[1]).toMatchObject({ trader: "Roman", net: null, totalPnl: null, totalR: -1.5, winrate: 40, closed: 7 });
    expect(out[1].prev).toEqual({ net: null, totalPnl: null, totalR: 0.2 });
    expect(rows[1].net).toBe(-300); // input not mutated
  });

  it("staff see every $", () => {
    expect(redactOthersMoney(rows, "Curator", true)).toEqual(rows);
  });

  it("anonymous / guest viewer (no name) sees nobody's $", () => {
    expect(redactOthersMoney(rows, null, false).every((r) => r.net === null)).toBe(true);
  });

  it("custom owner and field list", () => {
    const out = redactOthersMoney([{ who: "A", usd: 5, r: 1 }], "B", false, { owner: (r) => r.who, fields: ["usd"] });
    expect(out[0]).toEqual({ who: "A", usd: null, r: 1 });
  });
});

describe("seesMoneyOf / canSeeDeskAggregate", () => {
  it("own or staff", () => {
    expect(seesMoneyOf("A", false, "A")).toBe(true);
    expect(seesMoneyOf("A", false, "B")).toBe(false);
    expect(seesMoneyOf("A", true, "B")).toBe(true);
    expect(seesMoneyOf(null, false, null)).toBe(false);
  });
  it("desk sums: staff always, traders only over ≥ 3 people", () => {
    expect(DESK_AGGREGATE_MIN_TRADERS).toBe(3);
    expect(canSeeDeskAggregate(false, 2)).toBe(false);
    expect(canSeeDeskAggregate(false, 3)).toBe(true);
    expect(canSeeDeskAggregate(true, 1)).toBe(true);
  });
});
