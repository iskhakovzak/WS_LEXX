/**
 * «Позиция офиса» on the desk-day chart — the whole desk as ONE position on a ticker-day (owner 2026-10-18: «как позиция
 * офиса в целом по процентажу, где сколько кто зашёл, основную позу как офис полностью и где выходили»). Pure.
 *
 * Input: every trade of the ticker-day with its structure (lib/tradeStructure legs: opening flag, shares, time). Each
 * sized, timed leg moves the office's signed net position (long +, short −): a long's opening leg buys (+qty), its
 * closing leg sells (−qty); a short mirrors it. A position carried in from before the first fill (overnight) starts the
 * walk. Legs without shares or time (report-only trades) are left out and counted in `coverage`.
 *
 *   side        the office's main side = the side with more $ in opening legs over the whole day (ROMAN-14: five 09:30
 *               shorts that lost $700 are the office's position, not two longs into the close); tie → larger position.
 *   path        per minute with fills: the position farthest from flat inside the minute, then its close (step
 *               function; the client samples it per chart bar), as % of the day's maximum absolute office position —
 *               traders see the shape, never the size.
 *   peak        the largest main-side position after any fill instant.
 *   avgEntry    VWAP of every opening leg of main-side trades; avgExit — of every closing leg of main-side trades.
 *   build zone  the core of the build-up: from the instant the position passed 20 % of the peak to the instant it
 *               passed 80 % (counted from the last instant the office was flat or on the other side before the
 *               peak); time = first / last fill that grew the position in that window, price range + VWAP of those fills.
 *   exit zone   the core of the unwind after the peak: from the instant it fell under 80 % to the one under 20 %.
 *               No exit zone when the office never got back under 20 % (held into the close / overnight).
 *   contributors  at the peak: each trader's position on the office's side ÷ the sum of all positions on that
 *               side (shares add up to 100 % even when someone is against the office), top 5; `against` counts the rest.
 *
 * Privacy (who gets shares / office $) is decided by the caller (lib/deskDay.ts): this file computes everything.
 * Unit-tested in __tests__/deskOffice.test.ts.
 */
import type { Side, TradeStructure } from "./tradeStructure";

/** One leg of the walk (exported for tests). */
export interface OfficeEvent {
  /** Epoch ms. */
  t: number;
  trader: string;
  /** Side of the trade the leg belongs to. */
  side: Side;
  opening: boolean;
  price: number;
  qty: number;
  /** Signed change of the office position (shares). */
  delta: number;
}

export interface OfficeZone {
  from: string;
  to: string;
  low: number;
  high: number;
  vwap: number;
}

export interface OfficeContributor {
  trader: string;
  /** Share of the office-side positions at the peak, 0–1 (positions against the office are not listed). */
  share: number;
}

export interface OfficePoint {
  /** Minute start, epoch seconds. */
  t: number;
  /** Signed % of the peak (−100…100). */
  pct: number;
  /** Signed shares (staff only; null otherwise). */
  shares: number | null;
}

export interface OfficePosition {
  side: Side;
  /** Traders whose legs moved the walk. */
  traders: number;
  peakAt: string;
  /** Signed peak in shares (staff only; null otherwise). */
  peakShares: number | null;
  /** % of the peak before the first fill (overnight carry; usually 0). */
  startPct: number;
  path: OfficePoint[];
  avgEntry: number | null;
  avgExit: number | null;
  build: OfficeZone | null;
  exit: OfficeZone | null;
  /** Office net $ of the ticker-day (all trades); null when unknown or hidden. */
  net: number | null;
  contributors: OfficeContributor[];
  /** Traders positioned against the office at the peak. */
  against: number;
  /** Share of the day's legs that carried shares + time (1 = every leg used). */
  coverage: number;
}

export const ZONE_FROM = 0.2;
export const ZONE_TO = 0.8;
export const TOP_CONTRIBUTORS = 5;

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** The walk's legs, oldest first, plus the carried-in start and coverage. */
export function officeEvents(
  trades: readonly { id: number; trader: string }[], structures: ReadonlyMap<number, TradeStructure>,
): { events: OfficeEvent[]; start: number; startBy: Map<string, number>; coverage: number } {
  const events: OfficeEvent[] = [];
  const startBy = new Map<string, number>();
  let start = 0, legs = 0, used = 0;
  for (const tr of trades) {
    const s = structures.get(tr.id);
    if (!s) continue;
    const side: Side = s.stats.side === "short" ? "short" : "long";
    const dir = side === "short" ? -1 : 1;
    const carry = s.legs[0]?.positionBefore ?? 0;
    if (carry > 0) { start += dir * carry; startBy.set(tr.trader, (startBy.get(tr.trader) ?? 0) + dir * carry); }
    for (const l of s.legs) {
      legs++;
      const t = l.at ? Date.parse(l.at) : Number.NaN;
      if (l.qty == null || !(l.qty > 0) || !Number.isFinite(t) || !(l.price > 0)) continue;
      used++;
      events.push({ t, trader: tr.trader, side, opening: l.opening, price: l.price, qty: l.qty, delta: dir * (l.opening ? 1 : -1) * l.qty });
    }
  }
  // Same instant: opening legs after closing ones (a flip through zero does not fake a double-size peak).
  events.sort((a, b) => a.t - b.t || Number(a.opening) - Number(b.opening));
  return { events, start, startBy, coverage: legs ? round(used / legs, 3) : 0 };
}

function zone(evs: readonly OfficeEvent[], from: number, to: number, grow: (e: OfficeEvent) => boolean): OfficeZone | null {
  let lo = Infinity, hi = -Infinity, pv = 0, q = 0, first = Infinity, last = -Infinity;
  for (const e of evs) {
    if (e.t < from || e.t > to || !grow(e)) continue;
    lo = Math.min(lo, e.price); hi = Math.max(hi, e.price); pv += e.price * e.qty; q += e.qty;
    first = Math.min(first, e.t); last = Math.max(last, e.t);
  }
  if (!q) return null;
  return { from: new Date(first).toISOString(), to: new Date(last).toISOString(), low: round(lo), high: round(hi), vwap: round(pv / q) };
}

const vwap = (evs: readonly OfficeEvent[]) => {
  let pv = 0, q = 0;
  for (const e of evs) { pv += e.price * e.qty; q += e.qty; }
  return q ? round(pv / q) : null;
};

/** +1 long / −1 short / 0 none: the side with more $ in opening legs; a tie goes to the larger position reached. */
export function mainSign(events: readonly OfficeEvent[], steps: readonly { pos: number }[], start = 0): 1 | -1 | 0 {
  let longUsd = 0, shortUsd = 0;
  for (const e of events) {
    if (!e.opening) continue;
    if (e.side === "short") shortUsd += e.price * e.qty; else longUsd += e.price * e.qty;
  }
  if (Math.abs(longUsd - shortUsd) > 1e-6) return longUsd > shortUsd ? 1 : -1;
  let best = start;
  for (const x of steps) if (Math.abs(x.pos) > Math.abs(best)) best = x.pos;
  return best > 0 ? 1 : best < 0 ? -1 : 0;
}

/**
 * Chart path per minute with fills (the finest bar): the point farthest from flat inside the minute at the minute
 * start, then — when the minute ended elsewhere — its close at second 59. A position opened and closed inside one
 * minute (the 09:30 auction) stays visible instead of vanishing between two minute closes.
 */
export function minutePath(steps: readonly { t: number; pos: number }[], point: (pos: number) => Omit<OfficePoint, "t">): OfficePoint[] {
  const out: OfficePoint[] = [];
  for (let k = 0; k < steps.length;) {
    const m = Math.floor(steps[k].t / 60_000) * 60_000;
    let ext = steps[k].pos, close = steps[k].pos;
    for (; k < steps.length && steps[k].t < m + 60_000; k++) {
      if (Math.abs(steps[k].pos) > Math.abs(ext)) ext = steps[k].pos;
      close = steps[k].pos;
    }
    out.push({ t: m / 1000, ...point(ext) });
    if (Math.abs(close - ext) > 1e-9) out.push({ t: m / 1000 + 59, ...point(close) });
  }
  return out;
}

/**
 * The office position of one ticker-day. `nets` = net $ per trade (null = unknown). Returns null when no leg carries
 * shares + time, or the office never held a position.
 */
export function officePosition(
  trades: readonly { id: number; trader: string }[], structures: ReadonlyMap<number, TradeStructure>,
  nets: readonly (number | null)[], withShares: boolean,
): OfficePosition | null {
  const { events, start, startBy, coverage } = officeEvents(trades, structures);
  if (!events.length) return null;

  // The walk per instant: the position after the last fill of each timestamp (fills of one auction print move it at once).
  const steps: { t: number; pos: number; last: number }[] = [];
  let p = start;
  for (let i = 0; i < events.length; i++) {
    p += events[i].delta;
    if (steps.length && steps[steps.length - 1].t === events[i].t) { steps[steps.length - 1].pos = p; steps[steps.length - 1].last = i; } else steps.push({ t: events[i].t, pos: p, last: i });
  }

  // Main side = where the office put most of its money that day (ROMAN-14): $ of the opening legs per side. Reading it
  // off the last minutes instead made five 09:30 shorts (−$700) lose to two 15:57 longs. A tie → the larger position.
  const s = mainSign(events, steps, start);
  if (s === 0) return null;
  const side: Side = s > 0 ? "long" : "short";
  let peakStep = -1, peakAbs = Math.max(0, s * start);
  for (let k = 0; k < steps.length; k++) if (s * steps[k].pos > peakAbs + 1e-9) { peakAbs = s * steps[k].pos; peakStep = k; }
  if (peakStep < 0 || peakAbs <= 0) return null;
  const peak = steps[peakStep].pos;
  // The pane's scale: the day's largest position on either side (a bigger spike against the office stays inside ±100).
  const scale = steps.reduce((m, x) => Math.max(m, Math.abs(x.pos)), Math.max(peakAbs, Math.abs(start)));
  const pct = (x: number) => round((x / scale) * 100, 1);
  const path = minutePath(steps, (x) => ({ pct: pct(x), shares: withShares ? round(x, 2) : null }));

  // Build: counted from the last flat / other-side instant before the peak.
  let base = -1;
  for (let k = peakStep - 1; k >= 0; k--) if (s * steps[k].pos <= 0) { base = k; break; }
  const firstStep = (from: number, to: number, ok: (x: number) => boolean) => {
    for (let k = Math.max(0, from); k <= to; k++) if (ok(s * steps[k].pos)) return k;
    return -1;
  };
  const span = (a: number, b: number): [number, number] => [steps[a].t, steps[b].t];
  const b0 = firstStep(base + 1, peakStep, (x) => x >= ZONE_FROM * peakAbs);
  const b1 = b0 >= 0 ? firstStep(b0, peakStep, (x) => x >= ZONE_TO * peakAbs) : -1;
  const build = b0 >= 0 && b1 >= 0 ? zone(events, ...span(b0, b1), (e) => s * e.delta > 0) : null;
  const e0 = firstStep(peakStep + 1, steps.length - 1, (x) => x <= ZONE_TO * peakAbs);
  const e1 = e0 >= 0 ? firstStep(e0, steps.length - 1, (x) => x <= ZONE_FROM * peakAbs) : -1;
  const exit = e0 >= 0 && e1 >= 0 ? zone(events, ...span(e0, e1), (e) => s * e.delta < 0) : null;
  const peakIdx = steps[peakStep].last;

  // Contributors at the peak.
  const at = new Map(startBy);
  for (let i = 0; i <= peakIdx; i++) at.set(events[i].trader, (at.get(events[i].trader) ?? 0) + events[i].delta);
  const gross = [...at.values()].reduce((a, q) => a + Math.max(0, s * q), 0) || 1;
  const shares = [...at].map(([trader, q]) => ({ trader, share: round((s * q) / gross, 3) }));
  const contributors = shares.filter((x) => x.share > 0.0005).sort((a, b) => b.share - a.share || a.trader.localeCompare(b.trader)).slice(0, TOP_CONTRIBUTORS);

  const main = events.filter((e) => e.side === side);
  return {
    side,
    traders: new Set(events.map((e) => e.trader)).size,
    peakAt: new Date(events[peakIdx].t).toISOString(),
    peakShares: withShares ? round(peak, 2) : null,
    startPct: pct(start),
    path,
    avgEntry: vwap(main.filter((e) => e.opening)),
    avgExit: vwap(main.filter((e) => !e.opening)),
    build,
    exit,
    net: nets.length && nets.every((n) => n != null) ? round(nets.reduce<number>((a, n) => a + (n as number), 0), 2) : null,
    contributors,
    against: shares.filter((x) => x.share < -0.0005).length,
    coverage,
  };
}
