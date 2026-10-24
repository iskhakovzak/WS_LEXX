/** /chart-lab: the decision drill maths, the overlay rows, the pickers, notes on drawings and the fill-step keys. */
import { describe, expect, it } from "vitest";
import type { Bar, Fill } from "@/components/chart-engine/types";
import { fromApiDrawing, makeDrawing, notesOf, toApiDrawing } from "@/components/chart-engine/lib/drawings";
import { replayKeyAction } from "@/components/chart-engine/lib/replay-clock";
import { inPosition, outcomeAt, verdictOf } from "./decision";
import { checkpoint, overlayRows } from "./OverlayView";
import { decodePick, defaultPick, encodePick } from "./LabPicker";
import type { OverlayResponse } from "./api";

const bars: Bar[] = [10, 10.2, 10.5, 10.1, 9.8, 10.6].map((c, i) => ({ t: 1_000_000 + i * 60, o: c, h: c + 0.05, l: c - 0.05, c, v: 100, n: 1 }));
const fill = (p: Partial<Fill> & { idx: number; price: number; kind: Fill["kind"] }): Fill => ({
  id: p.idx, qty: 100, time: null, byPrice: false, label: "", role: "entry" as Fill["role"], inferred: false, pieces: 1, leg: null, ...p,
});
const fills = [fill({ idx: 1, price: 10.2, kind: "entry" }), fill({ idx: 5, price: 10.6, kind: "exit" })];

describe("decision drill", () => {
  it("in position only between the entry and the exit", () => {
    expect(inPosition(fills, 0, "long", bars, 100)).toBe(false);
    expect(inPosition(fills, 3, "long", bars, 100)).toBe(true);
  });
  it("«выйти сейчас» = the open position closed at the frozen bar; «держать» = the real result", () => {
    const o = outcomeAt(fills, 4, "long", bars, 100); // close 9.8 vs entry 10.2: −$40; real exit 10.6: +$40
    expect(o).toEqual({ exitNow: -40, hold: 40, unit: "usd" });
    expect(verdictOf("exit", o)).toEqual({ choice: "exit", mine: -40, other: 40, diff: -80, better: false });
    expect(verdictOf("hold", o)).toMatchObject({ diff: 80, better: true });
    // A short is mirrored.
    const s = outcomeAt(fills, 4, "short", bars, 100);
    expect(s).toEqual({ exitNow: 40, hold: -40, unit: "usd" });
  });
  it("without sizes the comparison is per share on the average entry", () => {
    const noQty = fills.map((f) => ({ ...f, qty: null }));
    const o = outcomeAt(noQty, 2, "long", bars, null);
    expect(o.unit).toBe("perShare");
    expect(o.exitNow).toBe(0.3);
    expect(o.hold).toBe(0.4);
    expect(verdictOf("exit", { exitNow: 1, hold: 1, unit: "usd" }).better).toBeNull();
  });
});

describe("overlay rows", () => {
  const o: OverlayResponse = {
    trader: "T", setup: "ORB", ticker: null, total: 2, withRisk: 2, unit: "pct", minutes: [-1, 0, 1, 5],
    paths: [{ id: 1, values: [-0.1, 0, 0.5, 1], win: true }, { id: 2, values: [0.1, 0, -0.5, null], win: false }],
    mean: [0, 0, 0, 1], p25: [null, 0, -0.5, 1], p75: [null, 0, 0.5, 1], p10: [null, 0, -0.5, 1], p90: [null, 0, 0.5, 1],
    mfe: { p25: [null, 0, 0, 1], p50: [null, 0, 0.25, 1], p75: [null, 0, 0.5, 1] }, mae: { p25: [null, 0, -0.5, 0], p50: [null, 0, -0.25, 0], p75: [null, 0, 0, 0] },
    n: [2, 2, 2, 1], missing: 0, trades: 2,
  };
  it("one row per minute, the clouds as ranges, the paths as p0…pN", () => {
    const rows = overlayRows(o);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ m: 1, mean: 0, band: [-0.5, 0.5], p0: 0.5, p1: -0.5 });
    expect(rows[0].band).toBeNull();
    expect(rows[3].p1).toBeNull();
  });
  it("checkpoints read a minute; a minute outside the window is empty", () => {
    expect(checkpoint(o, 5)).toEqual({ mean: 1, mfe: 1, mae: 0, n: 1 });
    expect(checkpoint(o, 60)).toEqual({ mean: null, mfe: null, mae: null, n: 0 });
  });
});

describe("pickers and notes", () => {
  it("encode / decode a setup or ticker pick; the prefill is the most traded setup", () => {
    expect(decodePick(encodePick({ kind: "setup", name: "ORB: break" }))).toEqual({ kind: "setup", name: "ORB: break" });
    expect(decodePick(encodePick(null))).toBeNull();
    expect(decodePick("bogus:x")).toBeNull();
    expect(defaultPick({ trader: "T", setups: [], tickers: [{ name: "AAPL", n: 3 }] })).toEqual({ kind: "ticker", name: "AAPL" });
    // A setup with 2 trades says little: the most traded ticker is the prefill; a real setup wins.
    expect(defaultPick({ trader: "T", setups: [{ name: "Gap", n: 2 }], tickers: [{ name: "NVDA", n: 38 }] })).toEqual({ kind: "ticker", name: "NVDA" });
    expect(defaultPick({ trader: "T", setups: [{ name: "Gap", n: 12 }], tickers: [{ name: "NVDA", n: 38 }] })).toEqual({ kind: "setup", name: "Gap" });
  });
  it("a drawing made on a trade keeps its id through the API; notes of the trade come first", () => {
    const d = { ...makeDrawing("hline", [{ time: 1, price: 10 }], "up", 77), label: "seller here" };
    const back = fromApiDrawing(toApiDrawing(d));
    expect(back?.tradeId).toBe(77);
    expect(back?.label).toBe("seller here");
    expect(makeDrawing("hline", [{ time: 1, price: 10 }]).tradeId).toBeUndefined();
    const other = { ...makeDrawing("hline", [{ time: 1, price: 11 }]), label: "old level", createdAt: 5 };
    const bare = makeDrawing("hline", [{ time: 1, price: 12 }]);
    expect(notesOf([other, bare, d], 77).map((x) => x.label)).toEqual(["seller here", "old level"]);
  });
  it("B / Shift+N step to the previous fill, N to the next", () => {
    expect(replayKeyAction("b", "KeyB", false)).toEqual({ kind: "prevFill" });
    expect(replayKeyAction("N", "KeyN", true)).toEqual({ kind: "prevFill" });
    expect(replayKeyAction("n", "KeyN", false)).toEqual({ kind: "nextFill" });
  });
});
