/**
 * Simulator scenario picking (moved out of service.ts for «Тренажёр 2»): a fair ticker-day / daily window the player
 * has not seen, with the level's filters. Free intraday games are stored on 1-minute base bars whenever the day has
 * them (the client aggregates into the display tf), 5-minute otherwise; 1-minute days are preferred. Intraday days the
 * desk traded in the closing auction (15:50–16:00 NY) are out of the pool (lib/trainer/eligibility).
 *
 * Day rule (owner 2026-10-25, catalyst.ts): every day opens ≥ trainer.minGapPct from the previous close, up or down,
 * and has a catalyst (an earnings report or news). The rule is never relaxed: when the player has seen every eligible
 * day the recency rule relaxes (seen days come back), and with no eligible day at all the pick is null — the client
 * says that the exercises ran out until new days are archived. Swing windows START on such a day: the player sees
 * the history up to the day before, the first played daily bar is the gap.
 */
import { nyDate, nyMinutes, addDays } from "../tradingDate";
import { setting } from "../settings/registry";
import {
  SWING_SPECS, buildIntraday, buildSwing, dayFeatures, intradaySpecOf, seriesFeatures, tfSec, weightedSample,
  type BuiltScenario, type Difficulty, type IntradayTf, type SimMode, type SimTf,
} from "./scenario";
import type { SimBar } from "./engine";
import * as store from "./store";
import { catalystKeys, dayKey } from "./catalystStore";
import { isGapDay } from "./catalyst";
import { withoutBlockedDays } from "../trainer/eligibility";
import { blockedTickerDays } from "../trainer/eligibilityStore";

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

/** The desk's gap threshold (trainer.minGapPct, default 7). */
export const minGapPct = (): number => setting("trainer.minGapPct");

/**
 * Pure: the candidates that may be dealt — gapped ≥ `minGap` with a catalyst (`catalysts` = "TICKER:DAY" keys), not
 * blocked; seen days only when nothing unseen is left (`seen`).
 */
export function eligibleDays<T extends { ticker: string; day: string; gapPct: number | null }>(
  cands: readonly T[], minGap: number, catalysts: ReadonlySet<string>, seen: ReadonlySet<string>,
): { list: T[]; relaxed: boolean } {
  const ok = cands.filter((c) => isGapDay(c.gapPct, minGap) && catalysts.has(dayKey(c)));
  const fresh = ok.filter((c) => !seen.has(dayKey(c)));
  return fresh.length ? { list: fresh, relaxed: false } : { list: ok, relaxed: ok.length > 0 };
}

/** Build one archived day: on 1m base bars when the archive has them, else (or when that fails) on the game tf. */
async function buildDay(c: store.IntradayCandidate, tf: IntradayTf, d: Difficulty): Promise<Picked | null> {
  const spec = intradaySpecOf(d, tf);
  const data = await store.loadDayBars(c.ticker, c.day);
  if (!data || (data.tf !== "1m" && data.tf !== "5m") || (spec.tf !== "5m" && data.tf !== "1m")) return null;
  const tries: IntradayTf[] = data.tf === "1m" && spec.tf !== "1m" ? ["1m", spec.tf] : [spec.tf];
  for (const baseTf of tries) {
    const prev = await store.loadPrevDay(c.ticker, c.day, tfSec(baseTf), data.prevClose);
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
  const minGap = minGapPct();
  // The archive already knows each day's gap: the gap rule first, before any other read.
  const cands = (await store.intradayCandidates(lastPlayableDay(), need1m)).filter((c) => isGapDay(c.gapPct, minGap));
  if (!cands.length) return null;
  const [recent, daily, blocked] = await Promise.all([store.recentScenarioKeys(viewer.id, "intraday"), store.recentDailyKeys(), blockedTickerDays()]);
  // Trainer eligibility: never a ticker-day the desk traded in the closing auction (lib/trainer/eligibility).
  const open = withoutBlockedDays(cands, (c) => c, blocked).filter((c) => !daily.has(dayKey(c)));
  const { list: base } = eligibleDays(open, minGap, await catalystKeys(open), recent);
  if (!base.length) return null;
  // Range filter of the level (the gap + catalyst rule above is never relaxed; this one is).
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

/** Pure: indexes of daily bars that open ≥ `minGap` from the previous close (gap days), oldest first. */
export function gapDayIndexes(bars: readonly SimBar[], minGap: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].c;
    if (pc > 0 && isGapDay(((bars[i].o - pc) / pc) * 100, minGap)) out.push(i);
  }
  return out;
}

export async function pickSwing(viewer: PickViewer, d: Difficulty, rnd: () => number): Promise<Picked | null> {
  const spec = SWING_SPECS[d];
  const need = spec.history + spec.play;
  const minGap = minGapPct();
  const cands = await store.swingCandidates();
  if (!cands.length) return null;
  const recent = await store.recentScenarioKeys(viewer.id, "swing");
  const lastDay = lastPlayableDay();
  const tried = weightedSample(cands, 8, (c) => 1 + 2 * Math.log2(1 + c.desk), rnd);
  // Windows that start on a gap day: the first played bar (index from + history) is the gap.
  type Win = { ticker: string; bars: SimBar[]; dates: string[]; from: number; day: string; gapPct: number };
  const wins: Win[] = [];
  for (const c of tried) {
    const { bars, dates } = await store.loadDailySeries(c.ticker, lastDay);
    const runs = store.contiguousRuns(dates).filter(([a, b]) => b - a + 1 >= need);
    for (const j of gapDayIndexes(bars, minGap)) {
      const from = j - spec.history;
      if (runs.some(([a, b]) => from >= a && from + need - 1 <= b)) wins.push({ ticker: c.ticker, bars, dates, from, day: dates[j], gapPct: ((bars[j].o - bars[j - 1].c) / bars[j - 1].c) * 100 });
    }
  }
  if (!wins.length) return null;
  const { list } = eligibleDays(wins, minGap, await catalystKeys(wins), recent);
  let best: { p: Picked; rank: number } | null = null;
  for (const w of weightedSample(list, 6, () => 1, rnd)) {
    const built = buildSwing(w.bars, w.from, spec);
    if (!built) continue;
    const f = seriesFeatures(built.bars.slice(built.startIdx));
    const p: Picked = { ...built, ticker: w.ticker, day: w.day, dayTo: w.dates[w.from + need - 1], tf: "1d", baseTf: "1d" };
    if (spec.filter(f)) return p;
    const rank = spec.rank(f);
    if (!best || rank > best.rank) best = { p, rank };
  }
  return best?.p ?? null;
}

export function pickScenario(viewer: PickViewer, mode: SimMode, d: Difficulty, rnd: () => number, tf: IntradayTf | null): Promise<Picked | null> {
  return mode === "intraday" ? pickIntraday(viewer, d, rnd, tf) : pickSwing(viewer, d, rnd);
}
