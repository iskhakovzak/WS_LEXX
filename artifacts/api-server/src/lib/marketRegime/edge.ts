/**
 * Edge by desk regime (pure): a trader's closed trades split by the desk regime of their entry day — P&L, win rate,
 * expectancy in R, trades and days per regime. The honest statistics are the «Мой edge» ones (lib/myEdge/rows
 * buildRows): $ per day / per trade with the 80 % day-clustered bootstrap interval and the status
 * «надёжно» / «гипотеза» / «мало данных» (lib/stats/myEdgeStats meStatus: < 5 days or < 10 trades = мало данных).
 * Trades on days without a desk regime only count in the coverage.
 */
import { buildRows, type MeRowTrade } from "../myEdge/rows";
import type { MeInterval, MeStatus } from "../stats/myEdgeStats";
import { REGIME_KEYS, type RegimeKey } from "./regimes";
import type { RegimeTrade } from "./store";

export type RegimeEdgeRow = {
  regime: RegimeKey;
  trades: number;
  days: number;
  net: number;
  winRate: number | null;
  perDay: MeInterval;
  perTrade: MeInterval;
  /** Mean signed R over the trades that have an R (null when none has). */
  expectancyR: number | null;
  rTrades: number;
  status: MeStatus;
};

export type RegimeEdge = {
  rows: RegimeEdgeRow[];
  /** Trades whose entry day has a desk regime / all closed trades of the window. */
  coverage: { known: number; total: number };
  /** The regime where the trader loses the most per day (enough data only) — «в боковике ты теряешь −$X в день». */
  leak: RegimeKey | null;
  /** The regime where the trader earns the most per day (enough data only). */
  strength: RegimeKey | null;
};

const DIM = "regime";
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function regimeEdge(trades: readonly RegimeTrade[], opts: { iters?: number } = {}): RegimeEdge {
  const known = trades.filter((t): t is RegimeTrade & { regime: RegimeKey } => t.regime != null);
  const byId = new Map(known.map((t) => [t.id, t] as const));
  const rowTrades: MeRowTrade[] = known.map((t) => ({ id: t.id, day: t.day, net: t.net, win: t.win }));
  const { rows } = buildRows({ trades: rowTrades, dims: [DIM], keyOf: (id) => byId.get(id)?.regime ?? "none", skip: new Set(["none"]), iters: opts.iters });
  const out: RegimeEdgeRow[] = [];
  for (const k of REGIME_KEYS) {
    const r = rows.find((x) => x.key === k);
    if (!r) continue;
    const rs = known.filter((t) => t.regime === k && t.r != null).map((t) => t.r as number);
    out.push({
      regime: k, trades: r.trades, days: r.days, net: r.net, winRate: r.winRate, perDay: r.perDay, perTrade: r.perTrade,
      expectancyR: rs.length ? r3(rs.reduce((a, b) => a + b, 0) / rs.length) : null, rTrades: rs.length, status: r.status,
    });
  }
  const ranked = out.filter((r) => r.status !== "low");
  const leak = ranked.filter((r) => r.perDay.point < 0).sort((a, b) => a.perDay.point - b.perDay.point)[0]?.regime ?? null;
  const strength = ranked.filter((r) => r.perDay.point > 0).sort((a, b) => b.perDay.point - a.perDay.point)[0]?.regime ?? null;
  return { rows: out, coverage: { known: known.length, total: trades.length }, leak, strength };
}
