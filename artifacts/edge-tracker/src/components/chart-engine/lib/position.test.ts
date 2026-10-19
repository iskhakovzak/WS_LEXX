import { describe, expect, it } from "vitest";
import { positionAt, replayMark } from "./position";
import type { Candle, Fill } from "../types";

const bars: Candle[] = [
  { t: 0, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 1 },
  { t: 300, o: 10.2, h: 11.6, l: 10.1, c: 11.43, v: 1 }, // the 5m bar with the entry: it closed far above the fill
  { t: 600, o: 11.4, h: 11.5, l: 11, c: 11.1, v: 1 },
];
const fill = (idx: number, kind: Fill["kind"], price: number): Fill =>
  ({ id: idx * 10 + (kind === "entry" ? 1 : 2), kind, price, qty: 100, time: null, idx, byPrice: false, label: "", role: "entry", inferred: false, pieces: 1, leg: null }) as unknown as Fill;

describe("replay mark (MAKSIM-20)", () => {
  const fills = [fill(1, "entry", 10.3), fill(2, "exit", 11.2)];
  it("on a bar with a fill the position is marked at the fill, not at the bar close", () => {
    expect(replayMark(bars, fills, 1)).toBe(10.3);
    const at = positionAt(fills, 1, "long", replayMark(bars, fills, 1)!, 100);
    expect(at.unrealized).toBeCloseTo(0);
  });
  it("other bars use the close; out of range is null", () => {
    expect(replayMark(bars, fills, 0)).toBe(10.2);
    expect(replayMark(bars, [fill(1, "entry", 10.3)], 2)).toBe(11.1);
    expect(replayMark(bars, fills, 9)).toBeNull();
  });
});
