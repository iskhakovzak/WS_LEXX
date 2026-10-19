import { describe, expect, it } from "vitest";
import { sideNet } from "./lib";

// ROMAN-31: a side with no trades prints «—», not «$0».
describe("sideNet", () => {
  it("null when that side has no trades, the net otherwise", () => {
    expect(sideNet(0, 0)).toBeNull();
    expect(sideNet(-159, 4)).toBe(-159);
    expect(sideNet(0, 3)).toBe(0); // traded, flat
    expect(sideNet(0, undefined)).toBeNull(); // older API: no counts
    expect(sideNet(12, undefined)).toBe(12);
  });
});
