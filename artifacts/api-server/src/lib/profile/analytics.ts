/**
 * Profile analytics — key numbers, the equity curve, best / worst slices, the style fingerprint, the clean streak and
 * the closest desk peer by style. PURE (no I/O), unit-tested (__tests__/profileAnalytics.test.ts).
 */
import { median } from "../stats";
import type { DayAgg, ProfileTrade } from "./types";

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export type KeyStats = {
  net: number; trades: number; wins: number; losses: number; winRate: number | null; profitFactor: number | null;
  expectancy: number | null; avgWin: number | null; avgLoss: number | null; activeDays: number; greenDays: number;
  bestDay: number | null; worstDay: number | null; maxDrawdown: number;
};

export function keyStatsOf(trades: readonly ProfileTrade[], days: readonly DayAgg[]): KeyStats {
  const wins = trades.filter((t) => t.result === "win");
  const losses = trades.filter((t) => t.result === "loss");
  const grossWin = wins.reduce((s, t) => s + Math.max(0, t.net), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.net), 0));
  const net = trades.reduce((s, t) => s + t.net, 0);
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const d of [...days].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    cum += d.net;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return {
    net: r2(net),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length + losses.length ? r4(wins.length / (wins.length + losses.length)) : null,
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
    expectancy: trades.length ? r2(net / trades.length) : null,
    avgWin: wins.length ? r2(grossWin / wins.length) : null,
    avgLoss: losses.length ? r2(-grossLoss / losses.length) : null,
    activeDays: days.length,
    greenDays: days.filter((d) => d.net > 0).length,
    bestDay: days.length ? r2(Math.max(...days.map((d) => d.net))) : null,
    worstDay: days.length ? r2(Math.min(...days.map((d) => d.net))) : null,
    maxDrawdown: r2(dd),
  };
}

/** Cumulative net per trading day, oldest first. */
export function equityOf(days: readonly DayAgg[]): { day: string; net: number; cum: number }[] {
  let cum = 0;
  return [...days].sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => {
    cum += d.net;
    return { day: d.day, net: r2(d.net), cum: r2(cum) };
  });
}

export type Slice = { key: string; n: number; net: number; winRate: number | null };
export type SliceSet = { best: Slice[]; worst: Slice[] };

/** Slices with at least `minN` trades: the 3 best positive and the 3 worst negative by net. */
export function slicesBy(trades: readonly ProfileTrade[], keyOf: (t: ProfileTrade) => string | null, minN = 3, top = 3): SliceSet {
  const m = new Map<string, { n: number; net: number; w: number; l: number }>();
  for (const t of trades) {
    const k = keyOf(t);
    if (!k) continue;
    const g = m.get(k) ?? { n: 0, net: 0, w: 0, l: 0 };
    g.n++;
    g.net += t.net;
    if (t.result === "win") g.w++;
    if (t.result === "loss") g.l++;
    m.set(k, g);
  }
  const all: Slice[] = [...m.entries()].filter(([, g]) => g.n >= minN).map(([key, g]) => ({ key, n: g.n, net: r2(g.net), winRate: g.w + g.l ? r4(g.w / (g.w + g.l)) : null }));
  return {
    best: all.filter((s) => s.net > 0).sort((a, b) => b.net - a.net).slice(0, top),
    worst: all.filter((s) => s.net < 0).sort((a, b) => a.net - b.net).slice(0, top),
  };
}

/** Half-hour window of an entry, NY time: "09:30". Null without an entry time. */
export function windowOf(entrySec: number | null): string | null {
  if (entrySec === null || !Number.isFinite(entrySec) || entrySec < 0) return null;
  const m = Math.floor(entrySec / 60);
  const h = Math.floor(m / 60);
  const half = m % 60 < 30 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${half}`;
}

export const PRICE_BUCKETS = ["lt5", "5to20", "20to100", "gt100"] as const;
export const HOLD_BUCKETS = ["lt1m", "1to5m", "5to30m", "30mto2h", "gt2h", "multiday"] as const;

export type Style = {
  trades: number;
  horizon: { intraday: number; overnight: number; swing: number };
  side: { long: number; short: number };
  price: Record<(typeof PRICE_BUCKETS)[number], number>;
  hold: Record<(typeof HOLD_BUCKETS)[number], number>;
  medianHoldSec: number | null;
  tradesPerDay: number | null;
};

export function priceBucket(p: number | null): (typeof PRICE_BUCKETS)[number] | null {
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  return p < 5 ? "lt5" : p < 20 ? "5to20" : p < 100 ? "20to100" : "gt100";
}

export function holdBucket(t: Pick<ProfileTrade, "holdSec" | "horizon">): (typeof HOLD_BUCKETS)[number] | null {
  if (t.horizon !== "intraday") return "multiday";
  const s = t.holdSec;
  if (s === null || !Number.isFinite(s) || s < 0) return null;
  return s < 60 ? "lt1m" : s < 300 ? "1to5m" : s < 1800 ? "5to30m" : s < 7200 ? "30mto2h" : "gt2h";
}

const share = (k: number, n: number) => (n ? r4(k / n) : 0);

/** Shares (0..1) of the horizon, side, price and hold buckets. */
export function styleOf(trades: readonly ProfileTrade[]): Style {
  const n = trades.length;
  const count = <K extends string>(keys: readonly K[], of: (t: ProfileTrade) => K | null) => {
    const c = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    let known = 0;
    for (const t of trades) {
      const k = of(t);
      if (k) { c[k]++; known++; }
    }
    for (const k of keys) c[k] = share(c[k], known);
    return c;
  };
  const sided = trades.filter((t) => t.side);
  const holds = trades.filter((t) => t.horizon === "intraday").map((t) => t.holdSec).filter((v): v is number => v !== null && v >= 0);
  const days = new Set(trades.map((t) => t.day)).size;
  return {
    trades: n,
    horizon: {
      intraday: share(trades.filter((t) => t.horizon === "intraday").length, n),
      overnight: share(trades.filter((t) => t.horizon === "overnight").length, n),
      swing: share(trades.filter((t) => t.horizon === "swing").length, n),
    },
    side: { long: share(sided.filter((t) => t.side === "long").length, sided.length), short: share(sided.filter((t) => t.side === "short").length, sided.length) },
    price: count(PRICE_BUCKETS, (t) => priceBucket(t.price)),
    hold: count(HOLD_BUCKETS, holdBucket),
    medianHoldSec: holds.length ? Math.round(median(holds)) : null,
    tradesPerDay: days ? r2(n / days) : null,
  };
}

/** Style as a vector for peer distance: horizon mix, long share, price mix, log hold time, trades per day. */
export function styleVector(s: Style): number[] {
  const hold = s.medianHoldSec === null ? 0 : Math.min(1, Math.log10(1 + s.medianHoldSec) / 5);
  const tpd = s.tradesPerDay === null ? 0 : Math.min(1, s.tradesPerDay / 40);
  return [s.horizon.intraday, s.horizon.overnight, s.horizon.swing, s.side.long, ...PRICE_BUCKETS.map((k) => s.price[k]), hold, tpd];
}

export const PEER_MIN_TRADES = 20;

/** The desk peer with the nearest style (Euclidean distance); similarity = 1 / (1 + distance), 0..1. */
export function closestPeer(me: Style, others: readonly { name: string; style: Style }[]): { name: string; similarity: number } | null {
  if (me.trades < PEER_MIN_TRADES) return null;
  const v = styleVector(me);
  let best: { name: string; d: number } | null = null;
  for (const o of others) {
    if (o.style.trades < PEER_MIN_TRADES) continue;
    const w = styleVector(o.style);
    const d = Math.sqrt(v.reduce((s, x, i) => s + (x - (w[i] ?? 0)) ** 2, 0));
    if (!best || d < best.d || (d === best.d && o.name < best.name)) best = { name: o.name, d };
  }
  return best ? { name: best.name, similarity: r2(1 / (1 + best.d)) } : null;
}

/**
 * Trading days in a row, counted back from the latest one, without a rule violation; plus the longest such run.
 * `violationDays` = NY days with at least one violation.
 */
export function cleanStreakOf(tradeDays: readonly string[], violationDays: ReadonlySet<string>): { current: number; best: number } {
  const days = [...new Set(tradeDays)].sort();
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = violationDays.has(d) ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/** The last `n` calendar days of trading days (for the year heat strip). */
export function recentDays(days: readonly DayAgg[], today: string, n = 371): { day: string; net: number; trades: number }[] {
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - n + 1);
  const start = from.toISOString().slice(0, 10);
  return days.filter((d) => d.day >= start && d.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => ({ day: d.day, net: r2(d.net), trades: d.n }));
}
