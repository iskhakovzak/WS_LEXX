/**
 * Lock-screen easter egg «Свеча: выше/ниже»: a procedurally generated random-walk candle chart (NOT market data — the
 * lock screen never asks the API for anything) and the guess-the-next-candle streak. Pure: seeded RNG, no DOM.
 *
 * The walk: each candle opens at the previous close (no gaps), its return is a sum of uniforms (≈ normal) scaled by a
 * slowly wandering volatility plus a small mean-reverting drift, so the chart has trends and quiet stretches but no
 * edge to find. A close never equals the open after rounding to cents, so «выше / ниже» always has an answer.
 */

export type Candle = { o: number; h: number; l: number; c: number };

/** mulberry32: a tiny seeded PRNG → numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** ≈ standard normal from four uniforms (Irwin–Hall, variance 4/12 → scaled to 1). */
function gauss(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3);
}

export type Walk = { price: number; vol: number; anchor: number; rand: () => number };

export function newWalk(seed: number, price = 100): Walk {
  return { price, vol: 0.012, anchor: price, rand: mulberry32(seed) };
}

/** The next candle of the walk (mutates the walk's price / vol: it is the generator's cursor). */
export function nextCandle(w: Walk): Candle {
  const r = w.rand;
  // Volatility wanders between 0.5% and 2.5% per candle.
  w.vol = Math.min(0.025, Math.max(0.005, w.vol * Math.exp(gauss(r) * 0.12)));
  const drift = ((w.anchor - w.price) / w.anchor) * 0.02;
  const o = w.price;
  let c = cents(o * (1 + drift + gauss(r) * w.vol));
  if (c === o) c = cents(o + (r() < 0.5 ? -0.01 : 0.01));
  c = Math.max(0.01, c);
  if (c === o) c = cents(o + 0.01);
  const h = cents(Math.max(o, c) * (1 + Math.abs(gauss(r)) * w.vol * 0.45));
  const l = Math.max(0.01, cents(Math.min(o, c) * (1 - Math.abs(gauss(r)) * w.vol * 0.45)));
  w.price = c;
  return { o, h, l, c };
}

export function generateCandles(w: Walk, n: number): Candle[] {
  return Array.from({ length: n }, () => nextCandle(w));
}

export type Guess = "higher" | "lower";

/** Did the candle close higher or lower than the previous close (= its own open: the walk has no gaps)? */
export function outcomeOf(prevClose: number, next: Candle): Guess {
  return next.c > prevClose ? "higher" : "lower";
}

export type Streak = { streak: number; best: number; /** The streak that just broke (0 = none), for the joke line. */ broke: number; last: "right" | "wrong" | null };

export const NO_STREAK: Streak = { streak: 0, best: 0, broke: 0, last: null };

export function applyGuess(s: Streak, right: boolean): Streak {
  if (right) {
    const streak = s.streak + 1;
    return { streak, best: Math.max(s.best, streak), broke: 0, last: "right" };
  }
  return { streak: 0, best: s.best, broke: s.streak, last: "wrong" };
}

export const JOKE_COUNT = 6;

/** Which joke to show when a streak breaks: stable for a given streak, cycling through the list. */
export function jokeIndex(broke: number, salt = 0): number {
  return (((broke * 7 + salt) % JOKE_COUNT) + JOKE_COUNT) % JOKE_COUNT;
}
