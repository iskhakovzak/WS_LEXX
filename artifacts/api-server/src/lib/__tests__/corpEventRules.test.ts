/**
 * Event-date rules of the corporate and index calendar (lib/corpEvents/rules): quad witching and the S&P quarterly
 * rebalance (third Friday, holiday → the session before), MSCI reviews (last business day of Feb / May / Aug / Nov),
 * the Nasdaq-100 December reconstitution, lock-up expiries, S&P headlines and offering types.
 */
import { describe, expect, it } from "vitest";
import { lastBusinessDay, lockupExpiry, offeringType, quadWitchingDays, ruleEvents, spChangeOf, thirdFriday } from "../corpEvents/rules";

// Full-day NYSE closures used below (holiday_calendar «Market closed»).
const CLOSED = new Set(["2026-06-19", "2027-06-18", "2026-05-25", "2026-09-07", "2026-11-26"]);

describe("deterministic index dates", () => {
  it("third Friday of a month", () => {
    expect(thirdFriday(2026, 3)).toBe("2026-03-20");
    expect(thirdFriday(2026, 12)).toBe("2026-12-18");
    expect(thirdFriday(2027, 6)).toBe("2027-06-18");
    expect(thirdFriday(2026, 5)).toBe("2026-05-15"); // May 1 2026 is a Friday
  });

  it("quad witching moves to the session before a holiday Friday", () => {
    expect(quadWitchingDays(2026, CLOSED)).toEqual(["2026-03-20", "2026-06-18", "2026-09-18", "2026-12-18"]);
    expect(quadWitchingDays(2027, CLOSED)).toEqual(["2027-03-19", "2027-06-17", "2027-09-17", "2027-12-17"]);
  });

  it("MSCI reviews on the last business day of Feb / May / Aug / Nov", () => {
    expect(lastBusinessDay(2026, 2, CLOSED)).toBe("2026-02-27");
    expect(lastBusinessDay(2026, 5, CLOSED)).toBe("2026-05-29");
    expect(lastBusinessDay(2026, 8, CLOSED)).toBe("2026-08-31");
    expect(lastBusinessDay(2026, 11, CLOSED)).toBe("2026-11-30");
    expect(lastBusinessDay(2027, 2, new Set())).toBe("2027-02-26"); // Feb 28 2027 is a Sunday
  });

  it("the window holds every rule once, sorted, inside [from, to]", () => {
    const ev = ruleEvents("2026-11-01", "2026-12-31", CLOSED);
    expect(ev.map((e) => [e.day, e.type, e.indexCode, e.rule])).toEqual([
      ["2026-11-30", "index_rebalance", "msci", "msci_semiannual"],
      ["2026-12-18", "index_rebalance", "nasdaq100", "ndx_annual"],
      ["2026-12-18", "quad_witching", null, "quad_witching"],
      ["2026-12-18", "index_rebalance", "sp500", "sp_quarterly"],
    ]);
    expect(ruleEvents("2026-01-01", "2026-12-31", CLOSED).filter((e) => e.rule === "msci_quarterly").map((e) => e.day)).toEqual(["2026-02-27", "2026-08-31"]);
  });
});

describe("lock-up expiry", () => {
  it("IPO day + the stated term, on the next session; the default is marked estimated", () => {
    expect(lockupExpiry("2026-04-15", 180, 180)).toEqual({ day: "2026-10-12", estimated: false });
    expect(lockupExpiry("2026-03-02", 90, 180)).toEqual({ day: "2026-06-01", estimated: false }); // Sunday → Monday
    expect(lockupExpiry("2026-04-15", null, 180)).toEqual({ day: "2026-10-12", estimated: true });
    expect(lockupExpiry("2026-03-23", 90, 180, CLOSED)).toEqual({ day: "2026-06-22", estimated: false }); // Sun 21 → Mon 22
  });
});

describe("data-derived rows", () => {
  it("S&P adds and removals from headlines; other indexes are ignored", () => {
    expect(spChangeOf("Synthco set to join S&P 500; Oldco to exit")).toEqual({ type: "sp_remove", indexCode: "sp500" });
    expect(spChangeOf("Synthco set to join S&P 500")).toEqual({ type: "sp_add", indexCode: "sp500" });
    expect(spChangeOf("Synthco to replace Oldco in S&P SmallCap 600")).toEqual({ type: "sp_add", indexCode: "sp600" });
    expect(spChangeOf("Synthco removed from S&P MidCap 400")).toEqual({ type: "sp_remove", indexCode: "sp400" });
    expect(spChangeOf("Synthco beats S&P 500 this year")).toBeNull();
    expect(spChangeOf("Synthco joins Russell 2000")).toBeNull();
  });

  it("offerings feed → ipo / pricing / offering", () => {
    expect(offeringType({ type: "IPO", kind: "IPO" })).toBe("ipo");
    expect(offeringType({ type: "Follow-on", kind: "424B" })).toBe("pricing");
    expect(offeringType({ type: "ATM", kind: "ATM" })).toBe("offering");
    expect(offeringType({ type: "Shelf", kind: "S-3" })).toBe("offering");
  });
});
