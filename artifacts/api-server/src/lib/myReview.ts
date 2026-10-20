/**
 * «Мой разбор» (Волна 2 п. 2.9) — one answer for the trader instead of six screens with the same KPIs, from the viewer's
 * OWN trades of the last N days (routes/my-review.ts, GET /api/my-review?days=30):
 *
 *   earn   «где зарабатываю» — the top 3 setups / tickers / entry hours by net (R alongside), net > 0;
 *   lose   «где теряю»       — the costliest behaviour patterns of the period (lib/daily mistakeCosts — the same engine
 *                              as the day line and the curator's cost queue) + the worst 3 setups / tickers / hours;
 *   rule   «одно правило на завтра» — the rule tomorrow's own plan will suggest (lib/planPrefill: the costliest pattern of
 *                              the focus window), else the costliest pattern of the whole period (same pick, pickSuggestedRule).
 *
 * Buckets come from the edge matrix SQL (routes/edge buildMatrixQuery, scoped to the viewer). Placeholder buckets
 * («Без сетапа», no time, no ticker) are left out; a bucket needs MIN_TRADES trades. Money is net (lib/tradeMath).
 * The answer is a few kilobytes (≤ 3 rows per list). Pure shaping is exported for tests.
 */
import { pool } from "@workspace/db";
import { buildMatrixQuery, type MatrixQuery } from "../routes/edge";
import { addDays, isWeekend, nyDate } from "./tradingDate";
import { logger } from "./logger";
import { focusSettings } from "./daily/engine";
import { mistakeCosts } from "./daily/service";
import { pickSuggestedRule, planPrefill, type SuggestedRule } from "./planPrefill";
import type { MistakeCost } from "./daily/types";

export const MY_REVIEW_DEFAULT_DAYS = 30;
export const MY_REVIEW_MIN_DAYS = 7;
export const MY_REVIEW_MAX_DAYS = 90;
/** Rows per list. */
export const TOP_N = 3;
/** A bucket with fewer trades is noise. */
export const MIN_TRADES = 2;

export type ReviewDimension = "setup" | "ticker" | "hour";

export type ReviewBucket = {
  /** setup name / ticker / entry hour «09» (NY). */
  key: string;
  trades: number;
  net: number;
  /** Σ R of the bucket's trades with an R (null when none has one). */
  r: number | null;
  /** wins / (wins + losses), 0..1; null when nothing was decided. */
  winRate: number | null;
};

export type ReviewPattern = { mistake: string; costNet: number; count: number; days: number };

export type MyReview = {
  trader: string;
  days: number;
  from: string;
  to: string;
  totals: { trades: number; net: number; r: number | null; winRate: number | null };
  earn: Record<ReviewDimension, ReviewBucket[]>;
  lose: { patterns: ReviewPattern[] } & Record<ReviewDimension, ReviewBucket[]>;
  /** The one rule for tomorrow; `source` = «plan» (what tomorrow's plan suggests) or «period» (the period's costliest). */
  rule: (SuggestedRule & { source: "plan" | "period" }) | null;
  generatedAt: string;
};

/** One row of the edge matrix as the SQL returns it (only the columns used here). */
export type MatrixRow = { row_key: unknown; n: unknown; wins: unknown; losses: unknown; sum_r: unknown; r_n: unknown; net: unknown; pnl_n: unknown };

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

// i18n-ignore-next (the edge matrix's stable bucket keys — data, not display)
const PLACEHOLDERS = new Set(["Без сетапа", "без времени", "?", ""]);

/** Days of the window: an integer in [MIN, MAX], default 30 (pure). */
export function clampDays(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || raw == null || raw === "") return MY_REVIEW_DEFAULT_DAYS;
  return Math.min(MY_REVIEW_MAX_DAYS, Math.max(MY_REVIEW_MIN_DAYS, n));
}

/** The NY weekday after `date` — the plan «на завтра» is for it. */
export function nextTradingDay(date: string): string {
  let d = addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Matrix key → display key: «m540» → «09» (entry hour, NY); sessions / no time → null (pure). */
export function hourKey(raw: string): string | null {
  const m = /^m(\d+)$/.exec(raw);
  if (!m) return null;
  const h = Math.floor(Number(m[1]) / 60);
  return h >= 0 && h < 24 ? String(h).padStart(2, "0") : null;
}

/** Matrix rows → buckets (placeholders dropped, ≥ MIN_TRADES trades with a known net) (pure). */
export function bucketsOf(rows: readonly MatrixRow[], dim: ReviewDimension): ReviewBucket[] {
  const out: ReviewBucket[] = [];
  for (const r of rows) {
    const raw = String(r.row_key ?? "");
    const key = dim === "hour" ? hourKey(raw) : PLACEHOLDERS.has(raw.trim()) ? null : raw.trim();
    if (!key || num(r.pnl_n) < MIN_TRADES) continue;
    const decided = num(r.wins) + num(r.losses);
    out.push({
      key, trades: num(r.n), net: round2(num(r.net)), r: num(r.r_n) > 0 ? round2(num(r.sum_r)) : null,
      winRate: decided > 0 ? Math.round((num(r.wins) / decided) * 1000) / 1000 : null,
    });
  }
  return out;
}

/** Best `n` by net (> 0, ties → more trades, then key) and worst `n` (< 0, most negative first) (pure). */
export function splitTop(buckets: readonly ReviewBucket[], n = TOP_N): { earn: ReviewBucket[]; lose: ReviewBucket[] } {
  const tie = (a: ReviewBucket, b: ReviewBucket) => b.trades - a.trades || a.key.localeCompare(b.key);
  return {
    earn: buckets.filter((b) => b.net > 0).sort((a, b) => b.net - a.net || tie(a, b)).slice(0, n),
    lose: buckets.filter((b) => b.net < 0).sort((a, b) => a.net - b.net || tie(a, b)).slice(0, n),
  };
}

/** The period's costliest priced patterns (cost < 0), top `n` (pure). */
export function topPatterns(costs: readonly MistakeCost[], n = TOP_N): ReviewPattern[] {
  return costs
    .filter((c) => c.costNet != null && c.costNet < 0)
    .sort((a, b) => (a.costNet ?? 0) - (b.costNet ?? 0) || b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((c) => ({ mistake: c.id, costNet: round2(c.costNet ?? 0), count: c.count, days: c.days }));
}

/** Totals over the setup rows (every closed trade is in exactly one setup bucket, placeholders included) (pure). */
export function totalsOf(rows: readonly MatrixRow[]): MyReview["totals"] {
  let trades = 0, net = 0, r = 0, rN = 0, wins = 0, losses = 0;
  for (const x of rows) {
    trades += num(x.n); net += num(x.net); r += num(x.sum_r); rN += num(x.r_n); wins += num(x.wins); losses += num(x.losses);
  }
  return { trades, net: round2(net), r: rN > 0 ? round2(r) : null, winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 1000 : null };
}

async function matrixRows(trader: string, rows: "setup" | "ticker" | "tod", from: string, to: string): Promise<MatrixRow[]> {
  // cols = rows → one column «—»; tod in 60-minute buckets (entry hour).
  const q = { rows, cols: rows, from, to, tod: rows === "tod" ? 60 : undefined } as MatrixQuery;
  const { sql, params } = buildMatrixQuery(q, trader, false);
  const { rows: out } = await pool.query<MatrixRow>(sql, params);
  return out;
}

async function disputedIn(trader: string, from: string, to: string): Promise<Set<string>> {
  const { rows } = await pool
    .query<{ m: string | null }>(`SELECT DISTINCT disputed_mistake AS m FROM daily_reviews WHERE trader = $1 AND disputed AND date >= $2 AND date <= $3`, [trader, from, to])
    .catch(() => ({ rows: [] as { m: string | null }[] }));
  return new Set(rows.map((r) => r.m).filter((m): m is string => !!m));
}

/** «Мой разбор» of `trader` over the last `days` NY calendar days up to today. */
export async function myReview(trader: string, days: number, now = new Date()): Promise<MyReview> {
  const to = nyDate(now);
  const from = addDays(to, -(days - 1));
  const [setups, tickers, hours, costs] = await Promise.all([
    matrixRows(trader, "setup", from, to),
    matrixRows(trader, "ticker", from, to),
    matrixRows(trader, "tod", from, to),
    mistakeCosts(trader, from, to).catch((err) => {
      logger.warn({ err: (err as Error)?.message, trader }, "my-review: mistake costs failed");
      return [] as MistakeCost[];
    }),
  ]);
  const s = splitTop(bucketsOf(setups, "setup"));
  const t = splitTop(bucketsOf(tickers, "ticker"));
  const h = splitTop(bucketsOf(hours, "hour"));
  const planned = await planPrefill(trader, nextTradingDay(to)).then((p) => p.rule).catch(() => null);
  let rule: MyReview["rule"] = planned ? { ...planned, source: "plan" } : null;
  if (!rule) {
    const picked = pickSuggestedRule(costs, { from, to }, { minCost: focusSettings().minCost, disputed: await disputedIn(trader, from, to) });
    rule = picked ? { ...picked, source: "period" } : null;
  }
  return {
    trader, days, from, to,
    totals: totalsOf(setups),
    earn: { setup: s.earn, ticker: t.earn, hour: h.earn },
    lose: { patterns: topPatterns(costs), setup: s.lose, ticker: t.lose, hour: h.lose },
    rule,
    generatedAt: new Date(now).toISOString(),
  };
}
