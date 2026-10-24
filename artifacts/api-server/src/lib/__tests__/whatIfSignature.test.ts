import { describe, expect, it } from "vitest";
import { tradesSignature } from "../whatIfSignature";
import type { SimTrade } from "../whatIfTypes";
import { mixedTrades, mk } from "./whatIfFixtures";

describe("trades signature", () => {
  const trades = mixedTrades({ traders: 1, days: 30, perDay: 4, seed: 51 });
  const sig = tradesSignature(trades);

  it("40 hex characters, the same for any input order and on every run", () => {
    expect(sig).toMatch(/^[0-9a-f]{40}$/);
    expect(tradesSignature([...trades].reverse())).toBe(sig);
    expect(tradesSignature(trades.map((t) => ({ ...t, mistakes: [...(t.mistakes ?? [])].reverse(), ptags: [...(t.ptags ?? [])].reverse() })))).toBe(sig);
    const one = [mk({ id: 1, gross: 10, day: "2026-01-02", entryMin: 600.123, mistakes: ["fomo"], ptags: ["News"] })];
    expect(tradesSignature(one)).toBe(tradesSignature(one.map((t) => ({ ...t }))));
  });

  it("changes when any engine field changes", () => {
    const edits: ((t: SimTrade) => SimTrade)[] = [
      (t) => ({ ...t, gross: (t.gross ?? 0) + 0.01 }),
      (t) => ({ ...t, fees: t.fees + 0.01 }),
      (t) => ({ ...t, entryMin: (t.entryMin ?? 0) + 1 }),
      (t) => ({ ...t, holdSec: (t.holdSec ?? 0) + 1 }),
      (t) => ({ ...t, day: "2027-01-01" }),
      (t) => ({ ...t, ticker: "ZZZZ" }),
      (t) => ({ ...t, qty: (t.qty ?? 0) + 1 }),
      (t) => ({ ...t, setup: "Other" }),
      (t) => ({ ...t, grade: "C" }),
      (t) => ({ ...t, imx: !t.imx }),
      (t) => ({ ...t, reentry: !t.reentry }),
      (t) => ({ ...t, sizeRel: 9 }),
      (t) => ({ ...t, hasStop: t.hasStop === true ? false : true }),
      (t) => ({ ...t, mistakes: ["revenge", ...(t.mistakes ?? [])] }),
      (t) => ({ ...t, ptags: ["brand-new", ...(t.ptags ?? [])] }),
      (t) => ({ ...t, strategy: t.strategy === "MOC" ? "Day" : "MOC" }),
      (t) => ({ ...t, earnings: t.earnings !== true }),
    ];
    for (const [i, edit] of edits.entries()) {
      expect(tradesSignature(trades.map((t, k) => (k === 7 ? edit(t) : t))), `edit ${i}`).not.toBe(sig);
    }
    expect(tradesSignature(trades.slice(1))).not.toBe(sig);
  });
});
