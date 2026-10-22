/** Planted-effect fixtures of the honest suggestion path (no DB). Deterministic: seeded RNG, cent-valued money. */
import { mulberry32, round2, type SimTrade } from "../whatIfTypes";
import { dayList, mixedTrades } from "./whatIfFixtures";

/** One trader, `days` calendar days × `perDay` trades, zero-mean noise (sd ≈ $40), every field populated, no fees. */
export function noise(seed: number, days = 200, perDay = 6): SimTrade[] {
  return mixedTrades({ traders: 1, days, perDay, seed }).map((t) => ({ ...t, fees: 0 }));
}

/** Trades grouped by day, in array order. */
function byDay(trades: SimTrade[]): Map<string, SimTrade[]> {
  const out = new Map<string, SimTrade[]>();
  for (const t of trades) out.set(t.day, [...(out.get(t.day) ?? []), t]);
  return out;
}

/**
 * The `slot`-th trade of every day where `present(day)` becomes ticker `ticker` (and setup `setup` when given) with a
 * net of mean(day) ± jitter/2 (default ± 20); the other trades of that day get the opposite amount spread over them,
 * so the trader's mean stays 0 and a rule that removes trades at random has no effect.
 */
export function plant(trades: SimTrade[], o: {
  seed: number; ticker?: string; setup?: string; slot?: number; jitter?: number;
  present?: (day: string, i: number) => boolean; mean?: (day: string, i: number) => number;
}): SimTrade[] {
  const rnd = mulberry32(o.seed);
  const slot = o.slot ?? 0;
  const out: SimTrade[] = [];
  [...byDay(trades).entries()].forEach(([day, ts], i) => {
    if (!(o.present ?? (() => true))(day, i)) { out.push(...ts.map((t) => (o.ticker && t.ticker === o.ticker ? { ...t, ticker: "ZZZ" } : t))); return; }
    const mean = (o.mean ?? (() => -50))(day, i);
    const comp = -mean / (ts.length - 1);
    ts.forEach((t, k) => {
      if (k === slot) out.push({ ...t, ...(o.ticker ? { ticker: o.ticker } : {}), ...(o.setup ? { setup: o.setup } : {}), gross: round2(mean + (rnd() - 0.5) * (o.jitter ?? 40)) });
      else out.push({ ...t, gross: round2((t.gross ?? 0) + comp) });
    });
  });
  return out;
}

/**
 * Sequential trades (one trader, `perDay` per day, entries 20 min apart, 5-min holds: every trade is closed before the
 * next entry), zero-mean noise; with `tilt`, every entry after the day's 2nd CONSECUTIVE realised loss loses `tilt`
 * more (what «стоп после 2 убытков подряд» removes). `drift` shifts every trade.
 */
export function sequentialDays(seed: number, o: { days?: number; perDay?: number; tilt?: number; drift?: number } = {}): SimTrade[] {
  const rnd = mulberry32(seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73;
  const out: SimTrade[] = [];
  let id = 500_000;
  for (const day of dayList(o.days ?? 220)) {
    let run = 0, tilted = false;
    for (let k = 0; k < (o.perDay ?? 8); k++) {
      id++;
      let gross = round2(gauss() * 40 + (o.drift ?? 0));
      if (tilted && o.tilt) gross = round2(gross - o.tilt);
      out.push({
        id, day, entryMin: 600 + 20 * k, ticker: ["AAA", "BBB", "CCC", "DDD"][k % 4], side: rnd() < 0.5 ? "long" : "short", qty: 100,
        entry: round2(5 + rnd() * 100), exit: null, gross, fees: 0, holdSec: 300, r: null, stop: null, setup: null, tags: [],
        horizon: "intraday", result: null, seq: id, trader: "T0", imx: false, reentry: false, sizeRel: 1, hasStop: null, mistakes: [], ptags: [],
      });
      run = gross < 0 ? run + 1 : gross > 0 ? 0 : run;
      if (run >= 2) tilted = true;
    }
  }
  return out;
}
