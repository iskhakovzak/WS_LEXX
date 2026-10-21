/**
 * Wave 1, 1.12 — early-close days (13:00 NY) in one session module: lib/marketDays sessionFor reads the calendar
 * (closeMinutesFor for the 13:00 rows), and the users — themes session, WS_NEWS windows, big7 hour buckets — follow it.
 * 27.11.2026 (day after Thanksgiving) and 24.12.2026 (Christmas Eve) are early closes; 26.11 / 25.12 are closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { sql: string; params: unknown[] }[]);
vi.mock("@workspace/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const d = String(params[0] ?? "");
      if (sql.includes("market closed") && (d === "2026-11-26" || d === "2026-12-25")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("early close") && (d === "2026-11-27" || d === "2026-12-24")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
}));

const { daySession, nySession, phaseAt, EARLY_CLOSE_MIN, REGULAR_CLOSE_MIN } = await import("../tradingDate");
const { sessionFor, knownSession, resetMarketDays } = await import("../marketDays");
const { themeSession } = await import("../themes/logic");
const schedule = await import("../newsChannel/schedule");
const { bucketOf } = await import("../../routes/big7tickers");

/** A NY wall time on a date (EST in late Nov / Dec: UTC−5). */
const nyAt = (date: string, h: number, m = 0) => new Date(`${date}T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

beforeEach(() => {
  calls.length = 0;
  resetMarketDays();
});

describe("sessionFor (one session module)", () => {
  it("27.11 and 24.12 are early closes: open 09:30, close 13:00, post-market until 17:00", async () => {
    for (const d of ["2026-11-27", "2026-12-24"]) {
      const s = await sessionFor(d);
      expect(s).toEqual({ date: d, closed: false, earlyClose: true, openMin: 570, closeMin: EARLY_CLOSE_MIN, postEndMin: 17 * 60 });
      expect(knownSession(d)).toEqual(s);
    }
  });

  it("full-day holidays and weekends are closed; an ordinary weekday closes at 16:00", async () => {
    expect((await sessionFor("2026-11-26")).closed).toBe(true);
    expect((await sessionFor("2026-12-25")).closed).toBe(true);
    expect((await sessionFor("2026-11-28")).closed).toBe(true); // Saturday
    const reg = await sessionFor("2026-11-30");
    expect(reg).toMatchObject({ closed: false, earlyClose: false, closeMin: REGULAR_CLOSE_MIN, postEndMin: 20 * 60 });
  });

  it("one calendar read per date per process; the close comes from the eod close rule (no second copy)", async () => {
    await sessionFor("2026-07-02");
    const first = calls.length;
    expect(first).toBe(2); // closed? + early close? (lib/eodStore closeMinutesFor)
    expect(calls.some((c) => c.sql.includes("ILIKE 'early close%'"))).toBe(true);
    await sessionFor("2026-07-02");
    expect(calls.length).toBe(first);
  });

  it("phases on an early-close day: 12:59 regular, 13:00 post-market, 17:00 closed", () => {
    const s = daySession("2026-11-27", { earlyClose: true });
    expect(nySession(nyAt("2026-11-27", 12, 59), s)).toBe("regular");
    expect(nySession(nyAt("2026-11-27", 13, 0), s)).toBe("postmarket");
    expect(nySession(nyAt("2026-11-27", 16, 59), s)).toBe("postmarket");
    expect(nySession(nyAt("2026-11-27", 17, 0), s)).toBe("closed");
    expect(nySession(nyAt("2026-11-27", 13, 0))).toBe("regular"); // without the session: the regular 16:00 close
    expect(phaseAt(15 * 60)).toBe("regular");
    expect(nySession(nyAt("2026-11-26", 11), daySession("2026-11-26", { closed: true }))).toBe("closed");
  });
});

describe("users of the session", () => {
  it("themes: the early close ends RTH at 13:00 (boolean callers unchanged)", async () => {
    const s = await sessionFor("2026-12-24");
    expect(themeSession(nyAt("2026-12-24", 12, 30), s)).toBe("rth");
    expect(themeSession(nyAt("2026-12-24", 13, 30), s)).toBe("post");
    expect(themeSession(nyAt("2026-12-24", 17, 30), s)).toBe("closed");
    expect(themeSession(nyAt("2026-12-24", 13, 30), false)).toBe("rth");
    expect(themeSession(nyAt("2026-12-24", 11), true)).toBe("closed");
  });

  it("WS_NEWS: «от открытия» ends before 13:00, «итоги дня» 13:05–16:55, retry cutoffs follow the close", () => {
    expect(schedule.postWindow("open", EARLY_CLOSE_MIN)).toEqual([575, 775]);
    expect(schedule.postWindow("close", EARLY_CLOSE_MIN)).toEqual([785, 1015]);
    expect(schedule.postWindow("close")).toEqual(schedule.POST_WINDOW.close);
    expect(schedule.postWindow("open")).toEqual(schedule.POST_WINDOW.open);
    expect(schedule.retryCutoff("open", EARLY_CLOSE_MIN)).toBe(11 * 60);
    // the close post: 3 h after its clamped send time (default 16:15), within its window (16:55 on an early close)
    expect(schedule.retryCutoff("close", EARLY_CLOSE_MIN)).toBe(16 * 60 + 55);
    expect(schedule.retryCutoff("close")).toBe(19 * 60 + 15);
    expect(schedule.retryCutoff("premarket")).toBeNull();
    // the early-close post at 16:15 is retried (the old 16:00 cutoff came before its own send time)
    expect(schedule.planRetry("close", true, nyAt("2026-11-27", 16, 15), nyAt("2026-11-27", 16, 16), EARLY_CLOSE_MIN)).toBe("16:20");
    expect(schedule.planRetry("close", true, nyAt("2026-11-27", 16, 50), nyAt("2026-11-27", 16, 51), EARLY_CLOSE_MIN)).toBe("16:55");
    expect(schedule.planRetry("close", true, nyAt("2026-11-27", 16, 55), nyAt("2026-11-27", 16, 56), EARLY_CLOSE_MIN)).toBeNull();
  });

  it("WS_NEWS cron getter: today's close from the cached session (regular until it is read)", async () => {
    expect(schedule.closeMinutesToday(nyAt("2026-11-27", 9))).toBe(REGULAR_CLOSE_MIN);
    await sessionFor("2026-11-27");
    expect(schedule.closeMinutesToday(nyAt("2026-11-27", 9))).toBe(EARLY_CLOSE_MIN);
  });

  it("big7 hours: an entry at 13:30 on an early close is post-market, on a regular day the 12–14 bucket", () => {
    expect(bucketOf(13 * 60 + 30, EARLY_CLOSE_MIN)?.key).toBe("post");
    expect(bucketOf(13 * 60 + 30)?.key).toBe("lunch");
    expect(bucketOf(12 * 60 + 59, EARLY_CLOSE_MIN)?.key).toBe("lunch");
    expect(bucketOf(null)).toBeNull();
  });
});
