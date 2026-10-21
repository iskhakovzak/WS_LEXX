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
 * The same pass writes the filter panel's derived columns (migrations 0241, 0242, lib/tradeFacetDerive): hold_sec,
 * overnight, entry_kind, adds_kind, exit_kind, has_stop, notional, size_rel, day_seq, prev_kind. day_seq / prev_kind
 * depend on the other trades of the trader's NY day, so a refresh always loads and re-derives WHOLE trader-days
 * (COALESCE(trader, '') + LEFT(date, 10), index trades_trader_day_idx): the neighbours of a new / edited / deleted trade
 * are rewritten when their values changed. size_rel depends on the trader's earlier trades (SIZE_REL_DAYS back), so a
 * refresh also re-derives the trader's FOLLOWING SIZE_REL_DAYS days of every day it touches (their «usual size» may
 * have moved) and reads the SIZE_REL_DAYS before them as history (not written). The 0242 triggers do the same for a
 * trade that leaves a day (trader / date changed, hard delete): that trader's day and the following SIZE_REL_DAYS days
 * go stale.
 */
import { pool } from "@workspace/db";
import { currentImxWindow, withImxTag } from "./imx";
import { deriveTradeStrategy, entrySecOf, isImxStrategy, type ImxWindow, type StrategyInput, type TradeStrategy } from "./tradeStrategy";
import {
  deriveFacetValues, isoDayOf, legsOf, notionalOf, shiftIsoDay,
  type FacetDerived, type FacetDeriveInput, type FacetFill, type SizeRow, type StructureLite,
} from "./tradeFacetDerive";
import { SIZE_REL_DAYS } from "./tradeFacetBuckets";

type Queryable = { query: (typeof pool)["query"] };

const reloadSettings = async (): Promise<void> => (await import("./settings/store")).warmSettings();

/** Bump when the rules of lib/tradeStrategy or lib/tradeFacetDerive change: the backfill then re-derives every trade. */
export const STRATEGY_VERSION = 3; // 2: + hold / entry / exit kind / notional / day sequence (0241); 3: + adds / stop / size vs usual, aggressive entry, flip exit (0242)

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
  stop?: string | number | null;
  // Stored facet values (compared, and guarded on write).
  hold_sec?: number | null;
  overnight?: boolean | null;
  entry_kind?: string | null;
  exit_kind?: string | null;
  notional?: string | number | null;
  day_seq?: number | null;
  prev_kind?: string | null;
  adds_kind?: string | null;
  size_rel?: string | number | null;
  has_stop?: boolean | null;
}

/** A fill (trade_executions); price / qty / role / leg_index feed the legs of the facet kinds (lib/tradeFacetDerive). */
export interface StrategyFillRow extends FacetFill { trade_id: number }

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

const facetInputOf = (r: StrategyTradeRow, input: StrategyInput, entrySec: number | null, fills: readonly StrategyFillRow[]): FacetDeriveInput => ({
  id: r.id, trader: r.trader ?? null, date: r.date, exitDate: r.exit_date, deleted: r.deleted === true, result: r.result ?? null,
  pnl: r.pnl, fees: r.fees, qty: r.qty, entry: r.entry, holdTime: r.hold_time ?? null, openedAt: r.opened_at, closedAt: r.closed_at,
  entryAt: input.entryAt ?? null, exitAt: input.exitAt ?? null, structure: r.structure ?? null, reentryOf: r.reentry_of ?? null, entrySec,
  legs: legsOf(fills), stop: r.stop ?? null,
});

/**
 * Every derived value of a set of rows (pass whole trader-days — day_seq / prev_kind look at the neighbours);
 * `history` = the same traders' trades of the SIZE_REL_DAYS before them (read only, for size_rel).
 */
export function deriveRows(
  rows: readonly StrategyTradeRow[], fillsOf: (id: number) => readonly StrategyFillRow[], win: ImxWindow, history: readonly StrategyTradeRow[] = [],
): StrategyRowUpdate[] {
  const fills = rows.map((r) => fillsOf(Number(r.id)));
  const inputs = rows.map((r, i) => strategyInputOf(r, fills[i]!));
  const base = rows.map((r, i) => strategyOf(r, inputs[i]!, win));
  const facets = deriveFacetValues(rows.map((r, i) => facetInputOf(r, inputs[i]!, base[i]!.entrySec, fills[i]!)), history.map(sizeRowOf));
  return base.map((b) => ({ ...b, ...facets.get(b.id)! }));
}

/** A history row's place in the size history (its stored entry second: only its day matters to the targets). */
const sizeRowOf = (r: StrategyTradeRow): SizeRow => ({
  id: Number(r.id), trader: r.trader ?? null, date: r.date, entrySec: r.entry_sec ?? null, deleted: r.deleted === true,
  notional: notionalOf(r.structure ?? null, r.qty, r.entry),
});

const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

type Values = Omit<StrategyRowUpdate, "id">;

/** The stored values of a row in the shape of an update (for the change test and the write guard). */
function storedOf(r: StrategyTradeRow): Values {
  return {
    strategy: (r.strategy ?? null) as TradeStrategy, entrySec: r.entry_sec ?? null, tags: r.tags ?? null,
    holdSec: r.hold_sec ?? null, overnight: r.overnight ?? null, entryKind: (r.entry_kind ?? null) as FacetDerived["entryKind"],
    exitKind: (r.exit_kind ?? null) as FacetDerived["exitKind"], notional: numOrNull(r.notional), daySeq: r.day_seq ?? null,
    prevKind: (r.prev_kind ?? null) as FacetDerived["prevKind"], addsKind: (r.adds_kind ?? null) as FacetDerived["addsKind"],
    sizeRel: numOrNull(r.size_rel), hasStop: (r.has_stop ?? null) as boolean,
  };
}

const FIELDS = [
  "strategy", "entrySec", "tags", "holdSec", "overnight", "entryKind", "exitKind", "notional", "daySeq", "prevKind",
  "addsKind", "sizeRel", "hasStop",
] as const;
/** Column + record type of each field (jsonb_to_recordset). */
const COLS: Record<(typeof FIELDS)[number], [string, string]> = {
  strategy: ["strategy", "text"], entrySec: ["entry_sec", "int"], tags: ["tags", "text"], holdSec: ["hold_sec", "int"],
  overnight: ["overnight", "bool"], entryKind: ["entry_kind", "text"], exitKind: ["exit_kind", "text"], notional: ["notional", "numeric"],
  daySeq: ["day_seq", "int"], prevKind: ["prev_kind", "text"], addsKind: ["adds_kind", "text"], sizeRel: ["size_rel", "numeric"],
  hasStop: ["has_stop", "bool"],
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
         'firstAt', t.structure -> 'firstAt', 'lastAt', t.structure -> 'lastAt', 'side', t.structure -> 'side',
         'stopPrice', t.structure -> 'stopPrice', 'flipOut', t.structure -> 'flipOut', 'carriedIn', t.structure -> 'carriedIn') END AS structure,
       t.stop, t.hold_sec, t.overnight, t.entry_kind, t.exit_kind, t.notional, t.day_seq, t.prev_kind, t.adds_kind, t.size_rel, t.has_stop,
       t.context_snapshot ->> 'openedAt' AS opened_at, t.context_snapshot ->> 'closedAt' AS closed_at`;

export interface StrategyRefreshResult { trades: number; changed: number }

/** Per trader, the day ranges [from, to] (inclusive, "YYYY-MM-DD") to load, merged; an invalid seed day is its own range. */
export function dayRanges(seeds: readonly { tr: string; d: string }[], back: number, ahead: number): { tr: string[]; from: string[]; to: string[] } {
  const by = new Map<string, [string, string][]>();
  for (const { tr, d } of seeds) {
    const iso = isoDayOf(d);
    const r: [string, string] = iso ? [shiftIsoDay(iso, back), shiftIsoDay(iso, ahead)] : [d, d];
    const l = by.get(tr);
    if (l) l.push(r); else by.set(tr, [r]);
  }
  const out = { tr: [] as string[], from: [] as string[], to: [] as string[] };
  for (const [tr, list] of by) {
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let cur: [string, string] | null = null;
    const flush = () => { if (cur) { out.tr.push(tr); out.from.push(cur[0]); out.to.push(cur[1]); } };
    for (const r of list) {
      const next = cur && isoDayOf(cur[1]) && isoDayOf(r[0]) ? shiftIsoDay(cur[1], 1) : null;
      if (cur && next != null && r[0] <= next) { if (r[1] > cur[1]) cur[1] = r[1]; continue; }
      flush();
      cur = [r[0], r[1]];
    }
    flush();
  }
  return out;
}

/** Trades of the given trader day ranges (index trades_trader_day_idx), plus the given ids. */
const RANGE_IDS = `SELECT x.id FROM unnest($2::text[], $3::text[], $4::text[]) AS r(tr, d0, d1)
  JOIN trades x ON COALESCE(x.trader, '') = r.tr AND LEFT(x.date, 10) >= r.d0 AND LEFT(x.date, 10) <= r.d1`;

/** Derive + write the given trades, every other trade of their trader-days and the following SIZE_REL_DAYS days (see the header). */
export async function refreshTradeStrategies(ids: readonly number[], q: Queryable = pool, win: ImxWindow = currentImxWindow()): Promise<StrategyRefreshResult> {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length) return { trades: 0, changed: 0 };
  const seeds = (await q.query<{ tr: string; d: string }>(
    `SELECT DISTINCT COALESCE(trader, '') AS tr, COALESCE(LEFT(date, 10), '') AS d FROM trades WHERE id = ANY($1::int[])`, [uniq],
  )).rows;
  const ahead = dayRanges(seeds, 0, SIZE_REL_DAYS);
  const tradesRes = await q.query<StrategyTradeRow>(
    `SELECT ${ROW_COLS} FROM trades t WHERE t.id IN (SELECT unnest($1::int[]) UNION ${RANGE_IDS})`,
    [uniq, ahead.tr, ahead.from, ahead.to],
  );
  const all = tradesRes.rows.map((r) => Number(r.id));
  // size_rel history: the SIZE_REL_DAYS before every loaded day (the loaded rows themselves are skipped).
  const valid = seeds.filter((x) => isoDayOf(x.d) != null);
  const back = dayRanges(valid, -SIZE_REL_DAYS, -1);
  const historyRes = back.tr.length
    ? await q.query<StrategyTradeRow>(
      `SELECT t.id, t.trader, t.date, t.qty, t.entry, t.entry_sec, (t.deleted_at IS NOT NULL) AS deleted,
              CASE WHEN t.structure IS NULL THEN NULL ELSE jsonb_build_object(
                'maxPosition', t.structure -> 'maxPosition', 'avgEntry', t.structure -> 'avgEntry') END AS structure
         FROM trades t WHERE t.id IN (${RANGE_IDS}) AND NOT (t.id = ANY($1::int[]))`,
      [all, back.tr, back.from, back.to],
    )
    : { rows: [] as StrategyTradeRow[] };
  const fillsRes = await q.query<StrategyFillRow>(
    `SELECT id, trade_id, kind, role, leg_index, price, qty, executed_at, sort_order FROM trade_executions WHERE trade_id = ANY($1::int[])`,
    [all],
  );
  const byTrade = new Map<number, StrategyFillRow[]>();
  for (const f of fillsRes.rows) {
    const list = byTrade.get(Number(f.trade_id));
    if (list) list.push(f); else byTrade.set(Number(f.trade_id), [f]);
  }
  const derived = deriveRows(tradesRes.rows, (id) => byTrade.get(id) ?? [], win, historyRes.rows);
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
