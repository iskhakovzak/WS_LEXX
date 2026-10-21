/** Synthetic trades for the what-if engine tests (no DB). Deterministic: a seeded RNG, cent-valued money. */
import type { ErrorVocabCode } from "../tradingErrors";
import { mulberry32, round2, type SimTrade } from "../whatIfTypes";

let seq = 0;

/** One trade with sensible defaults (day 2026-10-01, 10:00 ET, AAA long 100 sh. @ $10, no fees). */
export function mk(p: Partial<SimTrade> & { gross: number }): SimTrade {
  seq++;
  return {
    id: seq, day: "2026-10-01", entryMin: 600, ticker: "AAA", side: "long", qty: 100, entry: 10, exit: 11,
    fees: 0, holdSec: 60, r: null, stop: null, setup: null, tags: [], horizon: "intraday", result: null, seq, ...p,
  };
}

/** `n` consecutive calendar days from 2026-01-01 (YYYY-MM-DD). */
export function dayList(n: number, start = "2026-01-01"): string[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
}

const TICKERS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK", "LLL"];
const SETUPS = ["ORB", "Fade", "VWAP", "Gap"];
const GRADES = ["A+", "A", "B", "C"];
const MISTAKES: ErrorVocabCode[] = ["fomo", "offPlan", "earlyEntry", "revenge", "offSetup", "overtrading", "noStop", "lateExit"];
const PTAGS = ["breakout", "news", "fade", "halt"];

/**
 * Noise trades with every field populated: `traders` traders × `days` days × `perDay` trades, net ≈ N(0, 40) in cents,
 * size to the usual ≈ log-normal around 1×.
 * Nothing here carries an effect, so a sound search should call nothing robust on it.
 */
export function mixedTrades(o: { traders: number; days: number; perDay: number; seed?: number }): SimTrade[] {
  const rnd = mulberry32(o.seed ?? 7);
  const pick = <T>(a: readonly T[]): T => a[(rnd() * a.length) | 0];
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73;
  const out: SimTrade[] = [];
  let id = 100_000;
  for (const day of dayList(o.days)) {
    for (let tr = 0; tr < o.traders; tr++) {
      for (let k = 0; k < o.perDay; k++) {
        id++;
        const entryMin = 540 + Math.floor(rnd() * 451);
        const qty = 10 * (5 + Math.floor(rnd() * 96));
        const r = rnd();
        out.push({
          id, day, entryMin, ticker: pick(TICKERS), side: rnd() < 0.5 ? "long" : "short", qty,
          entry: round2(1 + rnd() * 299), exit: null,
          gross: round2(gauss() * 40), fees: round2(qty * 0.004), holdSec: Math.floor(10 + rnd() * 3600),
          r: null, stop: null, setup: rnd() < 0.7 ? pick(SETUPS) : null, tags: [], horizon: "intraday", result: null,
          seq: id, grade: rnd() < 0.7 ? pick(GRADES) : null,
          trader: `T${tr}`, imx: entryMin >= 950, reentry: rnd() < 0.12, sizeRel: round2(Math.exp(gauss() * 0.5)),
          hasStop: r < 0.4 ? true : r < 0.8 ? false : null,
          mistakes: rnd() < 0.15 ? [pick(MISTAKES)] : [], ptags: rnd() < 0.25 ? [pick(PTAGS)] : [],
        });
      }
    }
  }
  return out;
}
