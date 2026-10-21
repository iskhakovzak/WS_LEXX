/**
 * lib/admin/loopYesterday.ts buildLoop / loopTotals (Волна 2 п. 2.4 «Петля вчера»): one row per trader, plan before
 * the open, review hours in trading hours (weekends pause the SLA clock), totals per column.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })) } }));
const { buildLoop, loopTotals } = await import("../admin/loopYesterday");

const DATE = "2026-10-19"; // Monday
const trader = (name: string, group: string | null = null, telegram = true) => ({ name, group, telegram });

describe("buildLoop", () => {
  it("one row per trader, sorted by name, every column filled from its store", () => {
    const now = Date.parse("2026-10-20T18:30:00Z"); // Tue 14:30 NY
    const out = buildLoop(DATE, {
      traders: [trader("Bob", "Alpha", false), trader("Ann", "Alpha"), trader("Cid")],
      plans: new Map<string, Date | string>([["Ann", new Date("2026-10-19T13:00:00Z")], ["Bob", "2026-10-19T14:05:00Z"]]), // 09:00 NY / 10:05 NY
      trades: new Map([["Ann", 3], ["Bob", 1]]),
      days: new Map([
        ["Ann", { closedAt: "2026-10-19T20:30:00Z", reviewedAt: "2026-10-20T13:30:00Z", reviewedBy: "Curator C." }], // reviewed after 17 h
        ["Bob", { closedAt: "2026-10-19T20:30:00Z", reviewedAt: null, reviewedBy: null }], // waiting 22 h
      ]),
    }, new Set(), now);
    expect(out.date).toBe(DATE);
    expect(out.slaHours).toBe(24);
    expect(out.rows.map((r) => r.name)).toEqual(["Ann", "Bob", "Cid"]);
    expect(out.rows[0]).toMatchObject({
      group: "Alpha", plan: true, planBeforeOpen: true, trades: 3, closed: true, reviewed: true, reviewedBy: "Curator C.",
      reviewHours: 17, overSla: false, telegram: true,
    });
    expect(out.rows[1]).toMatchObject({ plan: true, planBeforeOpen: false, trades: 1, closed: true, reviewed: false, reviewHours: 22, overSla: false, telegram: false });
    expect(out.rows[2]).toMatchObject({ group: null, plan: false, planBeforeOpen: false, trades: 0, closed: false, closedAt: null, reviewed: false, reviewHours: null, overSla: false });
  });

  it("hours waiting: past the SLA → overSla; weekends and market holidays do not count", () => {
    const facts = (closedAt: string) => ({
      traders: [trader("Ann")], plans: new Map(), trades: new Map([["Ann", 2]]),
      days: new Map([["Ann", { closedAt, reviewedAt: null, reviewedBy: null }]]),
    });
    // Mon 16:30 NY → Wed 00:30 UTC (Tue 20:30 NY) = 28 trading hours
    const late = buildLoop(DATE, facts("2026-10-19T20:30:00Z"), new Set(), Date.parse("2026-10-21T00:30:00Z"));
    expect(late.rows[0]).toMatchObject({ reviewHours: 28, overSla: true });
    expect(late.totals).toMatchObject({ waiting: 1, overdue: 1 });
    // Fri 16:30 NY → Mon 10:30 NY: 7.5 h on Friday + 10.5 h on Monday, the weekend is skipped
    const weekend = buildLoop("2026-10-16", facts("2026-10-16T20:30:00Z"), new Set(), Date.parse("2026-10-19T14:30:00Z"));
    expect(weekend.rows[0]).toMatchObject({ reviewHours: 18, overSla: false });
    // a full-day holiday on that Monday pauses the clock too
    const holiday = buildLoop("2026-10-16", facts("2026-10-16T20:30:00Z"), new Set(["2026-10-19"]), Date.parse("2026-10-19T14:30:00Z"));
    expect(holiday.rows[0]!.reviewHours).toBe(7.5);
  });

  it("a review without a closed day does not count; a plan saved the evening before is «before the open»", () => {
    const out = buildLoop(DATE, {
      traders: [trader("Ann")],
      plans: new Map([["Ann", "2026-10-18T23:00:00Z"]]),
      trades: new Map(),
      days: new Map([["Ann", { closedAt: null, reviewedAt: "2026-10-20T13:30:00Z", reviewedBy: "Curator C." }]]),
    }, new Set());
    expect(out.rows[0]).toMatchObject({ planBeforeOpen: true, closed: false, reviewed: false, reviewedBy: null, reviewHours: null });
  });
});

describe("loopTotals", () => {
  it("counts per column", () => {
    const row = (o: Partial<ReturnType<typeof buildLoop>["rows"][number]>) => ({
      name: "x", group: null, plan: false, planBeforeOpen: false, trades: 0, closed: false, closedAt: null, reviewed: false,
      reviewedBy: null, reviewHours: null, overSla: false, telegram: false, ...o,
    });
    expect(loopTotals([
      row({ plan: true, planBeforeOpen: true, trades: 4, closed: true, reviewed: true, reviewHours: 3, telegram: true }),
      row({ plan: true, trades: 2, closed: true, reviewHours: 30, overSla: true }),
      row({ trades: 1, closed: true, reviewHours: 2 }),
      row({ telegram: true }),
    ])).toEqual({
      traders: 4, plan: 2, planBeforeOpen: 1, traded: 3, trades: 7, closed: 3, reviewed: 1, waiting: 2, overdue: 1, telegram: 2,
    });
    expect(loopTotals([])).toEqual({ traders: 0, plan: 0, planBeforeOpen: 0, traded: 0, trades: 0, closed: 0, reviewed: 0, waiting: 0, overdue: 0, telegram: 0 });
  });
});
