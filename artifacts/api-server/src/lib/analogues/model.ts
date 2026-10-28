/**
 * Library of analogues — similarity of a ticker-day to the desk's past cases (pure, no DB).
 *
 * A profile is what a trader reads off a day before trading it: which setup, which catalyst type, how big the gap,
 * the catalyst's direction and strength, the market regime. Each matching trait adds its desk-set weight
 * (catalyst.analogueWeight*); the gap counts in bands (catalyst.analogueGapBands, % edges of |gap|) — the same band
 * full weight, the next band half. The direction of the gap stands in for the catalyst direction when nobody marked
 * one. Ranking: score, then the more recent case, then the ticker. The day itself and an unknown-everything case
 * never rank.
 */
import type { Direction, Kind, Strength } from "../catalyst/codes";

export type Profile = {
  ticker: string;
  day: string;
  setupId: number | null;
  kind: Kind | null;
  direction: Direction | null;
  strength: Strength | null;
  gapPct: number | null;
  regime: string | null;
};

export type Weights = { setup: number; kind: number; gap: number; direction: number; strength: number; regime: number };
export type Trait = "setup" | "kind" | "gap" | "gapNear" | "direction" | "strength" | "regime";
export type Scored<C extends Profile> = C & { score: number; matched: Trait[] };

/** "2,5,10,20" → [2, 5, 10, 20] (sorted, positive, unique); junk parts are dropped. */
export function parseBands(raw: string): number[] {
  return [...new Set(String(raw).split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

/** Band index of |gap| between the edges (0 = below the first edge); null without a gap. */
export function gapBand(gapPct: number | null, edges: readonly number[]): number | null {
  if (gapPct == null || !Number.isFinite(gapPct)) return null;
  const g = Math.abs(gapPct);
  let i = 0;
  while (i < edges.length && g >= edges[i]) i++;
  return i;
}

/** The catalyst direction, or the gap's when none was marked (a gap under the first band edge says nothing). */
export function directionOf(p: Pick<Profile, "direction" | "gapPct">, edges: readonly number[]): Direction | null {
  if (p.direction) return p.direction;
  if (p.gapPct == null || !Number.isFinite(p.gapPct) || Math.abs(p.gapPct) < (edges[0] ?? 0) || p.gapPct === 0) return null;
  return p.gapPct > 0 ? "bull" : "bear";
}

/** Score of one candidate against the query (and which traits matched). */
export function similarity(q: Profile, c: Profile, w: Weights, edges: readonly number[]): { score: number; matched: Trait[] } {
  const matched: Trait[] = [];
  let score = 0;
  const hit = (t: Trait, pts: number) => { if (pts > 0) { matched.push(t); score += pts; } };
  if (q.setupId != null && q.setupId === c.setupId) hit("setup", w.setup);
  if (q.kind && q.kind === c.kind) hit("kind", w.kind);
  const qb = gapBand(q.gapPct, edges);
  const cb = gapBand(c.gapPct, edges);
  if (qb != null && cb != null) {
    if (qb === cb) hit("gap", w.gap);
    else if (Math.abs(qb - cb) === 1) hit("gapNear", w.gap / 2);
  }
  const qd = directionOf(q, edges);
  if (qd && qd === directionOf(c, edges)) hit("direction", w.direction);
  if (q.strength && q.strength === c.strength) hit("strength", w.strength);
  if (q.regime && q.regime === c.regime) hit("regime", w.regime);
  return { score: Math.round(score * 100) / 100, matched };
}

/** The `limit` most similar cases with a score ≥ `minScore` (the query's own ticker-day excluded). */
export function rankAnalogues<C extends Profile>(q: Profile, cands: readonly C[], opts: { weights: Weights; bands: readonly number[]; minScore: number; limit: number }): Scored<C>[] {
  const out: Scored<C>[] = [];
  for (const c of cands) {
    if (c.ticker === q.ticker && c.day === q.day) continue;
    const s = similarity(q, c, opts.weights, opts.bands);
    if (s.score <= 0 || s.score < opts.minScore) continue;
    out.push({ ...c, ...s });
  }
  return out
    .sort((a, b) => b.score - a.score || b.day.localeCompare(a.day) || a.ticker.localeCompare(b.ticker))
    .slice(0, Math.max(1, opts.limit));
}

/** Answer options of the «на что похоже» quiz: the right setup plus up to `n − 1` others, in a seeded order. */
export function quizChoices<S extends { id: number }>(right: S, pool: readonly S[], n: number, rand: () => number): S[] {
  const others = pool.filter((s) => s.id !== right.id);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const list = [right, ...others.slice(0, Math.max(0, n - 1))];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
