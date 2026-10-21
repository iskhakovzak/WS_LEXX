/**
 * Staff /stats on server aggregates (Волна 2 п. 2.5): the snapshot that api-server lib/stats/aggregate.ts builds for a
 * fixture book (api-server src/lib/__tests__/fixtures/stats-aggregate-*.json, kept in sync by its own test) gives the
 * SAME cards, days, breakdowns and fee numbers as this page's trade-based maths over the same trades.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import {
  computeKpis, dailySeries, feeStats, groupBy, horizonOf, isClosed, monthlySeries, sessionKey, sessionLabel, valueOf, type Metric,
} from "./metrics";
import { EVENT_LABEL } from "@/components/trades/trade-utils";
import {
  dailyEquity, daysOf, extremesOf, feesOf, groupStat, groupsOf, heatOf, kpisFromAggregate, monthlyOf, type StatsAggregate,
} from "./aggregate";

const FIX = path.resolve(__dirname, "../../../../api-server/src/lib/__tests__/fixtures");
const trades = JSON.parse(fs.readFileSync(path.join(FIX, "stats-aggregate-trades.json"), "utf8")) as Trade[];
const agg = { scope: "desk", trader: null, from: null, to: null, money: true, ...JSON.parse(fs.readFileSync(path.join(FIX, "stats-aggregate-expected.json"), "utf8")) } as StatsAggregate;
const METRICS: Metric[] = ["r", "usd", "net"];

const close = (a: unknown, b: unknown) => {
  if (typeof a === "number" && typeof b === "number") return expect(a).toBeCloseTo(b, 6);
  return expect(a).toEqual(b);
};

describe("kpisFromAggregate === computeKpis over the same trades", () => {
  for (const m of METRICS) {
    it(`metric ${m}`, () => {
      const want = computeKpis(trades, m);
      const got = kpisFromAggregate(agg, m);
      for (const k of Object.keys(want) as (keyof typeof want)[]) close(got[k], want[k]);
    });
  }
});

describe("days, equity, months", () => {
  for (const m of METRICS) {
    it(`metric ${m}`, () => {
      const want = dailySeries(trades, m).map(({ trades: _t, ...d }) => d);
      const got = daysOf(agg, m).map(({ trades: _t, ...d }) => d);
      expect(got.map((d) => d.key)).toEqual(want.map((d) => d.key));
      got.forEach((d, i) => { expect(d.count).toBe(want[i]!.count); close(d.value, want[i]!.value); });
      const months = monthlyOf(agg, m);
      monthlySeries(trades, m).forEach((x, i) => { expect(months[i]!.month).toBe(x.month); close(months[i]!.value, x.value); expect(months[i]!.count).toBe(x.count); });
      const eq = dailyEquity(daysOf(agg, m));
      const last = want.filter((d) => d.value != null).reduce((s, d) => s + d.value!, 0);
      if (eq.length) close(eq.at(-1)!.equity, last);
    });
  }
});

describe("breakdowns", () => {
  const setupKey = (t: Trade) => t.setup || (t.eventType ? EVENT_LABEL[t.eventType] ?? t.eventType : null);
  const cases: [Parameters<typeof groupsOf>[1], (t: Trade) => string | null | undefined][] = [
    ["trader", (t) => t.trader],
    ["setup", setupKey],
    ["ticker", (t) => t.ticker?.toUpperCase()],
    ["session", (t) => sessionLabel(sessionKey(t))],
    ["conviction", (t) => (t.conviction != null ? `${t.conviction}★` : null)],
    ["horizon", (t) => horizonOf(t)],
  ];
  for (const [dim, keyFn] of cases) {
    it(dim, () => {
      for (const m of METRICS) {
        const want = new Map(groupBy(trades, keyFn, m).map((g) => [g.key, g]));
        const got = groupsOf(agg, dim, m);
        expect(got.length).toBe(want.size);
        for (const g of got) {
          const w = want.get(g.key)!;
          expect(w, `${dim}:${g.key}`).toBeDefined();
          for (const k of Object.keys(w) as (keyof typeof w)[]) close(g[k], w[k]);
        }
      }
    });
  }
  it("horizonAll rows are horizon groups", () => {
    const want = groupBy(trades, (t) => horizonOf(t), "net");
    const got = (agg.horizonAll ?? []).map((g) => groupStat(g.key, g.b, "net"));
    expect(got.map((g) => g.key).sort()).toEqual(want.map((g) => g.key).sort());
  });
});

describe("fees, heat cells, extremes", () => {
  it("fee stats", () => {
    const f = feesOf(agg);
    const want = feeStats(trades);
    for (const k of Object.keys(want) as (keyof typeof want)[]) close(f.fees[k], want[k]);
    expect(f.closed).toBe(trades.filter(isClosed).length);
  });
  it("heat cells add up to every trade", () => {
    const cells = [...heatOf(agg, "net").values()];
    expect(cells.reduce((s, c) => s + c.n, 0)).toBe(trades.length);
  });
  it("extremes: best / worst trades per metric", () => {
    for (const m of METRICS) {
      const valued = trades.filter((t) => isClosed(t) && valueOf(t, m) != null);
      const best = valued.filter((t) => valueOf(t, m)! > 0).sort((a, b) => valueOf(b, m)! - valueOf(a, m)!).slice(0, 5);
      const got = extremesOf(agg, m);
      expect(got.best.map((t) => valueOf(t, m))).toEqual(best.map((t) => valueOf(t, m)));
    }
  });
});
