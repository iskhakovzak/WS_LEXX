import { describe, expect, it } from "vitest";
import { imxSql } from "../../lib/imx";
import { imxWindowOf } from "../../lib/tradeStrategy";
import { ruleSchema, rowToSim, simTradesQuery, type SimRow } from "../whatif";

const row = (p: Partial<SimRow>): SimRow => ({
  id: 1, ticker: "aaa", date: "2026-10-01", exit_date: null, side: "Long", qty: "100", entry: "10", exit: "11", stop: null,
  result: "win", pnl: "5", fees: "0.4", r_multiple: null, risk_usd: null, hold_time: null, setup: null, confidence_grade: null,
  tags: null, horizon: null, context_snapshot: null, first_entry: null, last_exit: null, ...p,
});

// Stored mistake spellings (data, as trades.tags keeps them): «Реванш» (an alias of revenge), «FOMO / погоня».
const REVANSH = "Реванш";
const FOMO = "FOMO / погоня";

describe("rowToSim — the new per-trade fields", () => {
  it("trader, IMX, re-entry, usual size and stop", () => {
    // 15:55 ET entry (19:55Z in October, EDT).
    const t = rowToSim(row({ trader: "chert", is_imx: true, first_entry: "2026-10-01T19:55:00Z", reentry_of: 42, size_rel: "2.35", has_stop: false }), 0);
    expect(t).toMatchObject({ trader: "chert", imx: true, reentry: true, sizeRel: 2.35, hasStop: false });
    const u = rowToSim(row({}), 1);
    expect(u).toMatchObject({ trader: null, imx: false, reentry: false, sizeRel: null, hasStop: null });
    expect(rowToSim(row({ size_rel: "0", has_stop: true }), 2)).toMatchObject({ sizeRel: null, hasStop: true });
    expect(rowToSim(row({ size_rel: "-1" }), 2).sizeRel).toBeNull();
  });

  it("mistakes by code from any spelling; personal tags without IMX and the vocabulary", () => {
    const t = rowToSim(row({ tags: `${REVANSH}, IMX, breakout, ${FOMO}, imx, News` }), 0);
    expect(t.mistakes).toEqual(["revenge", "fomo"]);
    expect(t.ptags).toEqual(["breakout", "News"]);
    expect(t.tags).toEqual([REVANSH, "IMX", "breakout", FOMO, "imx", "News"]);
    expect(rowToSim(row({ tags: null }), 0)).toMatchObject({ mistakes: [], ptags: [] });
  });

  it("IMX for the what-if = the stored mark AND an entry inside the IMX window (an auction exit alone is not one)", () => {
    const at = (iso: string | null) => rowToSim(row({ is_imx: true, first_entry: iso }), 0).imx;
    expect(at("2026-10-01T19:50:00Z")).toBe(true); // 15:50, the window start
    expect(at("2026-10-01T20:00:30Z")).toBe(true); // 16:00:30, inside the closing minute
    expect(at("2026-10-01T19:49:59Z")).toBe(false); // 15:49:59
    expect(at("2026-10-01T13:58:00Z")).toBe(false); // 09:58 entry held into the close auction
    expect(at(null)).toBe(false); // no entry time: not known to be an auction entry
    expect(rowToSim(row({ is_imx: false, first_entry: "2026-10-01T19:55:00Z" }), 0).imx).toBe(false);
    // The window follows the desk setting.
    expect(rowToSim(row({ is_imx: true, first_entry: "2026-10-01T19:45:00Z" }), 0, imxWindowOf("15:40", "16:00")).imx).toBe(true);
  });

  it("IMX comes from the SQL alias: the stored mark with the strategy MOC fallback", () => {
    const { sql, params } = simTradesQuery("chert", "2026-01-01");
    expect(imxSql("t")).toBe("COALESCE(t.is_imx, t.strategy = 'MOC', false)");
    expect(sql).toContain(`${imxSql("t")} AS is_imx`);
    expect(sql).toMatch(/t\.trader, .* t\.reentry_of, t\.size_rel, t\.has_stop/);
    expect(params).toEqual(["chert", "2026-01-01"]);
  });
});

describe("ruleSchema — the new rules", () => {
  const ok = (r: unknown) => ruleSchema.safeParse(r).success;
  it("accepts every new rule", () => {
    for (const r of [
      { type: "excludeImx" }, { type: "noReentry" }, { type: "requireStop" }, { type: "maxSizeRel", x: 2 }, { type: "maxSizeRel", x: "1.5" },
      { type: "excludeMistakes", codes: ["fomo", "revenge"] }, { type: "excludeTags", tags: ["breakout", "news"] },
      { type: "profitGiveback", peak: 150, pct: 30 }, { type: "dailyProfitTarget", usd: 300 },
    ]) expect(ok(r), JSON.stringify(r)).toBe(true);
  });
  it("rejects bad values", () => {
    for (const r of [
      { type: "maxSizeRel", x: 0.4 }, { type: "maxSizeRel", x: 11 },
      { type: "excludeMistakes", codes: [] }, { type: "excludeMistakes", codes: ["nope"] }, { type: "excludeMistakes", codes: ["fomo", "fomo"] },
      { type: "excludeTags", tags: [] }, { type: "excludeTags", tags: ["x".repeat(61)] }, { type: "excludeTags", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
      { type: "excludeTags", tags: ["IMX"] }, { type: "excludeTags", tags: [REVANSH] }, { type: "excludeTags", tags: ["fomo / погоня"] },
      { type: "profitGiveback", peak: 0, pct: 30 }, { type: "profitGiveback", peak: 100, pct: 9 }, { type: "profitGiveback", peak: 100, pct: 91 }, { type: "profitGiveback", peak: 100, pct: 33.5 },
      { type: "dailyProfitTarget", usd: 0 },
    ]) expect(ok(r), JSON.stringify(r)).toBe(false);
  });
});
