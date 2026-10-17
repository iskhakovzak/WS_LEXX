/**
 * «Спроси журнал» book — the compact trade list the client-side question engine runs on (routes/ask.ts).
 * Pure helpers only (unit-tested in __tests__/askBook.test.ts).
 *
 * One SQL query instead of the 10 × /trades/page round trips the page used to make: /trades/page computes a summary,
 * curve, streak and facets over the whole filtered set on every page, which is what made «Загружаю сделки…» take
 * a minute for a curator. Here only the fields the engine reads are selected, and rows go out as tuples
 * (`cols` + `rows`) — about a third of the JSON of trade objects.
 *
 * $ privacy (lib/playbookPrivacy): pnl / fees / qty / riskUsd of a trade the viewer may not see are nulled, same rule
 * as /trades and /trades/page. The snapshot qty is folded into `qty` before redaction, so it cannot leak around it.
 */
import { canSeeTradeMoney, type MoneyViewer } from "./playbookPrivacy";

/** Hard cap: the engine runs in the browser; a desk book is ~25k rows today. */
export const ASK_BOOK_MAX_ROWS = 60_000;

export const ASK_BOOK_COLS = [
  "id", "ticker", "date", "exitDate", "side", "trader", "setup", "holdTime", "qty", "result",
  "entry", "exit", "stop", "rMultiple", "pnl", "fees", "riskUsd", "horizon", "openedAt", "closedAt",
] as const;
export type AskBookCol = (typeof ASK_BOOK_COLS)[number];

/** Row as selected by ASK_BOOK_SQL (pg returns numerics as strings). */
export interface AskBookDbRow {
  id: number;
  ticker: string | null;
  date: string | null;
  exit_date: string | null;
  side: string | null;
  trader: string | null;
  setup: string | null;
  hold_time: string | null;
  qty: string | number | null;
  result: string | null;
  entry: string | number | null;
  exit: string | number | null;
  stop: string | number | null;
  r_multiple: string | number | null;
  pnl: string | number | null;
  fees: string | number | null;
  risk_usd: string | number | null;
  horizon: string | null;
  opened_at: string | null;
  closed_at: string | null;
  snap_qty: string | null;
}

/** `scope` null = whole desk (staff), otherwise one trader name (or the guest sentinel, which matches nobody). */
export function askBookQuery(scope: string | null, limit = ASK_BOOK_MAX_ROWS): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let where = "deleted_at IS NULL";
  if (scope != null) {
    params.push(scope);
    where += ` AND trader = $${params.length}`;
  }
  params.push(limit + 1);
  const sql = `SELECT id, ticker, date, exit_date, side, trader, setup, hold_time, qty, result, entry, exit, stop, r_multiple,
      pnl, fees, risk_usd, horizon,
      context_snapshot->>'openedAt' AS opened_at, context_snapshot->>'closedAt' AS closed_at, context_snapshot->>'qty' AS snap_qty
    FROM trades WHERE ${where} ORDER BY date DESC, id DESC LIMIT $${params.length}`;
  return { sql, params };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type Cell = string | number | null;

/** One DB row → tuple in ASK_BOOK_COLS order, with $ nulled when the viewer may not see this trade's money. */
export function askBookTuple(r: AskBookDbRow, viewer: MoneyViewer): Cell[] {
  const money = canSeeTradeMoney(viewer, r.trader);
  const qty = numOrNull(r.qty) ?? numOrNull(r.snap_qty);
  return [
    r.id,
    (r.ticker ?? "").toUpperCase(),
    r.date ?? null,
    r.exit_date || null,
    r.side ?? null,
    r.trader ?? null,
    r.setup ?? null,
    r.hold_time ?? null,
    money ? qty : null,
    r.result ?? null,
    numOrNull(r.entry),
    numOrNull(r.exit),
    numOrNull(r.stop),
    numOrNull(r.r_multiple),
    money ? numOrNull(r.pnl) : null,
    money ? numOrNull(r.fees) : null,
    money ? numOrNull(r.risk_usd) : null,
    r.horizon ?? null,
    r.opened_at ?? null,
    r.closed_at ?? null,
  ];
}

export interface AskBookResponse {
  cols: readonly AskBookCol[];
  rows: Cell[][];
  truncated: boolean;
  /** Effective scope: a trader name, or null for the whole desk. */
  scope: string | null;
  /** Some rows had their $ nulled for this viewer. */
  redacted: boolean;
}

export function askBookResponse(dbRows: AskBookDbRow[], viewer: MoneyViewer, scope: string | null, limit = ASK_BOOK_MAX_ROWS): AskBookResponse {
  const truncated = dbRows.length > limit;
  const kept = truncated ? dbRows.slice(0, limit) : dbRows;
  let redacted = false;
  const rows = kept.map((r) => {
    if (!redacted && !canSeeTradeMoney(viewer, r.trader)) redacted = true;
    return askBookTuple(r, viewer);
  });
  return { cols: ASK_BOOK_COLS, rows, truncated, scope, redacted };
}
