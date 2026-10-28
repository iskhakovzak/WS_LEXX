/**
 * «Пульс деска: что работает в сезоне» (pure; tests in __tests__/pulse.test.ts). Every closed PropReports trade of the
 * desk in the window → its cell setup family (./family) × timing (lib/sessionFlow/timing); per cell:
 *
 *   n, traders        closed trades with a $ result, distinct traders
 *   winrate, net      the shared $ math (lib/playbookEdge computeUsdStats → lib/coreMetrics winRateOf)
 *   netExTop3, median the robust-edge rule of lib/sessionFlow/flow robustEdge: P&L without the 3 best trades, the median
 *                     trade, «outliers» when the edge rests on a few trades
 *   medianR           the median signed R (lib/coreMetrics signedR) over the trades that carry R
 *   thin              below the minimum sample: fewer than pulse.minTrades trades, or fewer than pulse.minTraders people
 *                     — such a cell is greyed out and never judged
 *   verdict           works (net without the top 3 > 0 and the median > 0) / fails (net without the top 3 < 0 and the
 *                     net < 0) / mixed; null when thin
 *
 * Privacy (lib/moneyVisibility, owner decision 9): only desk-level aggregates leave this module, never a person's row.
 * A non-staff viewer gets a cell's numbers only when it spans at least max(pulse.minTraders, DESK_AGGREGATE_MIN_TRADERS)
 * people (a sum over two people gives the other one away); the $ median (one trade of one person) is staff-only — the
 * trader sees the median in R.
 */
import { computeUsdStats } from "../playbookEdge";
import { DESK_AGGREGATE_MIN_TRADERS } from "../moneyVisibility";
import { signedR, type TradeRowLike } from "../tradeMath";
import { robustEdge } from "../sessionFlow/flow";
import { TIMINGS, type Timing } from "../sessionFlow/timing";
import { FAMILIES, type Family } from "./family";

export type PulseTrade = TradeRowLike & { trader: string; family: Family | null; timing: Timing | null };

export type PulseCfg = { minTrades: number; minTraders: number };

export type Verdict = "works" | "fails" | "mixed";

export type PulseCell = {
  family: Family;
  timing: Timing;
  n: number;
  /** Distinct traders in the cell (null for a non-staff viewer when the cell is below the people minimum). */
  traders: number | null;
  winrate: number | null;
  net: number | null;
  netExTop3: number | null;
  /** Median trade, $ (staff only). */
  median: number | null;
  medianR: number | null;
  /** Trades that carry R. */
  rTrades: number;
  outliers: boolean;
  thin: "trades" | "people" | null;
  verdict: Verdict | null;
};

export type PulseHighlight = { family: Family; timing: Timing; n: number };

export type Pulse = {
  cells: PulseCell[];
  /** Closed trades with a $ result in the window, and those without a family or timing (no archived day / no side). */
  trades: number;
  unclassified: number;
  /** Desk traders with at least one classified trade. */
  traders: number;
  works: PulseHighlight | null;
  fails: PulseHighlight | null;
};

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export function verdictOf(c: Pick<PulseCell, "thin" | "netExTop3" | "net" | "median" | "medianR">): Verdict | null {
  if (c.thin || c.netExTop3 == null || c.net == null) return null;
  const mid = c.medianR ?? c.median;
  if (c.netExTop3 > 0 && mid != null && mid > 0) return "works";
  if (c.netExTop3 < 0 && c.net < 0) return "fails";
  return "mixed";
}

/** The desk cells of a window (every number for staff; ./pulse pulseFor applies the viewer's privacy). */
export function deskPulse(trades: readonly PulseTrade[], cfg: PulseCfg): Pulse {
  const by = new Map<string, PulseTrade[]>();
  let total = 0, unclassified = 0;
  const people = new Set<string>();
  for (const t of trades) {
    const st = computeUsdStats([t]);
    if (!st.n) continue; // open or without a $ result
    total++;
    if (!t.family || !t.timing) { unclassified++; continue; }
    people.add(t.trader);
    const k = `${t.family}|${t.timing}`;
    const l = by.get(k);
    if (l) l.push(t); else by.set(k, [t]);
  }
  const cells: PulseCell[] = [];
  for (const family of FAMILIES) {
    for (const timing of TIMINGS) {
      const list = by.get(`${family}|${timing}`);
      if (!list) continue;
      const st = computeUsdStats(list);
      const nets = list.map((t) => computeUsdStats([t]).net).filter((v): v is number => v != null);
      const rob = robustEdge(nets);
      const rs = list.map((t) => signedR(t)).filter((v): v is number => v != null && Number.isFinite(v));
      const traders = new Set(list.map((t) => t.trader)).size;
      const thin = traders < cfg.minTraders ? "people" : st.n < cfg.minTrades ? "trades" : null;
      const cell: PulseCell = {
        family, timing, n: st.n, traders, winrate: st.winrate, net: st.net, netExTop3: rob.netExTop3, median: rob.median,
        medianR: r2(median(rs)), rTrades: rs.length, outliers: rob.outliers, thin, verdict: null,
      };
      cell.verdict = verdictOf(cell);
      cells.push(cell);
    }
  }
  const score = (c: PulseCell) => (c.medianR ?? (c.median != null ? c.median / 1000 : 0));
  const works = cells.filter((c) => c.verdict === "works").sort((a, b) => score(b) - score(a) || b.n - a.n)[0] ?? null;
  const fails = cells.filter((c) => c.verdict === "fails").sort((a, b) => (a.netExTop3 ?? 0) - (b.netExTop3 ?? 0) || b.n - a.n)[0] ?? null;
  const hl = (c: PulseCell | null): PulseHighlight | null => (c ? { family: c.family, timing: c.timing, n: c.n } : null);
  return { cells, trades: total, unclassified, traders: people.size, works: hl(works), fails: hl(fails) };
}

/** The pulse as `staff` may see it: a non-staff viewer loses the numbers of cells below the people minimum and the $ median. */
export function pulseFor(p: Pulse, staff: boolean, cfg: PulseCfg): Pulse {
  if (staff) return p;
  const minPeople = Math.max(cfg.minTraders, DESK_AGGREGATE_MIN_TRADERS);
  return {
    ...p,
    cells: p.cells.map((c) => (c.traders != null && c.traders >= minPeople
      ? { ...c, median: null }
      : { ...c, traders: null, winrate: null, net: null, netExTop3: null, median: null, medianR: null, outliers: false, thin: "people" as const, verdict: null })),
  };
}
