import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ALERTS_AFTER_STAMP_MS, LIVE_STAMP_KEY, refreshOnStamp, stampMoved } from "./live-trades";
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

describe("live alerts follow the book stamp", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const keysOf = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey?: unknown } | undefined)?.queryKey ?? "predicate"));

  it("a moved stamp refetches trade screens now and the risk alerts once the server's scan has run", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    refreshOnStamp(qc);
    expect(keysOf(spy)).toEqual(['"predicate"']); // trade dependents, at once
    await vi.advanceTimersByTimeAsync(ALERTS_AFTER_STAMP_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(keysOf(spy).slice(1)).toEqual(['["risk-signals","me"]', '["risk-signals","desk"]']);
    // Stamp poll (5 s) → +1.5 s: inside the strip's own 5 s poll budget, phase-shifted from it.
    expect(ALERTS_AFTER_STAMP_MS).toBeLessThan(5_000);
  });

  it("cancel (a newer stamp / unmount) drops the pending alerts refresh", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const cancel = refreshOnStamp(qc);
    cancel();
    await vi.advanceTimersByTimeAsync(ALERTS_AFTER_STAMP_MS * 2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
