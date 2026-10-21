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
    // An older table without the newer columns leaves those fields out (the new rules then find nothing to act on).
    for (const k of ["trader", "imx", "reentry", "sizeRel", "hasStop", "ptags", "mistakes"]) expect(trades[0]).not.toHaveProperty(k);
  });

  it("reads the newer columns by name: owner, 1/0 flags, stop 1/0/null, comma lists of tags and mistakes", () => {
    const cols = ["id", "day", "ticker", "gross", "fees", "seq", "trader", "imx", "reentry", "sizeRel", "hasStop", "ptags", "mistakes", "someFutureColumn"];
    const trades = decodeTrades({
      cols,
      rows: [
        [1, 0, 0, 5, 0.4, 0, 0, 1, 0, 2.5, 1, 0, 0, "x"],
        [2, 0, 0, -3, 0.2, 1, 1, 0, 1, null, 0, null, null, null],
        [3, 0, 0, 1, 0, 2, null, 0, 0, null, null, 0, 1, null],
      ],
      dicts: { day: ["2026-10-01"], ticker: ["AAA"], trader: ["A", "B"], ptags: ["news,halt"], mistakes: ["fomo,revenge", "fomo,notACode"] },
    });
    expect(trades[0]).toMatchObject({ trader: "A", imx: true, reentry: false, sizeRel: 2.5, hasStop: true, ptags: ["news", "halt"], mistakes: ["fomo", "revenge"] });
    expect(trades[1]).toMatchObject({ trader: "B", imx: false, reentry: true, sizeRel: null, hasStop: false, ptags: [], mistakes: [] });
    expect(trades[2]).toMatchObject({ trader: null, hasStop: null, ptags: ["news", "halt"], mistakes: ["fomo"] });
  });
});
