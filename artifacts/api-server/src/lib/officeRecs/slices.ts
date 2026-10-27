/**
 * Desk-level slice aggregation for «Рекомендации офису» (pure). The slices are the edge map's (lib/edgeMap
 * sliceKeysOf: entry time, after-loss state, trade number in the day, price band, size, rapid entries, day zone …) —
 * every one observable before the entry, computed per trader (no look-ahead), then pooled across the desk.
 *
 * Day clusters: one desk trading day = one cluster (trades of a day share the regime), so every interval below comes
 * from resampling desk days (lib/stats P1), never single trades.
 */
import { sliceKeysOf, type EdgeTrade } from "../edgeMap";
import { rngFor, STATS_SEED } from "../stats";

/** Families a desk recommendation may come from (side / familiarity are descriptive, not something to change). */
export const DESK_FAMILIES = new Set(["time", "session", "state", "zone", "seq", "price", "size", "rapid"]);

export type DayAcc = { net: number; n: number; bps: number; nb: number };

export type SliceAgg = {
  key: string;
  n: number;
  net: number;
  wins: number;
  /** Desk day → sums of the slice's trades that day. */
  days: Map<string, DayAcc>;
  /** Trader → { n, net } inside the slice. */
  traders: Map<string, { n: number; net: number }>;
};

/** The last `lookback` desk trading days (any trade) up to `asOf`, oldest first. */
export function windowDays(trades: readonly { day: string }[], asOf: string, lookback: number): string[] {
  return [...new Set(trades.map((t) => t.day).filter((d) => d <= asOf))].sort().slice(-lookback);
}

/** Every slice of every trade in `trades` (already cut to the window), pooled across traders. */
export function aggregateSlices(trades: readonly EdgeTrade[], families: ReadonlySet<string> = DESK_FAMILIES): Map<string, SliceAgg> {
  const byTrader = new Map<string, EdgeTrade[]>();
  for (const t of trades) {
    const list = byTrader.get(t.trader);
    if (list) list.push(t);
    else byTrader.set(t.trader, [t]);
  }
  const out = new Map<string, SliceAgg>();
  for (const [trader, list] of byTrader) {
    const keys = sliceKeysOf(list);
    list.forEach((t, i) => {
      const bps = t.notional != null && t.notional > 0 ? (1e4 * t.net) / t.notional : null;
      for (const key of keys[i]) {
        if (!families.has(key.slice(0, key.indexOf(":")))) continue;
        let a = out.get(key);
        if (!a) { a = { key, n: 0, net: 0, wins: 0, days: new Map(), traders: new Map() }; out.set(key, a); }
        a.n += 1;
        a.net += t.net;
        if (t.net > 0) a.wins += 1;
        const d = a.days.get(t.day) ?? { net: 0, n: 0, bps: 0, nb: 0 };
        d.net += t.net; d.n += 1;
        if (bps != null) { d.bps += bps; d.nb += 1; }
        a.days.set(t.day, d);
        const tr = a.traders.get(trader) ?? { n: 0, net: 0 };
        tr.n += 1; tr.net += t.net;
        a.traders.set(trader, tr);
      }
    });
  }
  return out;
}

export type Boot = { mean: number; lo80: number; hi80: number; pGe0: number; pLe0: number };

/**
 * Ratio-of-sums day bootstrap: draws D days with replacement and returns Σnum / Σden (mean per trade). `num` / `den`
 * per day; null with < 2 days or no denominator. Seeded per `parts` (the same data gives the same bounds).
 */
export function dayRatioBoot(days: readonly { num: number; den: number }[], parts: readonly (string | number)[], B = 1000): Boot | null {
  const n = days.length;
  const sumDen = days.reduce((s, d) => s + d.den, 0);
  if (n < 2 || sumDen <= 0) return null;
  const point = days.reduce((s, d) => s + d.num, 0) / sumDen;
  const rnd = rngFor(STATS_SEED, ...parts);
  const draws: number[] = [];
  for (let b = 0; b < B; b++) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const d = days[Math.floor(rnd() * n)]; num += d.num; den += d.den; }
    if (den > 0) draws.push(num / den);
  }
  return summarizeDraws(draws, point);
}

/**
 * Difference of two groups' means per trade on the SAME desk days (paired day bootstrap): a − b. Days where one group
 * has no trade still count (its sums are 0 that day).
 */
export function dayDiffBoot(days: readonly { an: number; ad: number; bn: number; bd: number }[], parts: readonly (string | number)[], B = 1000): Boot | null {
  const n = days.length;
  const ad = days.reduce((s, d) => s + d.ad, 0), bd = days.reduce((s, d) => s + d.bd, 0);
  if (n < 2 || ad <= 0 || bd <= 0) return null;
  const point = days.reduce((s, d) => s + d.an, 0) / ad - days.reduce((s, d) => s + d.bn, 0) / bd;
  const rnd = rngFor(STATS_SEED, ...parts);
  const draws: number[] = [];
  for (let k = 0; k < B; k++) {
    let an = 0, a = 0, bn = 0, b = 0;
    for (let i = 0; i < n; i++) { const d = days[Math.floor(rnd() * n)]; an += d.an; a += d.ad; bn += d.bn; b += d.bd; }
    if (a > 0 && b > 0) draws.push(an / a - bn / b);
  }
  return summarizeDraws(draws, point);
}

function summarizeDraws(draws: number[], point: number): Boot | null {
  if (!draws.length) return null;
  draws.sort((x, y) => x - y);
  const q = (p: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.round(p * (draws.length - 1))))];
  let ge = 0, le = 0;
  for (const v of draws) { if (v >= 0) ge++; if (v <= 0) le++; }
  // (k + 1) / (B + 1): a finite bootstrap never claims p = 0 (which BH would pass at any number of slices).
  return { mean: point, lo80: q(0.1), hi80: q(0.9), pGe0: (ge + 1) / (draws.length + 1), pLe0: (le + 1) / (draws.length + 1) };
}

/** Block index (0 = oldest third … blocks−1 = newest) of each window day: the persistence check. */
export function blockIndex(days: readonly string[], blocks = 3): Map<string, number> {
  const m = new Map<string, number>();
  const size = Math.max(1, Math.ceil(days.length / blocks));
  days.forEach((d, i) => m.set(d, Math.min(blocks - 1, Math.floor(i / size))));
  return m;
}

/** Σ net of the slice per block. */
export function blockNets(a: SliceAgg, blockOf: ReadonlyMap<string, number>, blocks = 3): number[] {
  const out = new Array<number>(blocks).fill(0);
  for (const [day, d] of a.days) {
    const b = blockOf.get(day);
    if (b != null) out[b] += d.net;
  }
  return out;
}

/** Base64url JSON of what-if rules (the web's components/shared/what-if-rules encodeRules). */
export function encodeRulesParam(rules: readonly unknown[]): string {
  return Buffer.from(JSON.stringify(rules), "utf8").toString("base64url");
}
