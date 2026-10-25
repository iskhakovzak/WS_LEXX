/**
 * «Рекомендации офису» generators (lib/officeRecs/*) on synthetic desks only — made-up names (Synth-01 …) and numbers.
 *
 *   - leaks: an injected losing time window is found (with its what-if twin), nothing fires on a zero-edge desk across
 *     seeds (BH across every slice tried), nothing on a small sample;
 *   - rules: a revenge habit makes «pause after a loss» win across the desk; a 4-trader desk gets nothing;
 *   - fees, crowding, top practices, curator attention, readiness: thresholds both sides;
 *   - redaction per viewer and «скрыть на неделю».
 */
import { describe, expect, it } from "vitest";
import type { EdgeTrade } from "../edgeMap";
import type { SimTrade } from "../whatIfTypes";
import { randNormal, rngFor } from "../stats";
import { deskLeaks, ruleForSlice, topPractices } from "../officeRecs/leaks";
import { deskRules, signTestP, wilson } from "../officeRecs/rules";
import { deskCrowding, deskFees } from "../officeRecs/fees";
import { curatorAttention, readinessPipeline } from "../officeRecs/people";
import { activeHidden, redactRecs, splitHidden } from "../officeRecs/redact";
import { buildDeskRecs, orderRecs } from "../officeRecs/build";
import { encodeRulesParam } from "../officeRecs/slices";
import type { OfficeRec } from "../officeRecs/types";

const B = 300;

function weekdays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); out.length < n; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

type Spec = {
  traders: number;
  days: number;
  perDay: number;
  seed: number;
  /** Mean net $ of a trade given its entry minute / price / trader / previous trade (the injected structure). */
  mu?: (x: { entryMin: number; price: number; trader: number; afterLossMin: number | null }) => number;
  sigma?: number;
  price?: (r: () => number) => number;
  fees?: (price: number, qty: number) => number;
  ticker?: (r: () => number, day: number, trader: number, k: number) => string;
};

/** A synthetic desk as both SimTrade (what-if) and EdgeTrade (slices). */
function synthDesk(s: Spec): { sim: SimTrade[]; edge: EdgeTrade[]; days: string[] } {
  const days = weekdays("2026-01-05", s.days);
  const sim: SimTrade[] = [];
  let id = 1;
  for (let ti = 0; ti < s.traders; ti++) {
    const name = `Synth-${String(ti + 1).padStart(2, "0")}`;
    const r = rngFor(s.seed, name);
    days.forEach((day, di) => {
      // Entries spread over the regular session (9:31 … 15:55), in time order.
      const minutes = Array.from({ length: s.perDay }, () => 9 * 60 + 31 + Math.floor(r() * 384)).sort((a, b) => a - b);
      let lastClose = null as { at: number; net: number } | null;
      for (let k = 0; k < s.perDay; k++) {
        const minute = minutes[k];
        const price = s.price ? s.price(r) : 10 + r() * 40;
        const qty = 100;
        const afterLossMin: number | null = lastClose && lastClose.net < 0 ? minute - lastClose.at : null;
        const mu: number = s.mu ? s.mu({ entryMin: minute, price, trader: ti, afterLossMin }) : 0;
        const net: number = mu + (s.sigma ?? 40) * randNormal(r);
        const fees = s.fees ? s.fees(price, qty) : 1;
        const hold = 120;
        sim.push({
          id: id++, day, entryMin: minute, ticker: s.ticker ? s.ticker(r, di, ti, k) : `SYN${Math.floor(r() * 50)}`, side: "long", qty, entry: price, exit: price,
          gross: net + fees, fees, holdSec: hold, r: null, stop: null, setup: null, tags: [], horizon: "intraday", result: net > 0 ? "win" : "loss",
          seq: k, trader: name, sizeRel: 1,
        });
        lastClose = { at: minute + hold / 60, net };
      }
    });
  }
  const edge: EdgeTrade[] = sim.map((t) => ({
    trader: t.trader!, day: t.day, entryMin: t.entryMin, exitMin: (t.entryMin ?? 0) + (t.holdSec ?? 0) / 60, seq: t.seq,
    net: (t.gross ?? 0) - t.fees, notional: (t.qty ?? 0) * (t.entry ?? 0), price: t.entry, side: t.side, ticker: t.ticker, sizeRel: 1,
  }));
  return { sim, edge, days };
}

const ctxOf = (days: string[]) => ({ days, from: days[0], to: days[days.length - 1], B });

describe("desk leaks", () => {
  it("finds an injected losing window, with its what-if twin and the traders it affects", () => {
    const d = synthDesk({ traders: 8, days: 90, perDay: 8, seed: 11, mu: ({ entryMin }) => (entryMin >= 13 * 60 + 30 && entryMin < 15 * 60 + 30 ? -14 : 3) });
    const recs = deskLeaks(d.edge, ctxOf(d.days));
    const leak = recs.find((r) => r.id === "leak:time:13:30-15:30");
    expect(leak).toBeTruthy();
    expect(leak!.money!.hi).toBeLessThan(0);
    expect(leak!.basis.q).toBeLessThanOrEqual(0.1);
    expect(leak!.confidence).toBeGreaterThanOrEqual(2);
    expect(leak!.affected.count).toBeGreaterThanOrEqual(5);
    expect(leak!.affected.names.every((n) => n.startsWith("Synth-"))).toBe(true);
    expect(leak!.rel?.unit).toBe("bps");
    expect(leak!.action!.href).toContain(encodeRulesParam([{ type: "blockWindow", from: "13:30", to: "15:30" }]));
  });

  it("stays silent on a zero-edge desk (BH across every slice tried), seed after seed", () => {
    let fired = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const d = synthDesk({ traders: 6, days: 70, perDay: 7, seed });
      fired += deskLeaks(d.edge, ctxOf(d.days)).length;
    }
    expect(fired).toBeLessThanOrEqual(1);
  });

  it("needs a real sample: 15 desk days → nothing, however bad", () => {
    const d = synthDesk({ traders: 8, days: 15, perDay: 8, seed: 3, mu: () => -20 });
    expect(deskLeaks(d.edge, ctxOf(d.days))).toEqual([]);
  });

  it("maps slices to honest what-if twins only", () => {
    expect(ruleForSlice("time:9:30-9:50")).toEqual({ type: "blockWindow", from: "09:30", to: "09:50" });
    expect(ruleForSlice("state:after_loss_10")).toEqual({ type: "afterLoss", minutes: 10 });
    expect(ruleForSlice("seq:6+")).toEqual({ type: "maxTradesPerDay", n: 5 });
    expect(ruleForSlice("price:lt5")).toEqual({ type: "priceRange", min: 5 });
    expect(ruleForSlice("price:10-20")).toBeNull();
    expect(ruleForSlice("rapid:yes")).toBeNull();
  });
});

describe("top practices", () => {
  it("names a window where the top third earns and the rest loses", () => {
    // Traders 0-2 are strong at the open (9:30-9:50 … 10:10) and fine elsewhere; the rest lose at the open.
    const d = synthDesk({
      traders: 9, days: 80, perDay: 6, seed: 5, sigma: 25,
      mu: ({ entryMin, trader }) => (entryMin < 10 * 60 + 10 ? (trader < 3 ? 18 : -8) : trader < 3 ? 4 : 1),
    });
    const recs = topPractices(d.edge, ctxOf(d.days));
    expect(recs.length).toBeGreaterThan(0);
    expect(String(recs[0].params.slice)).toMatch(/^(time|session|seq):/);
    expect(recs[0].money!.lo).toBeGreaterThan(0);
    expect(recs[0].affected.names.every((n) => !["Synth-01", "Synth-02", "Synth-03"].includes(n))).toBe(true);
  });

  it("needs at least 6 traders with 20+ active days", () => {
    const d = synthDesk({ traders: 5, days: 80, perDay: 6, seed: 5, mu: ({ trader }) => (trader < 2 ? 20 : -5) });
    expect(topPractices(d.edge, ctxOf(d.days))).toEqual([]);
  });
});

describe("desk rules (what-if across traders)", () => {
  it("a revenge habit makes «pause after a loss» help most traders", () => {
    const d = synthDesk({ traders: 7, days: 40, perDay: 9, seed: 21, sigma: 20, mu: ({ afterLossMin }) => (afterLossMin != null && afterLossMin < 10 ? -30 : 4) });
    const recs = deskRules(d.sim, { from: d.days[0], to: d.days[d.days.length - 1], iters: 200 });
    const pause = recs.find((r) => r.id === "rule:afterLoss10");
    expect(pause).toBeTruthy();
    expect(Number(pause!.params.helped)).toBeGreaterThanOrEqual(5);
    expect(pause!.money!.mean).toBeGreaterThan(0);
    expect(pause!.rel!.unit).toBe("share");
    expect(pause!.secondary?.href).toBe("/rules");
  });

  it("a desk of 4 traders is too small", () => {
    const d = synthDesk({ traders: 4, days: 40, perDay: 9, seed: 21, mu: ({ afterLossMin }) => (afterLossMin != null && afterLossMin < 10 ? -30 : 4) });
    expect(deskRules(d.sim, { from: d.days[0], to: d.days[d.days.length - 1], iters: 100 })).toEqual([]);
  });

  it("sign test and Wilson interval", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(10, 10)).toBeCloseTo(1 / 1024, 6);
    expect(signTestP(5, 10)).toBeCloseTo(0.623, 3);
    const w = wilson(7, 10);
    expect(w.lo).toBeGreaterThan(0.45);
    expect(w.hi).toBeLessThan(0.88);
  });
});

describe("fees and crowding", () => {
  it("flags a cheap-stock band whose gross does not clear the fees", () => {
    const d = synthDesk({
      traders: 6, days: 40, perDay: 6, seed: 8, sigma: 5,
      price: (r) => (r() < 0.4 ? 2 + r() * 2.5 : 20 + r() * 30),
      mu: ({ price }) => (price < 5 ? -1.5 : 6),
      fees: (price) => (price < 5 ? 2 : 1),
    });
    const recs = deskFees(d.sim, { from: d.days[0], to: d.days[d.days.length - 1], days: d.days.length, B, fee: { minTrades: 30, ratioMin: 1.5 } });
    expect(recs.map((r) => r.id)).toContain("fees:lt5");
    const r = recs.find((x) => x.id === "fees:lt5")!;
    expect(r.confidence).toBeGreaterThanOrEqual(2);
    expect(r.action!.href).toContain(encodeRulesParam([{ type: "priceRange", min: 5 }]));
  });

  it("no fee card when every band clears its fees", () => {
    const d = synthDesk({ traders: 6, days: 40, perDay: 6, seed: 8, sigma: 5, price: (r) => 2 + r() * 2.5, mu: () => 8, fees: () => 1 });
    expect(deskFees(d.sim, { from: d.days[0], to: d.days[d.days.length - 1], days: d.days.length, B, fee: { minTrades: 30, ratioMin: 1.5 } })).toEqual([]);
  });

  it("crowds in one ticker that lose more than the rest are reported; a neutral crowd is not", () => {
    // Every trader's first trade of the day is in the day's hot ticker (a crowd); crowd trades lose.
    const crowd = (bad: boolean) => synthDesk({
      traders: 6, days: 40, perDay: 5, seed: 9, sigma: 15,
      ticker: (r, day, _t, k) => (k === 0 ? `HOT${day}` : `SYN${Math.floor(r() * 400)}`),
      mu: ({ entryMin }) => (bad && entryMin < 10 * 60 + 15 ? -12 : 3),
    });
    const bad = crowd(true);
    const recs = deskCrowding(bad.sim, { from: bad.days[0], to: bad.days[bad.days.length - 1], days: bad.days.length, B });
    expect(recs).toHaveLength(1);
    expect(recs[0].money!.hi).toBeLessThan(0);
    expect(Number(recs[0].params.clusters)).toBeGreaterThanOrEqual(15);
    const ok = synthDesk({ traders: 6, days: 40, perDay: 5, seed: 9, sigma: 15, ticker: (r, day, _t, k) => (k === 0 ? `HOT${day}` : `SYN${Math.floor(r() * 400)}`), mu: () => 3 });
    expect(deskCrowding(ok.sim, { from: ok.days[0], to: ok.days[ok.days.length - 1], days: ok.days.length, B })).toEqual([]);
  });
});

describe("curator attention and readiness (staff)", () => {
  const today = "2026-10-23";
  const active = ["Synth-01", "Synth-02", "Synth-03", "Synth-04"];
  it("thresholds: one stale trader is not a finding, two are", () => {
    const fresh = new Map(active.map((n) => [n, "2026-10-20"]));
    const one = new Map(fresh); one.set("Synth-01", "2026-09-01");
    const none = curatorAttention({ today, active, lastReview: one, lastOneOnOne: fresh, curatorOf: new Map(active.map((n) => [n, "Curator-A"])) }, { from: today, to: today });
    expect(none.find((r) => r.params.sub === "noReview")).toBeUndefined();
    const two = new Map(one); two.delete("Synth-02");
    const recs = curatorAttention({ today, active, lastReview: two, lastOneOnOne: fresh, curatorOf: new Map(active.map((n) => [n, "Curator-A"])) }, { from: today, to: today });
    const r = recs.find((x) => x.params.sub === "noReview")!;
    expect(r.affected.names).toEqual(["Synth-02", "Synth-01"]); // never first, then the oldest
    expect(r.params.never).toBe(1);
    expect(r.audience).toBe("staff");
  });

  it("an overloaded curator and traders without a curator", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Synth-${i + 10}`);
    const fresh = new Map([...many, "Synth-01", "Synth-02"].map((n) => [n, "2026-10-20"]));
    const curatorOf = new Map<string, string | null>([...many.map((n) => [n, "Curator-A"] as [string, string]), ["Synth-01", null], ["Synth-02", null]]);
    const recs = curatorAttention({ today, active: [...many, "Synth-01", "Synth-02"], lastReview: fresh, lastOneOnOne: fresh, curatorOf }, { from: today, to: today });
    expect(recs.find((r) => r.params.sub === "load")?.affected.names).toEqual(["Curator-A"]);
    expect(recs.find((r) => r.params.sub === "noCurator")?.affected.count).toBe(2);
  });

  it("readiness: ready, one criterion away, the common blocker", () => {
    const rows = [
      { user: "Synth-01", stage: "junior", nextStage: "trader", passed: 5, total: 5, ready: true, binding: null },
      { user: "Synth-02", stage: "junior", nextStage: "trader", passed: 4, total: 5, ready: false, binding: "consistency" },
      { user: "Synth-03", stage: "junior", nextStage: "trader", passed: 4, total: 5, ready: false, binding: "consistency" },
      { user: "Synth-04", stage: "junior", nextStage: "trader", passed: 2, total: 5, ready: false, binding: "net" },
      { user: "Synth-05", stage: "senior", nextStage: null, passed: 0, total: 0, ready: false, binding: null },
    ];
    const recs = readinessPipeline(rows, { from: today, to: today });
    expect(recs.find((r) => r.id === "readiness:ready")?.affected.names).toEqual(["Synth-01"]);
    const close = recs.find((r) => r.id === "readiness:close")!;
    expect(close.affected.names).toEqual(["Synth-02", "Synth-03"]);
    expect(close.params.blocker).toBe("consistency");
    expect(close.params.blockerCount).toBe(2);
    expect(readinessPipeline([], { from: today, to: today })).toEqual([]);
  });
});

describe("redaction per viewer and hiding", () => {
  const rec = (over: Partial<OfficeRec>): OfficeRec => ({
    id: "leak:time:15:30-16:00", kind: "leak", audience: "desk", priority: 10, confidence: 2,
    params: { slice: "time:15:30-16:00", medianPerDayUsd: 12 }, money: { mean: -5, lo: -8, hi: -2, per: "trade" },
    rel: { mean: -10, lo: -15, hi: -4, unit: "bps" }, affected: { count: 3, names: ["Synth-01", "Synth-02", "Synth-03"] },
    action: { kind: "whatif", href: "/what-if?trader=__all__&r=abc" }, secondary: { kind: "rules", href: "/rules" },
    basis: { trades: 300, days: 60, traders: 6, from: "2026-05-01", to: "2026-10-23", q: 0.02 }, ...over,
  });
  const recs = [rec({}), rec({ id: "attention:noReview", kind: "attention", audience: "staff", money: null })];

  it("partner: everything", () => {
    const out = redactRecs(recs, { role: "admin", scope: null });
    expect(out).toHaveLength(2);
    expect(out[0].money).not.toBeNull();
    expect(out[0].affected.names).toHaveLength(3);
  });

  it("curator: no $, names only within the scope", () => {
    const out = redactRecs(recs, { role: "curator", scope: ["Synth-02"] });
    expect(out).toHaveLength(2);
    expect(out[0].money).toBeNull();
    expect(out[0].params.medianPerDayUsd).toBeUndefined();
    expect(out[0].affected).toEqual({ count: 3, names: ["Synth-02"] });
    expect(redactRecs(recs, { role: "curator", scope: null })[0].affected.names).toHaveLength(3);
  });

  it("trader: anonymised desk aggregates, no staff kinds, no staff links", () => {
    const out = redactRecs(recs, { role: "trader", scope: ["Synth-01"] });
    expect(out.map((r) => r.kind)).toEqual(["leak"]);
    expect(out[0].money).toBeNull();
    expect(out[0].affected).toEqual({ count: 3, names: [] });
    expect(out[0].secondary).toBeNull();
    expect(out[0].action!.href).toBe("/what-if?r=abc");
    expect(JSON.stringify(out)).not.toContain("Synth-");
  });

  it("«скрыть на неделю»: active entries move to `hidden`, expired ones are ignored", () => {
    const hidden = activeHidden({ "leak:time:15:30-16:00": "2026-10-30", "fees:lt5": "2026-10-01", bogus: 5 }, "2026-10-23");
    expect(hidden).toEqual({ "leak:time:15:30-16:00": "2026-10-30" });
    const s = splitHidden(recs, hidden);
    expect(s.recs.map((r) => r.id)).toEqual(["attention:noReview"]);
    expect(s.hidden).toEqual([{ id: "leak:time:15:30-16:00", until: "2026-10-30", kind: "leak" }]);
  });
});

describe("assembly", () => {
  it("variety first: the first card of every kind before the second of any", () => {
    const mk = (id: string, kind: OfficeRec["kind"], priority: number) => ({ id, kind, priority } as OfficeRec);
    const out = orderRecs([mk("leak:a", "leak", 50), mk("leak:b", "leak", 40), mk("rule:a", "rule", 5), mk("fees:a", "fees", 1)]);
    expect(out.map((r) => r.id)).toEqual(["rule:a", "leak:a", "fees:a", "leak:b"]);
  });

  it("an empty desk builds an empty list", () => {
    const res = buildDeskRecs({ asOf: "2026-10-23", sim: [], edge: [], B });
    expect(res.recs).toEqual([]);
    expect(res.window.days).toBe(0);
  });
});
