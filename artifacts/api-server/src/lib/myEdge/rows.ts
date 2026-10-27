/**
 * «Мой edge» — one ranked row per (dimension, bucket) with the honest statistics, shared by «Что у меня работает» and
 * «Рынок и мой edge». Pure.
 *
 *   $ / day     mean over the bucket's trading days of the bucket's net that day (for a market-regime bucket that is
 *               the whole day — «в трендовые дни SPY вы зарабатываете +$X / день»)
 *   $ / trade   bucket net ÷ bucket trades
 *   interval    80 % day-clustered bootstrap (lib/stats/myEdgeStats meDayBootstrap), seeded by dim|key|n
 *   q / status  Benjamini–Hochberg over every ranked row of the answer; «мало данных» below the minimums
 *   blocks      persistence: the window's trading days in 3 chronological blocks
 * Buckets in `skip` (unknown, «нет данных») are not ranked: they only feed the coverage of their dimension.
 */
import {
  ME_LEVEL, meBhQ, meDayBootstrap, meHashSeed, mePersistence, meStatus,
  type MeBlock, type MeDay, type MeInterval, type MeStatus,
} from "../stats/myEdgeStats";
import { roundShare, winRateOf } from "../coreMetrics/kpi";

/** At most this many trade ids per row (the «Показать сделки» link; /trades takes 500). */
export const ME_IDS_CAP = 500;

export type MeRowTrade = { id: number; day: string; net: number; win: boolean | null };

export type MeRow = {
  dim: string;
  key: string;
  trades: number;
  days: number;
  net: number;
  winRate: number | null;
  perDay: MeInterval;
  perTrade: MeInterval;
  p: number;
  q: number | null;
  status: MeStatus;
  blocks: MeBlock[];
  /** Blocks whose sign agrees with the point estimate (0…3). */
  persist: number;
  /** Known only after the trade (hold) — never an entry rule. */
  outcome: boolean;
  ids: number[];
  idsTruncated: boolean;
};

export type MeCoverage = { dim: string; known: number; total: number };

export type MeRowsInput<D extends string> = {
  trades: readonly MeRowTrade[];
  dims: readonly D[];
  keyOf: (id: number, dim: D) => string;
  skip: ReadonlySet<string>;
  outcomeDims?: ReadonlySet<string>;
  level?: number;
  iters?: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Rows of every (dim, key) + the coverage of each dimension; BH is applied over all ranked rows together. */
export function buildRows<D extends string>(inp: MeRowsInput<D>): { rows: MeRow[]; coverage: MeCoverage[]; windowDays: string[] } {
  const windowDays = [...new Set(inp.trades.map((t) => t.day))].sort();
  const coverage: MeCoverage[] = [];
  const draft: Omit<MeRow, "q" | "status">[] = [];
  for (const dim of inp.dims) {
    const groups = new Map<string, MeRowTrade[]>();
    let known = 0;
    for (const t of inp.trades) {
      const key = inp.keyOf(t.id, dim);
      if (inp.skip.has(key)) continue;
      known++;
      const g = groups.get(key);
      if (g) g.push(t); else groups.set(key, [t]);
    }
    coverage.push({ dim, known, total: inp.trades.length });
    for (const [key, list] of groups) {
      const byDay = new Map<string, MeDay>();
      let wins = 0;
      let decided = 0;
      let net = 0;
      for (const t of list) {
        const d = byDay.get(t.day);
        if (d) { d.sum += t.net; d.n++; } else byDay.set(t.day, { sum: t.net, n: 1 });
        net += t.net;
        if (t.win != null) { decided++; if (t.win) wins++; }
      }
      const boot = meDayBootstrap([...byDay.values()], { seed: meHashSeed(`${dim}|${key}|${list.length}`), level: inp.level ?? ME_LEVEL, iters: inp.iters });
      if (!boot) continue;
      const blocks = mePersistence(windowDays, byDay);
      const sign = Math.sign(boot.perDay.point);
      const sorted = [...list].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
      draft.push({
        dim, key, trades: list.length, days: byDay.size, net: r2(net),
        winRate: roundShare(winRateOf(wins, decided - wins), 3),
        perDay: boot.perDay, perTrade: boot.perTrade, p: boot.p,
        blocks, persist: sign === 0 ? 0 : blocks.filter((b) => b.sign === sign).length,
        outcome: inp.outcomeDims?.has(dim) ?? false,
        ids: sorted.slice(0, ME_IDS_CAP).map((t) => t.id),
        idsTruncated: list.length > ME_IDS_CAP,
      });
    }
  }
  // Only rows with enough data enter the multiple-testing family (a 2-trade bucket is not a test).
  const tested = draft.map((r, i) => ({ r, i })).filter(({ r }) => meStatus(r.days, r.trades, 0) !== "low");
  const q = meBhQ(tested.map(({ r }) => r.p));
  const qOf = new Map(tested.map(({ i }, k) => [i, Math.round(q[k]! * 1000) / 1000]));
  const rows: MeRow[] = draft.map((r, i) => {
    const qi = qOf.get(i) ?? null;
    return { ...r, q: qi, status: meStatus(r.days, r.trades, qi) };
  });
  return { rows, coverage, windowDays };
}

const STATUS_RANK: Record<MeStatus, number> = { reliable: 0, hypothesis: 1, low: 2 };
/** A bucket holding more than this share of its dimension's trades is the baseline itself, not a slice — never ranked. */
export const RANK_MAX_SHARE = 0.85;

/** The impact the data can vouch for: the interval end nearest to zero × the bucket's days (0 when it crosses zero). */
export function conservativeImpact(r: MeRow): number {
  const bound = r.perDay.point > 0 ? Math.max(0, r.perDay.lo) : Math.min(0, r.perDay.hi);
  return Math.abs(bound) * r.days;
}

/**
 * Strengths (point $ / day > 0) and leaks (< 0): entry-time rows only (no outcome dims), «мало данных» and baseline
 * buckets (> RANK_MAX_SHARE of the dimension's trades) excluded; ordered by status, the conservative impact, |net|.
 */
export function rankRows(rows: readonly MeRow[], limit = 6): { strengths: MeRow[]; leaks: MeRow[] } {
  const perDim = new Map<string, number>();
  for (const r of rows) perDim.set(r.dim, (perDim.get(r.dim) ?? 0) + r.trades);
  const usable = rows.filter((r) => r.status !== "low" && !r.outcome && r.trades <= RANK_MAX_SHARE * (perDim.get(r.dim) ?? 0));
  const order = (a: MeRow, b: MeRow) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] || conservativeImpact(b) - conservativeImpact(a) || Math.abs(b.net) - Math.abs(a.net);
  return {
    strengths: usable.filter((r) => r.perDay.point > 0).sort(order).slice(0, limit),
    leaks: usable.filter((r) => r.perDay.point < 0).sort(order).slice(0, limit),
  };
}
