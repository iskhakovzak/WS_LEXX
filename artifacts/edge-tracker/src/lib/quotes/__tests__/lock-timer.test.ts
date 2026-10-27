import { describe, expect, it } from "vitest";
import { DEFAULT_LOCK_QUOTE_INTERVAL, crossFadeMs, lockQuotePlan, lockSlot, msToNextSlot, parseLockQuoteInterval } from "../lock-timer";

const at = (iso: string) => Date.parse(iso);

describe("lock-screen quote timer", () => {
  it("cuts time into wall-clock slots of N minutes", () => {
    expect(lockSlot(at("2026-10-26T10:00:00Z"), 5)).toBe(lockSlot(at("2026-10-26T10:04:59.999Z"), 5));
    expect(lockSlot(at("2026-10-26T10:05:00Z"), 5)).toBe(lockSlot(at("2026-10-26T10:00:00Z"), 5) + 1);
    expect(lockSlot(at("2026-10-26T10:00:59Z"), 1)).not.toBe(lockSlot(at("2026-10-26T10:01:00Z"), 1));
  });

  it("schedules the next change exactly on the boundary (never 0 ms)", () => {
    expect(msToNextSlot(at("2026-10-26T10:03:30Z"), 5)).toBe(90_000);
    expect(msToNextSlot(at("2026-10-26T10:05:00Z"), 5)).toBe(300_000);
    expect(msToNextSlot(at("2026-10-26T10:14:59.999Z"), 15)).toBe(1);
  });

  it("a quote changes every 5 minutes: 12 distinct slots per hour, none in between", () => {
    const start = at("2026-10-26T09:00:00Z");
    const slots = new Set<string>();
    for (let s = 0; s < 3600; s += 10) slots.add(lockQuotePlan(start + s * 1000, 5)!.slot);
    expect(slots.size).toBe(12);
  });

  it("off = no plan; switching the interval gives a different slot key", () => {
    const now = at("2026-10-26T10:00:00Z");
    expect(lockQuotePlan(now, 0)).toBeNull();
    expect(lockQuotePlan(now, 5)!.slot).not.toBe(lockQuotePlan(now, 1)!.slot);
    expect(lockQuotePlan(now, 15)!.nextInMs).toBe(15 * 60_000);
  });

  it("parses the stored setting (default 5 min; unknown → default; 0 = off)", () => {
    expect(parseLockQuoteInterval(null)).toBe(DEFAULT_LOCK_QUOTE_INTERVAL);
    expect(DEFAULT_LOCK_QUOTE_INTERVAL).toBe(5);
    expect(parseLockQuoteInterval("0")).toBe(0);
    expect(parseLockQuoteInterval("15")).toBe(15);
    expect(parseLockQuoteInterval("7")).toBe(5);
    expect(parseLockQuoteInterval("abc")).toBe(5);
  });

  it("respects reduced motion", () => {
    expect(crossFadeMs(true)).toBe(0);
    expect(crossFadeMs(false)).toBeGreaterThanOrEqual(1000);
  });
});
