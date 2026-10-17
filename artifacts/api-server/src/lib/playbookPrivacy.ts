/**
 * Playbook privacy — who may see the dollar facts of a trade shown inside a setup (examples, gallery, linked
 * trades, $-stats). Pure functions only (unit-tested in __tests__/playbookPrivacy.test.ts); the request-level
 * viewer comes from loadMoneyViewer() in playbookAccess.ts.
 *
 * Rule: a viewer sees the $ facts of a trade only when
 *   - they own it (trades.trader = viewer name), or
 *   - they are staff (role curator / admin).
 * Everyone else gets those fields as null plus `redacted: true`. What stays: ticker, dates, side, entry/exit times,
 * prices (the chart needs them), R, tier, note, checklist marks, media, trader / who added it.
 *
 * Aggregates over several traders' trades keep counts, win rate and R; their $ fields are null unless every
 * included trade is the viewer's own (or the viewer is staff).
 */

export interface MoneyViewer {
  /** Viewer's user name; null for anonymous / guest (never owns a trade). */
  name: string | null;
  /** Curator or admin. */
  staff: boolean;
}

/** $ fields of a trade row as returned by the playbook routes (absent keys are left alone). */
export const TRADE_MONEY_FIELDS = [
  "netPnl", "pnl", "grossPnl", "fees", "commission", "qty", "riskUsd", "slippage",
  "positionUsd", "positionSize", "notional", "notionalUsd", "mfeUsd", "maeUsd", "totalPnl",
] as const;

/** $ fields of a UsdStats block (lib/playbookEdge.computeUsdStats). n / wins / losses / winrate stay. */
export const USD_STATS_MONEY_FIELDS = ["net", "expectancy", "avgWin", "avgLoss", "payoff", "profitFactor", "best", "worst"] as const;

/** $ fields of an EdgeStats block (lib/playbookEdge.computeEdge). R-based fields and counts stay. */
export const EDGE_MONEY_FIELDS = ["maxDrawdown", "totalPnl", "totalPnlGross", "fees"] as const;

/** $ fields of a time-slot row (lib/playbookEdge.slotStats). */
export const SLOT_MONEY_FIELDS = ["net", "expectancy"] as const;

/** $ fields of a GET /playbook/summary row (byHorizon.*.netPnl is handled by redactSummaryRow). */
export const SUMMARY_MONEY_FIELDS = [
  "netPnl", "grossPnl", "totalPnl", "expectancyUsd", "avgWinUsd", "avgLossUsd", "profitFactorUsd",
] as const;

/** Copy of `obj` with every listed key that is present set to null. */
export function nullFields<T extends object>(obj: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const k of keys) if (k in out) out[k] = null;
  return out as T;
}

export function isOwnTrade(v: MoneyViewer, trader: string | null | undefined): boolean {
  return !!v.name && !!trader && trader === v.name;
}

/** May the viewer see the $ facts of a trade owned by `trader`? */
export function canSeeTradeMoney(v: MoneyViewer, trader: string | null | undefined): boolean {
  return v.staff || isOwnTrade(v, trader);
}

/** Are all of these trades the viewer's own (or is the viewer staff)? An empty set is trivially visible. */
export function canSeeAggregateMoney(v: MoneyViewer, traders: Iterable<string | null | undefined>): boolean {
  if (v.staff) return true;
  for (const t of traders) if (!isOwnTrade(v, t)) return false;
  return true;
}

export type Redacted<T> = T & { redacted: boolean };

/**
 * One trade-shaped row (example, gallery card, linked trade, picker row). `trader` is the owner of the trade.
 * Visible rows get `redacted: false`, others have every $ field nulled and `redacted: true`.
 */
export function redactTradeRow<T extends { trader?: string | null }>(row: T, v: MoneyViewer): Redacted<T> {
  if (canSeeTradeMoney(v, row.trader)) return { ...row, redacted: false };
  return { ...nullFields(row, TRADE_MONEY_FIELDS), redacted: true };
}

export function redactTradeRows<T extends { trader?: string | null }>(rows: T[], v: MoneyViewer): Redacted<T>[] {
  return rows.map((r) => redactTradeRow(r, v));
}

export function redactUsdStats<T extends object>(s: T): T {
  return nullFields(s, USD_STATS_MONEY_FIELDS);
}

export function redactEdgeStats<T extends object>(e: T): T {
  return nullFields(e, EDGE_MONEY_FIELDS);
}

export function redactSlot<T extends object>(s: T): T {
  return nullFields(s, SLOT_MONEY_FIELDS);
}

/** A GET /playbook/summary row: top-level $ fields and byHorizon.*.netPnl. */
export function redactSummaryRow<T extends { byHorizon?: Record<string, object> }>(row: T): Redacted<T> {
  const out = nullFields(row, SUMMARY_MONEY_FIELDS);
  if (row.byHorizon) {
    out.byHorizon = Object.fromEntries(
      Object.entries(row.byHorizon).map(([k, h]) => [k, nullFields(h, ["netPnl"])]),
    ) as T["byHorizon"];
  }
  return { ...out, redacted: true };
}

/** Cumulative signed R by close day — the $-free equity curve shown when the $ curve is hidden. */
export function equityByR(trades: { closeDate: string; r: number | null }[]): { day: string; r: number; cum: number }[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.r == null || !Number.isFinite(t.r) || !t.closeDate) continue;
    byDay.set(t.closeDate, (byDay.get(t.closeDate) ?? 0) + t.r);
  }
  let cum = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, r]) => ({ day, r: Number(r.toFixed(3)), cum: Number((cum += r).toFixed(3)) }));
}
