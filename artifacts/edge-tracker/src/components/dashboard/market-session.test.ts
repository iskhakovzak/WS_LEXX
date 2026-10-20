import { describe, expect, it } from "vitest";
import { getSessionState, sessionBounds, type MarketHoliday } from "./market-session";
import { phaseOf } from "@/components/big7/context";
import { holidaysFromEvents } from "@/components/shell/market-clock";

/** Wave 1, 1.12: early-close days (13:00 NY) are trading days, not «closed» (27.11.2026 and 24.12.2026). */
const CAL: MarketHoliday[] = [
  { date: "2026-11-26", name: "Thanksgiving" },
  { date: "2026-11-27", name: "Day after Thanksgiving", earlyClose: true },
  { date: "2026-12-24", name: "Christmas Eve", earlyClose: true },
  { date: "2026-12-25", name: "Christmas" },
];
/** NY wall time in late Nov / Dec (EST, UTC−5). */
const nyAt = (date: string, h: number, m = 0) => new Date(`${date}T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

describe("market session model — early close", () => {
  it("27.11: regular until 13:00 with the countdown to 13:00, then after-hours until 17:00, then closed", () => {
    const s = getSessionState(nyAt("2026-11-27", 11), CAL);
    expect(s).toMatchObject({ phase: "regular", earlyClose: true, closeTime: "13:00", holiday: null, nextKey: "toClose" });
    expect(s.msToNext).toBe(2 * 3600_000);
    const after = getSessionState(nyAt("2026-11-27", 13, 30), CAL);
    expect(after).toMatchObject({ phase: "after", nextKey: "toAfterEnd" });
    expect(after.msToNext).toBe(3.5 * 3600_000);
    expect(getSessionState(nyAt("2026-11-27", 17, 0), CAL).phase).toBe("closed");
  });

  it("24.12: premarket at 08:00, regular at 12:59; 25.12 is closed with the holiday name", () => {
    expect(getSessionState(nyAt("2026-12-24", 8), CAL).phase).toBe("pre");
    expect(getSessionState(nyAt("2026-12-24", 12, 59), CAL)).toMatchObject({ phase: "regular", earlyClose: true });
    const xmas = getSessionState(nyAt("2026-12-25", 11), CAL);
    expect(xmas).toMatchObject({ phase: "closed", holiday: "Christmas", earlyClose: false });
  });

  it("a closed day's next open skips holidays, not early closes (Thanksgiving → Friday 09:30)", () => {
    const s = getSessionState(nyAt("2026-11-26", 12), CAL);
    expect(s.phase).toBe("closed");
    expect(s.msToNext).toBe(21.5 * 3600_000);
  });

  it("an ordinary day keeps 16:00 / 20:00", () => {
    expect(getSessionState(nyAt("2026-11-30", 15, 30), CAL)).toMatchObject({ phase: "regular", earlyClose: false, closeTime: "16:00" });
    expect(sessionBounds(false)).toEqual({ closeMin: 960, afterEndMin: 1200 });
    expect(sessionBounds(true)).toEqual({ closeMin: 780, afterEndMin: 1020 });
  });

  it("/api/holidays rows carry a language-neutral earlyClose flag", () => {
    expect(holidaysFromEvents([
      { date: "2026-11-27T00:00:00Z", type: "holiday", name: "День после Дня благодарения", earlyClose: true },
      { date: "2026-11-26", type: "holiday", name: "День благодарения", earlyClose: false },
      { date: "2026-11-18", type: "fomc", name: "FOMC" },
    ])).toEqual([
      { date: "2026-11-27", name: "День после Дня благодарения", earlyClose: true },
      { date: "2026-11-26", name: "День благодарения", earlyClose: false },
    ]);
  });

  it("big7 board phase follows today's close", () => {
    expect(phaseOf("2026-11-27", nyAt("2026-11-27", 13, 30), 780)).toBe("post");
    expect(phaseOf("2026-11-27", nyAt("2026-11-27", 13, 30))).toBe("rth");
  });
});
