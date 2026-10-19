/**
 * Simulator scenario picking (moved out of service.ts for «Тренажёр 2»): a fair ticker-day / daily window the player
 * has not seen, with the level's filters. Free intraday games are stored on 1-minute base bars whenever the day has
 * them (the client aggregates into the display tf), 5-minute otherwise; 1-minute days are preferred.
 */
import { nyDate, nyMinutes, addDays } from "../tradingDate";
import {
  SWING_SPECS, buildIntraday, buildSwing, dayFeatures, intradaySpecOf, seriesFeatures, tfSec, weightedSample,
  type BuiltScenario, type Difficulty, type IntradayTf, type SimMode, type SimTf,
} from "./scenario";
import * as store from "./store";

type PickViewer = { id: number };

/** Last day a game may be on: today only after the close (a live day has no end yet). */
export function lastPlayableDay(now = new Date()): string {
  const today = nyDate(now);
  return nyMinutes(now) >= 16 * 60 + 15 ? today : addDays(today, -1);
}

export type Picked = BuiltScenario & { ticker: string; day: string; dayTo: string | null; tf: SimTf; baseTf: SimTf };

/** Weight of an intraday candidate: desk activity, ×4 for a day with 1-minute bars (the 1m base series). */
export const intradayWeight = (c: Pick<store.IntradayCandidate, "desk" | "tf">): number =>
  (c.desk > 0 ? 4 + Math.log2(1 + c.desk) : 1) * (c.tf === "1m" ? 4 : 1);

/** Build one archived day: on 1m base bars when the archive has them, else (or when that fails) on the game tf. */
async function buildDay(c: store.IntradayCandidate, tf: IntradayTf, d: Difficulty): Promise<Picked | null> {
  const spec = intradaySpecOf(d, tf);
  const data = await store.loadDayBars(c.ticker, c.day);
  if (!data || (data.tf !== "1m" && data.tf !== "5m") || (spec.tf !== "5m" && data.tf !== "1m")) return null;
  const tries: IntradayTf[] = data.tf === "1m" && spec.tf !== "1m" ? ["1m", spec.tf] : [spec.tf];
  for (const baseTf of tries) {
    const prev = await store.loadPrevDay(c.ticker, c.day, tfSec(baseTf));
    const built = buildIntraday({ day: c.day, dayBars: data.bars, prevBars: prev?.bars ?? [], prevLevels: prev?.levels ?? null, spec, baseTf });
    if (!built) continue;
    if (built.levels.pdc == null && data.prevClose != null) built.levels.pdc = data.prevClose;
    return { ...built, ticker: c.ticker, day: c.day, dayTo: null, tf: spec.tf, baseTf };
  }
  return null;
}

export async function pickIntraday(viewer: PickViewer, d: Difficulty, rnd: () => number, tf: IntradayTf | null): Promise<Picked | null> {
  const spec = intradaySpecOf(d, tf);
  // 1m and 2m need archived 1-minute bars (2m is aggregated from them); 5m takes 1m or 5m days.
  const need1m = spec.tf !== "5m";
  const cands = await store.intradayCandidates(lastPlayableDay(), need1m);
  if (!cands.length) return null;
  const [recent, daily] = await Promise.all([store.recentScenarioKeys(viewer.id, "intraday"), store.recentDailyKeys()]);
  const open = cands.filter((c) => !daily.has(`${c.ticker}:${c.day}`));
  const fresh = open.filter((c) => !recent.has(`${c.ticker}:${c.day}`));
  const base = fresh.length ? fresh : open;
  // The archive already knows each day's gap and range: filter before reading any bars.
  const fits = base.filter((c) => c.rangePct != null && spec.filter({ gapPct: c.gapPct ?? 0, rangePct: c.rangePct }));
  const tried = weightedSample(fits.length ? fits : base, 8, (c) => intradayWeight(c), rnd);
  let best: { p: Picked; rank: number } | null = null;
  for (const c of tried) {
    const p = await buildDay(c, spec.tf, d);
    if (!p) continue;
    const f = dayFeatures(p.levels.pdc, p.bars.slice(p.startIdx + 1));
    if (!f) continue;
    if (spec.filter(f)) return p;
    const rank = spec.rank(f);
    if (!best || rank > best.rank) best = { p, rank };
  }
  return best?.p ?? null;
}

export async function pickSwing(viewer: PickViewer, d: Difficulty, rnd: () => number): Promise<Picked | null> {
  const spec = SWING_SPECS[d];
  const need = spec.history + spec.play;
  const cands = await store.swingCandidates();
  if (!cands.length) return null;
  const recent = await store.recentScenarioKeys(viewer.id, "swing");
  const lastDay = lastPlayableDay();
  const tried = weightedSample(cands, 6, (c) => 1 + 2 * Math.log2(1 + c.desk), rnd);
  let best: { p: Picked; rank: number } | null = null;
  for (const c of tried) {
    const { bars, dates } = await store.loadDailySeries(c.ticker, lastDay);
    const runs = store.contiguousRuns(dates).filter(([a, b]) => b - a + 1 >= need);
    if (!runs.length) continue;
    for (let attempt = 0; attempt < 4; attempt++) {
      const [a, b] = runs[Math.floor(rnd() * runs.length)];
      const from = a + Math.floor(rnd() * (b - a + 2 - need));
      const day = dates[from + spec.history];
      if (recent.has(`${c.ticker}:${day}`)) continue;
      const built = buildSwing(bars, from, spec);
      if (!built) continue;
      const f = seriesFeatures(built.bars.slice(built.startIdx));
      const p: Picked = { ...built, ticker: c.ticker, day, dayTo: dates[from + need - 1], tf: "1d", baseTf: "1d" };
      if (spec.filter(f)) return p;
      const rank = spec.rank(f);
      if (!best || rank > best.rank) best = { p, rank };
    }
  }
  return best?.p ?? null;
}

export function pickScenario(viewer: PickViewer, mode: SimMode, d: Difficulty, rnd: () => number, tf: IntradayTf | null): Promise<Picked | null> {
  return mode === "intraday" ? pickIntraday(viewer, d, rnd, tf) : pickSwing(viewer, d, rnd);
}
