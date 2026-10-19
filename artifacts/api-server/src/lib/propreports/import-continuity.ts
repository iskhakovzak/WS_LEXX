/**
 * Manual imports that come in pieces: «вчера вошёл и добрал, сегодня скинул часть и вышел» arrives as two Fills files.
 *
 *   • continuation — a position still open in the journal (result 'open') is replayed from its stored executions in
 *     front of the new file's fills, so today's trims/exits close it instead of being dropped as orphans. The rebuilt
 *     round trip keeps the same external id (account|symbol|openedAt|side), so sync updates the open trade in place.
 *   • de-duplication — overlapping files (Mon–Wed, then Tue–Fri) or the same file twice: a fill already present is
 *     kept once. Same fill id = same fill; without ids, identical (time to the second, side, qty, price) fills are
 *     matched as a multiset, so two genuine identical fills in one file both survive.
 *
 * Pure helpers (mergeFills, fillsFromStoredTrade) are unit-tested; loadOpenPositionFills reads the DB.
 */
import { pool } from "@workspace/db";
import type { FeeBreakdown, Fill, FillSide } from "./types";
import { resolveAccount, type AccountMapping } from "./sync";

const sec = (dt: string) => dt.slice(0, 19).replace("T", " ");
const shapeKey = (f: Fill) => `${f.account}\u0000${f.symbol}\u0000${sec(f.dateTime)}\u0000${f.side}\u0000${f.qty}\u0000${f.price}`;

/** Drop exact repeats inside one file: rows with the same broker fill id (or PropReports row id) are one fill. */
export function dedupeFileFills(fills: Fill[]): { fills: Fill[]; duplicates: number } {
  const seen = new Set<string>();
  const out: Fill[] = [];
  for (const f of fills) {
    const id = f.fillId ? `f:${f.account}|${f.fillId}` : f.propReportsId ? `p:${f.propReportsId}` : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(f);
  }
  return { fills: out, duplicates: fills.length - out.length };
}

/**
 * Stored fills (from open journal positions) + the file's fills, each real fill once. The file wins: a stored fill is
 * dropped when the file has the same fill id, or — without ids — when the file already has as many fills of that shape.
 */
export function mergeFills(stored: Fill[], file: Fill[]): { fills: Fill[]; duplicates: number } {
  const fileIds = new Set(file.filter((f) => f.fillId).map((f) => `${f.account}|${f.fillId}`));
  const fileShapes = new Map<string, number>();
  for (const f of file) fileShapes.set(shapeKey(f), (fileShapes.get(shapeKey(f)) ?? 0) + 1);
  const kept: Fill[] = [];
  let duplicates = 0;
  for (const f of stored) {
    if (f.fillId && fileIds.has(`${f.account}|${f.fillId}`)) { duplicates++; continue; }
    const k = shapeKey(f);
    const left = fileShapes.get(k) ?? 0;
    if (left > 0) { fileShapes.set(k, left - 1); duplicates++; continue; }
    kept.push(f);
  }
  return { fills: [...kept, ...file], duplicates };
}

export interface StoredExecution {
  /** naive ET "YYYY-MM-DD HH:MM:SS" */
  at: string;
  qty: number;
  price: number;
  /** trade_executions.note, e.g. "PropReports B #123 · fees 0.35" */
  note: string;
  orderId: string | null;
}

export interface StoredOpenTrade {
  account: string;
  symbol: string;
  /** session date of the opening fill */
  date: string;
  /** trip-level fee split (context_snapshot.feesByType) — spread over the executions by their fee share */
  feesByType: FeeBreakdown;
  executions: StoredExecution[];
}

const NOTE = /^PropReports ([BSTC])(?: #(\S+))?(?: · fees (-?[\d.]+))?/;

/** The executions of an open journal trade back as fills (line −1: not from the file). */
export function fillsFromStoredTrade(t: StoredOpenTrade): Fill[] {
  const parsed = t.executions.map((e) => {
    const m = NOTE.exec(e.note);
    return m ? { e, side: m[1] as FillSide, fillId: m[2] ?? null, fees: Number(m[3] ?? 0) || 0 } : null;
  });
  if (parsed.some((p) => !p)) return []; // hand-edited executions: leave the trade alone
  const totalFees = parsed.reduce((s, p) => s + p!.fees, 0);
  const keys = Object.keys(t.feesByType);
  return parsed.map((p, i) => {
    const { e, side, fillId, fees } = p!;
    const share = totalFees ? fees / totalFees : 0;
    const split: FeeBreakdown = {};
    if (keys.length && totalFees) for (const k of keys) split[k] = (t.feesByType[k] || 0) * share;
    else if (fees) split.misc = fees;
    return {
      dateTime: e.at, account: t.account, side, qty: e.qty, symbol: t.symbol, price: e.price, route: null, fees: split,
      tradeDate: i === 0 ? t.date : e.at.slice(0, 10), orderId: e.orderId, fillId, propReportsId: null, status: null, line: -1,
    };
  });
}

/**
 * Open journal positions for the (account, symbol) pairs of a file, as fills. File fills whose account is another
 * spelling of the stored one (alias, display name vs id) are renamed to the stored spelling so ids stay stable.
 */
export async function loadOpenPositionFills(fileFills: Fill[], mappings: AccountMapping[]): Promise<{ fills: Fill[]; positions: number; duplicates: number }> {
  const symbols = [...new Set(fileFills.map((f) => f.symbol))];
  if (!symbols.length) return { fills: fileFills, positions: 0, duplicates: 0 };
  const { rows } = await pool.query(
    `SELECT t.id, t.ticker, LEFT(t.date, 10) AS date, t.broker_account, t.context_snapshot -> 'feesByType' AS fees_by_type,
            COALESCE(json_agg(json_build_object(
              'at', to_char(e.executed_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS'),
              'qty', e.qty, 'price', e.price, 'note', e.note, 'orderId', e.order_id) ORDER BY e.sort_order, e.id)
              FILTER (WHERE e.id IS NOT NULL), '[]') AS executions
       FROM trades t
       LEFT JOIN trade_executions e ON e.trade_id = t.id AND e.note LIKE 'PropReports%'
      WHERE t.source = 'propreports' AND t.deleted_at IS NULL AND LOWER(t.result) = 'open' AND t.ticker = ANY($1::text[])
      GROUP BY t.id`,
    [symbols],
  );
  if (!rows.length) return { fills: fileFills, positions: 0, duplicates: 0 };
  const canon = (a: string) => resolveAccount(a, mappings)?.mapping.account ?? a;
  const stored: Fill[] = [];
  const rename = new Map<string, string>(); // `${canonical}|${symbol}` → stored account spelling
  let positions = 0;
  for (const r of rows) {
    const account = String(r.broker_account ?? "");
    if (!account) continue;
    const key = `${canon(account)}|${r.ticker}`;
    if (!fileFills.some((f) => f.symbol === r.ticker && canon(f.account) === canon(account))) continue;
    const fills = fillsFromStoredTrade({
      account, symbol: String(r.ticker), date: String(r.date), feesByType: (r.fees_by_type ?? {}) as FeeBreakdown,
      executions: (r.executions as Array<Record<string, unknown>>).map((x) => ({
        at: String(x.at), qty: Number(x.qty), price: Number(x.price), note: String(x.note ?? ""), orderId: x.orderId == null ? null : String(x.orderId),
      })),
    });
    if (!fills.length) continue;
    rename.set(key, account);
    stored.push(...fills);
    positions++;
  }
  if (!positions) return { fills: fileFills, positions: 0, duplicates: 0 };
  const renamed = fileFills.map((f) => {
    const to = rename.get(`${canon(f.account)}|${f.symbol}`);
    return to && to !== f.account ? { ...f, account: to } : f;
  });
  const merged = mergeFills(stored, renamed);
  return { fills: merged.fills, positions, duplicates: merged.duplicates };
}
