/**
 * Big 7 leadership on a phone (Волна 2 п. 2.11) — pure view model of one card, unit-tested in card-model.test.ts.
 * The card keeps what a junior picks by: the move, RS to QQQ, the gap (premarket move before the open), RVOL, the
 * distance from VWAP (none before the open) and the nearest levels; correlation / β and the QQQ contribution stay in
 * the table (sm and up) and the detail sheet.
 */
import type { Big7Row } from "./context";

export type LeadershipCard = {
  symbol: string;
  chg: number | null;
  rs: number | null;
  /** «premarket» before the open (the premarket move, else the gap), «gap» after it. */
  gapLabel: "premarket" | "gap";
  gap: number | null;
  rvol: number | null;
  rvolStrong: boolean;
  /** Null before the open (VWAP is not meaningful yet). */
  vwap: number | null;
};

const RVOL_STRONG = 1.5;

export function leadershipCard(r: Big7Row, preOpen: boolean): LeadershipCard {
  return {
    symbol: r.symbol,
    chg: r.chg ?? null,
    rs: r.rsQqq ?? null,
    gapLabel: preOpen ? "premarket" : "gap",
    gap: preOpen ? r.pmChg ?? r.gap ?? null : r.gap ?? null,
    rvol: r.rvol ?? null,
    rvolStrong: r.rvol != null && r.rvol >= RVOL_STRONG,
    vwap: preOpen ? null : r.vwapDist ?? null,
  };
}
