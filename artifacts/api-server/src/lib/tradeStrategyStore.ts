/**
 * Stored strategy of each trade (columns trades.strategy / entry_sec / strategy_sig, migration 0237) and the IMX tag.
 *
 *   refreshTradeStrategies(ids, q)   derive (lib/tradeStrategy, lib/tradeFacetDerive) + write the rows that changed, for
 *                                    the given trades and the rest of their trader-days; an IMX trade (MOC) gets the
 *                                    desk tag «IMX», a trade that is no longer IMX loses it. Called by the PropReports
 *                                    sync inside its transaction (lib/propreports/sync writeExecutions).
 *   backfillTradeStrategies(q)       every row whose signature is NULL (new, edited — the 0237 triggers) or stale (rule
 *                                    version / IMX window changed, re-read from the settings table first) — job
 *                                    trades.strategy-backfill. Writes only rows whose values changed and still hold what
 *                                    was read (a concurrent tag edit wins).
 *
 * Inputs per trade: ticker, session, date, exit_date, horizon, qty, entry, the fills (trade_executions.executed_at; the
 * first entry / last exit by kind) and, without fills, the broker's openedAt / closedAt (ET wall clock) or a timed `date`.
 *
 * The same pass writes the filter panel's derived columns (migration 0241, lib/tradeFacetDerive): hold_sec, overnight,
 * entry_kind, exit_kind, notional, day_seq, prev_kind. day_seq / prev_kind depend on the other trades of the trader's
 * NY day, so a refresh always loads and re-derives WHOLE trader-days (COALESCE(trader, '') + LEFT(date, 10), index
 * trades_trader_day_idx): the neighbours of a new / edited / deleted trade are rewritten when their values changed.
 */
import { pool } from "@workspace/db";
import { currentImxWindow, withImxTag } from "./imx";
import { deriveTradeStrategy, entrySecOf, isImxStrategy, type ImxWindow, type StrategyInput, type TradeStrategy } from "./tradeStrategy";
import { deriveFacetValues, type FacetDerived, type FacetDeriveInput, type StructureLite } from "./tradeFacetDerive";

type Queryable = { query: (typeof pool)["query"] };

const reloadSettings = async (): Promise<void> => (await import("./settings/store")).warmSettings();

/** Bump when the rules of lib/tradeStrategy or lib/tradeFacetDerive change: the backfill then re-derives every trade. */
export const STRATEGY_VERSION = 2; // 2: + hold / entry / exit kind / notional / day sequence (migration 0241)

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
  // Facet inputs (optional: a strategy-only caller may leave them out).
  trader?: string | null;
  result?: string | null;
  pnl?: string | number | null;
  fees?: string | number | null;
  hold_time?: string | null;
  reentry_of?: number | null;
  deleted?: boolean;
  structure?: StructureLite | null;
  // Stored facet values (compared, and guarded on write).
  hold_sec?: number | null;
  overnight?: boolean | null;
  entry_kind?: string | null;
  exit_kind?: string | null;
  notional?: string | number | null;
  day_seq?: number | null;
  prev_kind?: string | null;
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

export interface StrategyRowUpdate extends FacetDerived { id: number; strategy: TradeStrategy; entrySec: number | null; tags: string | null }

/** Derived strategy values of one trade (pure; the facet values come from deriveRows). */
export function deriveRow(r: StrategyTradeRow, fills: readonly StrategyFillRow[], win: ImxWindow): Pick<StrategyRowUpdate, "id" | "strategy" | "entrySec" | "tags"> {
  return strategyOf(r, strategyInputOf(r, fills), win);
}

function strategyOf(r: StrategyTradeRow, input: StrategyInput, win: ImxWindow): Pick<StrategyRowUpdate, "id" | "strategy" | "entrySec" | "tags"> {
  const strategy = deriveTradeStrategy(input, win);
  return { id: r.id, strategy, entrySec: entrySecOf(input), tags: withImxTag(r.tags, isImxStrategy(strategy)) };
}

const facetInputOf = (r: StrategyTradeRow, input: StrategyInput, entrySec: number | null): FacetDeriveInput => ({
  id: r.id, trader: r.trader ?? null, date: r.date, exitDate: r.exit_date, deleted: r.deleted === true, result: r.result ?? null,
  pnl: r.pnl, fees: r.fees, qty: r.qty, entry: r.entry, holdTime: r.hold_time ?? null, openedAt: r.opened_at, closedAt: r.closed_at,
  entryAt: input.entryAt ?? null, exitAt: input.exitAt ?? null, structure: r.structure ?? null, reentryOf: r.reentry_of ?? null, entrySec,
});

/** Every derived value of a set of rows (pass whole trader-days — day_seq / prev_kind look at the neighbours). */
export function deriveRows(rows: readonly StrategyTradeRow[], fillsOf: (id: number) => readonly StrategyFillRow[], win: ImxWindow): StrategyRowUpdate[] {
  const inputs = rows.map((r) => strategyInputOf(r, fillsOf(Number(r.id))));
  const base = rows.map((r, i) => strategyOf(r, inputs[i]!, win));
  const facets = deriveFacetValues(rows.map((r, i) => facetInputOf(r, inputs[i]!, base[i]!.entrySec)));
  return base.map((b) => ({ ...b, ...facets.get(b.id)! }));
}

const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

type Values = Omit<StrategyRowUpdate, "id">;

/** The stored values of a row in the shape of an update (for the change test and the write guard). */
function storedOf(r: StrategyTradeRow): Values {
  return {
    strategy: (r.strategy ?? null) as TradeStrategy, entrySec: r.entry_sec ?? null, tags: r.tags ?? null,
    holdSec: r.hold_sec ?? null, overnight: r.overnight ?? null, entryKind: (r.entry_kind ?? null) as FacetDerived["entryKind"],
    exitKind: (r.exit_kind ?? null) as FacetDerived["exitKind"], notional: numOrNull(r.notional), daySeq: r.day_seq ?? null,
    prevKind: (r.prev_kind ?? null) as FacetDerived["prevKind"],
  };
}

const FIELDS = ["strategy", "entrySec", "tags", "holdSec", "overnight", "entryKind", "exitKind", "notional", "daySeq", "prevKind"] as const;
/** Column + record type of each field (jsonb_to_recordset). */
const COLS: Record<(typeof FIELDS)[number], [string, string]> = {
  strategy: ["strategy", "text"], entrySec: ["entry_sec", "int"], tags: ["tags", "text"], holdSec: ["hold_sec", "int"],
  overnight: ["overnight", "bool"], entryKind: ["entry_kind", "text"], exitKind: ["exit_kind", "text"], notional: ["notional", "numeric"],
  daySeq: ["day_seq", "int"], prevKind: ["prev_kind", "text"],
};

const sameValues = (a: Values, b: Values) => FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));

/** `u(id int, strategy text, o_strategy text, …)` + the guard «every column still holds what was read». */
const RECORD_DEF = `u(id int, ${FIELDS.map((f) => `${COLS[f][0]} ${COLS[f][1]}, o_${COLS[f][0]} ${COLS[f][1]}`).join(", ")})`;
const GUARD = FIELDS.map((f) => `t.${COLS[f][0]} IS NOT DISTINCT FROM u.o_${COLS[f][0]}`).join(" AND ");
const SET = FIELDS.map((f) => `${COLS[f][0]} = u.${COLS[f][0]}`).join(", ");

function recordOf(up: StrategyRowUpdate, old: Values): Record<string, unknown> {
  const o: Record<string, unknown> = { id: up.id };
  for (const f of FIELDS) { o[COLS[f][0]] = up[f] ?? null; o[`o_${COLS[f][0]}`] = old[f] ?? null; }
  return o;
}

const ROW_COLS = `t.id, t.ticker, t.session, t.date, t.exit_date, t.horizon, t.qty, t.entry, t.tags, t.strategy, t.entry_sec,
       t.trader, t.result, t.pnl, t.fees, t.hold_time, t.reentry_of, (t.deleted_at IS NOT NULL) AS deleted,
       CASE WHEN t.structure IS NULL THEN NULL ELSE jsonb_build_object(
         'adds', t.structure -> 'adds', 'partials', t.structure -> 'partials', 'stopHit', t.structure -> 'stopHit',
         'scaledEntryLikely', t.structure -> 'scaledEntryLikely', 'scaledExitLikely', t.structure -> 'scaledExitLikely',
         'maxPosition', t.structure -> 'maxPosition', 'avgEntry', t.structure -> 'avgEntry',
         'firstAt', t.structure -> 'firstAt', 'lastAt', t.structure -> 'lastAt') END AS structure,
       t.hold_sec, t.overnight, t.entry_kind, t.exit_kind, t.notional, t.day_seq, t.prev_kind,
       t.context_snapshot ->> 'openedAt' AS opened_at, t.context_snapshot ->> 'closedAt' AS closed_at`;

export interface StrategyRefreshResult { trades: number; changed: number }

/** Derive + write the given trades and every other trade of their trader-days (see the header). */
export async function refreshTradeStrategies(ids: readonly number[], q: Queryable = pool, win: ImxWindow = currentImxWindow()): Promise<StrategyRefreshResult> {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length) return { trades: 0, changed: 0 };
  const tradesRes = await q.query<StrategyTradeRow>(
    `SELECT ${ROW_COLS} FROM trades t
      WHERE t.id IN (
        SELECT unnest($1::int[])
        UNION
        SELECT x.id FROM trades x WHERE (COALESCE(x.trader, ''), LEFT(x.date, 10)) IN (
          SELECT COALESCE(s.trader, ''), LEFT(s.date, 10) FROM trades s WHERE s.id = ANY($1::int[])))`,
    [uniq],
  );
  const all = tradesRes.rows.map((r) => Number(r.id));
  const fillsRes = await q.query<StrategyFillRow>(`SELECT trade_id, kind, executed_at FROM trade_executions WHERE trade_id = ANY($1::int[])`, [all]);
  const byTrade = new Map<number, StrategyFillRow[]>();
  for (const f of fillsRes.rows) {
    const list = byTrade.get(Number(f.trade_id));
    if (list) list.push(f); else byTrade.set(Number(f.trade_id), [f]);
  }
  const derived = deriveRows(tradesRes.rows, (id) => byTrade.get(id) ?? [], win);
  const ups = tradesRes.rows.map((row, i) => ({ row, old: storedOf(row), up: derived[i]! }));
  const changed = ups.filter(({ old, up }) => !sameValues(old, up));
  const sig = strategySig(win);
  // Only the rows whose derived values changed are rewritten, and only while they still hold what was read: a trader
  // editing tags (or anything written here) meanwhile wins — the row is left for the next run instead of overwritten.
  if (changed.length) {
    await q.query(
      `UPDATE trades t SET ${SET}, strategy_sig = $2
         FROM jsonb_to_recordset($1::jsonb) AS ${RECORD_DEF}
        WHERE t.id = u.id AND ${GUARD}`,
      [JSON.stringify(changed.map((x) => recordOf(x.up, x.old))), sig],
    );
  }
  // The unchanged rows only get the signature (so the backfill does not pick them again) — same guard.
  const changedSet = new Set(changed);
  const same = ups.filter((x) => !changedSet.has(x));
  if (same.length) {
    await q.query(
      `UPDATE trades t SET strategy_sig = $2
         FROM jsonb_to_recordset($1::jsonb) AS ${RECORD_DEF}
        WHERE t.id = u.id AND t.strategy_sig IS DISTINCT FROM $2 AND ${GUARD}`,
      [JSON.stringify(same.map((x) => recordOf(x.up, x.old))), sig],
    );
  }
  return { trades: ups.length, changed: changed.length };
}

/** Re-reads the desk settings first: this process's cache may predate an IMX window saved by another instance. */
export async function backfillTradeStrategies(q: Queryable = pool, chunk = 1000, reload: () => Promise<void> = reloadSettings): Promise<StrategyRefreshResult & { sig: string }> {
  await reload();
  const win = currentImxWindow();
  const sig = strategySig(win);
  // = `strategy_sig IS DISTINCT FROM $1` (sig is never NULL), spelled so trades_strategy_sig_idx (0238) answers it with
  // a BitmapOr instead of a full scan every 5 minutes.
  const { rows } = await q.query<{ id: number }>(
    `SELECT id FROM trades WHERE strategy_sig IS NULL OR strategy_sig < $1 OR strategy_sig > $1 ORDER BY id`,
    [sig],
  );
  const ids = rows.map((r) => Number(r.id));
  const total = { trades: 0, changed: 0, sig };
  for (let i = 0; i < ids.length; i += chunk) {
    const r = await refreshTradeStrategies(ids.slice(i, i + chunk), q, win);
    total.trades += r.trades;
    total.changed += r.changed;
  }
  return total;
}
