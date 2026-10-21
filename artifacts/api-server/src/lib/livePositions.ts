/**
 * Live open positions from PropReports (action=positions, type=open) → the latest snapshot per account
 * (propreports_live_positions, migration 0221). Written by the positions tick step (lib/propreports/steps/positions.ts);
 * read by the risk desk (lib/riskData loadLiveSnapshots → lib/riskMetrics liveRisk).
 *
 * CSV columns (API v2): Date,Account,Qty,Symbol,Avg,Close,Unrealized Delta,Unrealized,Qty Traded,Realized,fees…
 * Qty 0 = a position closed during the day → ignored (its P&L arrives as a realized trade through the fills sync).
 * `Unrealized` = mark vs the average price (the whole open P&L) — the number the stop uses; `Unrealized Delta` (the
 * day's change) and `Realized` are stored for reference only.
 */
import { pool } from "@workspace/db";
import { normHeader, parseNum, round2, type CsvTable } from "./propreports/csv";
import type { AccountMapping } from "./propreports/sync";
import { resolveAccount } from "./propreports/sync";

export type LivePositionRow = {
  date: string;
  account: string;
  symbol: string;
  qty: number;
  avg: number | null;
  close: number | null;
  unrealized: number;
  unrealizedDelta: number;
  realized: number;
};

export type AccountSnapshot = {
  /** Canonical mapping account when the raw name resolves, else the raw PropReports account. */
  account: string;
  trader: string | null;
  openCount: number;
  unrealized: number;
  unrealizedDelta: number;
  realized: number;
  positions: Array<{ symbol: string; qty: number; avg: number | null; close: number | null; unrealized: number }>;
};

const finite = (x: number): number | null => (Number.isFinite(x) ? x : null);

/** Pure: positions CSV → open rows (Qty ≠ 0). Unknown / missing columns degrade to 0; rows without an account are skipped. */
export function parsePositionsTable(t: CsvTable): LivePositionRow[] {
  const idx = (...names: string[]) => {
    const want = names.map(normHeader);
    return t.header.findIndex((h) => want.includes(normHeader(h)));
  };
  const iDate = idx("date"), iAcc = idx("account"), iQty = idx("qty", "quantity"), iSym = idx("symbol");
  const iAvg = idx("avg", "avg price"), iClose = idx("close", "close price"), iUd = idx("unrealized delta"), iU = idx("unrealized");
  const iRe = idx("realized");
  if (iAcc < 0 || iQty < 0) return [];
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: LivePositionRow[] = [];
  for (const r of t.rows) {
    const account = cell(r, iAcc);
    const qty = parseNum(cell(r, iQty));
    if (!account || !Number.isFinite(qty) || qty === 0) continue;
    out.push({
      date: cell(r, iDate),
      account,
      symbol: cell(r, iSym).toUpperCase(),
      qty,
      avg: iAvg >= 0 ? finite(parseNum(cell(r, iAvg))) : null,
      close: iClose >= 0 ? finite(parseNum(cell(r, iClose))) : null,
      unrealized: finite(parseNum(cell(r, iU))) ?? 0,
      unrealizedDelta: finite(parseNum(cell(r, iUd))) ?? 0,
      realized: finite(parseNum(cell(r, iRe))) ?? 0,
    });
  }
  return out;
}

/**
 * Pure: open rows → one snapshot per account. Raw names resolve through the account mappings (exact / alias / case /
 * fuzzy, the same as the fills sync); an inactive mapping keeps the row but no trader. Every active mapped account that
 * has no open row gets an empty snapshot, so a flat trader's «обновлено N мин назад» is known too.
 */
export function buildAccountSnapshots(rows: LivePositionRow[], mappings: AccountMapping[]): AccountSnapshot[] {
  const by = new Map<string, AccountSnapshot>();
  const get = (account: string, trader: string | null) => {
    let s = by.get(account);
    if (!s) by.set(account, (s = { account, trader, openCount: 0, unrealized: 0, unrealizedDelta: 0, realized: 0, positions: [] }));
    return s;
  };
  for (const r of rows) {
    const res = resolveAccount(r.account, mappings);
    const m = res?.mapping ?? null;
    const s = get(m ? m.account : r.account, m && m.active && m.trader ? m.trader : null);
    s.openCount += 1;
    s.unrealized += r.unrealized;
    s.unrealizedDelta += r.unrealizedDelta;
    s.realized += r.realized;
    s.positions.push({ symbol: r.symbol, qty: r.qty, avg: r.avg, close: r.close, unrealized: round2(r.unrealized) });
  }
  for (const m of mappings) if (m.active && m.trader && !by.has(m.account)) get(m.account, m.trader);
  return [...by.values()]
    .map((s) => ({ ...s, unrealized: round2(s.unrealized), unrealizedDelta: round2(s.unrealizedDelta), realized: round2(s.realized) }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

type Queryable = { query: (typeof pool)["query"] };

/**
 * Overwrites the latest snapshot of every account in `snaps` and empties the accounts the response no longer has (a
 * stored account absent from this run has no open position in scope). One round trip each; idempotent.
 */
export async function saveLiveSnapshots(snaps: AccountSnapshot[], date: string, fetchedAt: Date, db: Queryable = pool): Promise<void> {
  const rows = snaps.map((s) => ({
    account: s.account, trader: s.trader, open_count: s.openCount, unrealized: s.unrealized,
    unrealized_delta: s.unrealizedDelta, realized: s.realized, positions: s.positions,
  }));
  if (rows.length) {
    await db.query(
      `INSERT INTO propreports_live_positions (account, trader, trading_date, open_count, unrealized, unrealized_delta, realized, positions, fetched_at)
       SELECT x.account, x.trader, $2, x.open_count, x.unrealized, x.unrealized_delta, x.realized, COALESCE(x.positions, '[]'::jsonb), $3
         FROM jsonb_to_recordset($1::jsonb) AS x(account text, trader text, open_count int, unrealized numeric, unrealized_delta numeric, realized numeric, positions jsonb)
       ON CONFLICT (account) DO UPDATE SET
         trader = EXCLUDED.trader, trading_date = EXCLUDED.trading_date, open_count = EXCLUDED.open_count,
         unrealized = EXCLUDED.unrealized, unrealized_delta = EXCLUDED.unrealized_delta, realized = EXCLUDED.realized,
         positions = EXCLUDED.positions, fetched_at = EXCLUDED.fetched_at`,
      [JSON.stringify(rows), date, fetchedAt],
    );
  }
  await db.query(
    `UPDATE propreports_live_positions
        SET open_count = 0, unrealized = 0, unrealized_delta = 0, realized = 0, positions = '[]'::jsonb, trading_date = $1, fetched_at = $2
      WHERE NOT (account = ANY($3::text[]))`,
    [date, fetchedAt, snaps.map((s) => s.account)],
  );
}

/** Open positions of one trader from the latest snapshot (the trader card / «Мой риск»). */
export async function loadLivePositions(trader: string, date: string): Promise<{ fetchedAt: string | null; positions: Array<AccountSnapshot["positions"][number] & { account: string }> }> {
  const { rows } = await pool.query<{ account: string; positions: unknown; fetched_at: Date | string }>(
    `SELECT account, positions, fetched_at FROM propreports_live_positions WHERE trader = $1 AND trading_date = $2 ORDER BY account`,
    [trader, date],
  ).catch(() => ({ rows: [] as { account: string; positions: unknown; fetched_at: Date | string }[] }));
  let oldest: number | null = null;
  const positions: Array<AccountSnapshot["positions"][number] & { account: string }> = [];
  for (const r of rows) {
    const at = new Date(r.fetched_at).getTime();
    if (Number.isFinite(at) && (oldest == null || at < oldest)) oldest = at;
    for (const p of Array.isArray(r.positions) ? (r.positions as AccountSnapshot["positions"]) : []) positions.push({ ...p, account: String(r.account) });
  }
  return { fetchedAt: oldest == null ? null : new Date(oldest).toISOString(), positions };
}
