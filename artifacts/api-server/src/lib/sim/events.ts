/**
 * «Тренажёр 2» event jump (step `until: "event"`): the next market event of an intraday game — pure, causal (an event
 * at bar i is decided from bars ≤ i only, so jumping to it never peeks past what the player is shown anyway).
 *
 *   pdh / pdl / pmh / pml   the bar crosses the level: up = previous close < level ≤ high, down = previous close >
 *                           level ≥ low; after any cross a level re-arms only after ≥ 5 minutes of closes on one
 *                           side (then it may fire away from that side) — no whipsaw events in a chop.
 *   hod / lod               a new session high / low beyond one that had stood ≥ 15 minutes.
 *   vwap                    the close crosses the session VWAP after ≥ 5 minutes of closes on the other side.
 *   volume                  bar volume ≥ 2.5 × the mean of the previous 20 regular-session bars.
 * Only regular-session bars of the play day (the date of the game's last bar) emit events. The «fill» event (a bracket
 * filled during the jump) is added by the service from the engine's fills.
 */
import type { SimBar } from "./engine";
import { RTH_CLOSE, RTH_OPEN, etOf, type Levels } from "./scenario";

export type EventKind = "pdh" | "pdl" | "pmh" | "pml" | "hod" | "lod" | "vwap" | "volume" | "fill";
export type MarketEvent = { kind: EventKind; dir: "up" | "down"; idx: number; level: number | null };

export const EVENT_RULES = { levelRearmMin: 5, extremeAgeMin: 15, vwapSideMin: 5, volumeMult: 2.5, volumeLookback: 20 } as const;

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const minsToBars = (min: number, baseSec: number) => Math.max(1, Math.round((min * 60) / baseSec));

type LevelState = { key: "pdh" | "pdl" | "pmh" | "pml"; px: number; armedUp: boolean; armedDown: boolean; below: number; above: number };

/**
 * First event with index in [from, to] (inclusive), or null. `endIdx`: the game's last bar (its date is the play day).
 */
export function findEvent(bars: readonly SimBar[], levels: Levels, baseSec: number, from: number, to: number, endIdx = bars.length - 1): MarketEvent | null {
  if (from > to || !bars.length) return null;
  const last = bars[Math.min(endIdx, bars.length - 1)];
  if (!last) return null;
  const playDay = etOf(last.t).date;
  const rth = bars.map((b) => { const e = etOf(b.t); return e.min >= RTH_OPEN && e.min < RTH_CLOSE ? e.date : null; });
  const first = rth.findIndex((d) => d === playDay);
  if (first < 0) return null;
  const rearm = minsToBars(EVENT_RULES.levelRearmMin, baseSec);
  const age = minsToBars(EVENT_RULES.extremeAgeMin, baseSec);
  const vwapRun = minsToBars(EVENT_RULES.vwapSideMin, baseSec);

  const lv: LevelState[] = (["pmh", "pml", "pdh", "pdl"] as const)
    .filter((k) => levels[k] != null && Number.isFinite(levels[k]))
    .map((k) => ({ key: k, px: levels[k] as number, armedUp: true, armedDown: true, below: 0, above: 0 }));
  // Volumes of earlier regular-session bars (the previous session in the series counts as history).
  const vols: number[] = [];
  for (let i = 0; i < first; i++) if (rth[i]) vols.push(bars[i].v);

  let hod = -Infinity, lod = Infinity, hodIdx = -1, lodIdx = -1;
  let pv = 0, vv = 0, vSide = 0, vRun = 0;
  const stop = Math.min(to, endIdx, bars.length - 1);
  for (let i = first; i <= stop; i++) {
    const b = bars[i];
    if (rth[i] !== playDay) continue;
    const prevC = i > 0 ? bars[i - 1].c : b.o;
    const emit = i >= from;
    let ev: MarketEvent | null = null;

    // Levels (premarket first: the classic open break).
    for (const L of lv) {
      const up = prevC < L.px && b.h >= L.px, down = prevC > L.px && b.l <= L.px;
      if (!ev && up && L.armedUp) ev = { kind: L.key, dir: "up", idx: i, level: L.px };
      else if (!ev && down && L.armedDown) ev = { kind: L.key, dir: "down", idx: i, level: L.px };
      // Any touch of the level disarms it both ways: no whipsaw events while price chops around it.
      if (up || down) { L.armedUp = false; L.armedDown = false; }
      if (b.c < L.px) { L.below++; L.above = 0; } else { L.above++; L.below = 0; }
      if (L.below >= rearm) L.armedUp = true;
      if (L.above >= rearm) L.armedDown = true;
    }

    // Session extremes.
    if (i > first) {
      if (!ev && b.h > hod && i - hodIdx >= age) ev = { kind: "hod", dir: "up", idx: i, level: r4(hod) };
      else if (!ev && b.l < lod && i - lodIdx >= age) ev = { kind: "lod", dir: "down", idx: i, level: r4(lod) };
    }
    if (b.h > hod) { hod = b.h; hodIdx = i; }
    if (b.l < lod) { lod = b.l; lodIdx = i; }

    // VWAP (typical price × volume since the open).
    const v = Math.max(0, b.v || 0);
    pv += ((b.h + b.l + b.c) / 3) * v;
    vv += v;
    if (vv > 0) {
      const vwap = pv / vv;
      const side = b.c > vwap ? 1 : b.c < vwap ? -1 : vSide;
      if (side !== vSide && vSide !== 0 && vRun >= vwapRun && !ev) ev = { kind: "vwap", dir: side > 0 ? "up" : "down", idx: i, level: r4(vwap) };
      if (side === vSide) vRun++; else { vSide = side; vRun = 1; }
    }

    // Volume spike.
    if (vols.length >= EVENT_RULES.volumeLookback) {
      const recent = vols.slice(-EVENT_RULES.volumeLookback);
      const avg = recent.reduce((a, x) => a + x, 0) / recent.length;
      if (!ev && avg > 0 && b.v >= EVENT_RULES.volumeMult * avg) ev = { kind: "volume", dir: b.c >= b.o ? "up" : "down", idx: i, level: null };
    }
    vols.push(b.v);

    if (ev && emit) return ev;
  }
  return null;
}
