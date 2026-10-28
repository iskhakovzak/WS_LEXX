/**
 * «Лёгкие деньги дня» (lib/deskPulse/easyMoney): only moves the archived day really shows count, classified by family
 * and timing; each person of the group is took / against / skipped / missed with the shared $ result.
 */
import { describe, expect, it } from "vitest";
import { detectMove, matchMove, personalLines, timingFromBars, type EasyMove, type MatchRow } from "../easyMoney";

const cfg = { minMovePct: 4, cleanShare: 0.6, gapPct: 2 };
const bar = (prevClose: number, open: number, high: number, low: number, close: number) => ({ prevClose, open, high, low, close });

describe("easy-money detector", () => {
  it("a clean trend day after a gap up: gap-and-go long, sized by the open → close body", () => {
    const m = detectMove("2026-10-27", "NVDA", bar(100, 103, 110.5, 102.5, 110), ["traded"], cfg)!;
    expect(m).toMatchObject({ kind: "session", side: "long", family: "gap_up_long", movePct: 6.8, gapPct: 3, timing: null });
    expect(m.sources).toEqual(["traded", "gap"]);
  });

  it("a gap-up fade is a short of the gap-up family", () => {
    const m = detectMove("2026-10-27", "AAA", bar(50, 53, 53.2, 50.4, 50.6), [], cfg)!;
    expect(m).toMatchObject({ kind: "session", side: "short", family: "gap_up_short" });
  });

  it("chop is not easy money: a big range with a small body", () => {
    expect(detectMove("2026-10-27", "CHOP", bar(100, 100, 110, 92, 104.5), [], cfg)).toBeNull();
  });

  it("a gap that held with a quiet session: the money was pre-market (timing am, sized by the gap)", () => {
    const m = detectMove("2026-10-27", "GAP", bar(20, 21.5, 21.8, 21.2, 21.6), ["earnings"], { ...cfg, minMovePct: 5 })!;
    expect(m).toMatchObject({ kind: "gap", side: "long", family: "gap_up_long", timing: "am", movePct: 7.5 });
    // half the gap given back without a clean session move is neither (a clean fill would be the short instead)
    expect(detectMove("2026-10-27", "GONE", bar(20, 21.5, 22.2, 20.4, 20.7), [], { ...cfg, minMovePct: 5 })).toBeNull();
  });

  it("marks an expected-move break only when the day's change passed the EM", () => {
    expect(detectMove("2026-10-27", "E", bar(100, 103, 110.5, 102.5, 110), [], cfg, { emPct: 8 })!.sources).toContain("em_break");
    expect(detectMove("2026-10-27", "E", bar(100, 103, 110.5, 102.5, 110), [], cfg, { emPct: 12 })!.sources).not.toContain("em_break");
  });

  it("timing from the archived bars: half the move by 10:00 is the opening window", () => {
    expect(timingFromBars([{ min: 570, c: 104 }, { min: 595, c: 107 }, { min: 900, c: 110 }], 103, 110)).toBe("open30");
    expect(timingFromBars([{ min: 570, c: 103.5 }, { min: 595, c: 104 }, { min: 900, c: 110 }], 103, 110)).toBe("day");
    expect(timingFromBars([{ min: 700, c: 108 }], 103, 110)).toBeNull();
    expect(timingFromBars(null, 103, 110)).toBeNull();
  });
});

describe("planned / traded / missed matching", () => {
  const move = { side: "long" as const };
  it("took, against, skipped and missed with the net of the person's trades", () => {
    expect(matchMove(move, { trader: "a", planned: true, trades: [{ side: "long", pnl: 120, fees: 2, result: "win" }, { side: "long", pnl: -30, fees: 1, result: "loss" }] }))
      .toEqual({ trader: "a", status: "took", planned: true, n: 2, wins: 1, losses: 1, net: 87 });
    expect(matchMove(move, { trader: "b", planned: false, trades: [{ side: "short", pnl: -50, fees: 1, result: "loss" }] }))
      .toMatchObject({ status: "against", net: -51 });
    expect(matchMove(move, { trader: "c", planned: true, trades: [] })).toMatchObject({ status: "skipped", n: 0, net: null });
    expect(matchMove(move, { trader: "d", planned: false, trades: [] })).toMatchObject({ status: "missed", net: null });
  });

  it("the debrief keeps every took / against / skipped line and only the biggest missed", () => {
    const mv = (ticker: string, movePct: number) => ({ ticker, movePct, kind: "session", side: "long", family: "flat_long", timing: "day", sources: [] }) as unknown as EasyMove;
    const row = (status: MatchRow["status"]): MatchRow => ({ trader: "a", status, planned: status === "skipped", n: 0, wins: 0, losses: 0, net: null });
    const moves = [mv("M1", 9), mv("M2", 8), mv("T", 5), mv("S", 4), mv("M3", 12)];
    const rows = new Map<string, MatchRow>([["M1", row("missed")], ["M2", row("missed")], ["T", row("took")], ["S", row("skipped")], ["M3", row("missed")]]);
    expect(personalLines(moves, rows, 2).map((l) => `${l.status}:${l.ticker}`)).toEqual(["took:T", "skipped:S", "missed:M3", "missed:M1"]);
    expect(personalLines(moves, rows, 0).map((l) => l.ticker)).toEqual(["T", "S"]);
  });
});
