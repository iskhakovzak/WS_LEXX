import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import { scanCooldownMinutes } from "../api";

describe("source scan cooldown (429)", () => {
  it("reads the minutes left from details.retryAfterMs, rounded up", () => {
    const e = new ApiError({ status: 429, code: "RATE_LIMITED", body: { error: "x", code: "RATE_LIMITED", details: { retryAfterMs: 61_000 } } });
    expect(scanCooldownMinutes(e)).toBe(2);
  });
  it("defaults to the 10-minute window; other errors are not a cooldown", () => {
    expect(scanCooldownMinutes(new ApiError({ status: 429, code: "RATE_LIMITED", body: null }))).toBe(10);
    expect(scanCooldownMinutes(new ApiError({ status: 403, code: "STAFF_ONLY", body: null }))).toBeNull();
    expect(scanCooldownMinutes(new Error("boom"))).toBeNull();
  });
});
