/** «Почему» (lib/whatIfWhy), «Набор правил» (lib/whatIfCombo) and «Мои правила в деле» (lib/whatIfMyRules). */
import { afterEach, describe, expect, it } from "vitest";
import { runScenario, type Rule, type SimTrade } from "../whatIf";
import { whyOf, whyOfRules, withWhy } from "../whatIfWhy";
import { comboCount, findCombos, normaliseSet, subsets, warningOf } from "../whatIfCombo";
import { catalogTime, catalogueRule, ruleInAction, rulesInAction, MIN_SIDE_DAYS } from "../whatIfMyRules";
import { registerRuleTrialSource, trialRules } from "../whatIfRuleTrials";
import { dayList, mixedTrades, mk } from "./whatIfFixtures";
import { mulberry32, round2 } from "../whatIfTypes";

describe("«Почему»: the effect decomposes exactly into trades and days", () => {
  it("Σ contributions = Σ day differences = Δ (to rounding), also for a set that changes and then removes a trade", () => {
    const trades = mixedTrades({ traders: 1, days: 40, perDay: 6, seed: 12 });
    const sets: Rule[][] = [
      [{ type: "dailyLossLimit", usd: 60 }],
      [{ type: "maxSizeRel", x: 1.2 }, { type: "capLoss", usd: 30 }, { type: "maxTradesPerDay", n: 3 }],
      [{ type: "afterWin", minutes: 10 }, { type: "excludeSide", side: "short" }],
    ];
    for (const rules of sets) {
      const r = runScenario(trades, rules, { bootstrap: false });
      const w = whyOf(r, 10_000);
      const delta = round2(r.scenario.net - r.baseline.net);
      expect(Math.abs(w.total - delta)).toBeLessThanOrEqual(0.01);
      const sumTrades = w.topTrades.reduce((s, t) => s + t.contribution, 0);
      expect(Math.abs(sumTrades - delta)).toBeLessThanOrEqual(0.005 * (r.excluded.length + r.changed.length) + 0.01);
      expect(w.topDays.reduce((s, d) => s + d.delta, 0)).toBeCloseTo(w.total, 1);
    }
  });

  it("the top trades / days and the share of the best day — a rule carried by one lucky day shows as such", () => {
    const d = dayList(3);
    const trades = [
      mk({ day: d[0], gross: -100, ticker: "BAD" }), mk({ day: d[0], gross: 5 }),
      mk({ day: d[1], gross: -10, ticker: "BAD" }), mk({ day: d[1], gross: 7 }),
      mk({ day: d[2], gross: -10, ticker: "BAD" }), mk({ day: d[2], gross: 3 }),
    ];
    const w = whyOfRules(trades, [{ type: "excludeTickers", tickers: ["BAD"] }]);
    expect(w.total).toBe(120);
    expect(w.topTrades.map((t) => [t.ticker, t.contribution, t.kind])).toEqual([["BAD", 100, "removed"], ["BAD", 10, "removed"], ["BAD", 10, "removed"]]);
    expect(w.topDays[0]).toEqual({ day: d[0], delta: 100 });
    expect(w.topDayShare).toBe(0.83);
    expect(w.top3Share).toBe(1);
    expect(w.withoutTopDay).toBe(20);
    expect(w.days).toBe(3);
  });

  it("a rule that costs money sorts its most harmful trades first and has no share", () => {
    const trades = [mk({ gross: 50, side: "short" }), mk({ gross: 20, side: "short" }), mk({ gross: -5, side: "long" })];
    const w = whyOfRules(trades, [{ type: "excludeSide", side: "short" }]);
    expect(w.total).toBe(-70);
    expect(w.topTrades[0].contribution).toBe(-50);
    expect(w.topDayShare).toBeNull();
  });

  it("withWhy adds one decomposition per card and leaves an empty body alone", () => {
    const trades = [mk({ gross: -40, ticker: "X" }), mk({ gross: 10 })];
    const body = withWhy({ suggestions: [{ rule: { type: "excludeTickers", tickers: ["X"] } as Rule }] }, trades);
    expect((body.suggestions[0] as { why?: { total: number } }).why?.total).toBe(40);
    const none = { suggestions: [] };
    expect(withWhy(none, trades)).toBe(none);
  });
});

describe("«Набор»: counting the sets searched", () => {
  it("subsets and the count of pairs + triples", () => {
    expect(subsets(4, 2)).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    expect(subsets(6, 3)).toHaveLength(20);
    expect(comboCount(6)).toBe(35);
    expect(comboCount(3)).toBe(4);
    expect(comboCount(1)).toBe(0);
  });

  it("one rule per type, at most three", () => {
    const set = normaliseSet([
      { type: "maxTradesPerDay", n: 3 }, { type: "maxTradesPerDay", n: 5 }, { type: "afterLoss", minutes: 5 },
      { type: "excludeSide", side: "long" }, { type: "afterWin", minutes: 5 },
    ]);
    expect(set.map((r) => r.type)).toEqual(["maxTradesPerDay", "afterLoss", "excludeSide"]);
    expect(set[0]).toEqual({ type: "maxTradesPerDay", n: 3 });
  });

  it("the correction counts every single rule tried and every set built; a new own set adds one, a searched one adds none", () => {
    const rnd = mulberry32(5);
    // Losing late trades and a losing ticker: something to combine.
    const trades: SimTrade[] = mixedTrades({ traders: 1, days: 70, perDay: 6, seed: 31 }).map((t) => {
      const late = (t.entryMin ?? 0) > 900 ? -25 : 0;
      const bad = rnd() < 0.08 ? -30 : 0;
      return { ...t, gross: round2((t.gross ?? 0) + late + bad), ticker: bad ? "BAD" : t.ticker };
    });
    const res = findCombos(trades, { iters: 200 });
    expect(res.searched).toBe(comboCount(res.blocks.length));
    expect(res.family).toBe(res.singles + res.searched);
    expect(res.blocks.length).toBeGreaterThanOrEqual(2);
    expect(res.holdout).toBe(true);
    for (const c of res.combos) {
      expect(c.rules.length).toBeGreaterThanOrEqual(2);
      expect(c.gates && c.beatsBest).toBe(true);
      // The set's Δ is the scenario's own number, not the sum of the singles.
      const r = runScenario(trades, c.rules, { bootstrap: false });
      expect(c.delta).toBeCloseTo(r.scenario.net - r.baseline.net, 1);
      expect(c.interaction).toBeCloseTo(c.delta - c.sumSingles, 1);
      for (const [i, m] of c.marginal.entries()) {
        const without = runScenario(trades, c.rules.filter((_, j) => j !== i), { bootstrap: false });
        expect(m).toBeCloseTo(c.delta - (without.scenario.net - without.baseline.net), 1);
      }
    }
    const own: Rule[] = [{ type: "capLoss", usd: 25 }, { type: "excludeSide", side: "long" }];
    const withOwn = findCombos(trades, { iters: 200, own });
    expect(withOwn.family).toBe(res.family + 1);
    expect(withOwn.own?.rules).toEqual(own);
    if (res.combos[0]) {
      const again = findCombos(trades, { iters: 200, own: [...res.combos[0].rules].reverse() });
      expect(again.family).toBe(res.family);
      expect(again.own?.delta).toBe(res.combos[0].delta);
    }
  });

  it("under 30 days nothing is robust (no later days to check the picked blocks on)", () => {
    const res = findCombos(mixedTrades({ traders: 1, days: 20, perDay: 8, seed: 2 }), { iters: 100 });
    expect(res.holdout).toBe(false);
    expect(res.combos.every((c) => !c.robust)).toBe(true);
  });

  it("interaction verdicts", () => {
    expect(warningOf(100, [80, 60], [40, 20])).toBe("overlap");
    expect(warningOf(150, [80, 60], [90, 70])).toBeNull();
    expect(warningOf(200, [80, 60], [140, 120])).toBe("synergy");
    expect(warningOf(80, [80, 60], [20, 0])).toBe("redundant");
    expect(warningOf(80, [80], [80])).toBeNull();
  });
});

describe("«Мои правила в деле»", () => {
  afterEach(() => registerRuleTrialSource(null));

  it("catalogue kinds → what-if twins; the rest are not modelled", () => {
    expect(catalogueRule("max_trades_per_day", { n: 5 })).toEqual({ rule: { type: "maxTradesPerDay", n: 5 }, estimate: false });
    expect(catalogueRule("max_consecutive_losses", { n: "3" })?.rule).toEqual({ type: "stopAfterLosses", n: 3 });
    expect(catalogueRule("max_trades_per_ticker_day", { n: 2 })?.rule).toEqual({ type: "maxTradesPerTicker", n: 2 });
    expect(catalogueRule("min_pause_after_loss", { min: 10 })?.rule).toEqual({ type: "afterLoss", minutes: 10 });
    expect(catalogueRule("no_trade_first_minutes", { n: 5 })?.rule).toEqual({ type: "timeWindow", from: "09:35" });
    expect(catalogueRule("trading_window", { start: 930, end: 1555 })?.rule).toEqual({ type: "timeWindow", from: "09:30", to: "15:55" });
    expect(catalogueRule("banned_tickers", { tickers: ["aapl", " tsla", "AAPL"] })?.rule).toEqual({ type: "excludeTickers", tickers: ["AAPL", "TSLA"] });
    expect(catalogueRule("max_loss_per_trade_usd", { usd: 100 })).toEqual({ rule: { type: "capLoss", usd: 100 }, estimate: true });
    expect(catalogueRule("max_daily_loss_usd", { usd: null })).toBeNull();
    // «Дневной стоп по лимиту риска»: the $ comes from the trader's risk limits.
    expect(catalogueRule("max_daily_loss_usd", {}, { dailyLossLimit: 300 })?.rule).toEqual({ type: "dailyLossLimit", usd: 300 });
    expect(catalogueRule("max_loss_per_trade_usd", {}, { maxRiskPerTrade: 50 })?.rule).toEqual({ type: "capLoss", usd: 50 });
    for (const k of ["no_overnight", "no_swing", "trade_without_checklist", "no_averaging_down", "self_check", "position_size_pct"]) expect(catalogueRule(k, {})).toBeNull();
    expect(catalogTime(1599)).toBeNull();
    expect(catalogTime(945)).toBe("09:45");
  });

  it("before: the third trade of the day loses; since adoption: kept → no cost, and the closed leak is the estimate", () => {
    const days = dayList(30, "2026-03-02");
    const trades: SimTrade[] = [];
    days.forEach((day, i) => {
      const before = i < 15;
      trades.push(mk({ day, entryMin: 600, gross: 10 }), mk({ day, entryMin: 610, gross: 5 }));
      if (before) trades.push(mk({ day, entryMin: 620, gross: -20 }));
    });
    const r = ruleInAction(trades, { id: "1", name: "Max 2", kind: "max_trades_per_day", threshold: { n: 2 }, since: days[15], source: "catalog" });
    expect(r.status).toBe("ok");
    expect(r.after).toEqual({ days: 15, trades: 30, broke: 0, cost: 0 });
    expect(r.before).toEqual({ days: 15, trades: 45, perDay: 20 });
    expect(r.saved).toBe(300);
  });

  it("breaks since adoption cost money; too few days on a side → early, no estimate", () => {
    const days = dayList(12, "2026-03-02");
    const trades = days.flatMap((day) => [mk({ day, entryMin: 600, gross: 4 }), mk({ day, entryMin: 601, gross: 4 }), mk({ day, entryMin: 602, gross: -9 })]);
    const r = ruleInAction(trades, { id: "2", name: "Max 2", kind: "max_trades_per_day", threshold: { n: 2 }, since: days[8], source: "catalog" });
    expect(r.status).toBe("early");
    expect(r.after?.broke).toBe(4);
    expect(r.after?.cost).toBe(36);
    expect(r.saved).toBeNull();
    expect(MIN_SIDE_DAYS).toBe(10);
  });

  it("not modelled / no adoption day are listed after the modelled ones", () => {
    const list = rulesInAction([mk({ gross: 1 })], [
      { id: "a", name: "Overnight", kind: "no_overnight", threshold: {}, since: "2026-01-01", source: "catalog" },
      { id: "b", name: "Max", kind: "max_trades_per_day", threshold: { n: 1 }, since: null, source: "catalog" },
      { id: "c", name: "Max", kind: "max_trades_per_day", threshold: { n: 1 }, since: "2026-01-01", source: "catalog" },
    ]);
    expect(list.map((x) => [x.id, x.status])).toEqual([["c", "early"], ["b", "noSince"], ["a", "notModelled"]]);
  });

  it("rule trials come in through the adapter (none without a source; a failing source is empty, not an error)", async () => {
    expect(await trialRules("T")).toEqual([]);
    registerRuleTrialSource({ list: async () => [{ id: 7, name: "Trial", kind: "min_pause_after_loss", threshold: { min: 5 }, startedOn: "2026-05-01" }] });
    expect(await trialRules("T")).toEqual([{ id: "trial:7", name: "Trial", kind: "min_pause_after_loss", threshold: { min: 5 }, since: "2026-05-01", source: "trial" }]);
    registerRuleTrialSource({ list: async () => { throw new Error("down"); } });
    expect(await trialRules("T")).toEqual([]);
  });
});
