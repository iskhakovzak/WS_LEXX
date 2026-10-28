/**
 * Expected move on earnings (pure; tests in __tests__/expectedMove.test.ts).
 *
 *   impliedMove(slice, spot)       the options-implied move: the at-the-money straddle (call mid + put mid at the strike
 *                                  nearest the spot) of the first expiration on / after the reaction day ÷ the spot, %.
 *                                  Source: the free delayed chain the desk already reads (lib/options), no paid feed.
 *   historicalMove(moves, n)       the average |close-to-close move| of the last n reaction days, % — labelled
 *                                  «historical» wherever it shows (it is NOT the market's expectation)
 *   levels(priorClose, em)         prior close × (1 ± EM)
 *   broken(movePct, em)            after the report: the reaction day's |move| went past the EM
 *   reactionDay(date, timing, next) a report before the open (or unknown timing) moves its own day; after the close —
 *                                  the next session
 */
import type { ChainContract, ChainSlice } from "../options/types";

export const EM_SOURCES = ["implied", "historical"] as const;
export type EmSource = (typeof EM_SOURCES)[number];

const r2 = (v: number) => Math.round(v * 100) / 100;

function priceOf(c: ChainContract | undefined): number | null {
  if (!c) return null;
  const v = c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.mid > 0 ? c.mid : c.last;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** ATM straddle ÷ spot, in % (null without a two-sided quote at the at-the-money strike). */
export function impliedMove(slice: Pick<ChainSlice, "calls" | "puts">, spot: number): number | null {
  if (!(spot > 0) || !slice.calls.length || !slice.puts.length) return null;
  const strikes = [...new Set(slice.calls.map((c) => c.strike).filter((k) => slice.puts.some((p) => p.strike === k)))];
  if (!strikes.length) return null;
  const atm = strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best), strikes[0]!);
  const call = priceOf(slice.calls.find((c) => c.strike === atm));
  const put = priceOf(slice.puts.find((p) => p.strike === atm));
  if (call == null || put == null) return null;
  return r2(((call + put) / spot) * 100);
}

/** Average |move| of the last `n` reaction days (newest last in `moves`), % — null without any. */
export function historicalMove(moves: readonly number[], n: number): { em: number; quarters: number } | null {
  const last = moves.filter((m) => Number.isFinite(m)).slice(-Math.max(1, n));
  if (!last.length) return null;
  return { em: r2(last.reduce((a, m) => a + Math.abs(m), 0) / last.length), quarters: last.length };
}

export function levels(priorClose: number | null, emPct: number | null): { up: number; down: number } | null {
  if (priorClose == null || !(priorClose > 0) || emPct == null || !(emPct > 0)) return null;
  const k = emPct / 100;
  return { up: Math.round(priorClose * (1 + k) * 100) / 100, down: Math.round(priorClose * (1 - k) * 100) / 100 };
}

export function broken(movePct: number | null, emPct: number | null): boolean | null {
  if (movePct == null || emPct == null || !(emPct > 0)) return null;
  return Math.abs(movePct) > emPct;
}

export function reactionDay(date: string, timing: string | null, nextSession: string): string {
  return timing === "amc" ? nextSession : date;
}
