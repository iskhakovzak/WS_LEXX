/**
 * Session flow loader: trades of one or many traders in a window as FlowTrade (lib/sessionFlow/types). The fill times
 * come from the behaviour rows (trade_executions first entry / last exit, else the broker's openedAt / closedAt), the
 * derived facets (entry_sec, exit_kind, strategy, notional) from the PropReports sync pass (lib/tradeStrategyStore),
 * the setup from the playbook link rolled up to the top-level setup. Read-only.
 */
import { pool } from "@workspace/db";
import { loadBehaviorRows, rowToBehaviorTrade } from "../../routes/behavior";
import type { FlowTrade } from "./types";

type ExtraRow = {
  id: number; pnl: string | null; fees: string | null; risk_usd: string | null; r_multiple: string | null; stop: string | null; exit: string | null;
  entry_sec: number | null; exit_kind: string | null; strategy: string | null; notional: string | null; setup_id: number | null; setup_name: string | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Trades of `traders` (null = one trader in `scope`) with the entry day in [from, to]. */
export async function flowTrades(scope: string | null, from: string, to: string, traders?: string[]): Promise<FlowTrade[]> {
  const rows = await loadBehaviorRows(scope, from, to, undefined, traders);
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const { rows: extra } = await pool.query<ExtraRow>(
    `SELECT t.id, t.pnl, t.fees, t.risk_usd, t.r_multiple, t.stop, t.exit, t.entry_sec, t.exit_kind, t.strategy, t.notional,
            COALESCE(pp.id, p.id) AS setup_id, COALESCE(pp.name, p.name) AS setup_name
       FROM trades t
       LEFT JOIN playbook p ON p.id = t.playbook_id AND p.deleted_at IS NULL
       LEFT JOIN playbook pp ON pp.id = p.parent_id AND pp.deleted_at IS NULL
      WHERE t.id = ANY($1::int[])`,
    [ids],
  );
  const by = new Map(extra.map((r) => [Number(r.id), r]));
  const out: FlowTrade[] = [];
  for (const r of rows) {
    if (!r.trader) continue;
    const b = rowToBehaviorTrade(r);
    const x = by.get(b.id);
    out.push({
      id: b.id, trader: r.trader, day: b.date, ticker: b.ticker, side: b.side, result: b.result, net: b.net,
      entryAt: b.entryAt, exitAt: b.exitAt, entrySec: x?.entry_sec ?? null, notional: num(x?.notional), exitKind: x?.exit_kind ?? null,
      strategy: x?.strategy ?? null, setupId: x?.setup_id == null ? null : Number(x.setup_id), setupName: x?.setup_name ?? null,
      pnl: x?.pnl ?? null, fees: x?.fees ?? null, riskUsd: x?.risk_usd ?? null, rMultiple: x?.r_multiple ?? null, stop: x?.stop ?? null,
      entry: b.entry, exit: x?.exit ?? null,
    });
  }
  return out;
}

/** Group by a key, keeping the input order inside each group. */
export function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const l = m.get(k);
    if (l) l.push(it); else m.set(k, [it]);
  }
  return m;
}
