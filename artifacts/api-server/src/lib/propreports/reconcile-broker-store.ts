/**
 * Nightly broker reconciliation — DB part (table propreports_reconcile_days, migration 0222).
 *
 *   loadOurDays(names, from, to)        journal side for one broker account (all its names: account, name, id, aliases)
 *   saveComparisons(account, rows)      upsert per (account, date); an acknowledged row is re-opened when its diff
 *                                       moves by more than $1 since the acknowledgement
 *   listReconcileDays(filter)           admin panel rows (default: open mismatches)
 *   acknowledgeReconcileDay(id, actor)  "seen / explained" — the row stays, marked
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql, resultSql } from "../tradeMath";
import { MISMATCH_THRESHOLD, type DayComparison, type OurDay, type ReconcileStatus } from "./reconcile-broker";

type Queryable = { query: (typeof pool)["query"] };

const PR_SOURCE = `(t.source = 'propreports' OR t.context_snapshot ->> 'source' = 'propreports')`;
const ACCOUNT = `COALESCE(t.broker_account, t.context_snapshot ->> 'account')`;
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const nn = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** All the names one mapping's trades can carry in broker_account. */
export function accountNames(m: { account: string; accountName: string | null; accountId: string | null; aliases: string[] }): string[] {
  return [...new Set([m.account, m.accountName ?? "", m.accountId ?? "", ...m.aliases].map((s) => s.trim()).filter(Boolean))];
}

export async function loadOurDays(names: string[], from: string, to: string, db: Queryable = pool): Promise<{ days: OurDay[]; spans: Array<{ date: string; closeDate: string | null; open: boolean }> }> {
  const close = `substring(${closeDateSql()} from 1 for 10)`;
  const [days, spans, adj] = await Promise.all([
    db.query(
      `SELECT ${close} AS day, COUNT(*)::int AS trades, SUM(t.pnl) AS gross, SUM(ABS(COALESCE(t.fees, 0))) AS fees, SUM(${netPnlSql()}) AS net
         FROM trades t
        WHERE t.deleted_at IS NULL AND ${PR_SOURCE} AND ${closedSql()} AND ${ACCOUNT} = ANY($1::text[])
          AND ${close} >= $2 AND ${close} <= $3
        GROUP BY 1`,
      [names, from, to],
    ),
    db.query(
      `SELECT substring(t.date from 1 for 10) AS d, NULLIF(substring(COALESCE(t.exit_date, '') from 1 for 10), '') AS c, ${resultSql()} = 'open' AS open
         FROM trades t
        WHERE t.deleted_at IS NULL AND ${PR_SOURCE} AND ${ACCOUNT} = ANY($1::text[])
          AND substring(t.date from 1 for 10) <= $3
          AND (${resultSql()} = 'open' OR (t.exit_date IS NOT NULL AND substring(t.exit_date from 1 for 10) >= $2 AND substring(t.exit_date from 1 for 10) > substring(t.date from 1 for 10)))`,
      [names, from, to],
    ),
    db.query(
      `SELECT date, COALESCE(SUM(amount) FILTER (WHERE kind <> 'transfer'), 0) AS adj, COALESCE(SUM(amount) FILTER (WHERE kind = 'transfer'), 0) AS transfers
         FROM propreports_adjustments
        WHERE archived_at IS NULL AND account = ANY($1::text[]) AND date >= $2 AND date <= $3
        GROUP BY date`,
      [names, from, to],
    ).catch(() => ({ rows: [] as any[] })),
  ]);
  const adjByDay = new Map<string, { adj: number; transfers: number }>(adj.rows.map((r: any) => [String(r.date), { adj: n(r.adj), transfers: n(r.transfers) }]));
  const out = new Map<string, OurDay>();
  for (const r of days.rows as any[]) {
    if (!r.day) continue;
    out.set(String(r.day), { date: String(r.day), trades: Number(r.trades), gross: n(r.gross), fees: n(r.fees), net: n(r.net), adjFees: 0, transfers: 0 });
  }
  for (const [date, a] of adjByDay) {
    const d = out.get(date) ?? { date, trades: 0, gross: 0, fees: 0, net: 0 };
    out.set(date, { ...d, adjFees: a.adj, transfers: a.transfers });
  }
  return {
    days: [...out.values()].sort((a, b) => a.date.localeCompare(b.date)),
    spans: spans.rows.map((r: any) => ({ date: String(r.d), closeDate: r.c ?? null, open: !!r.open })),
  };
}

export interface ReconcileAccount {
  account: string;
  accountId: string | null;
  trader: string | null;
}

export async function saveComparisons(acc: ReconcileAccount, rows: DayComparison[], db: Queryable = pool): Promise<{ saved: number; mismatches: number }> {
  let mismatches = 0;
  for (const r of rows) {
    if (r.status !== "ok") mismatches++;
    const details = { ours: r.ours, broker: r.broker };
    await db.query(
      `INSERT INTO propreports_reconcile_days
         (account, account_id, trader, date, status, ours_net, broker_net, diff, ours_trades, broker_fills, carry, adj_diff, transfer_diff, details, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, NOW())
       ON CONFLICT (account, date) DO UPDATE SET
         account_id = EXCLUDED.account_id, trader = EXCLUDED.trader, status = EXCLUDED.status,
         ours_net = EXCLUDED.ours_net, broker_net = EXCLUDED.broker_net, diff = EXCLUDED.diff,
         ours_trades = EXCLUDED.ours_trades, broker_fills = EXCLUDED.broker_fills, carry = EXCLUDED.carry,
         adj_diff = EXCLUDED.adj_diff, transfer_diff = EXCLUDED.transfer_diff, details = EXCLUDED.details, checked_at = NOW(),
         acknowledged_at = CASE WHEN ABS(COALESCE(propreports_reconcile_days.acknowledged_diff, 0) - EXCLUDED.diff) > $15
                                THEN NULL ELSE propreports_reconcile_days.acknowledged_at END,
         acknowledged_by = CASE WHEN ABS(COALESCE(propreports_reconcile_days.acknowledged_diff, 0) - EXCLUDED.diff) > $15
                                THEN NULL ELSE propreports_reconcile_days.acknowledged_by END`,
      [acc.account, acc.accountId, acc.trader, r.date, r.status, r.ours?.net ?? null, r.broker?.net ?? null, r.diff,
        r.ours?.trades ?? null, r.broker?.fills ?? null, r.carry, r.adjDiff, r.transferDiff, JSON.stringify(details), MISMATCH_THRESHOLD],
    );
  }
  return { saved: rows.length, mismatches };
}

export interface ReconcileDayRow {
  id: number;
  account: string;
  accountId: string | null;
  trader: string | null;
  date: string;
  status: ReconcileStatus;
  oursNet: number | null;
  brokerNet: number | null;
  diff: number;
  oursTrades: number | null;
  brokerFills: number | null;
  carry: boolean;
  adjDiff: number | null;
  transferDiff: number | null;
  checkedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  note: string | null;
}

export interface ReconcileListFilter {
  /** "open" = not ok and not acknowledged (default); "all" = every non-ok row; "ok" included only with "everything". */
  view?: "open" | "all" | "everything";
  trader?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export async function listReconcileDays(f: ReconcileListFilter = {}, db: Queryable = pool): Promise<{ rows: ReconcileDayRow[]; lastCheckedAt: string | null; openCount: number }> {
  const view = f.view ?? "open";
  const where = [
    view === "everything" ? "TRUE" : "status <> 'ok'",
    view === "open" ? "acknowledged_at IS NULL" : "TRUE",
    "($1::text IS NULL OR trader = $1)",
    "($2::text IS NULL OR date >= $2)",
    "($3::text IS NULL OR date <= $3)",
  ].join(" AND ");
  const limit = Math.min(Math.max(f.limit ?? 300, 1), 1000);
  const [list, meta] = await Promise.all([
    db.query(`SELECT * FROM propreports_reconcile_days WHERE ${where} ORDER BY date DESC, ABS(diff) DESC, account LIMIT ${limit}`, [f.trader ?? null, f.from ?? null, f.to ?? null]),
    db.query(`SELECT MAX(checked_at) AS last, COUNT(*) FILTER (WHERE status <> 'ok' AND acknowledged_at IS NULL)::int AS open FROM propreports_reconcile_days`),
  ]);
  return {
    rows: list.rows.map((r: any): ReconcileDayRow => ({
      id: Number(r.id), account: String(r.account), accountId: r.account_id ?? null, trader: r.trader ?? null, date: String(r.date),
      status: r.status as ReconcileStatus, oursNet: nn(r.ours_net), brokerNet: nn(r.broker_net), diff: n(r.diff),
      oursTrades: r.ours_trades == null ? null : Number(r.ours_trades), brokerFills: r.broker_fills == null ? null : Number(r.broker_fills),
      carry: !!r.carry, adjDiff: nn(r.adj_diff), transferDiff: nn(r.transfer_diff),
      checkedAt: new Date(r.checked_at).toISOString(), acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
      acknowledgedBy: r.acknowledged_by ?? null, note: r.ack_note ?? null,
    })),
    lastCheckedAt: meta.rows[0]?.last ? new Date(meta.rows[0].last).toISOString() : null,
    openCount: Number(meta.rows[0]?.open ?? 0),
  };
}

export async function acknowledgeReconcileDay(id: number, actor: string, note: string | null, db: Queryable = pool): Promise<boolean> {
  const r = await db.query(
    `UPDATE propreports_reconcile_days SET acknowledged_at = NOW(), acknowledged_by = $2, acknowledged_diff = diff, ack_note = $3 WHERE id = $1`,
    [id, actor, note],
  );
  return !!r.rowCount;
}
