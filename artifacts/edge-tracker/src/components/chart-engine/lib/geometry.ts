/**
 * Everything derived from bars + executions for one timeframe, in one pure call (memoised by the
 * component). Keeps WsChart.tsx free of maths.
 */
import type { Bar, Candle, DayLevels, ExcursionResult, Execution, Fill, MarketEventLite, PositionPoint, Side, TradeLike, VolumeProfile } from "../types";
import { barIndexForTime, etParts, etWallToEpoch, findBarIndex, sessionOfMinutes } from "./time";
import { avgEntryPrice, avgExitPrice, excursion, firstEntryIdx, grossFromFills, lastExitIdx, positionSeries, positionSize, resolveFills, riskPerShare, sideOf, toNum } from "./position";
import { anchoredVwap, sessionVwap } from "./vwap";
import { dayLevels } from "./levels";
import { volumeProfile } from "./profile";
import { rvolSeries } from "./rvol";

export type VwapIdxPoint = { idx: number; vwap: number; sd: number };
export type EventIdx = { id: number; idx: number; text: string };

export type Geometry = {
  side: Side;
  fills: Fill[];
  /** Fills on the base (finest) bars — used for MFE/MAE. */
  baseFills: Fill[];
  entryIdx: number | null;
  exitIdx: number | null;
  entryTime: number | null;
  exitTime: number | null;
  avgEntry: number | null;
  avgExit: number | null;
  qty: number | null;
  risk: number | null;
  stop: number | null;
  target: number | null;
  grossUsd: number | null;
  position: PositionPoint[];
  excursion: ExcursionResult | null;
  mfeIdx: number | null;
  maeIdx: number | null;
  levels: DayLevels;
  vwap: VwapIdxPoint[];
  avwap: VwapIdxPoint[];
  rvol: (number | null)[];
  profile: VolumeProfile | null;
  events: EventIdx[];
  /** Index range of the trade day (ET) inside `bars`. */
  dayRange: { from: number; to: number } | null;
};

export type GeometryInput = {
  bars: readonly Bar[];
  barSec: number;
  baseBars: readonly Candle[];
  baseSec: number;
  trade: TradeLike;
  executions: readonly Execution[];
  prevClose: number | null;
  dateKey: string;
  target?: number | null;
  events?: readonly MarketEventLite[];
  intraday: boolean;
};

export function buildGeometry(input: GeometryInput): Geometry {
  const { bars, barSec, baseBars, baseSec, trade, executions, prevClose, dateKey, intraday } = input;
  const side = sideOf(trade);
  const fallback = { entry: toNum(trade.entry), exit: toNum(trade.exit), qty: trade.qty ?? null, dayKey: dateKey };
  const fills = resolveFills(bars, barSec, executions, fallback);
  const baseFills = baseBars === bars ? fills : resolveFills(baseBars, baseSec, executions, fallback);
  const entryIdx = firstEntryIdx(fills);
  const exitIdx = lastExitIdx(fills);
  const avgEntry = avgEntryPrice(fills) ?? toNum(trade.entry);
  const avgExit = avgExitPrice(fills) ?? toNum(trade.exit);
  const stop = toNum(trade.stop);
  const risk = riskPerShare(avgEntry, stop);
  const qty = positionSize(fills, trade.qty ?? null);
  const entryFill = fills.find((f) => f.kind === "entry" || f.kind === "add") ?? null;
  const exitFillsAtEnd = fills.filter((f) => f.kind !== "entry" && f.kind !== "add" && f.idx === exitIdx);
  const entryTime = entryFill ? (entryFill.time ?? bars[entryFill.idx]?.t ?? null) : null;
  const lastExit = exitFillsAtEnd.length ? exitFillsAtEnd[exitFillsAtEnd.length - 1] : null;
  const exitTime = lastExit ? (lastExit.time ?? bars[lastExit.idx]?.t ?? null) : null;

  const position = positionSeries(bars, fills, side, trade.qty ?? null);
  const exc = excursion(baseBars, baseFills, side, { qty, riskPerShare: risk });
  const mfeIdx = exc?.mfeAt != null ? barIndexForTime(bars, exc.mfeAt, barSec) : null;
  const maeIdx = exc?.maeAt != null ? barIndexForTime(bars, exc.maeAt, barSec) : null;

  const levels = intraday ? dayLevels(baseBars, dateKey, prevClose) : { pdh: null, pdl: null, pdc: prevClose, pmh: null, pml: null, open: null, orb5: null, orb15: null };
  const toIdx = (pts: { t: number; vwap: number; sd: number }[]): VwapIdxPoint[] => {
    const out: VwapIdxPoint[] = [];
    for (const p of pts) { const i = findBarIndex(bars, p.t); if (i >= 0 && bars[i].t === p.t) out.push({ idx: i, vwap: p.vwap, sd: p.sd }); }
    return out;
  };
  const vwap = intraday ? toIdx(sessionVwap(bars)) : [];
  const avwap = intraday && entryIdx != null ? toIdx(anchoredVwap(bars, entryIdx)) : [];
  const rvol = intraday ? rvolSeries(bars) : bars.map(() => null);

  let dayRange: { from: number; to: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const p = etParts(bars[i].t);
    if (p.dayKey !== dateKey) continue;
    if (!intraday || sessionOfMinutes(p.mod) === "rth") { if (!dayRange) dayRange = { from: i, to: i }; else dayRange.to = i; }
  }
  const profile = dayRange && intraday ? volumeProfile(bars, { from: dayRange.from, to: dayRange.to, bins: 40 }) : null;

  const events: EventIdx[] = [];
  for (const e of input.events ?? []) {
    const day = e.date.slice(0, 10);
    let t: number;
    if (/T\d{2}:\d{2}/.test(e.date)) t = Math.floor(Date.parse(e.date) / 1000);
    else {
      const ses = (e.session || "").toUpperCase();
      t = ses === "PRE" ? etWallToEpoch(day, 8, 30) : ses === "POST" || ses === "AH" ? etWallToEpoch(day, 16, 5) : etWallToEpoch(day, 9, 30);
    }
    if (!Number.isFinite(t) || !bars.length || t < bars[0].t - barSec || t > bars[bars.length - 1].t + barSec) continue;
    const idx = barIndexForTime(bars, t, barSec);
    events.push({ id: e.id, idx, text: `${e.eventType ? `${e.eventType.toUpperCase()}: ` : ""}${e.headline}` });
  }

  return {
    side, fills, baseFills, entryIdx, exitIdx, entryTime, exitTime, avgEntry, avgExit, qty, risk, stop,
    target: input.target ?? null,
    grossUsd: grossFromFills(fills, side, trade.qty ?? null),
    position, excursion: exc, mfeIdx, maeIdx, levels, vwap, avwap, rvol, profile, events, dayRange,
  };
}
