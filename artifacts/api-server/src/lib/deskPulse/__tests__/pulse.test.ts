/**
 * Desk pulse (lib/deskPulse/pulse): the family × timing aggregation on the shared $ math, the robust-edge verdict, the
 * minimum sample, and the privacy minimums a non-staff viewer gets.
 */
import { describe, expect, it } from "vitest";
import { deskPulse, pulseFor, type PulseTrade } from "../pulse";
import { familyOf } from "../family";

const cfg = { minTrades: 4, minTraders: 3 };
let id = 0;
const tr = (trader: string, family: PulseTrade["family"], timing: PulseTrade["timing"], pnl: number, fees = 1, r: number | null = null): PulseTrade => ({
  id: ++id, trader, family, timing, pnl, fees, result: pnl - fees > 0 ? "win" : pnl - fees < 0 ? "loss" : "be", rMultiple: r,
} as PulseTrade);

describe("setup families", () => {
  it("is the day's gap × the side, null without either", () => {
    expect(familyOf(3.1, "short", 2)).toBe("gap_up_short");
    expect(familyOf(-2, "long", 2)).toBe("gap_down_long");
    expect(familyOf(0.4, "long", 2)).toBe("flat_long");
    expect(familyOf(null, "long", 2)).toBeNull();
    expect(familyOf(5, null, 2)).toBeNull();
  });
});

describe("desk pulse", () => {
  const trades = [
    // gap_up_short · pm: 3 traders, 6 trades — works with the top 3 removed
    tr("a", "gap_up_short", "pm", 101, 1, 1), tr("b", "gap_up_short", "pm", 81, 1, 0.8), tr("c", "gap_up_short", "pm", 61, 1, 0.5),
    tr("a", "gap_up_short", "pm", 41, 1, 0.4), tr("b", "gap_up_short", "pm", 31, 1, 0.3), tr("c", "gap_up_short", "pm", -19, 1, -0.2),
    // gap_up_long · open30: 3 traders, 4 trades, one huge winner — fails without it
    tr("a", "gap_up_long", "open30", 501, 1, 5), tr("b", "gap_up_long", "open30", -99, 1, -1), tr("c", "gap_up_long", "open30", -99, 1, -1),
    tr("a", "gap_up_long", "open30", -99, 1, -1), tr("b", "gap_up_long", "open30", -99, 1, -1),
    // flat_long · day: two people only
    tr("a", "flat_long", "day", 51), tr("b", "flat_long", "day", 51), tr("a", "flat_long", "day", 51), tr("b", "flat_long", "day", 51),
    // no archived day → unclassified
    tr("d", null, "day", 10),
  ];

  it("aggregates by family × timing with the shared win rate, net and the robust edge", () => {
    const p = deskPulse(trades, cfg);
    expect(p.trades).toBe(trades.length);
    expect(p.unclassified).toBe(1);
    const pm = p.cells.find((c) => c.family === "gap_up_short" && c.timing === "pm")!;
    expect(pm).toMatchObject({ n: 6, traders: 3, winrate: 0.8333, net: 290, netExTop3: 50, verdict: "works", thin: null });
    expect(pm.medianR).toBe(0.45);
    const open = p.cells.find((c) => c.family === "gap_up_long")!;
    expect(open.net).toBe(100);
    expect(open.netExTop3).toBe(-400);
    expect(open.outliers).toBe(true);
    expect(open.verdict).toBe("mixed"); // net > 0 on one outlier: not «works», not «fails» either
    expect(p.works).toMatchObject({ family: "gap_up_short", timing: "pm" });
  });

  it("greys out a cell below the minimum sample and never judges it", () => {
    const p = deskPulse(trades, cfg);
    const flat = p.cells.find((c) => c.family === "flat_long")!;
    expect(flat.thin).toBe("people");
    expect(flat.verdict).toBeNull();
    const fewTrades = deskPulse(trades, { minTrades: 10, minTraders: 3 });
    expect(fewTrades.cells.find((c) => c.timing === "pm")!).toMatchObject({ thin: "trades", verdict: null });
    expect(fewTrades.works).toBeNull();
  });

  it("a trader sees no numbers of a cell under three people and never the $ median", () => {
    const staff = deskPulse(trades, cfg);
    const view = pulseFor(staff, false, cfg);
    const flat = view.cells.find((c) => c.family === "flat_long")!;
    expect(flat).toMatchObject({ n: 4, traders: null, winrate: null, net: null, netExTop3: null, median: null, medianR: null, verdict: null });
    const pm = view.cells.find((c) => c.timing === "pm")!;
    expect(pm.median).toBeNull();
    expect(pm.netExTop3).toBe(50);
    // even if the desk lowers the setting, the three-people privacy floor holds
    const two = pulseFor(deskPulse(trades, { minTrades: 1, minTraders: 2 }), false, { minTrades: 1, minTraders: 2 });
    expect(two.cells.find((c) => c.family === "flat_long")!.net).toBeNull();
    expect(pulseFor(staff, true, cfg).cells.find((c) => c.family === "flat_long")!.net).toBe(200);
  });
});
