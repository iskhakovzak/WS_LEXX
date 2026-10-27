import { describe, expect, it } from "vitest";
import { describeRule, runScenario, type Rule, type SimTrade } from "../whatIf";
import { candidateEffect, prepare } from "../whatIfSuggest";
import { mk } from "./whatIfFixtures";

const run = (trades: SimTrade[], rules: Rule[]) => runScenario(trades, rules, { bootstrap: false });

describe("excludeImx / noReentry", () => {
  it("removes only the flagged trades", () => {
    const trades = [mk({ gross: -50, imx: true }), mk({ gross: 30, imx: false }), mk({ gross: 10 })];
    const r = run(trades, [{ type: "excludeImx" }]);
    expect(r.excluded.map((e) => [e.id, e.reason, e.detail])).toEqual([[trades[0].id, "excludeImx", "вход на аукционе закрытия (IMX)"]]);
    expect(r.scenario.net).toBe(40);
    expect(r.skipped).toEqual([]);
  });
  it("noReentry removes re-entries only", () => {
    const trades = [mk({ gross: -20, reentry: true }), mk({ gross: 5, reentry: false }), mk({ gross: 7 })];
    const r = run(trades, [{ type: "noReentry" }]);
    expect(r.excluded.map((e) => e.id)).toEqual([trades[0].id]);
    expect(r.excluded[0].reason).toBe("noReentry");
  });
});

describe("requireStop", () => {
  it("drops trades with no stop recorded and keeps unknown ones", () => {
    const trades = [mk({ gross: -20, hasStop: false }), mk({ gross: 5, hasStop: null }), mk({ gross: 10, hasStop: true }), mk({ gross: 1 })];
    const r = run(trades, [{ type: "requireStop" }]);
    expect(r.excluded.map((e) => [e.id, e.detail])).toEqual([[trades[0].id, "стоп не записан"]]);
    expect(r.scenario.trades).toBe(3);
  });
  it("is skipped when no trade has a stop recorded", () => {
    const r = run([mk({ gross: -20, hasStop: false }), mk({ gross: 5, hasStop: null })], [{ type: "requireStop" }]);
    expect(r.skipped[0]).toMatchObject({ rule: "requireStop", reason: "стоп записан меньше чем в 15% сделок" });
    expect(r.excluded).toEqual([]);
  });
  it("needs a stop recorded on ≥ 15% of the trades: one recorded stop does not switch it on for the period", () => {
    // false = «no stop recorded» (lib/tradeFacetDerive hasStopOf), as for 909 of 910 local trades of one trader.
    const of = (withStop: number) => Array.from({ length: 20 }, (_, i) => mk({ gross: i % 2 ? 5 : -4, hasStop: i < withStop }));
    expect(run(of(1), [{ type: "requireStop" }])).toMatchObject({ excluded: [], skipped: [{ rule: "requireStop" }] });
    expect(run(of(2), [{ type: "requireStop" }]).excluded).toEqual([]);
    const on = run(of(3), [{ type: "requireStop" }]);
    expect(on.skipped).toEqual([]);
    expect(on.excluded).toHaveLength(17);
  });
});

describe("maxSizeRel (scale)", () => {
  it("halves gross and fees at 2× the cap, leaves x× and unknown sizes alone", () => {
    const trades = [mk({ gross: 100, fees: 2, sizeRel: 4 }), mk({ gross: 50, fees: 1, sizeRel: 2 }), mk({ gross: 30, fees: 1, sizeRel: null })];
    const r = run(trades, [{ type: "maxSizeRel", x: 2 }]);
    expect(r.changed).toEqual([{ id: trades[0].id, day: "2026-10-01", ticker: "AAA", reason: "maxSizeRel", before: 98, after: 49, detail: "размер 4× → 2×", estimate: true }]);
    expect(r.excluded).toEqual([]);
    expect(r.scenario.gross).toBe(130);
    expect(r.scenario.fees).toBe(3);
    expect(r.scenario.net).toBe(127);
    // Same fixture and number as the web preview (edge-tracker components/what-if/rules.test.ts).
    expect(r.scenario.net - r.baseline.net).toBe(-49);
  });
  it("day rules see the scaled net", () => {
    const trades = [mk({ gross: -200, sizeRel: 4, entryMin: 600 }), mk({ gross: 40, entryMin: 610 })];
    expect(run(trades, [{ type: "dailyLossLimit", usd: 150 }]).excluded.map((e) => e.id)).toEqual([trades[1].id]);
    const scaled = run(trades, [{ type: "maxSizeRel", x: 2 }, { type: "dailyLossLimit", usd: 150 }]);
    expect(scaled.excluded).toEqual([]);
    expect(scaled.scenario.net).toBe(-60);
  });
  it("is skipped when no trade has a usual size", () => {
    const r = run([mk({ gross: 5 })], [{ type: "maxSizeRel", x: 2 }]);
    expect(r.skipped[0]).toMatchObject({ rule: "maxSizeRel" });
    expect(r.changed).toEqual([]);
  });
});

describe("excludeMistakes", () => {
  it("removes a trade carrying any of the codes", () => {
    const trades = [mk({ gross: -30, mistakes: ["fomo"] }), mk({ gross: -10, mistakes: ["offPlan", "revenge"] }), mk({ gross: 20, mistakes: ["lateExit"] }), mk({ gross: 5 })];
    const r = run(trades, [{ type: "excludeMistakes", codes: ["revenge", "fomo"] }]);
    expect(r.excluded.map((e) => [e.id, e.detail])).toEqual([[trades[0].id, "ошибка: FOMO / погоня"], [trades[1].id, "ошибка: Отыгрыш после убытка"]]);
    expect(r.scenario.net).toBe(25);
  });
  it("is skipped on an empty list or when nothing is marked", () => {
    expect(run([mk({ gross: 1, mistakes: ["fomo"] })], [{ type: "excludeMistakes", codes: [] }]).skipped[0]).toMatchObject({ rule: "excludeMistakes", reason: "ошибки не заданы" });
    expect(run([mk({ gross: 1 })], [{ type: "excludeMistakes", codes: ["fomo"] }]).skipped[0]).toMatchObject({ rule: "excludeMistakes", reason: "в сделках не отмечены ошибки" });
  });
});

describe("excludeTags", () => {
  it("matches personal tags case-insensitively", () => {
    const trades = [mk({ gross: -30, ptags: ["Breakout"] }), mk({ gross: 10, ptags: ["news"] }), mk({ gross: 5, ptags: [] })];
    const r = run(trades, [{ type: "excludeTags", tags: ["breakout"] }]);
    expect(r.excluded.map((e) => [e.id, e.detail])).toEqual([[trades[0].id, "тег Breakout"]]);
  });
  it("is skipped without tags or without personal tags on the trades", () => {
    expect(run([mk({ gross: 1, ptags: ["x"] })], [{ type: "excludeTags", tags: [] }]).skipped[0]).toMatchObject({ rule: "excludeTags" });
    expect(run([mk({ gross: 1 })], [{ type: "excludeTags", tags: ["x"] }]).skipped[0]).toMatchObject({ rule: "excludeTags", reason: "в сделках нет личных тегов" });
  });
});

describe("profitGiveback", () => {
  const rule: Rule = { type: "profitGiveback", peak: 100, pct: 30 };
  it("a peak exactly at the threshold arms it; a day exactly at peak·(1−pct) stops; the crossing trade is kept", () => {
    const trades = [mk({ gross: 100, entryMin: 600 }), mk({ gross: -30, entryMin: 610 }), mk({ gross: 50, entryMin: 620 }), mk({ gross: 5, entryMin: 630 })];
    const r = run(trades, [rule]);
    expect(r.keptIds).toEqual([trades[0].id, trades[1].id]);
    expect(r.excluded.map((e) => e.reason)).toEqual(["profitGiveback", "profitGiveback"]);
    expect(r.scenario.net - r.baseline.net).toBe(-55);
    expect(r.excluded[0].detail).toBe("отдал 30% плюса дня (пик +$100)");
  });
  it("does nothing below the peak or above the giveback line", () => {
    expect(run([mk({ gross: 99.99, entryMin: 600 }), mk({ gross: -60, entryMin: 610 }), mk({ gross: 5, entryMin: 620 })], [rule]).excluded).toEqual([]);
    expect(run([mk({ gross: 100, entryMin: 600 }), mk({ gross: -29.99, entryMin: 610 }), mk({ gross: 5, entryMin: 620 })], [rule]).excluded).toEqual([]);
  });
});

describe("dailyProfitTarget", () => {
  it("stops the day once it is exactly up the target", () => {
    const trades = [mk({ gross: 60, entryMin: 600 }), mk({ gross: 40, entryMin: 610 }), mk({ gross: 20, entryMin: 620 }), mk({ gross: 30, day: "2026-10-02" })];
    const r = run(trades, [{ type: "dailyProfitTarget", usd: 100 }]);
    expect(r.excluded.map((e) => [e.id, e.reason, e.detail])).toEqual([[trades[2].id, "dailyProfitTarget", "цель дня +$100 уже взята"]]);
    expect(r.scenario.net - r.baseline.net).toBe(-20);
  });
});

describe("order of the day stops after a kept trade: dailyLossLimit → stopAfterLosses → target → giveback", () => {
  it("the loss limit wins when the same trade also hits the loss run and the giveback", () => {
    const trades = [mk({ gross: 100, entryMin: 600 }), mk({ gross: -160, entryMin: 610 }), mk({ gross: 5, entryMin: 620 })];
    const r = run(trades, [{ type: "profitGiveback", peak: 50, pct: 50 }, { type: "stopAfterLosses", n: 1 }, { type: "dailyLossLimit", usd: 50 }]);
    expect(r.excluded.map((e) => e.reason)).toEqual(["dailyLossLimit"]);
  });
  it("the loss run wins over the giveback", () => {
    const trades = [mk({ gross: 100, entryMin: 600 }), mk({ gross: -60, entryMin: 610 }), mk({ gross: 5, entryMin: 620 })];
    const r = run(trades, [{ type: "profitGiveback", peak: 50, pct: 50 }, { type: "stopAfterLosses", n: 1 }]);
    expect(r.excluded.map((e) => e.reason)).toEqual(["stopAfterLosses"]);
  });
  it("the loss limit wins over the target on a day that also reached it earlier", () => {
    // Target and loss limit cannot both hold on one day net, so the earlier hit decides: the limit stops first here.
    const trades = [mk({ gross: -80, entryMin: 600 }), mk({ gross: 300, entryMin: 610 })];
    const r = run(trades, [{ type: "dailyProfitTarget", usd: 10 }, { type: "dailyLossLimit", usd: 50 }]);
    expect(r.excluded.map((e) => e.reason)).toEqual(["dailyLossLimit"]);
  });
});

describe("describeRule — new rules and the special windows", () => {
  it("has a plain-language label for every new type", () => {
    expect(describeRule({ type: "excludeImx" })).toBe("Без входов на аукционе закрытия (IMX)");
    expect(describeRule({ type: "noReentry" })).toBe("Без перезаходов в ту же бумагу");
    expect(describeRule({ type: "requireStop" })).toBe("Только сделки с записанным стопом");
    expect(describeRule({ type: "maxSizeRel", x: 2 })).toBe("Позиция не больше 2× обычной (оценка)");
    expect(describeRule({ type: "excludeMistakes", codes: ["fomo", "revenge"] })).toBe("Без сделок с ошибками: FOMO / погоня, Отыгрыш после убытка");
    expect(describeRule({ type: "excludeTags", tags: ["news", "halt"] })).toBe("Без тегов: news, halt");
    expect(describeRule({ type: "profitGiveback", peak: 150, pct: 50 })).toBe("Стоп дня, если отдал 50% плюса после +$150");
    expect(describeRule({ type: "dailyProfitTarget", usd: 300 })).toBe("Стоп дня на +$300");
    expect(describeRule({ type: "excludeImx" }, "en")).toBe("No closing-auction (IMX) entries");
  });
  it("names «no pre-market» and «no after-hours» windows", () => {
    expect(describeRule({ type: "timeWindow", from: "09:30" })).toBe("Без премаркета (вход с 09:30 ET)");
    expect(describeRule({ type: "timeWindow", to: "16:00" })).toBe("Без входов после 16:00 ET");
    expect(describeRule({ type: "timeWindow", from: "09:30", to: "16:00" })).toBe("Только 09:30–16:00 ET");
    expect(describeRule({ type: "timeWindow", from: "09:45" })).toBe("Не раньше 09:45 ET");
  });
});

/*
 * Day stops see a kept trade's result only once it has closed (no look-ahead): an entry taken while an earlier trade
 * was still open is decided on what was realised at that moment. Same fixtures and numbers as the web preview
 * (edge-tracker components/what-if/rules.test.ts «no look-ahead»).
 */
describe("day stops: no look-ahead into trades still open", () => {
  const ids = (r: ReturnType<typeof run>) => r.excluded.map((e) => [e.id, e.reason]);
  const parity = (trades: SimTrade[], rule: Rule) => {
    const r = run(trades, [rule]);
    const e = candidateEffect(prepare(trades), rule);
    expect(e.excluded).toBe(r.excluded.length);
    expect(Math.abs(e.delta - (r.scenario.net - r.baseline.net))).toBeLessThan(0.006);
    return r;
  };

  it("dailyProfitTarget: a later entry is not cut by the target an open trade reaches only at its close", () => {
    // A 09:31–10:30 +500; B 09:32–09:35 −200 (entered while A was open: the day was 0); C 10:40 after both closed.
    const ts = [mk({ gross: 500, entryMin: 571, holdSec: 3540 }), mk({ gross: -200, entryMin: 572, holdSec: 180 }), mk({ gross: 10, entryMin: 640 })];
    const r = parity(ts, { type: "dailyProfitTarget", usd: 300 });
    expect(ids(r)).toEqual([[ts[2].id, "dailyProfitTarget"]]);
    expect(r.scenario.net - r.baseline.net).toBe(-10);
  });

  it("profitGiveback: the giveback counts from the closes, in close order", () => {
    // A 10:00–11:00 +142; B 10:40–11:30 −85; C 11:10–11:11 −136 (at 11:10 the day was +142, B still open); D 11:40.
    const ts = [
      mk({ gross: 142, entryMin: 600, holdSec: 3600 }), mk({ gross: -85, entryMin: 640, holdSec: 3000 }),
      mk({ gross: -136, entryMin: 670, holdSec: 60 }), mk({ gross: 10, entryMin: 700 }),
    ];
    const r = parity(ts, { type: "profitGiveback", peak: 100, pct: 50 });
    expect(ids(r)).toEqual([[ts[3].id, "profitGiveback"]]);
    expect(r.excluded[0].detail).toBe("отдал 50% плюса дня (пик +$142)");
  });

  it("dailyLossLimit: an entry while the losing trade is still open is kept; the next one after its close is not", () => {
    const ts = [mk({ gross: -150, entryMin: 600, holdSec: 1800 }), mk({ gross: 20, entryMin: 610 }), mk({ gross: 30, entryMin: 640 })];
    const r = parity(ts, { type: "dailyLossLimit", usd: 100 });
    expect(ids(r)).toEqual([[ts[2].id, "dailyLossLimit"]]);
  });

  it("stopAfterLosses 1: the stop comes from the first loss to CLOSE", () => {
    const ts = [mk({ gross: -10, entryMin: 600, holdSec: 1800 }), mk({ gross: -5, entryMin: 605, holdSec: 60 }), mk({ gross: 3, entryMin: 607 })];
    const r = parity(ts, { type: "stopAfterLosses", n: 1 });
    expect(ids(r)).toEqual([[ts[2].id, "stopAfterLosses"]]);
  });

  it("afterLoss: the pause runs from the latest losing close, not the last losing entry", () => {
    // A loses 10:00–10:10, B loses 10:02–10:03; C at 10:12 is 2 min after A's close.
    const ts = [mk({ gross: -10, entryMin: 600, holdSec: 600 }), mk({ gross: -5, entryMin: 602, holdSec: 60 }), mk({ gross: 4, entryMin: 612 })];
    const r = parity(ts, { type: "afterLoss", minutes: 5 });
    expect(ids(r)).toEqual([[ts[2].id, "afterLoss"]]);
  });

  it("an unknown hold falls back to the entry order (realised at once)", () => {
    const ts = [mk({ gross: -150, entryMin: 600, holdSec: null }), mk({ gross: 20, entryMin: 601 })];
    expect(ids(parity(ts, { type: "dailyLossLimit", usd: 100 }))).toEqual([[ts[1].id, "dailyLossLimit"]]);
    const noTime = [mk({ gross: -150, entryMin: 600, holdSec: 3600 }), mk({ gross: 20, entryMin: null })];
    expect(ids(parity(noTime, { type: "dailyLossLimit", usd: 100 }))).toEqual([[noTime[1].id, "dailyLossLimit"]]);
  });
});
