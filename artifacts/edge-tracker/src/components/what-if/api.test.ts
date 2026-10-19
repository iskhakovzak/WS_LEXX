import { describe, expect, it } from "vitest";
import { decodeTrades } from "./api";

describe("compact /whatif/base table (DEV-10)", () => {
  it("restores dictionary columns, numbers and the regulatory sum", () => {
    const cols = ["id", "day", "entryMin", "ticker", "side", "qty", "entry", "gross", "fees", "holdSec", "seq", "fills", "reg", "setup", "grade"];
    const trades = decodeTrades({
      cols,
      rows: [
        [7, 0, 570.12, 0, 0, 100, 10, 5, 0.4, 60, 0, 2, 0.03, 0, null],
        [8, 1, null, 1, 1, null, null, -3, 0.2, null, 1, null, null, null, 0],
      ],
      dicts: { day: ["2026-10-01", "2026-10-02"], ticker: ["AAA", "BBB"], side: ["long", "short"], setup: ["ORB"], grade: ["A"] },
    });
    expect(trades[0]).toEqual({
      id: 7, day: "2026-10-01", entryMin: 570.12, ticker: "AAA", side: "long", qty: 100, entry: 10, gross: 5, fees: 0.4, holdSec: 60,
      seq: 0, fills: 2, regFees: 0.03, setup: "ORB", grade: null,
    });
    expect(trades[1]).toMatchObject({ id: 8, day: "2026-10-02", ticker: "BBB", side: "short", qty: null, entryMin: null, regFees: null, setup: null, grade: "A" });
  });
});
