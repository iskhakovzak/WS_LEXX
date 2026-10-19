import { describe, expect, it } from "vitest";
import { decodeTagged } from "./use-tagged-trades";

describe("decodeTagged", () => {
  it("expands the columnar payload, -1 → null", () => {
    const rows = decodeTagged({
      n: 2,
      dict: ["AAPL", "win", "vwap, orb", "ORB", "intraday", "loss"],
      id: [7, 9], ticker: [0, 0], date: ["2026-10-01", "2026-10-02"], result: [1, 5], r: [1.5, null],
      pnl: [120.5, null], fees: [1.2, null], tags: [2, -1], setup: [3, 3], horizon: [4, -1],
    });
    expect(rows).toEqual([
      { id: 7, ticker: "AAPL", date: "2026-10-01", result: "win", rMultiple: 1.5, pnl: 120.5, fees: 1.2, tags: "vwap, orb", setup: "ORB", horizon: "intraday" },
      { id: 9, ticker: "AAPL", date: "2026-10-02", result: "loss", rMultiple: null, pnl: null, fees: null, tags: null, setup: "ORB", horizon: null },
    ]);
  });

  it("enc=2 (dates as indexes, ids as deltas) decodes to the same rows (DEV-10)", () => {
    const plain = {
      n: 3, dict: ["AAPL", "win"], id: [7, 9, 15], ticker: [0, 0, 0], date: ["2026-10-01", "2026-10-02", "2026-10-01"], result: [1, 1, 1],
      r: [1, 2, 3], pnl: [1, 2, 3], fees: [0, 0, 0], tags: [-1, -1, -1], setup: [-1, -1, -1], horizon: [-1, -1, -1],
    };
    const { id: _i, date: _d, ...rest } = plain;
    const compact = { ...rest, enc: 2 as const, idDelta: [7, 2, 6], dates: ["2026-10-01", "2026-10-02"], date: [0, 1, 0] };
    expect(decodeTagged(compact)).toEqual(decodeTagged(plain));
  });
});
