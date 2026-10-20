import { describe, expect, it } from "vitest";
import { BP_MAX_JUNIOR, BP_MIN, buyingPowerError } from "./buying-power";

describe("buying power bounds (Волна 1 п. 1.21)", () => {
  it("junior (or no tier yet): 25 000 – 800 000 $", () => {
    expect([BP_MIN, BP_MAX_JUNIOR]).toEqual([25_000, 800_000]);
    expect(buyingPowerError("250000", "junior")).toBeNull();
    expect(buyingPowerError("250,000", "")).toBeNull();
    expect(buyingPowerError("900 000", "junior")).toBe("errBpJunior");
    expect(buyingPowerError("10000", "")).toBe("errBpJunior");
    expect(buyingPowerError("900000", "trainee")).toBe("errBpJunior"); // a stored legacy tier is a junior
  });
  it("above junior: no upper cap, still ≥ 25 000; empty is allowed (set later)", () => {
    expect(buyingPowerError("2000000", "senior")).toBeNull();
    expect(buyingPowerError("1000", "trader")).toBe("errBpMin");
    expect(buyingPowerError("", "junior")).toBeNull();
  });
});
