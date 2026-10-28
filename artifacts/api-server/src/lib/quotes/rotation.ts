/**
 * Rotation without repeats (served by POST /api/quotes/pick, routes/quotes.ts). Each reader has a seed
 * (users.settings.quotes.seed, else a hash of the name) and, per surface (dashboard card / lock screen), a cycle: the
 * ids already shown in it. The cycle itself stays in the reader's browser (edge-tracker lib/quotes/store.ts) and is
 * sent with each pick; the server keeps nothing, it only draws. The next quote is a weighted,
 * deterministic draw among the eligible ids NOT yet shown in the cycle — so no quote repeats until the whole eligible
 * pool has been shown; then a new cycle starts (never with the quote that closed the previous one).
 *
 *   weights   per surface (the lock screen favours «Олимп» and the philosophers, the dashboard mixes trading /
 *             psychology / classics); categories the reader switched off in the card weigh 0.
 *   context   preferTags (./context.ts): when some unseen quote carries one of them, the draw is limited to those —
 *             still from the unseen set, so the no-repeat guarantee holds.
 *
 * Pure and deterministic: the same seed, cycle and history draw the same quote (tests: __tests__/rotation.test.ts).
 */
import type { QuoteCat, QuoteMeta, QuoteTag } from "./types";

export type Surface = "dash" | "lock";

export interface RotationState {
  v: 1;
  cycle: number;
  /** Ids shown in the current cycle, in order (the last one = the quote on screen). */
  seen: string[];
  /** The quote on screen and the slot it belongs to (dashboard: NY date «YYYY-MM-DD»; lock: interval slot number). */
  current: { id: string; slot: string } | null;
}

export const EMPTY_ROTATION: RotationState = { v: 1, cycle: 0, seen: [], current: null };

export const SURFACE_WEIGHTS: Record<Surface, Record<QuoteCat, number>> = {
  lock: { olympus: 3, philosophy: 2.4, discipline: 1, psychology: 0.6, trading: 0.5 },
  dash: { trading: 2, psychology: 1.6, olympus: 1.3, philosophy: 1.3, discipline: 1 },
};

export interface PickOptions {
  seed: number;
  weights: Record<QuoteCat, number>;
  /** Categories the reader keeps on (null / empty = all). */
  cats?: readonly QuoteCat[] | null;
  /** Context tags: prefer unseen quotes carrying any of them. */
  preferTags?: readonly QuoteTag[] | null;
}

/** FNV-1a 32-bit hash of a string (seeds from names, salts per surface). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough to shuffle quotes. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ids a reader can get on this surface (weight > 0, category on). Falls back to the whole pool when empty. */
export function eligiblePool(pool: readonly QuoteMeta[], opt: Pick<PickOptions, "weights" | "cats">): QuoteMeta[] {
  const on = opt.cats && opt.cats.length > 0 ? new Set(opt.cats) : null;
  const list = pool.filter((q) => (opt.weights[q.cat] ?? 0) > 0 && (!on || on.has(q.cat)));
  return list.length > 0 ? list : [...pool];
}

function weightedPick(list: readonly QuoteMeta[], weights: Record<QuoteCat, number>, rnd: () => number): QuoteMeta {
  let total = 0;
  for (const q of list) total += Math.max(weights[q.cat] ?? 0, 0.0001);
  let r = rnd() * total;
  for (const q of list) {
    r -= Math.max(weights[q.cat] ?? 0, 0.0001);
    if (r < 0) return q;
  }
  return list[list.length - 1]!;
}

/**
 * Draw the next quote. `slot` is stored as the current one (the dashboard's day / the lock's interval slot).
 * Returns null only for an empty pool.
 */
export function nextQuote(
  pool: readonly QuoteMeta[],
  state: RotationState,
  opt: PickOptions,
  slot: string,
): { id: string; state: RotationState } | null {
  if (pool.length === 0) return null;
  const eligible = eligiblePool(pool, opt);
  const seen = new Set(state.seen);
  let cycle = state.cycle;
  let history = state.seen;
  let candidates = eligible.filter((q) => !seen.has(q.id));
  if (candidates.length === 0) {
    // The whole eligible pool was shown: a new cycle. The quote that closed the old one does not open the new one.
    const last = state.seen[state.seen.length - 1];
    cycle += 1;
    history = [];
    candidates = eligible.length > 1 ? eligible.filter((q) => q.id !== last) : eligible;
  }
  const tags = opt.preferTags && opt.preferTags.length > 0 ? new Set<string>(opt.preferTags) : null;
  if (tags) {
    const matching = candidates.filter((q) => q.tags.some((t) => tags.has(t)));
    if (matching.length > 0) candidates = matching;
  }
  const rnd = seededRandom(hashString(`${opt.seed}:${cycle}:${history.length}`));
  const pick = weightedPick(candidates, opt.weights, rnd);
  return { id: pick.id, state: { v: 1, cycle, seen: [...history, pick.id], current: { id: pick.id, slot } } };
}

/**
 * The quote for `slot`: the stored one when the slot has not changed (reload, second tab), else the next draw.
 * `changed` tells the caller to persist the new state.
 */
export function quoteForSlot(
  pool: readonly QuoteMeta[],
  state: RotationState,
  opt: PickOptions,
  slot: string,
): { id: string; state: RotationState; changed: boolean } | null {
  // The stored quote stays only while it is still eligible (in the library, its category on).
  const ids = new Set(eligiblePool(pool, opt).map((q) => q.id));
  if (state.current && state.current.slot === slot && ids.has(state.current.id)) return { id: state.current.id, state, changed: false };
  const next = nextQuote(pool, state, opt, slot);
  return next ? { ...next, changed: true } : null;
}

/** The name a browser keys its quote state by ("me" for a guest / no name). */
const userKey = (user: string | null | undefined) => (user || "me").trim().toLowerCase();

/** The reader's seed for a surface: the stored seed (or the name's hash) salted per surface. */
export function seedFor(seed: number | null | undefined, user: string | null | undefined, surface: Surface): number {
  const base = seed ?? hashString(userKey(user));
  return hashString(`${base}:${surface}`);
}

/** Validate a stored rotation (anything malformed → empty). */
export function parseRotation(raw: unknown): RotationState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || o.v !== 1 || !Array.isArray(o.seen)) return EMPTY_ROTATION;
  const seen = o.seen.filter((x): x is string => typeof x === "string").slice(-5000);
  const cur = o.current as { id?: unknown; slot?: unknown } | null | undefined;
  const current = cur && typeof cur.id === "string" && typeof cur.slot === "string" ? { id: cur.id, slot: cur.slot } : null;
  const cycle = typeof o.cycle === "number" && Number.isFinite(o.cycle) && o.cycle >= 0 ? Math.floor(o.cycle) : 0;
  return { v: 1, cycle, seen, current };
}
