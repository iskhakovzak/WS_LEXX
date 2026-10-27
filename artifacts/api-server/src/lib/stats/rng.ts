/**
 * Seeded randomness for every resampling of the coaching statistics (ALGORITHMS P1: «every bootstrap is seeded», so a
 * re-run gives identical numbers). Pure: no Math.random, no clock.
 *
 *   rngFor(seed, ...parts)   an independent stream per (job seed, trader, slice …): the order in which a job visits
 *                            traders or slices never changes a result.
 */
import { mulberry32 } from "../whatIfTypes";

/** Job-wide default seed (the same as whatIf.pairedDayBootstrap). */
export const STATS_SEED = 20260101;

export type Rng = () => number;

/** FNV-1a 32-bit hash of a string (stable across platforms). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A uniform [0, 1) generator for `seed` mixed with the given parts (trader, slice key …). */
export function rngFor(seed: number, ...parts: readonly (string | number)[]): Rng {
  const mixed = parts.length ? (seed ^ hash32(parts.map(String).join("\u0001"))) >>> 0 : seed >>> 0;
  return mulberry32(mixed);
}

/** Integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Standard normal draw (Box–Muller; one value per call). For simulations and tests. */
export function randNormal(rng: Rng): number {
  let u = 0;
  while (u <= Number.EPSILON) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
