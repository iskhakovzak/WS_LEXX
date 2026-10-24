/**
 * Edge map with desk shrinkage (roadmap R4) — pure, seeded, no I/O. The store (lib/edgeMapStore.ts) loads the trades
 * and saves the rows; the nightly job edgemap.nightly runs it; GET /edge/map and «Мой разбор» read the verdicts.
 *
 * Inputs: each trader's closed trades over the last `lookbackDays` desk trading days up to `asOf`. Every slice is
 * observable BEFORE the entry (no outcome-defined slices):
 *
 *   time:<bucket>        entry time, desk TIME_BUCKETS (lib/tradeFacetsSql)
 *   session:pre|rth|ah   premarket (< 09:30) / regular session / after 16:00
 *   state:after_win_10   < 10 min after the day's last closed trade, which was a win; state:after_loss_10 likewise
 *   zone:<z>             realised day net at entry in units u = the trader's median |daily net| of the previous 60
 *                        active days: le_m2 (≤ −2u) | m2_m05 | flat | p05_2 | ge_2 (≥ 2u)
 *   seq:1|2|3|4-5|6+     trade number in the day (seq 1 = «first trade of the day»)
 *   price:<bucket>       desk price bands (lib/tradeFacetBuckets PRICE_BUCKETS)
 *   side:long|short
 *   size:<bucket>        size relative to the trader's 60-day median notional (SIZE_REL_BUCKETS); skipped when unknown
 *   familiar:0|1-3|4-30|gt30   the trader's earlier trades in the ticker
 *   rapid:yes            ≥ 3 entries in the previous 15 minutes
 *
 * Computation (ALGORITHMS P1–P3):
 *   x = 1e4 · net / notional (bps of notional, winsorized at the desk mean ± 5 SD); per trader i and slice s the mean
 *   x̄ and its se from a day-clustered bootstrap (B = 1000, a seeded stream per trader + slice); the desk prior per
 *   slice from traders with n ≥ 30 (method of moments, else μ0 = desk all-trade mean, τ = coach.tauDefaultBps);
 *   θ = w·x̄ + (1 − w)·μ0 with its 80% interval; $ per active day = θ · median notional · n / active days.
 *
 * Verdict: LEAK ⇔ hi80(θ) < 0 ∧ BH q ≤ 0.10 across the trader's eligible slices (one-sided bootstrap p) ∧ negative in
 * ≥ 2 of the last 3 non-overlapping 60-trading-day blocks ∧ cost ≥ coach.leakMinUsdPerDay ∧ n ≥ 30 on ≥ 10 days.
 * STRENGTH is the symmetric case; everything else is NONE (never shown).
 */
import { PRICE_BUCKETS, SIZE_REL_BUCKETS, bucketOf, UNKNOWN } from "./tradeFacetBuckets";
import { timeBucketOf } from "./tradeFacetsSql";
import { STATS_SEED, bhQValues, blocksAgreeing, clusterBootstrapMean, deskPrior, median, rngFor, shrink, winsorBounds, type Prior } from "./stats";

export type EdgeTrade = {
  trader: string;
  /** NY trading day of the entry. */
  day: string;
  /** Minutes since NY midnight of the first entry; null when unknown. */
  entryMin: number | null;
  /** Minutes since NY midnight of the exit on `day`; null when unknown or closed on a later day. */
  exitMin: number | null;
  /** Import order inside the day (ties of the entry time). */
  seq: number;
  /** Net $ (pnl − |fees|). */
  net: number;
  /** qty × entry price ($); trades without it are left out (no bps). */
  notional: number | null;
  price: number | null;
  side: "long" | "short" | null;
  ticker: string;
  /** Notional ÷ the trader's 60-day median notional; null when unknown. */
  sizeRel: number | null;
};

export type Verdict = "LEAK" | "STRENGTH" | "NONE";

export type EdgeMapRow = {
  trader: string;
  asOf: string;
  sliceKey: string;
  family: string;
  n: number;
  days: number;
  /** Σ net $ of the slice's trades. */
  net: number;
  xbarBps: number;
  seBps: number;
  thetaBps: number;
  lo80Bps: number;
  hi80Bps: number;
  /** BH q value of the direction of θ (leak q for θ < 0, strength q otherwise); null when the slice is not eligible. */
  q: number | null;
  /** Of the last 3 non-overlapping 60-day blocks, how many share the sign of θ. */
  persistBlocks: number;
  verdict: Verdict;
  /** θ in $ per active day of the trader, with its 80% interval. */
  costPerDay: number;
  costLo: number;
  costHi: number;
  priorMu: number;
  priorTau: number;
};

export type EdgeMapOptions = {
  asOf: string;
  /** coach.tauDefaultBps — τ of the fallback prior. */
  tauDefaultBps: number;
  /** coach.leakMinUsdPerDay — smallest |$ per active day| a verdict needs. */
  minUsdPerDay: number;
  lookbackDays?: number;
  B?: number;
  seed?: number;
  qMax?: number;
  minN?: number;
  minDays?: number;
  blockDays?: number;
  blocks?: number;
};

export const EDGE_DEFAULTS = { lookbackDays: 250, B: 1000, qMax: 0.1, minN: 30, minDays: 10, blockDays: 60, blocks: 3 } as const;

/** Slice families in display order. */
export const SLICE_FAMILIES = ["time", "session", "state", "zone", "seq", "price", "side", "size", "familiar", "rapid"] as const;

const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;
const AFTER_MIN = 10;
const RAPID_WINDOW = 15;
const RAPID_COUNT = 3;
const ZONE_HISTORY = 60;
const ZONE_MIN_DAYS = 10;

const seqKey = (k: number) => (k <= 3 ? String(k) : k <= 5 ? "4-5" : "6+");
const familiarKey = (prior: number) => (prior === 0 ? "0" : prior <= 3 ? "1-3" : prior <= 30 ? "4-30" : "gt30");

function zoneKey(dayNet: number, u: number): string {
  const z = dayNet / u;
  if (z <= -2) return "le_m2";
  if (z <= -0.5) return "m2_m05";
  if (z < 0.5) return "flat";
  if (z < 2) return "p05_2";
  return "ge_2";
}

/** Slice keys of every trade of ONE trader (input sorted or not), in the input order. Pure, no look-ahead. */
export function sliceKeysOf(trades: readonly EdgeTrade[]): string[][] {
  const idx = trades.map((_, i) => i).sort((a, b) => {
    const x = trades[a], y = trades[b];
    return x.day.localeCompare(y.day) || (x.entryMin ?? Infinity) - (y.entryMin ?? Infinity) || x.seq - y.seq;
  });
  const out: string[][] = new Array(trades.length);
  const tickerCount = new Map<string, number>();
  const dayNets: number[] = []; // |daily net| of finished days, oldest first
  let i = 0;
  while (i < idx.length) {
    const day = trades[idx[i]].day;
    let j = i;
    while (j < idx.length && trades[idx[j]].day === day) j++;
    const hist = dayNets.slice(-ZONE_HISTORY);
    const u = hist.length >= ZONE_MIN_DAYS ? median(hist) : 0;
    const dayIdx = idx.slice(i, j);
    let dayTotal = 0;
    dayIdx.forEach((ti, k) => {
      const t = trades[ti];
      const keys: string[] = [`seq:${seqKey(k + 1)}`];
      const pb = bucketOf(PRICE_BUCKETS, t.price, 0, false);
      if (pb !== UNKNOWN) keys.push(`price:${pb}`);
      if (t.side) keys.push(`side:${t.side}`);
      if (t.sizeRel != null && t.sizeRel > 0) keys.push(`size:${bucketOf(SIZE_REL_BUCKETS, t.sizeRel, 0, false)}`);
      const seen = tickerCount.get(t.ticker) ?? 0;
      keys.push(`familiar:${familiarKey(seen)}`);
      if (t.entryMin != null) {
        const e = t.entryMin;
        keys.push(`time:${timeBucketOf(Math.floor(e * 60))}`);
        keys.push(`session:${e < RTH_OPEN ? "pre" : e < RTH_CLOSE ? "rth" : "ah"}`);
        // Closed before this entry (same day): realised day net, the last closed trade.
        let realised = 0;
        let last: EdgeTrade | null = null;
        let rapid = 0;
        for (const oi of dayIdx) {
          if (oi === ti) continue;
          const o = trades[oi];
          if (o.exitMin != null && o.exitMin <= e) {
            realised += o.net;
            if (!last || (o.exitMin > (last.exitMin ?? -1))) last = o;
          }
          if (o.entryMin != null && o.entryMin >= e - RAPID_WINDOW && (o.entryMin < e || (o.entryMin === e && o.seq < t.seq))) rapid++;
        }
        if (last && last.exitMin != null && e - last.exitMin < AFTER_MIN) {
          if (last.net > 0) keys.push("state:after_win_10");
          else if (last.net < 0) keys.push("state:after_loss_10");
        }
        if (u > 0) keys.push(`zone:${zoneKey(realised, u)}`);
        if (rapid >= RAPID_COUNT) keys.push("rapid:yes");
      }
      out[ti] = keys;
      dayTotal += t.net;
      tickerCount.set(t.ticker, seen + 1);
    });
    dayNets.push(Math.abs(dayTotal));
    i = j;
  }
  return out;
}

type SliceAcc = { days: Map<string, { s: number; n: number }>; n: number; net: number; blocks: { s: number; n: number }[] };

type TraderSlice = {
  trader: string;
  key: string;
  n: number;
  days: number;
  net: number;
  xbar: number;
  se: number;
  pGe0: number;
  pLe0: number;
  blockMeans: (number | null)[];
};

type TraderCtx = { activeDays: number; medianNotional: number };

/** The desk trading days of the window: the last `lookback` distinct days with any trade, up to asOf. */
function windowDays(trades: readonly EdgeTrade[], asOf: string, lookback: number): string[] {
  const all = [...new Set(trades.map((t) => t.day).filter((d) => d <= asOf))].sort();
  return all.slice(-lookback);
}

/** Per-trader slice statistics (bootstrap) — the expensive part. */
function traderSlices(trader: string, trades: readonly EdgeTrade[], keys: string[][], bounds: { lo: number; hi: number } | null, blockOf: (day: string) => number, opts: Required<Pick<EdgeMapOptions, "B" | "seed" | "blocks">>): TraderSlice[] {
  const acc = new Map<string, SliceAcc>();
  trades.forEach((t, i) => {
    if (!(t.notional != null && t.notional > 0)) return;
    let x = (1e4 * t.net) / t.notional;
    if (bounds) x = Math.min(bounds.hi, Math.max(bounds.lo, x));
    const blk = blockOf(t.day);
    for (const k of keys[i]) {
      let a = acc.get(k);
      if (!a) {
        a = { days: new Map(), n: 0, net: 0, blocks: Array.from({ length: opts.blocks }, () => ({ s: 0, n: 0 })) };
        acc.set(k, a);
      }
      const d = a.days.get(t.day) ?? { s: 0, n: 0 };
      d.s += x;
      d.n += 1;
      a.days.set(t.day, d);
      a.n += 1;
      a.net += t.net;
      if (blk >= 0) {
        a.blocks[blk].s += x;
        a.blocks[blk].n += 1;
      }
    }
  });
  const out: TraderSlice[] = [];
  for (const [key, a] of [...acc.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const sums = [...a.days.values()].map((d) => d.s);
    const counts = [...a.days.values()].map((d) => d.n);
    const b = clusterBootstrapMean(sums, counts, rngFor(opts.seed, trader, key), opts.B);
    if (!b) continue;
    out.push({
      trader, key, n: a.n, days: a.days.size, net: a.net, xbar: b.mean, se: b.se, pGe0: b.pGe0, pLe0: b.pLe0,
      blockMeans: a.blocks.map((x) => (x.n ? x.s / x.n : null)),
    });
  }
  return out;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** The whole desk's edge map as of `opts.asOf` (one row per trader × slice with trades). */
export function computeEdgeMap(trades: readonly EdgeTrade[], opts: EdgeMapOptions): EdgeMapRow[] {
  const o = { ...EDGE_DEFAULTS, seed: STATS_SEED, ...opts };
  const days = windowDays(trades, o.asOf, o.lookbackDays);
  if (!days.length) return [];
  const inWin = new Set(days);
  // Block b = 0 is the most recent 60 trading days, 1 the 60 before, …; older days are outside every block.
  const blockIndex = new Map<string, number>();
  for (let k = 0; k < days.length; k++) {
    const fromEnd = days.length - 1 - k;
    const b = Math.floor(fromEnd / o.blockDays);
    if (b < o.blocks) blockIndex.set(days[k], b);
  }
  const blockOf = (d: string) => blockIndex.get(d) ?? -1;
  const win = trades.filter((t) => inWin.has(t.day));
  const xs = win.filter((t) => t.notional != null && t.notional > 0).map((t) => (1e4 * t.net) / t.notional!);
  const bounds = winsorBounds(xs, 5);
  const deskMu = xs.length ? xs.map((x) => (bounds ? Math.min(bounds.hi, Math.max(bounds.lo, x)) : x)).reduce((s, v) => s + v, 0) / xs.length : 0;

  const byTrader = new Map<string, EdgeTrade[]>();
  for (const t of win) {
    const list = byTrader.get(t.trader) ?? [];
    list.push(t);
    byTrader.set(t.trader, list);
  }
  const ctx = new Map<string, TraderCtx>();
  const slices: TraderSlice[] = [];
  for (const [trader, list] of [...byTrader.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = sliceKeysOf(list);
    const notionals = list.map((t) => t.notional).filter((v): v is number => v != null && v > 0);
    ctx.set(trader, { activeDays: new Set(list.map((t) => t.day)).size, medianNotional: notionals.length ? median(notionals) : 0 });
    slices.push(...traderSlices(trader, list, keys, bounds, blockOf, o));
  }

  // Desk prior per slice.
  const priors = new Map<string, Prior>();
  for (const key of new Set(slices.map((s) => s.key))) {
    priors.set(key, deskPrior(slices.filter((s) => s.key === key).map((s) => ({ xbar: s.xbar, se: s.se, n: s.n })), {
      minN: o.minN, minUnits: 5, tauMin: 1, fallbackMu: deskMu, fallbackTau: o.tauDefaultBps,
    }));
  }

  const rows: EdgeMapRow[] = [];
  for (const trader of [...byTrader.keys()].sort()) {
    const mine = slices.filter((s) => s.trader === trader);
    const c = ctx.get(trader)!;
    const eligible = mine.map((s) => s.n >= o.minN && s.days >= o.minDays);
    const idx = mine.map((_, i) => i).filter((i) => eligible[i]);
    const qLeak = bhQValues(idx.map((i) => mine[i].pGe0));
    const qStr = bhQValues(idx.map((i) => mine[i].pLe0));
    const qOf = new Map(idx.map((i, k) => [i, { leak: qLeak[k], str: qStr[k] }]));
    mine.forEach((s, i) => {
      const prior = priors.get(s.key)!;
      const post = shrink(s.xbar, s.se, prior);
      const perDay = c.activeDays > 0 ? (c.medianNotional * s.n) / (1e4 * c.activeDays) : 0;
      const q = qOf.get(i);
      const neg = blocksAgreeing(s.blockMeans, -1);
      const pos = blocksAgreeing(s.blockMeans, 1);
      const cost = post.theta * perDay;
      let verdict: Verdict = "NONE";
      if (q && post.hi80 < 0 && q.leak <= o.qMax && neg >= 2 && -cost >= o.minUsdPerDay) verdict = "LEAK";
      else if (q && post.lo80 > 0 && q.str <= o.qMax && pos >= 2 && cost >= o.minUsdPerDay) verdict = "STRENGTH";
      rows.push({
        trader, asOf: o.asOf, sliceKey: s.key, family: s.key.split(":")[0], n: s.n, days: s.days, net: round(s.net, 2),
        xbarBps: round(s.xbar), seBps: round(s.se), thetaBps: round(post.theta), lo80Bps: round(post.lo80), hi80Bps: round(post.hi80),
        q: q ? round(post.theta < 0 ? q.leak : q.str, 6) : null,
        persistBlocks: post.theta < 0 ? neg : pos,
        verdict, costPerDay: round(cost, 2), costLo: round(post.lo80 * perDay, 2), costHi: round(post.hi80 * perDay, 2),
        priorMu: round(prior.mu), priorTau: round(prior.tau),
      });
    });
  }
  return rows;
}

/** The rows a person may see: at most `n` LEAKs (costliest first) and `n` STRENGTHs (largest first). Pure. */
export function visibleVerdicts<T extends Pick<EdgeMapRow, "verdict" | "costPerDay" | "sliceKey">>(rows: readonly T[], n = 3): { earn: T[]; lose: T[] } {
  return {
    earn: rows.filter((r) => r.verdict === "STRENGTH").sort((a, b) => b.costPerDay - a.costPerDay || a.sliceKey.localeCompare(b.sliceKey)).slice(0, n),
    lose: rows.filter((r) => r.verdict === "LEAK").sort((a, b) => a.costPerDay - b.costPerDay || a.sliceKey.localeCompare(b.sliceKey)).slice(0, n),
  };
}
