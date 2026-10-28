/**
 * Session flow (lib/sessionFlow/*): what a trader's day looked like trade by trade — re-entries, chases, the give-back
 * from the day's peak, the green-to-red cross, the timing axis, and the robust edge of a slice. Every input is derived
 * from PropReports fills (trades + trade_executions + the derived facet columns); nothing here is typed in by hand.
 */
import type { TradeRowLike } from "../tradeMath";

/** One trade as the session-flow calculators read it. Times are epoch ms; `day` is the NY entry day. */
export type FlowTrade = TradeRowLike & {
  id: number;
  trader: string;
  day: string;
  ticker: string;
  side: "long" | "short" | null;
  result: "win" | "loss" | "be" | "open" | null;
  /** Net $ (pnl − |fees|), null without a P&L. */
  net: number | null;
  entryAt: number | null;
  exitAt: number | null;
  /** NY seconds of the first entry (trades.entry_sec). */
  entrySec: number | null;
  /** Max position × average entry, $ (trades.notional). */
  notional: number | null;
  /** whole | partials | stopped | flip (trades.exit_kind). */
  exitKind: string | null;
  /** The PropReports-style strategy (trades.strategy: OPG, Print, OPGtoDAY, Day, MOC, AfterMarket, Overnight, Swing …). */
  strategy: string | null;
  /** Top-level playbook setup (a variant rolls up to its parent). */
  setupId: number | null;
  setupName: string | null;
};

export const round2 = (v: number): number => Math.round(v * 100) / 100;
