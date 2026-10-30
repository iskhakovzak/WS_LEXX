import { describe, expect, it } from "vitest";
import { LIVE_STAMP_KEY, stampMoved } from "./live-trades";
import { isTradeDependentKey } from "@/lib/query-keys";

describe("live trades poller", () => {
  it("refetches trade screens only when the book stamp moves (the first stamp is the baseline)", () => {
    expect(stampMoved(null, "7")).toBe(false);
    expect(stampMoved("7", "7")).toBe(false);
    expect(stampMoved("7", "8")).toBe(true);
    expect(stampMoved("7", null)).toBe(false);
  });

  it("the stamp query is not itself trade-dependent (invalidating trades does not loop back into it)", () => {
    expect(isTradeDependentKey(LIVE_STAMP_KEY)).toBe(false);
    expect(isTradeDependentKey(["/api/trades", {}])).toBe(true);
  });
});
