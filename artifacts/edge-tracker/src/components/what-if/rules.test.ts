import { describe, expect, it } from "vitest";
import {
  type PreviewTrade, type Rule, chipLabel, decodeRules, encodeRules, ifNotPhrase, isApplied, mergeRule, planSummary, previewRule, recomputeFees, removeRule, subtractRule,
} from "./rules";

const mk = (id: number, day: string, entryMin: number, gross: number, extra: Partial<PreviewTrade> = {}): PreviewTrade => ({
  id, day, entryMin, ticker: "AAA", side: "long", qty: 100, entry: 10, gross, fees: 0, holdSec: 60, seq: id, ...extra,
});

const trades: PreviewTrade[] = [
  mk(1, "2026-01-02", 600, -50, { holdSec: 120 }), // loss closes at 602
  mk(2, "2026-01-02", 603, 30), // 1 min after the loss
  mk(3, "2026-01-02", 610, 20, { ticker: "BBB" }), // 8 min after
  mk(4, "2026-01-03", 570, 10, { qty: 500, entry: 3 }),
  mk(5, "2026-01-03", 900, -10, { qty: 50, side: "short", holdSec: 30 }),
];

describe("scenario list", () => {
  it("merges bounds of the same type and replaces the rest", () => {
    let rs: Rule[] = [];
    rs = mergeRule(rs, { type: "timeWindow", from: "09:45", to: null });
    rs = mergeRule(rs, { type: "timeWindow", from: null, to: "15:00" });
    expect(rs).toEqual([{ type: "timeWindow", from: "09:45", to: "15:00" }]);
    rs = mergeRule(rs, { type: "excludeTickers", tickers: ["amd"] });
    rs = mergeRule(rs, { type: "excludeTickers", tickers: ["TSLA", "AMD"] });
    expect(rs[1]).toEqual({ type: "excludeTickers", tickers: ["AMD", "TSLA"] });
    rs = mergeRule(rs, { type: "minHold", seconds: 120 });
    rs = mergeRule(rs, { type: "minHold", seconds: 300 });
    expect(rs.filter((r) => r.type === "minHold")).toEqual([{ type: "minHold", seconds: 300 }]);
  });

  it("subtracts only the part a suggestion added", () => {
    const rs: Rule[] = [{ type: "timeWindow", from: "09:45", to: "15:00" }, { type: "excludeTickers", tickers: ["AMD", "TSLA"] }];
    expect(subtractRule(rs, { type: "timeWindow", to: "15:00" })[0]).toEqual({ type: "timeWindow", from: "09:45", to: null });
    expect(subtractRule(rs, { type: "excludeTickers", tickers: ["AMD"] })[1]).toEqual({ type: "excludeTickers", tickers: ["TSLA"] });
    expect(subtractRule([{ type: "minHold", seconds: 300 }], { type: "minHold", seconds: 300 })).toEqual([]);
    expect(removeRule(rs, "timeWindow")).toHaveLength(1);
  });

  it("knows when a suggestion is already applied", () => {
    const rs: Rule[] = [{ type: "timeWindow", from: "09:45", to: "15:00" }];
    expect(isApplied(rs, { type: "timeWindow", to: "15:00" })).toBe(true);
    expect(isApplied(rs, { type: "timeWindow", to: "14:00" })).toBe(false);
    expect(isApplied([], { type: "afterLoss", minutes: 5 })).toBe(false);
  });

  it("phrases rules in Russian", () => {
    expect(ifNotPhrase({ type: "minHold", seconds: 300 })).toBe("Если бы ты не закрывал сделки быстрее 5 мин");
    expect(ifNotPhrase({ type: "excludeTickers", tickers: ["AMD"] })).toBe("Если бы ты не торговал AMD");
    expect(chipLabel({ type: "sizeRange", max: 200 })).toBe("Без позиций больше 200 акц.");
    expect(chipLabel({ type: "afterLoss", minutes: 10 })).toBe("Пауза 10 мин после убытка");
  });
});

describe("URL state", () => {
  it("round-trips rules, including Cyrillic-free base64url", () => {
    const rs: Rule[] = [{ type: "minHold", seconds: 300 }, { type: "excludeTickers", tickers: ["AMD"] }, { type: "commissionPlan", perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true }];
    const s = encodeRules(rs);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRules(s)).toEqual(rs);
    expect(encodeRules([])).toBe("");
  });

  it("drops garbage instead of throwing", () => {
    expect(decodeRules("%%%")).toEqual([]);
    expect(decodeRules(null)).toEqual([]);
    const bad = encodeRules([{ type: "minHold", seconds: -5 } as Rule, { type: "nope" } as unknown as Rule, { type: "timeWindow", from: "25:99" } as Rule, { type: "dailyLossLimit", usd: 200 }]);
    expect(decodeRules(bad)).toEqual([{ type: "dailyLossLimit", usd: 200 }]);
  });
});

describe("live preview (mirror of the engine)", () => {
  it("counts static exclusions and their net", () => {
    expect(previewRule(trades, { type: "excludeTickers", tickers: ["bbb"] })).toMatchObject({ affected: 1, net: 20, effect: -20, total: 5 });
    expect(previewRule(trades, { type: "timeWindow", from: "09:45" })).toMatchObject({ affected: 1, net: 10 });
    expect(previewRule(trades, { type: "sizeRange", max: 200 })).toMatchObject({ affected: 1, net: 10 });
    expect(previewRule(trades, { type: "excludeSide", side: "short" })).toMatchObject({ affected: 1, net: -10, effect: 10 });
    expect(previewRule(trades, { type: "minHold", seconds: 45 })).toMatchObject({ affected: 1 });
  });

  it("applies the after-loss pause within the day only", () => {
    expect(previewRule(trades, { type: "afterLoss", minutes: 5 })).toMatchObject({ affected: 1, net: 30, effect: -30 });
    expect(previewRule(trades, { type: "afterLoss", minutes: 10 })).toMatchObject({ affected: 2, net: 50 });
  });

  it("stops the day on a loss limit / trade count", () => {
    expect(previewRule(trades, { type: "dailyLossLimit", usd: 40 })).toMatchObject({ affected: 2, net: 50 });
    expect(previewRule(trades, { type: "maxTradesPerDay", n: 1 })).toMatchObject({ affected: 3 });
  });

  it("caps losses as an estimate", () => {
    expect(previewRule(trades, { type: "capLoss", usd: 20 })).toMatchObject({ affected: 1, effect: 30 });
  });
});

describe("fee plans", () => {
  it("uses the server formula (orders from fills, min per order, ECN, regulatory kept)", () => {
    const t = mk(1, "2026-01-02", 600, 5, { qty: 100, fills: 2, fees: 1, feeBreakdown: { comm: 0.6, sec: 0.02, taf: 0.01 } });
    // 2 orders × max(0.5, 0.003×100) = 1.00; ECN 0.002×200 = 0.40; regulatory 0.03
    expect(recomputeFees(t, { perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true })).toBe(1.43);
    expect(recomputeFees(t, { perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: false })).toBe(1.4);
    expect(recomputeFees({ ...t, qty: null }, { perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0 })).toBeNull();
  });

  it("the compact base's regulatory sum gives the same tariff as the breakdown", () => {
    const t = mk(1, "2026-01-02", 600, 5, { qty: 100, fills: 2, fees: 1, regFees: 0.03 });
    expect(recomputeFees(t, { perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: true })).toBe(1.43);
    expect(recomputeFees(t, { perShare: 0.003, minPerOrder: 0.5, ecnPerShare: 0.002, keepRegulatory: false })).toBe(1.4);
  });

  it("summarises the actual fees and the break-even move per share", () => {
    const ts = [mk(1, "d", 1, 10, { fees: 2, qty: 100 }), mk(2, "d", 2, -4, { fees: 1, qty: 200 })];
    const s = planSummary(ts, null);
    expect(s).toMatchObject({ fees: 3, gross: 6, net: 3, shares: 300, trades: 2, breakEvenCents: 1 });
    expect(s.feePctOfGross).toBeCloseTo(0.5);
  });
});

describe("new rules — URL state", () => {
  const all: Rule[] = [
    { type: "excludeImx" }, { type: "noReentry" }, { type: "requireStop" }, { type: "maxSizeRel", x: 2 },
    { type: "excludeMistakes", codes: ["fomo", "revenge"] }, { type: "excludeTags", tags: ["breakout", "news"] },
    { type: "profitGiveback", peak: 150, pct: 30 }, { type: "dailyProfitTarget", usd: 300 },
  ];

  it("round-trips every new rule", () => {
    expect(decodeRules(encodeRules(all))).toEqual(all);
  });

  it("rejects bad values", () => {
    const bad = (r: unknown) => decodeRules(encodeRules([r as Rule]));
    for (const r of [
      { type: "maxSizeRel", x: 0.4 }, { type: "maxSizeRel", x: 10.5 }, { type: "maxSizeRel" },
      { type: "excludeMistakes", codes: [] }, { type: "excludeMistakes", codes: ["nope"] },
      { type: "excludeTags", tags: [] }, { type: "excludeTags", tags: ["IMX", "imx", "Реванш", "FOMO / погоня", "x".repeat(61), "  "] },
      { type: "profitGiveback", peak: 0, pct: 30 }, { type: "profitGiveback", peak: 100, pct: 9 }, { type: "profitGiveback", peak: 100, pct: 91 }, { type: "profitGiveback", peak: 100, pct: 33.5 },
      { type: "dailyProfitTarget", usd: -5 },
    ]) expect(bad(r), JSON.stringify(r)).toEqual([]);
  });

  it("cleans the lists: unique known codes; personal tags trimmed, unique ignoring case, at most 20", () => {
    expect(decodeRules(encodeRules([{ type: "excludeMistakes", codes: ["fomo", "fomo", "nope", "revenge"] } as unknown as Rule]))).toEqual([{ type: "excludeMistakes", codes: ["fomo", "revenge"] }]);
    const tags = [" news ", "News", "IMX", "halt", ...Array.from({ length: 25 }, (_, i) => `t${i}`)];
    const r = decodeRules(encodeRules([{ type: "excludeTags", tags }]))[0];
    expect(r.type === "excludeTags" && r.tags.slice(0, 3)).toEqual(["news", "halt", "t0"]);
    expect(r.type === "excludeTags" && r.tags.length).toBe(20);
  });
});

describe("new rules — scenario list", () => {
  it("merges and subtracts mistake codes", () => {
    let rs = mergeRule([], { type: "excludeMistakes", codes: ["fomo"] });
    rs = mergeRule(rs, { type: "excludeMistakes", codes: ["revenge", "fomo"] });
    expect(rs).toEqual([{ type: "excludeMistakes", codes: ["fomo", "revenge"] }]);
    expect(isApplied(rs, { type: "excludeMistakes", codes: ["revenge"] })).toBe(true);
    expect(subtractRule(rs, { type: "excludeMistakes", codes: ["fomo"] })).toEqual([{ type: "excludeMistakes", codes: ["revenge"] }]);
    expect(subtractRule(rs, { type: "excludeMistakes", codes: ["revenge", "fomo"] })).toEqual([]);
  });

  it("merges and subtracts tags ignoring case", () => {
    let rs = mergeRule([], { type: "excludeTags", tags: ["News"] });
    rs = mergeRule(rs, { type: "excludeTags", tags: ["news", "halt"] });
    expect(rs).toEqual([{ type: "excludeTags", tags: ["News", "halt"] }]);
    expect(isApplied(rs, { type: "excludeTags", tags: ["NEWS"] })).toBe(true);
    expect(subtractRule(rs, { type: "excludeTags", tags: ["news"] })).toEqual([{ type: "excludeTags", tags: ["halt"] }]);
  });

  it("other new rules replace the previous one", () => {
    expect(mergeRule([{ type: "maxSizeRel", x: 2 }], { type: "maxSizeRel", x: 3 })).toEqual([{ type: "maxSizeRel", x: 3 }]);
    expect(mergeRule([{ type: "profitGiveback", peak: 100, pct: 30 }], { type: "profitGiveback", peak: 200, pct: 50 })).toEqual([{ type: "profitGiveback", peak: 200, pct: 50 }]);
  });
});

describe("new rules — phrasing", () => {
  const every: Rule[] = [
    { type: "excludeImx" }, { type: "noReentry" }, { type: "requireStop" }, { type: "maxSizeRel", x: 1.5 },
    { type: "excludeMistakes", codes: ["fomo"] }, { type: "excludeMistakes", codes: ["fomo", "revenge"] }, { type: "excludeMistakes", codes: ["fomo", "revenge", "offPlan"] },
    { type: "excludeTags", tags: ["news"] }, { type: "excludeTags", tags: ["news", "halt"] },
    { type: "profitGiveback", peak: 150, pct: 50 }, { type: "dailyProfitTarget", usd: 300 },
    { type: "timeWindow", from: "09:30" }, { type: "timeWindow", to: "16:00" },
  ];
  it("has a real text (not a key) for every new rule and both special windows", () => {
    for (const r of every) {
      for (const text of [chipLabel(r), ifNotPhrase(r)]) {
        expect(text, JSON.stringify(r)).not.toMatch(/rules\.|\{/);
        expect(text.length).toBeGreaterThan(3);
      }
    }
  });
  it("reads well in Russian", () => {
    expect(chipLabel({ type: "timeWindow", from: "09:30" })).toBe("Без премаркета");
    expect(chipLabel({ type: "timeWindow", from: "09:30", to: "16:00" })).toBe("Входы 09:30–16:00");
    expect(ifNotPhrase({ type: "timeWindow", to: "16:00" })).toBe("Если бы ты не входил после закрытия (16:00)");
    expect(chipLabel({ type: "excludeMistakes", codes: ["fomo"] })).toBe("Без ошибки «FOMO / погоня»");
    expect(chipLabel({ type: "excludeMistakes", codes: ["fomo", "revenge", "offPlan"] })).toBe("Без отмеченных ошибок входа (3)");
    // Exit / outcome marks are not «ошибки входа».
    expect(chipLabel({ type: "excludeMistakes", codes: ["heldLoser", "lateExit", "earlyExit"] })).toBe("Без отмеченных ошибок (3)");
    expect(ifNotPhrase({ type: "excludeMistakes", codes: ["fomo", "revenge", "lateExit"] })).toBe("Если бы ты не брал сделки, где сам отметил ошибку");
    expect(ifNotPhrase({ type: "excludeMistakes", codes: ["fomo", "revenge", "oversize"] })).toBe("Если бы ты не брал сделки, где сам отметил ошибку входа");
    expect(chipLabel({ type: "maxSizeRel", x: 2 })).toBe("Позиция ≤ 2× обычной (оценка)");
    expect(ifNotPhrase({ type: "profitGiveback", peak: 150, pct: 50 })).toBe("Если бы ты останавливался, отдав 50% дневного плюса после +$150");
    expect(chipLabel({ type: "dailyProfitTarget", usd: 300 })).toBe("Стоп дня на +$300");
  });
});

/*
 * Same fixtures and hand-computed numbers as the API engine tests (api-server lib/__tests__/whatIfNewRules.test.ts and
 * whatIfTeamScope.test.ts): the live preview must agree with the server.
 */
describe("new rules — live preview mirrors the engine", () => {
  const day = "2026-10-01";
  it("static exclusions on the flags and marks", () => {
    const ts = [
      mk(1, day, 600, -50, { imx: true, reentry: true, hasStop: false, mistakes: ["fomo"], ptags: ["Breakout"] }),
      mk(2, day, 601, 30, { imx: false, hasStop: null, mistakes: ["revenge", "offPlan"] }),
      mk(3, day, 602, 10, { hasStop: true, ptags: ["news"] }),
    ];
    expect(previewRule(ts, { type: "excludeImx" })).toMatchObject({ affected: 1, net: -50, effect: 50 });
    expect(previewRule(ts, { type: "noReentry" })).toMatchObject({ affected: 1, net: -50 });
    expect(previewRule(ts, { type: "requireStop" })).toMatchObject({ affected: 1, net: -50 });
    expect(previewRule(ts.slice(0, 2), { type: "requireStop" })).toMatchObject({ affected: 0, effect: 0 });
    // Like the engine: needs a stop recorded on ≥ 15% of the trades.
    const stops = (n: number) => Array.from({ length: 20 }, (_, i) => mk(i + 10, day, 600 + i, i % 2 ? 5 : -4, { hasStop: i < n }));
    expect(previewRule(stops(2), { type: "requireStop" })).toMatchObject({ affected: 0 });
    expect(previewRule(stops(3), { type: "requireStop" })).toMatchObject({ affected: 17 });
    expect(previewRule(ts, { type: "excludeMistakes", codes: ["revenge", "fomo"] })).toMatchObject({ affected: 2, net: -20, effect: 20 });
    expect(previewRule(ts, { type: "excludeTags", tags: ["breakout"] })).toMatchObject({ affected: 1, net: -50 });
  });

  it("maxSizeRel: 2× the cap halves gross and fees (−$49 on 98), x× and unknown sizes stay", () => {
    const ts = [mk(1, day, 600, 100, { fees: 2, sizeRel: 4 }), mk(2, day, 601, 50, { fees: 1, sizeRel: 2 }), mk(3, day, 602, 30, { fees: 1, sizeRel: null })];
    expect(previewRule(ts, { type: "maxSizeRel", x: 2 })).toMatchObject({ affected: 1, net: -49, effect: -49, total: 3 });
  });

  it("team scope: one trader's day stop leaves the other trading", () => {
    const ts = [mk(1, day, 600, -100, { trader: "A" }), mk(2, day, 601, 10, { trader: "B" }), mk(3, day, 602, 10, { trader: "A" }), mk(4, day, 603, 20, { trader: "B" })];
    expect(previewRule(ts, { type: "dailyLossLimit", usd: 50 })).toMatchObject({ affected: 1, net: 10, effect: -10 });
    expect(previewRule(ts, { type: "maxTradesPerDay", n: 1 })).toMatchObject({ affected: 2, net: 30 });
  });

  it("giveback and target stop the day inclusively; the crossing trade is kept", () => {
    const gb = [mk(1, day, 600, 100), mk(2, day, 610, -30), mk(3, day, 620, 50), mk(4, day, 630, 5)];
    expect(previewRule(gb, { type: "profitGiveback", peak: 100, pct: 30 })).toMatchObject({ affected: 2, net: 55, effect: -55 });
    const tg = [mk(1, day, 600, 60), mk(2, day, 610, 40), mk(3, day, 620, 20), mk(4, "2026-10-02", 600, 30)];
    expect(previewRule(tg, { type: "dailyProfitTarget", usd: 100 })).toMatchObject({ affected: 1, net: 20, effect: -20 });
  });
});

/* Same fixtures and numbers as the API engine (api-server lib/__tests__/whatIfNewRules.test.ts «no look-ahead»). */
describe("day stops: no look-ahead into trades still open", () => {
  const day = "2026-10-01";
  it("dailyProfitTarget: an entry while the winner is still open is kept", () => {
    const ts = [mk(1, day, 571, 500, { holdSec: 3540 }), mk(2, day, 572, -200, { holdSec: 180 }), mk(3, day, 640, 10)];
    expect(previewRule(ts, { type: "dailyProfitTarget", usd: 300 })).toMatchObject({ affected: 1, net: 10, effect: -10 });
  });
  it("profitGiveback counts the closes in close order", () => {
    const ts = [mk(1, day, 600, 142, { holdSec: 3600 }), mk(2, day, 640, -85, { holdSec: 3000 }), mk(3, day, 670, -136), mk(4, day, 700, 10)];
    expect(previewRule(ts, { type: "profitGiveback", peak: 100, pct: 50 })).toMatchObject({ affected: 1, net: 10 });
  });
  it("dailyLossLimit / stopAfterLosses start at the losing close", () => {
    const dll = [mk(1, day, 600, -150, { holdSec: 1800 }), mk(2, day, 610, 20), mk(3, day, 640, 30)];
    expect(previewRule(dll, { type: "dailyLossLimit", usd: 100 })).toMatchObject({ affected: 1, net: 30 });
    const sal = [mk(1, day, 600, -10, { holdSec: 1800 }), mk(2, day, 605, -5), mk(3, day, 607, 3)];
    expect(previewRule(sal, { type: "stopAfterLosses", n: 1 })).toMatchObject({ affected: 1, net: 3 });
  });
  it("afterLoss runs from the latest losing close", () => {
    const ts = [mk(1, day, 600, -10, { holdSec: 600 }), mk(2, day, 602, -5), mk(3, day, 612, 4)];
    expect(previewRule(ts, { type: "afterLoss", minutes: 5 })).toMatchObject({ affected: 1, net: 4 });
  });
  it("an unknown hold or entry time falls back to the entry order", () => {
    expect(previewRule([mk(1, day, 600, -150, { holdSec: null }), mk(2, day, 601, 20)], { type: "dailyLossLimit", usd: 100 })).toMatchObject({ affected: 1, net: 20 });
    expect(previewRule([mk(1, day, 600, -150, { holdSec: 3600 }), { ...mk(2, day, 0, 20), entryMin: null }], { type: "dailyLossLimit", usd: 100 })).toMatchObject({ affected: 1, net: 20 });
  });
});
