/**
 * «Тренажёр» eligibility (lib/trainer/eligibility.ts): the close-auction window 15:50:00–16:00:00 NY inclusive (any
 * fill → only that trade out), the 25-minute minimum hold, missing times = not eligible, New York time with DST.
 */
import { describe, it, expect } from "vitest";
import {
  closeAuctionDays, eligibleTrades, inCloseAuction, isTrainerEligible, nyClock, tickerDayKey, withoutBlockedDays,
} from "../trainer/eligibility";
import { deskQuota } from "../trainer/drillStore";

const SUMMER = "2026-07-15"; // EDT, UTC−4
const WINTER = "2026-01-15"; // EST, UTC−5
/** ISO instant of a New York wall-clock time (offset given explicitly so the test does not depend on the code under test). */
const at = (date: string, hhmmss: string, offset: "-04:00" | "-05:00") => `${date}T${hhmmss}${offset}`;
const S = (t: string) => at(SUMMER, t, "-04:00");
const W = (t: string) => at(WINTER, t, "-05:00");
const fills = (...ts: string[]) => ts.map((t) => ({ at: t }));

describe("close-auction window (NY, inclusive 15:50:00 … 16:00:00)", () => {
  it("summer (EDT) boundaries", () => {
    expect(inCloseAuction(S("15:49:59"))).toBe(false);
    expect(inCloseAuction(S("15:50:00"))).toBe(true);
    expect(inCloseAuction(S("15:55:30"))).toBe(true);
    expect(inCloseAuction(S("16:00:00"))).toBe(true);
    expect(inCloseAuction(S("16:00:01"))).toBe(false);
  });

  it("winter (EST) boundaries — the same UTC instant means a different NY time", () => {
    expect(inCloseAuction(W("15:49:59"))).toBe(false);
    expect(inCloseAuction(W("15:50:00"))).toBe(true);
    expect(inCloseAuction(W("16:00:00"))).toBe(true);
    expect(inCloseAuction(W("16:00:01"))).toBe(false);
    // 19:50Z is 15:50 NY in summer but 14:50 NY in winter; 20:50Z is 15:50 NY in winter but 16:50 NY in summer.
    expect(inCloseAuction(`${WINTER}T19:50:00Z`)).toBe(false);
    expect(inCloseAuction(`${SUMMER}T19:50:00Z`)).toBe(true);
    expect(inCloseAuction(`${SUMMER}T20:50:00Z`)).toBe(false);
    expect(inCloseAuction(`${WINTER}T20:50:00Z`)).toBe(true);
  });

  it("DST switch weeks: the Monday after spring-forward is EDT, the Monday after fall-back is EST", () => {
    expect(inCloseAuction("2026-03-09T19:50:00Z")).toBe(true); // 15:50 EDT
    expect(inCloseAuction("2026-03-06T19:50:00Z")).toBe(false); // Friday before: 14:50 EST
    expect(inCloseAuction("2026-03-06T20:50:00Z")).toBe(true);
    expect(inCloseAuction("2026-10-30T19:55:00Z")).toBe(true); // Friday before fall-back: 15:55 EDT
    expect(inCloseAuction("2026-11-02T19:55:00Z")).toBe(false); // 14:55 EST
    expect(inCloseAuction("2026-11-02T20:55:00Z")).toBe(true);
    expect(nyClock(Date.parse("2026-11-02T20:55:00Z"))).toEqual({ date: "2026-11-02", sec: 15 * 3600 + 55 * 60 });
  });

  it("Date and epoch-ms inputs; sub-second at 16:00:00 still counts; unknown is not «in»", () => {
    expect(inCloseAuction(new Date(S("15:50:00")))).toBe(true);
    expect(inCloseAuction(Date.parse(S("15:49:59")))).toBe(false);
    expect(inCloseAuction(`${SUMMER}T20:00:00.400Z`)).toBe(true);
    expect(inCloseAuction(null)).toBe(false);
    expect(inCloseAuction("not a date")).toBe(false);
  });
});

describe("isTrainerEligible", () => {
  it("15:49:59 is ok: a 25-minute trade closed at 15:49:59, and one opened at 15:49:59 and held past the window", () => {
    expect(isTrainerEligible({}, fills(S("15:24:59"), S("15:49:59")))).toEqual({ ok: true, reason: null });
    expect(isTrainerEligible({}, fills(S("15:49:59"), S("16:30:00")))).toEqual({ ok: true, reason: null });
  });

  it("any fill in the window excludes: entry, an add, the exit, a stop at exactly 16:00:00", () => {
    expect(isTrainerEligible({}, fills(S("15:50:00"), S("16:30:00")))).toEqual({ ok: false, reason: "closeAuction" });
    expect(isTrainerEligible({}, fills(S("13:00:00"), S("15:52:10"), S("17:00:00")))).toMatchObject({ reason: "closeAuction" });
    expect(isTrainerEligible({}, fills(W("14:00:00"), W("16:00:00")))).toMatchObject({ reason: "closeAuction" });
    expect(isTrainerEligible({}, fills(W("14:00:00"), W("16:00:01")))).toEqual({ ok: true, reason: null });
    // The trade's own open / close count too.
    expect(isTrainerEligible({ openAt: S("15:51:00"), closeAt: S("16:40:00") })).toMatchObject({ reason: "closeAuction" });
  });

  it("hold: 24:59 is out, 25:00 is in (first fill → last fill)", () => {
    expect(isTrainerEligible({}, fills(S("10:00:00"), S("10:24:59")))).toEqual({ ok: false, reason: "shortHold" });
    expect(isTrainerEligible({}, fills(S("10:00:00"), S("10:25:00")))).toEqual({ ok: true, reason: null });
    expect(isTrainerEligible({}, fills(S("10:00:00"), S("10:10:00"), S("10:25:00")))).toEqual({ ok: true, reason: null });
    expect(isTrainerEligible({ openAt: S("10:00:00"), closeAt: S("10:24:59") })).toMatchObject({ reason: "shortHold" });
    expect(isTrainerEligible({ openAt: S("10:00:00"), closeAt: S("10:25:00") }).ok).toBe(true);
    expect(isTrainerEligible({}, fills(S("10:00:00")))).toMatchObject({ reason: "shortHold" }); // a single fill: no hold
  });

  it("the close-auction check wins over the hold check", () => {
    expect(isTrainerEligible({}, fills(S("15:55:00"), S("15:56:00")))).toMatchObject({ reason: "closeAuction" });
  });

  it("missing times are not eligible", () => {
    expect(isTrainerEligible(null)).toEqual({ ok: false, reason: "noTimes" });
    expect(isTrainerEligible({}, [])).toEqual({ ok: false, reason: "noTimes" });
    expect(isTrainerEligible({ openAt: S("10:00:00") })).toMatchObject({ reason: "noTimes" });
    expect(isTrainerEligible({ closeAt: S("11:00:00") })).toMatchObject({ reason: "noTimes" });
    expect(isTrainerEligible({}, [{ at: S("10:00:00") }, { at: null }, { at: S("11:00:00") }])).toMatchObject({ reason: "noTimes" });
    expect(isTrainerEligible({}, [{ at: S("10:00:00") }, { at: "garbage" }])).toMatchObject({ reason: "noTimes" });
  });
});

describe("ticker-day pools", () => {
  it("closeAuctionDays keys on the NY date of the fill", () => {
    const days = closeAuctionDays([
      { ticker: "aapl", at: W("15:55:00") },
      { ticker: "MSFT", at: W("15:49:59") },
      { ticker: "TSLA", at: null },
    ]);
    expect([...days]).toEqual([tickerDayKey("AAPL", WINTER)]);
  });

  it("a close-auction fill takes only that trade out; other trades of the day stay (desk block only when passed)", () => {
    type T = { id: number; ticker: string; day: string; f: string[] };
    const trades: T[] = [
      { id: 1, ticker: "AAPL", day: SUMMER, f: [S("10:00:00"), S("11:00:00")] }, // fine on its own
      { id: 2, ticker: "AAPL", day: SUMMER, f: [S("15:30:00"), S("15:58:00")] }, // the close auction → this trade out
      { id: 3, ticker: "MSFT", day: SUMMER, f: [S("10:00:00"), S("11:00:00")] },
      { id: 4, ticker: "NVDA", day: SUMMER, f: [S("10:00:00"), S("11:00:00")] }, // blocked by the desk (another trader)
      { id: 5, ticker: "AMD", day: SUMMER, f: [S("10:00:00"), S("10:20:00")] }, // short hold, its day stays usable
    ];
    const blocked = new Set([tickerDayKey("NVDA", SUMMER)]);
    const ok = eligibleTrades(trades, (t) => ({ ticker: t.ticker, day: t.day, executions: fills(...t.f) }), blocked);
    expect(ok.map((t) => t.id)).toEqual([1, 3]);
  });

  it("withoutBlockedDays drops only the blocked ticker-days", () => {
    const cands = [{ ticker: "AAPL", day: SUMMER }, { ticker: "AAPL", day: WINTER }, { ticker: "MSFT", day: SUMMER }];
    expect(withoutBlockedDays(cands, (c) => c, new Set([tickerDayKey("AAPL", SUMMER)]))).toEqual(cands.slice(1));
    expect(withoutBlockedDays(cands, (c) => c, new Set())).toEqual(cands);
  });

  it("drills: desk quota per setup after the eligibility filter (setups with enough examples get none)", () => {
    const c = (setup_id: number, id: number) => ({ setup_id, id });
    const counts = new Map([[1, { ex: 0, n: 3 }], [2, { ex: 5, n: 5 }]]);
    const out = deskQuota([c(1, 10), c(1, 11), c(1, 12), c(2, 20), c(3, 30), c(3, 31)], counts, 3, 5);
    expect(out.map((x) => x.id)).toEqual([10, 11, 30, 31]);
  });
});
