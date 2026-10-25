/**
 * «Где деск теряет» and «Чему учиться у сильных» — the two slice-based generators (pure).
 *
 * deskLeaks: a slice where the whole desk loses money per trade, and does worse than on the rest of its trades.
 *   x = net $ of a trade; mean per trade of the slice from a day-clustered bootstrap (desk days resampled, B = 1000);
 *   eligible: n ≥ LEAK_MIN_N trades on ≥ LEAK_MIN_DAYS days from ≥ LEAK_MIN_TRADERS traders (≥ 5 trades each), and
 *   at most LEAK_MAX_COVERAGE of the desk's trades (a slice that is nearly every trade is «the desk», not a leak);
 *   LEAK ⇔ hi80(slice) < 0 ∧ hi80(slice − rest) < 0 (paired day bootstrap) ∧ BH q ≤ 0.05 of the difference across
 *          every eligible slice tried (one-sided p = (draws ≥ 0 + 1) / (B + 1))
 *          ∧ Σ net < 0 in ≥ 2 of the 3 thirds of the window (persistence).
 *   The unit-free twin (bps of notional per trade) is what non-partners see; the $ stays for partners.
 *
 * topPractices: a slice where the top third of traders (mean daily net over the window, ≥ 20 active days) earns and
 *   the rest does not: paired day bootstrap of mean(top) − mean(rest) per trade; BH across slices; needs lo80 > 0,
 *   (q ≤ 0.05) the top group's own mean > 0, ≥ 3 top traders positive in the slice and ≥ PRACTICE_MIN_N trades on each side.
 *   Framed as learnable (a time window / a habit), never as «be like X».
 */
import { bhQValues } from "../stats";
import type { EdgeTrade } from "../edgeMap";
import { aggregateSlices, blockIndex, blockNets, dayDiffBoot, dayRatioBoot, encodeRulesParam, type SliceAgg } from "./slices";
import { REC_Q_MAX, round, ticksOf, type RawRec, type RecAction } from "./types";

export const LEAK_MIN_N = 200;
export const LEAK_MIN_DAYS = 20;
export const LEAK_MIN_TRADERS = 3;
export const LEAK_MAX_RECS = 3;
export const LEAK_MAX_COVERAGE = 0.6;
export const PRACTICE_MIN_N = 100;
export const PRACTICE_MIN_ACTIVE_DAYS = 20;
export const PRACTICE_MAX_RECS = 2;
/** A trader counts as «affected» by a desk slice with this many of their own trades in it. */
const AFFECTED_MIN_N = 20;

type Ctx = { days: string[]; from: string; to: string; B?: number };

const pad = (hm: string) => (/^\d:\d\d$/.test(hm) ? `0${hm}` : hm);

/** The what-if twin of a desk slice (a rule that removes / trims it), or null when no honest twin exists. */
export function ruleForSlice(key: string): Record<string, unknown> | null {
  const [family, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  switch (family) {
    case "time": {
      if (value === "before-8:30") return { type: "timeWindow", from: "08:30" };
      if (value === "after-16:00") return { type: "timeWindow", to: "16:00" };
      const [a, b] = value.split("-");
      return a && b ? { type: "blockWindow", from: pad(a), to: pad(b) } : null;
    }
    case "session": return value === "pre" ? { type: "timeWindow", from: "09:30" } : value === "ah" ? { type: "timeWindow", to: "16:00" } : null;
    case "state": return value === "after_loss_10" ? { type: "afterLoss", minutes: 10 } : value === "after_win_10" ? { type: "afterWin", minutes: 10 } : null;
    case "seq": return value === "6+" ? { type: "maxTradesPerDay", n: 5 } : value === "4-5" ? { type: "maxTradesPerDay", n: 3 } : null;
    case "price": return value === "lt5" ? { type: "priceRange", min: 5 } : value === "gt200" ? { type: "priceRange", max: 200 } : null;
    case "size": return value === "x3" ? { type: "maxSizeRel", x: 3 } : value === "x2" ? { type: "maxSizeRel", x: 1.5 } : null;
    default: return null;
  }
}

export function whatIfAction(rule: Record<string, unknown> | null): RecAction {
  return { kind: "whatif", href: rule ? `/what-if?trader=__all__&r=${encodeRulesParam([rule])}` : "/what-if?trader=__all__" };
}

function eligible(a: SliceAgg, minN: number, minDays: number, minTraders: number): boolean {
  const busy = [...a.traders.values()].filter((t) => t.n >= 5).length;
  return a.n >= minN && a.days.size >= minDays && busy >= minTraders;
}

/** Traders with ≥ 20 own trades in the slice on the given side of zero, the biggest first. */
function tradersBy(a: SliceAgg, sign: -1 | 1): string[] {
  return [...a.traders.entries()]
    .filter(([, t]) => t.n >= AFFECTED_MIN_N && Math.sign(t.net) === sign)
    .sort(([x, a1], [y, b1]) => sign * (b1.net - a1.net) || x.localeCompare(y))
    .map(([name]) => name);
}

/** Desk-wide leaks (≤ LEAK_MAX_RECS, costliest per desk day first). `edgeLeaks` = slice → traders with an edge-map LEAK. */
export function deskLeaks(trades: readonly EdgeTrade[], ctx: Ctx, edgeLeaks: ReadonlyMap<string, readonly string[]> = new Map()): RawRec[] {
  const inWin = new Set(ctx.days);
  const win = trades.filter((t) => inWin.has(t.day));
  if (!win.length || ctx.days.length < LEAK_MIN_DAYS) return [];
  const slices = [...aggregateSlices(win).values()]
    .filter((a) => eligible(a, LEAK_MIN_N, LEAK_MIN_DAYS, LEAK_MIN_TRADERS) && a.n <= LEAK_MAX_COVERAGE * win.length)
    .sort((a, b) => a.key.localeCompare(b.key));
  const total = new Map<string, { net: number; n: number }>();
  for (const t of win) { const d = total.get(t.day) ?? { net: 0, n: 0 }; d.net += t.net; d.n += 1; total.set(t.day, d); }
  const boots = slices.map((a) => dayRatioBoot([...a.days.values()].map((d) => ({ num: d.net, den: d.n })), ["office-leak", a.key], ctx.B));
  const diffs = slices.map((a) => dayDiffBoot([...total.entries()].map(([day, t]) => {
    const s = a.days.get(day);
    return { an: s?.net ?? 0, ad: s?.n ?? 0, bn: t.net - (s?.net ?? 0), bd: t.n - (s?.n ?? 0) };
  }), ["office-leak-diff", a.key], ctx.B));
  const q = bhQValues(diffs.map((b) => b?.pGe0 ?? 1));
  const blockOf = blockIndex(ctx.days);
  const out: RawRec[] = [];
  slices.forEach((a, i) => {
    const b = boots[i];
    if (!b || !(b.hi80 < 0) || !(diffs[i] && diffs[i]!.hi80 < 0) || q[i] > REC_Q_MAX || a.net >= 0) return;
    const neg = blockNets(a, blockOf).filter((v) => v < 0).length;
    if (neg < 2) return;
    const rel = dayRatioBoot([...a.days.values()].filter((d) => d.nb > 0).map((d) => ({ num: d.bps, den: d.nb })), ["office-leak-bps", a.key], ctx.B);
    const affected = tradersBy(a, -1);
    const rule = ruleForSlice(a.key);
    const perDay = a.net / ctx.days.length;
    out.push({
      id: `leak:${a.key}`, kind: "leak", audience: "desk", priority: round(-perDay, 2), confidence: ticksOf(q[i], neg === 3),
      params: {
        slice: a.key, trades: a.n, share: round(a.n / win.length, 4), winRate: round(a.wins / a.n, 4), blocks: neg,
        edgeLeaks: (edgeLeaks.get(a.key) ?? []).length,
      },
      money: { mean: round(b.mean), lo: round(b.lo80), hi: round(b.hi80), per: "trade" },
      rel: rel ? { mean: round(rel.mean, 1), lo: round(rel.lo80, 1), hi: round(rel.hi80, 1), unit: "bps" } : null,
      affected: { count: affected.length, names: affected },
      action: whatIfAction(rule),
      secondary: null,
      basis: { trades: a.n, days: a.days.size, traders: a.traders.size, from: ctx.from, to: ctx.to, q: round(q[i], 4) },
    });
  });
  return out.sort((x, y) => y.priority - x.priority || x.id.localeCompare(y.id)).slice(0, LEAK_MAX_RECS);
}

/** The top third of traders by mean daily net (≥ PRACTICE_MIN_ACTIVE_DAYS active days); null with < 6 such traders. */
export function topGroup(trades: readonly EdgeTrade[]): { top: Set<string>; rest: Set<string> } | null {
  const by = new Map<string, Map<string, number>>();
  for (const t of trades) {
    const m = by.get(t.trader) ?? new Map<string, number>();
    m.set(t.day, (m.get(t.day) ?? 0) + t.net);
    by.set(t.trader, m);
  }
  const ranked = [...by.entries()]
    .filter(([, days]) => days.size >= PRACTICE_MIN_ACTIVE_DAYS)
    .map(([name, days]) => ({ name, mean: [...days.values()].reduce((s, v) => s + v, 0) / days.size }))
    .sort((a, b) => b.mean - a.mean || a.name.localeCompare(b.name));
  if (ranked.length < 6) return null;
  const k = Math.max(3, Math.floor(ranked.length / 3));
  return { top: new Set(ranked.slice(0, k).map((r) => r.name)), rest: new Set(ranked.slice(k).map((r) => r.name)) };
}

/** What the top third does differently (≤ PRACTICE_MAX_RECS). */
export function topPractices(trades: readonly EdgeTrade[], ctx: Ctx): RawRec[] {
  const inWin = new Set(ctx.days);
  const win = trades.filter((t) => inWin.has(t.day));
  const g = topGroup(win);
  if (!g) return [];
  const slices = [...aggregateSlices(win).values()].filter((a) => a.n >= 2 * PRACTICE_MIN_N && a.days.size >= LEAK_MIN_DAYS).sort((a, b) => a.key.localeCompare(b.key));
  // Per slice and desk day: the top group's and the rest's sums. aggregateSlices pools traders, so re-split by trader.
  const split = slices.map((a) => {
    const topN = [...a.traders.entries()].filter(([n]) => g.top.has(n)).reduce((s, [, t]) => s + t.n, 0);
    const restN = [...a.traders.entries()].filter(([n]) => g.rest.has(n)).reduce((s, [, t]) => s + t.n, 0);
    return { a, topN, restN };
  }).filter((x) => x.topN >= PRACTICE_MIN_N && x.restN >= PRACTICE_MIN_N);
  if (!split.length) return [];
  const daily = perDaySplit(win, split.map((x) => x.a.key), g);
  const boots = split.map((x) => dayDiffBoot(daily.get(x.a.key) ?? [], ["office-practice", x.a.key], ctx.B));
  const q = bhQValues(boots.map((b) => b?.pLe0 ?? 1));
  const out: RawRec[] = [];
  split.forEach(({ a, topN, restN }, i) => {
    const b = boots[i];
    if (!b || !(b.lo80 > 0) || q[i] > REC_Q_MAX) return;
    const days = daily.get(a.key) ?? [];
    const topMean = days.reduce((s, d) => s + d.an, 0) / Math.max(1, days.reduce((s, d) => s + d.ad, 0));
    const restMean = days.reduce((s, d) => s + d.bn, 0) / Math.max(1, days.reduce((s, d) => s + d.bd, 0));
    const topPositive = [...a.traders.entries()].filter(([n, t]) => g.top.has(n) && t.net > 0 && t.n >= 10).length;
    if (!(topMean > 0) || topPositive < 3) return;
    const affected = tradersBy(a, -1).filter((n) => g.rest.has(n));
    out.push({
      id: `practice:${a.key}`, kind: "practice", audience: "desk", priority: round(b.mean * restN / ctx.days.length / 4, 2), confidence: ticksOf(q[i], b.lo80 > Math.abs(restMean)),
      params: { slice: a.key, topCount: g.top.size, topPositive, topTrades: topN, restTrades: restN, topMeanSign: Math.sign(topMean), restMeanSign: Math.sign(restMean) },
      money: { mean: round(b.mean), lo: round(b.lo80), hi: round(b.hi80), per: "trade" },
      rel: null,
      affected: { count: affected.length, names: affected },
      action: { kind: "benchmark", href: "/benchmark" },
      secondary: null,
      basis: { trades: a.n, days: a.days.size, traders: a.traders.size, from: ctx.from, to: ctx.to, q: round(q[i], 4) },
    });
  });
  return out.sort((x, y) => y.priority - x.priority || x.id.localeCompare(y.id)).slice(0, PRACTICE_MAX_RECS);
}

/** slice → per desk day { top Σnet, top n, rest Σnet, rest n } (days of the slice only). */
function perDaySplit(win: readonly EdgeTrade[], keys: readonly string[], g: { top: Set<string>; rest: Set<string> }) {
  const wanted = new Set(keys);
  const fam = new Set(keys.map((k) => k.slice(0, k.indexOf(":"))));
  const acc = new Map<string, Map<string, { an: number; ad: number; bn: number; bd: number }>>();
  const add = (group: Set<string>, side: "a" | "b") => {
    const sub = win.filter((t) => group.has(t.trader));
    for (const s of aggregateSlices(sub, fam).values()) {
      if (!wanted.has(s.key)) continue;
      const m = acc.get(s.key) ?? new Map();
      for (const [day, d] of s.days) {
        const cur = m.get(day) ?? { an: 0, ad: 0, bn: 0, bd: 0 };
        if (side === "a") { cur.an += d.net; cur.ad += d.n; } else { cur.bn += d.net; cur.bd += d.n; }
        m.set(day, cur);
      }
      acc.set(s.key, m);
    }
  };
  add(g.top, "a");
  add(g.rest, "b");
  return new Map([...acc.entries()].map(([k, m]) => [k, [...m.values()]]));
}
