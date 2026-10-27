/**
 * Mentor commitments and escalation rules (pure): progress from trades, the verdict the mentor talks from, and the
 * patterns that bring in the curator.
 */
import { describe, expect, it } from "vitest";
import { commitmentVerdict, parseParams, trackCommitment, type TrackTrade } from "../commitments";
import { detectEscalations, freshEscalations, type TradedDay } from "../escalation";

const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-04:00`);
let seq = 0;
/** One trade: entry and exit as NY wall clock, net $. */
function tr(day: string, entry: string, exit: string, net: number): TrackTrade {
  return { id: ++seq, date: day, entryAt: at(day, entry), exitAt: at(day, exit), entryMin: Number(entry.slice(0, 2)) * 60 + Number(entry.slice(3)), net };
}

describe("commitment tracking", () => {
  it("pause after a loss: counts each loss, kept when the next entry waited long enough (stopping keeps it)", () => {
    const trades = [
      tr("2026-10-19", "09:35", "09:40", -50), tr("2026-10-19", "09:42", "09:50", 30), // re-entry after 2 min: broken
      tr("2026-10-19", "10:00", "10:05", -20), tr("2026-10-19", "10:20", "10:30", 10), // 15 min: kept
      tr("2026-10-20", "09:40", "09:45", -40), // last trade of the day: kept
      tr("2026-10-16", "09:31", "09:32", -10), tr("2026-10-16", "09:33", "09:40", 5), // before the start: ignored
    ];
    const p = trackCommitment({ kind: "pause_after_loss", params: { minutes: 10 }, startedOn: "2026-10-19" }, trades);
    expect(p).toMatchObject({ tracked: true, unit: "loss", opportunities: 3, kept: 2, broken: 1, streak: 2 });
    expect(p.breaks[0]).toEqual({ tradeId: trades[1]!.id, day: "2026-10-19" });
    expect(p.days.map((d) => d.day)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("max trades per day and stop after N losses in a row are judged per day", () => {
    const day1 = [tr("2026-10-19", "09:31", "09:32", -5), tr("2026-10-19", "09:35", "09:36", -5), tr("2026-10-19", "09:40", "09:41", 8)];
    const day2 = [tr("2026-10-20", "09:31", "09:32", 3)];
    const max = trackCommitment({ kind: "max_trades", params: { count: 2 }, startedOn: "2026-10-19" }, [...day1, ...day2]);
    expect(max).toMatchObject({ opportunities: 2, kept: 1, rate: 0.5 });
    expect(max.breaks[0]!.tradeId).toBe(day1[2]!.id); // the third trade broke it
    const stop = trackCommitment({ kind: "stop_after_losses", params: { count: 2 }, startedOn: "2026-10-19" }, [...day1, ...day2]);
    expect(stop).toMatchObject({ opportunities: 1, kept: 0 }); // two losses, then one more entry; day 2 had no streak
  });

  it("verdicts: new → on track → achieved; failing only with enough data; custom is untracked", () => {
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"];
    const loss = (d: string, net: number) => tr(d, "09:31", "09:35", net);
    const ok = days.map((d) => loss(d, -30));
    const c = { kind: "max_daily_loss" as const, params: { usd: 100 }, startedOn: "2026-10-19" };
    expect(commitmentVerdict(trackCommitment(c, ok.slice(0, 2)))).toBe("new");
    expect(commitmentVerdict(trackCommitment(c, ok.slice(0, 4)))).toBe("on_track");
    expect(commitmentVerdict(trackCommitment(c, ok))).toBe("achieved");
    const bad = days.map((d, i) => loss(d, i % 4 === 0 ? -30 : -300));
    expect(commitmentVerdict(trackCommitment(c, bad))).toBe("failing");
    expect(commitmentVerdict(trackCommitment({ kind: "custom", params: {}, startedOn: "2026-10-19" }, ok))).toBe("untracked");
  });

  it("params are validated per kind", () => {
    expect(parseParams("pause_after_loss", { minutes: 10 })).toEqual({ minutes: 10 });
    expect(parseParams("max_daily_loss", { usd: 150.256 })).toEqual({ usd: 150.26 });
    expect(parseParams("no_entry_before", { time: "9:45" })).toBeNull();
    expect(parseParams("max_trades", { count: 0 })).toBeNull();
  });
});

describe("escalation rules", () => {
  const day = (d: string, net: number, tilt = false): TradedDay => ({ day: d, trades: 4, net, tilt });
  const base = { today: "2026-10-27", breaks: new Map<string, number>(), maxDrawdown: null, drawdownFromPeak: 0, lastActivity: "2026-10-27" };

  it("a tilt streak counts the latest traded days in a row", () => {
    const days = [day("2026-10-21", 10, false), day("2026-10-22", -40, true), day("2026-10-23", -60, true), day("2026-10-26", -20, true)];
    expect(detectEscalations({ ...base, days })).toEqual([{ rule: "tilt_streak", params: { days: 3 } }]);
    expect(detectEscalations({ ...base, days: [...days, day("2026-10-27", 15, false)] })).toEqual([]);
  });

  it("repeated commitment breaks inside the window, drawdown near the limit", () => {
    const breaks = new Map([["2026-10-26", 2], ["2026-10-27", 2], ["2026-10-01", 9]]);
    const days = [day("2026-10-22", 500), day("2026-10-23", -300), day("2026-10-26", -250)];
    // The drawdown from the peak comes from the risk desk's state (lib/coreMetrics/risk), not from the mentor's days.
    const out = detectEscalations({ ...base, days, breaks, maxDrawdown: 600, drawdownFromPeak: 550 });
    expect(out).toContainEqual({ rule: "rule_breaks", params: { count: 4, days: 5 } });
    expect(out).toContainEqual({ rule: "drawdown_near_limit", params: { drawdown: 550, limit: 600, pct: 92 } });
  });

  it("silence only for a recently active trader; the same rule is not repeated within the cooldown", () => {
    const quiet = { ...base, days: [day("2026-10-20", 10)], lastActivity: "2026-10-21" };
    expect(detectEscalations(quiet)).toEqual([{ rule: "silence", params: { days: 4 } }]);
    expect(detectEscalations({ ...quiet, days: [day("2026-08-03", 10)], lastActivity: null })).toEqual([]); // left long ago
    const found = detectEscalations(quiet);
    expect(freshEscalations(found, [{ rule: "silence", day: "2026-10-23", status: "acknowledged" }], "2026-10-27")).toEqual([]);
    expect(freshEscalations(found, [{ rule: "silence", day: "2026-10-16", status: "open" }], "2026-10-27")).toEqual(found);
  });
});
