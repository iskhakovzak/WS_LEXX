/**
 * Synthetic traders for the edge-map simulations (roadmap R4 tests). Entirely made up: no desk data, no real person.
 * A trader trades `perDay` times a day (Poisson-ish) on consecutive weekdays; each trade's net $ is
 * N(edge(trade), sigma²), notional ≈ $5k (±50%), entry times spread over the premarket / session / after-hours.
 */
import type { EdgeTrade } from "../../edgeMap";
import { randInt, randNormal, rngFor, type Rng } from "../../stats";

export type SynthOpts = {
  trader: string;
  days: number;
  perDay?: number;
  sigmaUsd?: number;
  seed?: number;
  /** $ per trade added to a trade (true edge); default 0. Receives the entry minute and the index in the day. */
  edge?: (t: { entryMin: number; k: number }) => number;
  startDay?: string;
};

/** The first `n` weekdays from `start` (YYYY-MM-DD). */
export function weekdays(n: number, start = "2025-01-06"): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function entryMinute(rng: Rng): number {
  const u = rng();
  if (u < 0.15) return 7 * 60 + rng() * 150; // premarket 07:00–09:30
  if (u < 0.95) return 9 * 60 + 30 + rng() * 390; // session
  return 16 * 60 + rng() * 60; // after hours
}

const TICKERS = Array.from({ length: 40 }, (_, i) => `SYN${i}`);

export function synthTrader(o: SynthOpts): EdgeTrade[] {
  const rng = rngFor(o.seed ?? 1, "synth", o.trader);
  const perDay = o.perDay ?? 4;
  const sigma = o.sigmaUsd ?? 60;
  const out: EdgeTrade[] = [];
  for (const day of weekdays(o.days, o.startDay)) {
    const n = Math.max(1, Math.round(perDay + (rng() - 0.5) * perDay));
    const entries = Array.from({ length: n }, () => entryMinute(rng)).sort((a, b) => a - b);
    entries.forEach((entryMin, k) => {
      const hold = 1 + rng() * 30;
      const notional = 5000 * (0.5 + rng());
      const price = [3, 7, 15, 30, 70][randInt(rng, 5)] * (0.8 + 0.4 * rng());
      const edge = o.edge ? o.edge({ entryMin, k }) : 0;
      out.push({
        trader: o.trader, day, entryMin, exitMin: entryMin + hold < 24 * 60 ? entryMin + hold : null, seq: k,
        net: edge + sigma * randNormal(rng), notional, price, side: rng() < 0.6 ? "long" : "short",
        ticker: TICKERS[Math.min(TICKERS.length - 1, Math.floor(TICKERS.length * rng() ** 2))],
        sizeRel: Math.exp(0.4 * randNormal(rng)),
      });
    });
  }
  return out;
}

/** Entry minute inside the desk's 11:15–13:30 bucket (the «midday» slice). */
export const isMidday = (m: number) => m >= 11 * 60 + 15 && m < 13 * 60 + 30;
