/**
 * Win rate vs the breakeven win rate of the trader's own payoff (roadmap R1 / R2, shared):
 *
 *   breakevenWr   = 1 / (1 + avgWin / |avgLoss|)
 *   edgeMarginPp  = 100 × (W / (W + L) − breakevenWr)      on NET trade results (pnl − |fees|)
 *
 * A high-payoff style can be profitable with a low win rate: the margin says how far above its own breakeven it is.
 * null (and a failing criterion) with fewer than MIN_SIDE wins or losses — a payoff of 3 trades means nothing.
 * Break-even trades (net = 0) count on neither side.
 */
export const MIN_SIDE = 5;

export type EdgeMargin = {
  wins: number;
  losses: number;
  /** %, 0…100 */
  winRate: number;
  avgWin: number;
  /** ≤ 0 */
  avgLoss: number;
  /** %, 0…100 */
  breakevenWr: number;
  /** percentage points (WR − breakeven WR) */
  marginPp: number;
};

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** The margin from net trade results; null when wins or losses < MIN_SIDE. */
export function edgeMargin(nets: readonly (number | null | undefined)[]): EdgeMargin | null {
  let w = 0, l = 0, sumW = 0, sumL = 0;
  for (const v of nets) {
    if (v == null || !Number.isFinite(v) || v === 0) continue;
    if (v > 0) { w++; sumW += v; } else { l++; sumL += v; }
  }
  if (w < MIN_SIDE || l < MIN_SIDE) return null;
  const avgWin = sumW / w, avgLoss = sumL / l;
  const wr = w / (w + l);
  const be = breakevenWinRate(avgWin, avgLoss) ?? 0;
  return { wins: w, losses: l, winRate: round(wr * 100), avgWin: round(avgWin), avgLoss: round(avgLoss), breakevenWr: round(be * 100), marginPp: round((wr - be) * 100) };
}

/** The breakeven win rate (share 0…1) of a payoff: 1 / (1 + avgWin / |avgLoss|); null without a win and a loss. */
export function breakevenWinRate(avgWin: number, avgLoss: number): number | null {
  if (!(avgWin > 0) || !(avgLoss < 0)) return null;
  return 1 / (1 + avgWin / Math.abs(avgLoss));
}

/** The same from summary numbers (win rate as a share 0…1, average win, average loss). */
export function edgeMarginOf(winRate: number, avgWin: number, avgLoss: number): number | null {
  const be = breakevenWinRate(avgWin, avgLoss);
  if (be == null || !(winRate >= 0 && winRate <= 1)) return null;
  return round((winRate - be) * 100);
}
