/**
 * «Задача дня» — pure rules (no I/O): which ticker-day becomes a challenge, the desk ranking, the streak.
 *
 * Pick (one per NY challenge date, the same for the whole desk):
 *   - candidates = archived 1-minute ticker-days before the challenge date (the archive's own regular-session stats:
 *     range % and gap %, the same day features the simulator filters on), liquid (open ≥ trainer.dailyMinPriceUsd,
 *     day volume ≥ trainer.dailyMinVolume) and interesting (range in [dailyMinRangePct, dailyMaxRangePct]);
 *   - never a ticker-day any desk trader traded (whoever traded it would know how it went), never a ticker-day used
 *     in the last trainer.dailyNoRepeatDays challenges, and not one of the last 5 challenge tickers;
 *   - deterministic: the eligible list is ranked by «interest» (a mid-size range, a moderate gap), the best 20 are
 *     ordered by a hash of (date, ticker, day) and the first wins — the same inputs always give the same pick;
 *   - when the archive has no clean day, the rule relaxes step by step (fewest desk traders first, then the
 *     liquidity / range filters); traders who traded a relaxed pick are left out of its ranking.
 * Ranking: by R (sum of closed trades' R) high → low, ties by fewer trades; a game without trades has no R and goes
 * last. Shown to the viewer after they finished, or for everyone after the close (16:00 NY of the challenge date).
 */
import { createHash } from "node:crypto";

export type DailyCandidate = {
  ticker: string;
  day: string;
  open: number | null;
  volume: number;
  rangePct: number | null;
  gapPct: number | null;
  /** Distinct desk traders who traded the ticker that day. */
  deskTraders: number;
};

export type PickRules = {
  minPrice: number;
  minVolume: number;
  minRangePct: number;
  maxRangePct: number;
};

/** Stable 32-bit hash of a string (sha256 prefix). */
export function hash32(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0);
}

/** Higher = a better challenge: a 3–6 % range reads well intraday; a big gap makes the open a coin flip. */
export function interestOf(c: Pick<DailyCandidate, "rangePct" | "gapPct">): number {
  const range = c.rangePct ?? 0;
  const gap = Math.abs(c.gapPct ?? 0);
  return -Math.abs(range - 4.5) - Math.max(0, gap - 3) * 0.5;
}

const TICKER_RE = /^[A-Z]{1,5}$/;

/**
 * The ordered candidates for `date` (best first). `usedKeys` = "TICKER:DAY" of the no-repeat window, `recentTickers`
 * = tickers of the last few challenges. Returns the list of the first relaxation level that has anything.
 */
export function pickOrder(
  date: string,
  cands: readonly DailyCandidate[],
  rules: PickRules,
  usedKeys: ReadonlySet<string>,
  recentTickers: ReadonlySet<string>,
): DailyCandidate[] {
  const base = cands.filter((c) => c.day < date && TICKER_RE.test(c.ticker) && !usedKeys.has(`${c.ticker}:${c.day}`));
  const liquid = (c: DailyCandidate) => (c.open ?? 0) >= rules.minPrice && c.volume >= rules.minVolume;
  const ranged = (c: DailyCandidate) => c.rangePct != null && c.rangePct >= rules.minRangePct && c.rangePct <= rules.maxRangePct;
  const fresh = (c: DailyCandidate) => !recentTickers.has(c.ticker);
  const minDesk = (xs: DailyCandidate[]) => {
    const m = Math.min(...xs.map((c) => c.deskTraders));
    return xs.filter((c) => c.deskTraders === m);
  };
  const levels: ((xs: DailyCandidate[]) => DailyCandidate[])[] = [
    (xs) => xs.filter((c) => c.deskTraders === 0 && liquid(c) && ranged(c) && fresh(c)),
    (xs) => xs.filter((c) => c.deskTraders === 0 && liquid(c) && ranged(c)),
    (xs) => { const ok = xs.filter((c) => liquid(c) && ranged(c)); return ok.length ? minDesk(ok) : []; },
    (xs) => { const ok = xs.filter((c) => c.deskTraders === 0 && (c.rangePct ?? 0) > 0); return ok; },
    (xs) => (xs.length ? minDesk(xs) : []),
  ];
  for (const level of levels) {
    const list = level(base);
    if (!list.length) continue;
    const top = [...list].sort((a, b) => interestOf(b) - interestOf(a) || a.ticker.localeCompare(b.ticker) || a.day.localeCompare(b.day)).slice(0, 20);
    return top
      .map((c) => ({ c, k: hash32(`${date}|${c.ticker}|${c.day}`) }))
      .sort((a, b) => a.k - b.k || a.c.ticker.localeCompare(b.c.ticker))
      .map((e) => e.c);
  }
  return [];
}

/* ─────────────────────────── Ranking ─────────────────────────── */

export type DailyGameRow = { userId: number; name: string; r: number; trades: number };
export type RankingMode = "names" | "aliases";
export type RankedRow = { label: string; me: boolean; r: number | null; trades: number };

export type DailyRanking = {
  ranking: RankedRow[];
  my: { r: number | null; rank: number | null; of: number } | null;
};

/** Sorted rows: R high → low (ties: fewer trades, then name for stability); no trades → no R → last. */
export function sortDaily(rows: readonly DailyGameRow[]): DailyGameRow[] {
  return [...rows].sort((a, b) => {
    const ar = a.trades > 0 ? a.r : null, br = b.trades > 0 ? b.r : null;
    if (ar == null || br == null) return ar == null && br == null ? a.name.localeCompare(b.name) : ar == null ? 1 : -1;
    return br - ar || a.trades - b.trades || a.name.localeCompare(b.name);
  });
}

/**
 * The visible ranking: the top `topN` plus the viewer's own row when it is lower (no public tail).
 * `aliases` = deskAliases over the date's participants (used for other traders in "aliases" mode → label "t<n>").
 * `excluded` = traders who traded the challenge's ticker-day (relaxed pick): not ranked.
 */
export function buildRanking(
  rows: readonly DailyGameRow[],
  viewerId: number,
  mode: RankingMode,
  aliases: ReadonlyMap<string, number>,
  topN: number,
  excluded: ReadonlySet<string> = new Set(),
): DailyRanking {
  const ranked = sortDaily(rows.filter((r) => !excluded.has(r.name)));
  const label = (r: DailyGameRow) => (r.userId === viewerId || mode === "names" ? r.name : `t${aliases.get(r.name) ?? 0}`);
  const out: RankedRow[] = [];
  let mine: DailyRanking["my"] = null;
  ranked.forEach((r, i) => {
    const me = r.userId === viewerId;
    const row = { label: label(r), me, r: r.trades > 0 ? r.r : null, trades: r.trades };
    if (i < topN || me) out.push(row);
    if (me) mine = { r: row.r, rank: i + 1, of: ranked.length };
  });
  const own = rows.find((r) => r.userId === viewerId);
  if (!mine && own) mine = { r: own.trades > 0 ? own.r : null, rank: null, of: ranked.length };
  return { ranking: out, my: mine };
}

/* ─────────────────────────── Streak ─────────────────────────── */

/**
 * Challenge dates in a row the viewer played, newest first. `dates` = all challenge dates up to the current one
 * (newest first); the current one not played yet does not break the streak (the day is not over).
 */
export function dailyStreak(dates: readonly string[], played: ReadonlySet<string>, current: string): number {
  let n = 0;
  for (const d of dates) {
    if (d > current) continue;
    if (played.has(d)) { n++; continue; }
    if (d === current) continue;
    break;
  }
  return n;
}
