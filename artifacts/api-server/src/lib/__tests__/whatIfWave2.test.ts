/**
 * Wave-2 rule families of the what-if engine (lib/whatIfPasses): afterWin, redZone, blockWindow, maxTradesPerTicker,
 * noReentryAfterLoss, excludeStrategies, excludeEarnings — behaviour, skip reasons and NO LOOK-AHEAD: a decision about a
 * trade depends only on what was known at its entry (a trade's result counts only from its close).
 */
import { describe, expect, it } from "vitest";
import { describeRule, runScenario, type Rule, type SimTrade } from "../whatIf";
import { candidateEffect, prepare } from "../whatIfSuggest";
import { gridRecipes } from "../whatIfRecipes";
import { mulberry32, round2 } from "../whatIfTypes";
import { mixedTrades, mk } from "./whatIfFixtures";

const run = (trades: SimTrade[], rules: Rule[]) => runScenario(trades, rules, { bootstrap: false, lang: "en" });
const ids = (r: ReturnType<typeof run>) => r.excluded.map((e) => e.id);
/** A trade entered at `entryMin` and closed `hold` minutes later. */
const at = (entryMin: number, gross: number, hold = 1, p: Partial<SimTrade> = {}) => mk({ entryMin, holdSec: hold * 60, gross, ...p });

describe("afterWin: a pause after a WINNING trade", () => {
  it("skips entries inside [close, close + minutes) of a realised win only", () => {
    const win = at(600, 50, 10); // closes 610
    const whileOpen = at(605, -5); // the win is still open: its result is unknown → kept
    const inPause = at(612, -20); // 2 min after the close → skipped
    const later = at(616, 7); // 6 min after → kept
    const r = run([win, whileOpen, inPause, later], [{ type: "afterWin", minutes: 5 }]);
    expect(ids(r)).toEqual([inPause.id]);
    expect(r.excluded[0]).toMatchObject({ reason: "afterWin", detail: "entry 2 min after a winning trade" });
  });
  it("a loss does not start the pause; another trader's win does not either", () => {
    const loss = at(600, -30, 1);
    const other = at(600, 40, 1, { trader: "B" });
    const next = at(602, 5, 1, { trader: "A" });
    const r = run([{ ...loss, trader: "A" }, other, next], [{ type: "afterWin", minutes: 10 }]);
    expect(ids(r)).toEqual([]);
  });
});

describe("redZone: at most k more entries once the realised day is at −usd", () => {
  it("counts entries from the first realised touch of the zone; a recovery does not give them back", () => {
    const before = at(590, 5); // before the zone
    const hit = at(600, -60, 1); // realised at 601: day −55 → in the zone (usd 50)
    const one = at(602, 80, 1); // the one entry allowed (k = 1) → day +25, still no reset
    const two = at(610, 3); // skipped
    const r = run([before, hit, one, two], [{ type: "redZone", usd: 50, k: 1 }]);
    expect(ids(r)).toEqual([two.id]);
    expect(r.excluded[0].reason).toBe("redZone");
  });
  it("a trade still open when the next entry comes does not put the day in the zone yet", () => {
    const hit = at(600, -60, 30); // closes 630
    const a = at(610, 1); // the loss is not realised yet → kept
    const b = at(631, 1); // zone (k = 0) → skipped
    expect(ids(run([hit, a, b], [{ type: "redZone", usd: 50, k: 0 }]))).toEqual([b.id]);
  });
  it("floor stops the day; a floor at or above the start is skipped as a bad zone", () => {
    const t = [at(600, -60, 1), at(602, -100, 1), at(605, 50)];
    const r = run(t, [{ type: "redZone", usd: 50, k: 3, floor: 150 }]);
    expect(ids(r)).toEqual([t[2].id]);
    expect(r.excluded[0].detail).toBe("the day is below −$150");
    expect(run(t, [{ type: "redZone", usd: 50, k: 3, floor: 40 }]).skipped[0]).toMatchObject({ rule: "redZone" });
  });
});

describe("blockWindow", () => {
  it("skips entries inside [from, to) only; unknown entry times stay", () => {
    const t = [at(570, 1), at(574, 2), at(575, 3), mk({ entryMin: null, gross: 4 })];
    const r = run(t, [{ type: "blockWindow", from: "09:30", to: "09:35" }]);
    expect(ids(r)).toEqual([t[0].id, t[1].id]);
    expect(r.excluded[0].detail).toBe("entry 09:30 inside 09:30–09:35");
  });
  it("a reversed or empty window is skipped", () => {
    expect(run([at(600, 1)], [{ type: "blockWindow", from: "10:00", to: "09:00" }]).skipped[0]).toMatchObject({ rule: "blockWindow" });
  });
});

describe("maxTradesPerTicker", () => {
  it("at most n kept entries per ticker per trader-day", () => {
    const t = [at(600, 1), at(601, 2, 1, { ticker: "BBB" }), at(602, 3), at(603, 4, 1, { trader: "Z" }), at(600, 5, 1, { day: "2026-10-02" })];
    const r = run(t, [{ type: "maxTradesPerTicker", n: 1 }]);
    expect(ids(r)).toEqual([t[2].id]);
    expect(r.excluded[0].detail).toBe("already 1 trades in AAA today");
  });
});

describe("noReentryAfterLoss: same ticker, after a realised loss in it", () => {
  it("skips the same ticker inside the pause; other tickers and entries while the loss was open stay", () => {
    const loss = at(600, -40, 10); // AAA closes 610
    const openYet = at(605, 1); // AAA, the loss still open → kept
    const same = at(612, -9); // AAA 2 min after → skipped
    const other = at(612, 3, 1, { ticker: "BBB" }); // kept
    const r = run([loss, openYet, same, other], [{ type: "noReentryAfterLoss", minutes: 15 }]);
    expect(ids(r)).toEqual([same.id]);
    expect(r.excluded[0].detail).toBe("re-entry into AAA 2 min after a loss");
  });
});

describe("excludeStrategies / excludeEarnings", () => {
  it("skip the marked trades; without labels the rule is skipped with a reason", () => {
    const t = [mk({ gross: -5, strategy: "OPG" }), mk({ gross: 4, strategy: "Day" }), mk({ gross: -7, earnings: true }), mk({ gross: 2, earnings: false })];
    expect(ids(run(t, [{ type: "excludeStrategies", strategies: ["OPG", "Print"] }]))).toEqual([t[0].id]);
    expect(ids(run(t, [{ type: "excludeEarnings" }]))).toEqual([t[2].id]);
    const bare = [mk({ gross: 1 })];
    expect(run(bare, [{ type: "excludeStrategies", strategies: ["OPG"] }]).skipped[0].reason).toBe("the trades have no strategy");
    expect(run(bare, [{ type: "excludeEarnings" }]).skipped[0].reason).toBe("none of these trades is in the earnings calendar");
  });
  it("labels in every language", () => {
    const rules: Rule[] = [
      { type: "afterWin", minutes: 5 }, { type: "redZone", usd: 50, k: 2 }, { type: "redZone", usd: 50, k: 2, floor: 120 },
      { type: "blockWindow", from: "11:30", to: "13:30" }, { type: "maxTradesPerTicker", n: 2 }, { type: "noReentryAfterLoss", minutes: 15 },
      { type: "excludeStrategies", strategies: ["OPG"] }, { type: "excludeEarnings" },
    ];
    for (const lang of ["ru", "en", "uz"] as const) {
      for (const r of rules) {
        const s = describeRule(r, lang);
        expect(s.length).toBeGreaterThan(3);
        expect(s).not.toMatch(/\{|rule\./);
      }
    }
  });
});

/*
 * The no-look-ahead property, for every sequential rule: cut the day at a time c; change the RESULT of every trade that
 * closes after c (and add new trades entered after c). No decision about a trade entered at or before c may change —
 * those decisions could only have used results realised by then.
 */
describe("no look-ahead (property over random desks)", () => {
  const sequentialRules: Rule[] = [
    { type: "afterWin", minutes: 10 }, { type: "redZone", usd: 40, k: 1 }, { type: "redZone", usd: 30, k: 2, floor: 90 },
    { type: "maxTradesPerTicker", n: 1 }, { type: "noReentryAfterLoss", minutes: 20 },
  ];
  const staticRules: Rule[] = [
    { type: "blockWindow", from: "09:30", to: "10:00" }, { type: "excludeStrategies", strategies: ["OPG", "MOC"] }, { type: "excludeEarnings" },
  ];
  const close = (t: SimTrade) => (t.entryMin as number) + (t.holdSec as number) / 60;
  for (const rule of [...sequentialRules, ...staticRules]) {
    it(`${rule.type} ${JSON.stringify(rule)}`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const rnd = mulberry32(seed * 101);
        const base = mixedTrades({ traders: 2, days: 6, perDay: 7, seed }).map((t) => ({
          ...t, holdSec: Math.floor(30 + rnd() * 1500), strategy: rnd() < 0.3 ? "OPG" : rnd() < 0.2 ? "MOC" : "Day", earnings: rnd() < 0.2,
        }));
        const cut = 560 + Math.floor(rnd() * 400);
        // Results after the cut change sign and size; trades entered after the cut appear.
        const future = base.map((t) => (close(t) > cut ? { ...t, gross: round2(-(t.gross ?? 0) * 3 + 17) } : t));
        const extra = base.slice(0, 5).map((t, i) => ({ ...t, id: 900_000 + i, seq: 900_000 + i, entryMin: cut + 1 + i, gross: -500 }));
        const decided = (trades: SimTrade[]) => {
          const ex = new Set(ids(run(trades, [rule])));
          return base.filter((t) => (t.entryMin as number) <= cut).map((t) => `${t.id}:${ex.has(t.id)}`);
        };
        expect(decided([...future, ...extra]), `seed ${seed} cut ${cut}`).toEqual(decided(base));
      }
    });
  }
});

describe("grid: wave-2 slots", () => {
  it("are ex-ante, the order claims are `ordering`, and every fitted rule runs", () => {
    const trades = mixedTrades({ traders: 1, days: 60, perDay: 6, seed: 3 }).map((t, i) => ({ ...t, earnings: i % 9 === 0, strategy: i % 7 === 0 ? "OPG" : "Day" }));
    const prep = prepare(trades);
    const { recipes } = gridRecipes(prep.base);
    const wave = recipes.filter((r) => /^(afterWin|redZone|block|mtt|reentryLoss|price\.band|strategy|earnings)/.test(r.id));
    expect(wave).toHaveLength(23);
    for (const r of wave) {
      expect(r.kind).toBe("exante");
      expect(r.ordering).toBe(/^(afterWin|redZone|mtt|reentryLoss)/.test(r.id));
      const rule = r.fit({ pick: new Float64Array(prep.days.length).fill(1), all: new Float64Array(prep.days.length).fill(1), minPick: 10 });
      if (rule) expect(candidateEffect(prep, rule).skipped, r.id).toBe(false);
    }
    // Entry times say «pre-market» here, so the strategy slot stays off (it would be the same rule twice).
    expect(wave.find((r) => r.id === "strategy.premarket")?.fit({ pick: [], all: [], minPick: 10 }) ?? null).toBeNull();
  });
});
