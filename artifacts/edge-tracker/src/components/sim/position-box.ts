/**
 * Position box (TradingView-like) — pure logic: the risk / reward zones of an open position or of a plan made while
 * flat, the $ and R on each line, the automatic bracket on entry (stop just beyond the nearest level, else 1 risk
 * unit; target at 2R) and which line a modified click places. The chart primitive only draws what this returns.
 */
import { roundPrice } from "./model";

export type LineStat = { price: number; usd: number; r: number };
export type Zone = { from: number; to: number };
export type Box = {
  /** +1 long, −1 short. */
  dir: 1 | -1;
  /** Entry (the average price, or the current price for a plan). */
  entry: number;
  risk: Zone | null;
  reward: Zone | null;
  stop: LineStat | null;
  target: LineStat | null;
};

/** $ and R of a line: P&L of `qty` shares (signed by `dir`) if the price gets there, in units of `unit` $/share. */
export function lineStat(dir: 1 | -1, qty: number, entry: number, price: number, unit: number): LineStat {
  const perShare = (price - entry) * dir;
  return { price, usd: perShare * Math.abs(qty), r: unit > 0 ? perShare / unit : 0 };
}

/**
 * Box of an open position: `unit` = the trade's risk per share (1R). Zones span entry↔stop (risk; a stop already past
 * the entry on the profit side has no risk zone) and entry↔target (reward).
 */
export function positionBox(p: { pos: number; avg: number | null; stop: number | null; target: number | null; unit: number }): Box | null {
  if (p.pos === 0 || p.avg == null || !(p.avg > 0)) return null;
  const dir: 1 | -1 = p.pos > 0 ? 1 : -1;
  const stop = p.stop != null ? lineStat(dir, p.pos, p.avg, p.stop, p.unit) : null;
  const target = p.target != null ? lineStat(dir, p.pos, p.avg, p.target, p.unit) : null;
  return {
    dir, entry: p.avg,
    risk: stop && stop.usd < 0 ? { from: p.avg, to: stop.price } : null,
    reward: target && target.usd > 0 ? { from: p.avg, to: target.price } : null,
    stop, target,
  };
}

/**
 * Box of a plan while flat: the side follows the stop (below the price = long) or, without one, the target. 1R = the
 * distance to the planned stop (else the risk unit), `qty` = the size the next order would use.
 */
export function planBox(p: { price: number; stop: number | null; target: number | null; qty: number; riskUnit: number }): Box | null {
  if (!(p.price > 0) || (p.stop == null && p.target == null)) return null;
  const dir: 1 | -1 = p.stop != null ? (p.stop < p.price ? 1 : -1) : (p.target! > p.price ? 1 : -1);
  const unit = p.stop != null && p.stop !== p.price ? Math.abs(p.price - p.stop) : p.riskUnit;
  const stop = p.stop != null ? lineStat(dir, p.qty, p.price, p.stop, unit) : null;
  const target = p.target != null ? lineStat(dir, p.qty, p.price, p.target, unit) : null;
  return {
    dir, entry: p.price,
    risk: stop && stop.usd < 0 ? { from: p.price, to: stop.price } : null,
    reward: target && target.usd > 0 ? { from: p.price, to: target.price } : null,
    stop, target,
  };
}

export type NamedLevel = { key: string; price: number | null | undefined };
export type AutoBracket = { stop: number; target: number; level: string | null };

/** Price step used for the buffer beyond a level: a cent above $1, a hundredth of a cent below. */
const tickOf = (price: number) => (price >= 1 ? 0.01 : 0.0001);

/**
 * Automatic bracket on entry: the stop just beyond the nearest level on the loss side that is 0.25–2 risk units away
 * (a buffer of 0.1 unit, at least a tick, past the level), else 1 risk unit; the target at 2× the stop distance.
 */
export function autoBracket(dir: 1 | -1, entry: number, riskUnit: number, levels: readonly NamedLevel[]): AutoBracket | null {
  if (!(entry > 0) || !(riskUnit > 0)) return null;
  let best: { key: string; price: number; d: number } | null = null;
  for (const l of levels) {
    if (l.price == null || !Number.isFinite(l.price) || !(l.price > 0)) continue;
    const d = (entry - l.price) * dir;
    if (d < 0.25 * riskUnit || d > 2 * riskUnit) continue;
    if (!best || d < best.d) best = { key: l.key, price: l.price, d };
  }
  const buffer = Math.max(tickOf(entry), 0.1 * riskUnit);
  const stop = roundPrice(best ? best.price - dir * buffer : entry - dir * riskUnit);
  if (!(stop > 0)) return null;
  const target = roundPrice(entry + dir * 2 * Math.abs(entry - stop));
  if (!(target > 0)) return null;
  return { stop, target, level: best ? best.key : null };
}

/** Which line a modified click places: Shift = stop, Alt = target (none without a modifier). */
export function placeKind(e: { shiftKey?: boolean; altKey?: boolean }): "stop" | "target" | null {
  if (e.shiftKey && !e.altKey) return "stop";
  if (e.altKey && !e.shiftKey) return "target";
  return null;
}

/**
 * A stop / target placed at `price` while in a position: valid only on its own side of the current price (a long's
 * stop below, target above). Returns the bracket to send, or null when the click is on the wrong side.
 */
export function placeInPosition(
  kind: "stop" | "target", price: number, pos: number, last: number, cur: { stop: number | null; target: number | null },
): { stop: number | null; target: number | null } | null {
  if (pos === 0 || !(price > 0)) return null;
  const dir = pos > 0 ? 1 : -1;
  const p = roundPrice(price);
  if (kind === "stop") return (p - last) * dir < 0 ? { stop: p, target: cur.target } : null;
  return (p - last) * dir > 0 ? { stop: cur.stop, target: p } : null;
}

/** R on a line label, short: "1R", "2R", "1.5R" (magnitude; the $ next to it carries the sign). */
export function rShort(r: number): string {
  const v = Math.round(Math.abs(r) * 10) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}R`;
}
