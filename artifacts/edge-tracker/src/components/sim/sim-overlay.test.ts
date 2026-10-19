import { describe, it, expect, vi } from "vitest";

// The primitive base pulls lightweight-charts types only; the pure helpers are what is tested here.
vi.mock("@/components/chart-engine/primitives/canvas", () => ({ SeriesPrimitiveBase: class {}, hline: () => {}, label: () => {} }));

const { EMPTY_OVERLAY, mapOverlay, overlayBox } = await import("./sim-overlay");

describe("sim overlay — base indices on a display timeframe", () => {
  it("maps fills, the open trade, the cursor, spans, desk fills and the own marker", () => {
    const d = {
      ...EMPTY_OVERLAY,
      fills: [{ idx: 7, price: 10, qty: 100, reason: "buy" as const }],
      openIdx: 7, cursor: 12,
      spans: [{ from: 7, to: 12, text: "#1" }],
      desk: [{ idx: 3, price: 9.9, side: "in" as const, long: true, own: false, tag: "A" }],
      marker: { idx: 5, text: "entry" },
    };
    const m = mapOverlay(d, (i) => Math.floor(i / 5));
    expect(m.fills[0].idx).toBe(1);
    expect(m.openIdx).toBe(1);
    expect(m.cursor).toBe(2);
    expect(m.spans[0]).toEqual({ from: 1, to: 2, text: "#1" });
    expect(m.desk[0].idx).toBe(0);
    expect(m.marker).toEqual({ idx: 1, text: "entry" });
    expect(d.fills[0].idx).toBe(7); // the input stays as it was
  });

  it("box zones: the open position's, else the flat plan's", () => {
    expect(overlayBox({ ...EMPTY_OVERLAY, pos: 100, avg: 10, stop: 9.5, target: 11 })).toMatchObject({ risk: { from: 10, to: 9.5 }, reward: { from: 10, to: 11 } });
    expect(overlayBox({ ...EMPTY_OVERLAY, last: 20, plan: { price: 19.5, text: "" }, planTarget: { price: 21, text: "" } })).toMatchObject({ dir: 1, risk: { from: 20, to: 19.5 }, reward: { from: 20, to: 21 } });
    expect(overlayBox({ ...EMPTY_OVERLAY, last: 20 })).toBeNull();
  });
});
