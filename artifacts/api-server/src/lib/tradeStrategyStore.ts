/**
 * Stored strategy of each trade (columns trades.strategy / entry_sec / strategy_sig, migration 0237) and the IMX tag.
 *
 *   refreshTradeStrategies(ids, q)   derive (lib/tradeStrategy) + write the rows that changed; an IMX trade (MOC) gets the
 *                                    desk tag «IMX», a trade that is no longer IMX loses it. Called by the PropReports
 *                                    sync inside its transaction (lib/propreports/sync writeExecutions).
 *   backfillTradeStrategies(q)       every row whose signature is NULL (new, edited — the 0237 triggers) or stale (rule
 *                                    version / IMX window changed) — job trades.strategy-backfill.
 *
 * Inputs per trade: ticker, session, date, exit_date, horizon, qty, entry, the fills (trade_executions.executed_at; the
 * first entry / last exit by kind) and, without fills, the broker's openedAt / closedAt (ET wall clock) or a timed `date`.
 */
import { pool } from "@workspace/db";
import { currentImxWindow, withImxTag } from "./imx";
import { deriveTradeStrategy, entrySecOf, isImxStrategy, type ImxWindow, type StrategyInput, type TradeStrategy } from "./tradeStrategy";

type Queryable = { query: (typeof pool)["query"] };

/** Bump when the rules of lib/tradeStrategy change: the backfill then re-derives every trade. */
export const STRATEGY_VERSION = 1;

export function strategySig(win: ImxWindow): string {
  return `v${STRATEGY_VERSION}|${win.start}-${win.end}`;
}

export interface StrategyTradeRow {
  id: number;
  ticker: string | null;
  session: string | null;
  date: string | null;
  exit_date: string | null;
  horizon: string | null;
  qty: string | number | null;
  entry: string | number | null;
  tags: string | null;
  opened_at: string | null;
  closed_at: string | null;
  strategy: string | null;
  entry_sec: number | null;
}

export interface StrategyFillRow { trade_id: number; kind: string; executed_at: Date | string | null }

const ENTRY_KINDS = new Set(["entry", "add"]);
const EXIT_KINDS = new Set(["exit", "trim", "stop"]);
const ms = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** The derivation input of one trade from its row and fills (pure). */
export function strategyInputOf(r: StrategyTradeRow, fills: readonly StrategyFillRow[]): StrategyInput {
  const timed = fills.filter((f): f is StrategyFillRow & { executed_at: Date | string } => f.executed_at != null && Number.isFinite(ms(f.executed_at)));
  const pick = (kinds: Set<string>, last: boolean) => {
    const list = timed.filter((f) => kinds.has(f.kind)).sort((a, b) => ms(a.executed_at) - ms(b.executed_at));
    return list.length ? (last ? list[list.length - 1]! : list[0]!).executed_at : null;
  };
  const date = r.date ?? "";
  const timedDate = date.length > 10 ? date : null;
  return {
    ticker: r.ticker, session: r.session, date: date.slice(0, 10), exitDate: r.exit_date, horizon: r.horizon,
    qty: r.qty, entry: r.entry,
    entryAt: pick(ENTRY_KINDS, false) ?? r.opened_at ?? timedDate,
    exitAt: pick(EXIT_KINDS, true) ?? r.closed_at,
    fills: timed.map((f) => f.executed_at),
  };
}

export interface StrategyRowUpdate { id: number; strategy: TradeStrategy; entrySec: number | null; tags: string | null }

/** Derived values of one trade (pure). */
export function deriveRow(r: StrategyTradeRow, fills: readonly StrategyFillRow[], win: ImxWindow): StrategyRowUpdate {
  const input = strategyInputOf(r, fills);
  const strategy = deriveTradeStrategy(input, win);
  return { id: r.id, strategy, entrySec: entrySecOf(input), tags: withImxTag(r.tags, isImxStrategy(strategy)) };
}

export interface StrategyRefreshResult { trades: number; changed: number }

export async function refreshTradeStrategies(ids: readonly number[], q: Queryable = pool, win: ImxWindow = currentImxWindow()): Promise<StrategyRefreshResult> {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length) return { trades: 0, changed: 0 };
  const [tradesRes, fillsRes] = await Promise.all([
    q.query<StrategyTradeRow>(
      `SELECT id, ticker, session, date, exit_date, horizon, qty, entry, tags, strategy, entry_sec,
              context_snapshot ->> 'openedAt' AS opened_at, context_snapshot ->> 'closedAt' AS closed_at
         FROM trades WHERE id = ANY($1::int[])`,
      [uniq],
    ),
    q.query<StrategyFillRow>(`SELECT trade_id, kind, executed_at FROM trade_executions WHERE trade_id = ANY($1::int[])`, [uniq]),
  ]);
  const byTrade = new Map<number, StrategyFillRow[]>();
  for (const f of fillsRes.rows) {
    const list = byTrade.get(Number(f.trade_id));
    if (list) list.push(f); else byTrade.set(Number(f.trade_id), [f]);
  }
  const ups = tradesRes.rows.map((r) => ({ row: r, up: deriveRow(r, byTrade.get(Number(r.id)) ?? [], win) }));
  const changed = ups.filter(({ row, up }) => row.strategy !== up.strategy || (row.entry_sec ?? null) !== up.entrySec || (row.tags ?? null) !== up.tags);
  const sig = strategySig(win);
  // Every row gets the signature (also the unchanged ones), so the backfill does not pick them again.
  await q.query(
    `UPDATE trades t SET strategy = u.strategy, entry_sec = u.entry_sec, tags = u.tags, strategy_sig = $5
       FROM unnest($1::int[], $2::text[], $3::int[], $4::text[]) AS u(id, strategy, entry_sec, tags)
      WHERE t.id = u.id`,
    [ups.map((x) => x.up.id), ups.map((x) => x.up.strategy), ups.map((x) => x.up.entrySec), ups.map((x) => x.up.tags), sig],
  );
  return { trades: ups.length, changed: changed.length };
}

export async function backfillTradeStrategies(q: Queryable = pool, chunk = 1000): Promise<StrategyRefreshResult & { sig: string }> {
  const win = currentImxWindow();
  const sig = strategySig(win);
  const { rows } = await q.query<{ id: number }>(`SELECT id FROM trades WHERE strategy_sig IS DISTINCT FROM $1 ORDER BY id`, [sig]);
  const ids = rows.map((r) => Number(r.id));
  const total = { trades: 0, changed: 0, sig };
  for (let i = 0; i < ids.length; i += chunk) {
    const r = await refreshTradeStrategies(ids.slice(i, i + chunk), q, win);
    total.trades += r.trades;
    total.changed += r.changed;
  }
  return total;
}
