/**
 * Broker adjustments store (table propreports_adjustments, migration 0222) — phase 3 ACCURACY.
 *
 *   planAdjustmentWrites(existing, incoming)   pure: touch / replace (new propReportsId, same data) / insert / archive
 *   storeAdjustments(rows, window)              one transaction; a fetch is authoritative for its scope + date window:
 *                                               rows of that scope+window that are no longer returned are ARCHIVED
 *                                               (archived_at), never deleted; a returning id un-archives its row
 *   adjustmentDays(trader, from, to)            per trader per day: fees / transfers / other (+ trade net, adjusted net,
 *                                               equity change) — what net P&L and equity add on top of the trades
 *   relinkAdjustmentTraders()                   re-resolve `trader` after the account mapping changed
 *
 * Money: amounts as PropReports books them (a fee is negative, a deposit positive). netWithAdjustments = trade net +
 * fees + other; equityDelta = netWithAdjustments + transfers.
 */
import { pool } from "@workspace/db";
import { closeDateSql, closedSql, netPnlSql } from "../tradeMath";
import { round4 } from "./csv";
import { pairReplacements } from "./replacement";
import { resolveAccount, type AccountMapping } from "./sync";
import type { AdjustmentKind, AdjustmentRow } from "./adjustments-parse";

type Queryable = { query: (typeof pool)["query"] };

export interface ExistingAdjustment {
  id: number;
  account: string;
  propReportsId: string | null;
  fingerprint: string;
  occurrence: number;
  archived: boolean;
  /** Inside the scope + date window of this fetch (only those can be archived / paired). */
  inWindow: boolean;
}

export interface AdjustmentWritePlan {
  touch: Array<{ id: number; row: AdjustmentRow }>;
  replace: Array<{ id: number; oldId: string | null; row: AdjustmentRow }>;
  insert: AdjustmentRow[];
  archive: number[];
}

const idKey = (account: string, id: string) => `${account}\u0000${id}`;

export function planAdjustmentWrites(existing: ExistingAdjustment[], incoming: AdjustmentRow[]): AdjustmentWritePlan {
  const byId = new Map<string, ExistingAdjustment>();
  const byFpOcc = new Map<string, ExistingAdjustment>();
  for (const e of existing) {
    if (e.propReportsId) byId.set(idKey(e.account, e.propReportsId), e);
    else if (e.inWindow) byFpOcc.set(`${e.fingerprint}#${e.occurrence}`, e);
  }
  const used = new Set<number>();
  const plan: AdjustmentWritePlan = { touch: [], replace: [], insert: [], archive: [] };
  const left: AdjustmentRow[] = [];
  const seenIds = new Set<string>();
  for (const r of incoming) {
    if (r.propReportsId) {
      const k = idKey(r.account, r.propReportsId);
      if (seenIds.has(k)) continue; // same id twice in one fetch (overlapping pages) = one row
      seenIds.add(k);
      const e = byId.get(k);
      if (e && !used.has(e.id)) { used.add(e.id); plan.touch.push({ id: e.id, row: r }); continue; }
    } else {
      const e = byFpOcc.get(`${r.fingerprint}#${r.occurrence}`);
      if (e && !used.has(e.id)) { used.add(e.id); plan.touch.push({ id: e.id, row: r }); continue; }
    }
    left.push(r);
  }
  // a vanished active row of this window + a fresh row with the same data = the same adjustment under a new id
  const vanished = existing
    .filter((e) => e.inWindow && !e.archived && !used.has(e.id))
    .sort((a, b) => a.id - b.id);
  const paired = pairReplacements(vanished, left, (e) => e.fingerprint, (r) => r.fingerprint);
  for (const [e, r] of paired.pairs) plan.replace.push({ id: e.id, oldId: e.propReportsId, row: r });
  plan.insert = paired.fresh;
  plan.archive = paired.vanished.map((e) => e.id);
  return plan;
}

export interface StoreWindow {
  /** Scope the fetch covered, e.g. "group:-4" or "accounts:A1,A2" — only this scope's rows are archived. */
  scope: string;
  from: string;
  to: string;
  mappings: AccountMapping[];
}

export interface StoreResult {
  inserted: number;
  updated: number;
  replaced: number;
  archived: number;
}

function traderOf(account: string, mappings: AccountMapping[]): string | null {
  return resolveAccount(account, mappings)?.mapping.trader ?? null;
}

const UPDATE_SQL = `
  UPDATE propreports_adjustments SET
    date = $2, account = $3, trader = $4, category = $5, kind = $6, amount = $7, comment = $8, qty = $9, symbol = $10, price = $11,
    propreports_id = $12, fingerprint = $13, occurrence = $14, scope = $15,
    replaced_ids = CASE WHEN $16::text IS NULL OR $16::text = ANY(replaced_ids) THEN replaced_ids ELSE array_append(replaced_ids, $16::text) END,
    archived_at = NULL, last_seen_at = NOW(), updated_at = NOW()
  WHERE id = $1`;

function rowParams(r: AdjustmentRow, trader: string | null, scope: string): unknown[] {
  return [r.date, r.account, trader, r.category, r.kind, r.amount, r.comment, r.qty, r.symbol, r.price, r.propReportsId, r.fingerprint, r.occurrence, scope];
}

export async function storeAdjustments(rows: AdjustmentRow[], w: StoreWindow, db: Pick<typeof pool, "connect"> = pool): Promise<StoreResult> {
  const client = await db.connect();
  const res: StoreResult = { inserted: 0, updated: 0, replaced: 0, archived: 0 };
  try {
    await client.query("BEGIN");
    const ids = rows.map((r) => r.propReportsId).filter((x): x is string => !!x);
    const { rows: ex } = await client.query(
      `SELECT id, account, propreports_id, fingerprint, occurrence, archived_at, scope, date
         FROM propreports_adjustments
        WHERE (scope = $1 AND date >= $2 AND date <= $3) OR propreports_id = ANY($4::text[])
        FOR UPDATE`,
      [w.scope, w.from, w.to, ids],
    );
    const existing: ExistingAdjustment[] = ex.map((e: any) => ({
      id: Number(e.id), account: String(e.account), propReportsId: e.propreports_id ?? null, fingerprint: String(e.fingerprint),
      occurrence: Number(e.occurrence ?? 1), archived: !!e.archived_at,
      inWindow: e.scope === w.scope && String(e.date) >= w.from && String(e.date) <= w.to,
    }));
    const plan = planAdjustmentWrites(existing, rows);
    for (const t of plan.touch) {
      await client.query(UPDATE_SQL, [t.id, ...rowParams(t.row, traderOf(t.row.account, w.mappings), w.scope), null]);
      res.updated++;
    }
    for (const r of plan.replace) {
      await client.query(UPDATE_SQL, [r.id, ...rowParams(r.row, traderOf(r.row.account, w.mappings), w.scope), r.oldId && r.oldId !== r.row.propReportsId ? r.oldId : null]);
      res.replaced++;
    }
    for (const r of plan.insert) {
      await client.query(
        `INSERT INTO propreports_adjustments (date, account, trader, category, kind, amount, comment, qty, symbol, price, propreports_id, fingerprint, occurrence, scope)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        rowParams(r, traderOf(r.account, w.mappings), w.scope),
      );
      res.inserted++;
    }
    if (plan.archive.length) {
      const a = await client.query(`UPDATE propreports_adjustments SET archived_at = NOW(), updated_at = NOW() WHERE id = ANY($1::int[]) AND archived_at IS NULL`, [plan.archive]);
      res.archived = a.rowCount ?? plan.archive.length;
    }
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** After a mapping change: `trader` of every adjustment follows propreports_accounts (exact account name). */
export async function relinkAdjustmentTraders(db: Queryable = pool): Promise<number> {
  const r = await db.query(
    `UPDATE propreports_adjustments a SET trader = m.trader, updated_at = NOW()
       FROM propreports_accounts m
      WHERE (a.account = m.account OR a.account = m.account_name OR a.account = ANY(m.aliases))
        AND a.trader IS DISTINCT FROM m.trader`,
  );
  return r.rowCount ?? 0;
}

// ─── reads ──────────────────────────────────────────────────────────────────

export interface AdjustmentDay {
  date: string;
  /** Σ net of the trader's closed trades booked that day (close date), as on the dashboard. */
  tradeNet: number;
  fees: number;
  transfers: number;
  other: number;
  count: number;
  /** tradeNet + fees + other — net P&L including broker adjustments. */
  netWithAdjustments: number;
  /** netWithAdjustments + transfers — the day's change of account equity. */
  equityDelta: number;
}

export interface AdjustmentItem {
  id: number;
  date: string;
  account: string;
  trader: string | null;
  category: string;
  kind: AdjustmentKind;
  amount: number;
  comment: string | null;
  symbol: string | null;
}

export interface AdjustmentsReport {
  trader: string | null;
  from: string;
  to: string;
  days: AdjustmentDay[];
  totals: Omit<AdjustmentDay, "date">;
  items: AdjustmentItem[];
  itemsTruncated: boolean;
}

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/** Pure merge of trade-net days and adjustment days (both keyed by YYYY-MM-DD). */
export function mergeAdjustmentDays(
  trades: Array<{ date: string; net: number }>,
  adj: Array<{ date: string; fees: number; transfers: number; other: number; count: number }>,
): { days: AdjustmentDay[]; totals: Omit<AdjustmentDay, "date"> } {
  const map = new Map<string, AdjustmentDay>();
  const get = (date: string) => {
    let d = map.get(date);
    if (!d) { d = { date, tradeNet: 0, fees: 0, transfers: 0, other: 0, count: 0, netWithAdjustments: 0, equityDelta: 0 }; map.set(date, d); }
    return d;
  };
  for (const t of trades) get(t.date).tradeNet += t.net;
  for (const a of adj) {
    const d = get(a.date);
    d.fees += a.fees; d.transfers += a.transfers; d.other += a.other; d.count += a.count;
  }
  const days = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
    const netWithAdjustments = round4(d.tradeNet + d.fees + d.other);
    return { ...d, tradeNet: round4(d.tradeNet), fees: round4(d.fees), transfers: round4(d.transfers), other: round4(d.other), netWithAdjustments, equityDelta: round4(netWithAdjustments + d.transfers) };
  });
  const totals = days.reduce(
    (s, d) => ({ tradeNet: s.tradeNet + d.tradeNet, fees: s.fees + d.fees, transfers: s.transfers + d.transfers, other: s.other + d.other, count: s.count + d.count, netWithAdjustments: s.netWithAdjustments + d.netWithAdjustments, equityDelta: s.equityDelta + d.equityDelta }),
    { tradeNet: 0, fees: 0, transfers: 0, other: 0, count: 0, netWithAdjustments: 0, equityDelta: 0 },
  );
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) if (k !== "count") totals[k] = round4(totals[k]);
  return { days, totals };
}

/** Per-day adjustment sums only (for other aggregates — dashboard / equity curves can add them to their own net). */
export async function adjustmentTotalsByDay(trader: string | null, from: string, to: string, db: Queryable = pool): Promise<Array<{ date: string; fees: number; transfers: number; other: number; count: number }>> {
  const { rows } = await db.query(
    `SELECT date,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'fee'), 0) AS fees,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'transfer'), 0) AS transfers,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'other'), 0) AS other,
            COUNT(*)::int AS n
       FROM propreports_adjustments
      WHERE archived_at IS NULL AND date >= $2 AND date <= $3 AND ($1::text IS NULL OR trader = $1)
      GROUP BY date ORDER BY date`,
    [trader, from, to],
  );
  return rows.map((r: any) => ({ date: String(r.date), fees: n(r.fees), transfers: n(r.transfers), other: n(r.other), count: Number(r.n) }));
}

const ITEMS_LIMIT = 500;

export async function adjustmentDays(trader: string | null, from: string, to: string, db: Queryable = pool): Promise<AdjustmentsReport> {
  const [adj, trades, items] = await Promise.all([
    adjustmentTotalsByDay(trader, from, to, db),
    db.query(
      `SELECT substring(${closeDateSql()} from 1 for 10) AS day, SUM(${netPnlSql()}) AS net
         FROM trades t
        WHERE t.deleted_at IS NULL AND ${closedSql()} AND ($1::text IS NULL OR t.trader = $1)
          AND substring(${closeDateSql()} from 1 for 10) >= $2 AND substring(${closeDateSql()} from 1 for 10) <= $3
        GROUP BY 1`,
      [trader, from, to],
    ),
    db.query(
      `SELECT id, date, account, trader, category, kind, amount, comment, symbol
         FROM propreports_adjustments
        WHERE archived_at IS NULL AND date >= $2 AND date <= $3 AND ($1::text IS NULL OR trader = $1)
        ORDER BY date DESC, id DESC LIMIT ${ITEMS_LIMIT + 1}`,
      [trader, from, to],
    ),
  ]);
  const { days, totals } = mergeAdjustmentDays(
    trades.rows.filter((r: any) => r.day).map((r: any) => ({ date: String(r.day), net: n(r.net) })),
    adj,
  );
  const list = items.rows.slice(0, ITEMS_LIMIT).map((r: any): AdjustmentItem => ({
    id: Number(r.id), date: String(r.date), account: String(r.account), trader: r.trader ?? null, category: String(r.category),
    kind: (["fee", "transfer", "other"].includes(r.kind) ? r.kind : "other") as AdjustmentKind, amount: n(r.amount), comment: r.comment ?? null, symbol: r.symbol ?? null,
  }));
  return { trader, from, to, days, totals, items: list, itemsTruncated: items.rows.length > ITEMS_LIMIT };
}
