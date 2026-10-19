import { describe, expect, it } from "vitest";
import { entryTimeOf, netOf, searchParams } from "./picker";

describe("chart-lab trade picker", () => {
  it("asks /trades/page for rows only (lite=1, DEV-02) and splits ticker / day", () => {
    const p = searchParams("META 2026-09-16", 6);
    expect(p.get("lite")).toBe("1");
    expect(p.get("limit")).toBe("6");
    expect(p.get("q")).toBe("META");
    expect(p.get("date")).toBe("2026-09-16");
    expect(searchParams("").get("q")).toBeNull();
  });
  it("shows net $ (gross − |fees|, DENIS-15) and the entry time (MAKSIM-22)", () => {
    expect(netOf({ pnl: 4.8, fees: 1.3 })).toBeCloseTo(3.5);
    expect(netOf({ pnl: -55.8, fees: -1.5863 })).toBeCloseTo(-57.3863);
    expect(netOf({ pnl: null, fees: 1 })).toBeNull();
    expect(entryTimeOf({ contextSnapshot: { openedAt: "2026-10-16T14:55:17" } })).toBe("14:55");
    expect(entryTimeOf({ contextSnapshot: null })).toBeNull();
  });
});
