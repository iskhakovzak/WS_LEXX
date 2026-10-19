/**
 * «Тренажёр 2» intrabar fills: a bracket is checked along the bar path (bull O→L→H→C, bear O→H→L→C), the first level
 * touched fills, a gap open fills at the open; games without cfg.intrabar keep «stop first».
 */
import { describe, expect, it } from "vitest";
import { bracketHit, pathOf, simulate, type SimBar, type SimConfig, type SimEvent } from "../sim/engine";

const bar = (o: number, h: number, l: number, c: number, t = 0): SimBar => ({ t, o, h, l, c, v: 1000 });
const cfg = (intrabar: boolean): SimConfig => ({ startIdx: 0, endIdx: 3, feePerShare: 0, riskUnit: 1, intrabar });

/** Long 100 at 10 on bar 0 with stop 9 / target 11, then `b` on bar 1. */
function longThrough(b: SimBar, intrabar: boolean) {
  const bars = [bar(10, 10, 10, 10), b, bar(10, 10, 10, 10), bar(10, 10, 10, 10)];
  const events: SimEvent[] = [
    { seq: 1, idx: 0, req: 1, type: "order", kind: "buy", qty: 100 },
    { seq: 2, idx: 0, req: 1, type: "bracket", stop: 9, target: 11 },
  ];
  return simulate(bars, cfg(intrabar), events, 3);
}

describe("intrabar path", () => {
  it("bull bar goes O→L→H→C, bear bar O→H→L→C", () => {
    expect(pathOf(bar(10, 12, 9, 11))).toEqual([10, 9, 12, 11]);
    expect(pathOf(bar(10, 12, 9, 9.5))).toEqual([10, 12, 9, 9.5]);
  });

  it("both levels inside a bull bar: the low comes first → the stop fills, marked intrabar", () => {
    const s = longThrough(bar(10, 11.5, 8.5, 11.2), true);
    const exit = s.fills.find((f) => f.reason === "stop" || f.reason === "target")!;
    expect(exit.reason).toBe("stop");
    expect(exit.price).toBe(9);
    expect(exit.intrabar).toBe(true);
    expect(s.trades[0].r).toBe(-1);
  });

  it("both levels inside a bear bar: the high comes first → the target fills", () => {
    const s = longThrough(bar(10, 11.5, 8.5, 8.8), true);
    const exit = s.fills.find((f) => f.reason === "stop" || f.reason === "target")!;
    expect(exit.reason).toBe("target");
    expect(exit.price).toBe(11);
    expect(exit.intrabar).toBe(true);
    expect(s.trades[0].r).toBe(1);
    expect(s.trades[0].mfeR).toBe(1);
  });

  it("a gap open beyond a level fills at the open, not intrabar", () => {
    const s = longThrough(bar(8.6, 9.2, 8.4, 9.1), true);
    const exit = s.fills.find((f) => f.reason === "stop")!;
    expect(exit.price).toBe(8.6);
    expect(exit.intrabar).toBeUndefined();
    const up = longThrough(bar(11.4, 11.6, 11.3, 11.5), true).fills.find((f) => f.reason === "target")!;
    expect(up.price).toBe(11.4);
  });

  it("older games (no cfg.intrabar): both inside one bar → the stop first, no intrabar flag", () => {
    const s = longThrough(bar(10, 11.5, 8.5, 8.8), false);
    const exit = s.fills.find((f) => f.reason === "stop" || f.reason === "target")!;
    expect(exit.reason).toBe("stop");
    expect(exit.intrabar).toBeUndefined();
  });

  it("short side: bull bar → the short's target (below) is reached first", () => {
    expect(bracketHit(bar(10, 11.5, 8.5, 11), false, 11, 9)).toMatchObject({ reason: "target", px: 9, intrabar: true });
    expect(bracketHit(bar(10, 11.5, 8.5, 9), false, 11, 9)).toMatchObject({ reason: "stop", px: 11, intrabar: true });
    expect(bracketHit(bar(10, 10.5, 9.5, 10.2), false, 11, 9)).toBeNull();
  });

  it("only the stop set: a bar that never reaches it does not fill", () => {
    expect(bracketHit(bar(10, 10.8, 9.2, 10.5), true, 9, null)).toBeNull();
    expect(bracketHit(bar(10, 10.8, 8.9, 10.5), true, 9, null)).toMatchObject({ reason: "stop", px: 9 });
  });
});
