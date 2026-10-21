/**
 * Stored strategy of each trade (columns trades.strategy / entry_sec / strategy_sig, migration 0237), the IMX mark
 * (trades.is_imx, migration 0243: any fill inside the IMX window — not a strategy) and the IMX tag.
 *
 *   refreshTradeStrategies(ids, q)   derive (lib/tradeStrategy, lib/tradeFacetDerive) + write the rows that changed, for
 *                                    the given trades and the rest of their trader-days; an IMX trade (is_imx) gets
 *                                    the desk tag «IMX», a trade that is no longer IMX loses it. Called by the PropReports
 *                                    sync inside its transaction (lib/propreports/sync writeExecutions).
 *   backfillTradeStrategies(q)       every row whose signature is NULL (new, edited — the 0237 triggers) or stale (rule
 *                                    version / IMX window changed, re-read from the settings table first) — job
 *                                    trades.strategy-backfill. Writes only rows whose values changed and still hold what
 *                                    was read (a concurrent tag edit wins).
 *
 * Inputs per trade: ticker, session, date, exit_date, horizon, qty, entry, the fills (trade_executions.executed_at; the
 * first entry / last exit by kind) and, without fills, the broker's openedAt / closedAt (ET wall clock) or a timed `date`;
 * plus the full-day market holidays (holiday_calendar «Market closed…», for Overnight vs Swing) and the desk Print
 * clusters (below).
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
 *
 * Print clusters (lib/tradeStrategy rule 5, migration 0243): a pre-market position exited before 09:45:00 is a Print
 * when the same ticker was exited on the same NY day at the same second by >= PRINT_CLUSTER_MIN_TRADERS distinct
 * traders' pre-market positions. That depends on OTHER traders' trades, so a refresh computes the clusters desk-wide
 * in SQL (openPrintCandidates) for the ticker-days of every loaded trade with a pre-market entry (now, or as stored
 * — a trade that just left the pre-market) and also rewrites the strategy of the other candidates of those
 * ticker-days (strategy only: no facet value depends on it). A trade that leaves a ticker-day (ticker / date changed,
 * hard delete) marks that ticker-day's pre-market trades stale (0243 triggers).
 */
import { pool } from "@workspace/db";
import { currentImxWindow, withImxTag } from "./imx";
import {
  PRINT_CLUSTER_MIN_TRADERS, PRINT_CLUSTER_UNTIL_SEC, RTH_OPEN_SEC, deriveTradeStrategy, entrySecOf, isImxTrade, nyParts,
  type ImxWindow, type StrategyInput, type TradeStrategy,
} from "./tradeStrategy";
import {
  deriveFacetValues, isoDayOf, legsOf, notionalOf, shiftIsoDay,
  type FacetDerived, type FacetDeriveInput, type FacetFill, type SizeRow, type StructureLite,
} from "./tradeFacetDerive";
import { SIZE_REL_DAYS } from "./tradeFacetBuckets";

type Queryable = { query: (typeof pool)["query"] };

const reloadSettings = async (): Promise<void> => (await import("./settings/store")).warmSettings();

/** Bump when the rules of lib/tradeStrategy or lib/tradeFacetDerive change: the backfill then re-derives every trade. */
export const STRATEGY_VERSION = 4; // 2: + hold / entry / exit kind / notional / day sequence (0241); 3: + adds / stop / size vs usual, aggressive entry, flip exit (0242); 4: owner strategy set 2026-10-21 (OPG / Print / OPGtoDAY / Swing, desk Print cluster, is_imx — 0243)

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
  is_imx?: boolean | null;
}

/** A fill (trade_executions); price / qty / role / leg_index feed the legs of the facet kinds (lib/tradeFacetDerive). */
export interface StrategyFillRow extends FacetFill { trade_id: number }

const ENTRY_KINDS = new Set(["entry", "add"]);
const EXIT_KINDS = new Set(["exit", "trim", "stop"]);
const ms = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** The derivation input of one trade from its row and fills (pure); `inPrintCluster` = rule 5 (openPrintCandidates). */
export function strategyInputOf(r: StrategyTradeRow, fills: readonly StrategyFillRow[], inPrintCluster = false): StrategyInput {
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
    isOpenPrintCluster: inPrintCluster,
  };
}

export interface StrategyRowUpdate extends FacetDerived { id: number; strategy: TradeStrategy; isImx: boolean; entrySec: number | null; tags: string | null }

/** Derived strategy values of one trade (pure; the facet values come from deriveRows). */
export function deriveRow(
  r: StrategyTradeRow, fills: readonly StrategyFillRow[], win: ImxWindow, inPrintCluster = false, closed: ReadonlySet<string> = NO_DAYS,
): StrategyBase {
  return strategyOf(r, strategyInputOf(r, fills, inPrintCluster), win, closed);
}

type StrategyBase = Pick<StrategyRowUpdate, "id" | "strategy" | "isImx" | "entrySec" | "tags">;
const NO_DAYS: ReadonlySet<string> = new Set();

function strategyOf(r: StrategyTradeRow, input: StrategyInput, win: ImxWindow, closed: ReadonlySet<string>): StrategyBase {
  const isImx = isImxTrade(input, win);
  return { id: r.id, strategy: deriveTradeStrategy(input, win, closed), isImx, entrySec: entrySecOf(input), tags: withImxTag(r.tags, isImx) };
}

const facetInputOf = (r: StrategyTradeRow, input: StrategyInput, entrySec: number | null, fills: readonly StrategyFillRow[]): FacetDeriveInput => ({
  id: r.id, trader: r.trader ?? null, date: r.date, exitDate: r.exit_date, deleted: r.deleted === true, result: r.result ?? null,
  pnl: r.pnl, fees: r.fees, qty: r.qty, entry: r.entry, holdTime: r.hold_time ?? null, openedAt: r.opened_at, closedAt: r.closed_at,
  entryAt: input.entryAt ?? null, exitAt: input.exitAt ?? null, structure: r.structure ?? null, reentryOf: r.reentry_of ?? null, entrySec,
  legs: legsOf(fills), stop: r.stop ?? null,
});

/**
 * Every derived value of a set of rows (pass whole trader-days — day_seq / prev_kind look at the neighbours);
 * `history` = the same traders' trades of the SIZE_REL_DAYS before them (read only, for size_rel);
 * `printCluster` = the ids in a desk Print cluster (openPrintCandidates); `closed` = full-day market holidays.
 */
export function deriveRows(
  rows: readonly StrategyTradeRow[], fillsOf: (id: number) => readonly StrategyFillRow[], win: ImxWindow, history: readonly StrategyTradeRow[] = [],
  printCluster: ReadonlySet<number> = new Set(), closed: ReadonlySet<string> = NO_DAYS,
): StrategyRowUpdate[] {
  const fills = rows.map((r) => fillsOf(Number(r.id)));
  const inputs = rows.map((r, i) => strategyInputOf(r, fills[i]!, printCluster.has(Number(r.id))));
  const base = rows.map((r, i) => strategyOf(r, inputs[i]!, win, closed));
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
    strategy: (r.strategy ?? null) as TradeStrategy, isImx: (r.is_imx ?? null) as boolean, entrySec: r.entry_sec ?? null, tags: r.tags ?? null,
    holdSec: r.hold_sec ?? null, overnight: r.overnight ?? null, entryKind: (r.entry_kind ?? null) as FacetDerived["entryKind"],
    exitKind: (r.exit_kind ?? null) as FacetDerived["exitKind"], notional: numOrNull(r.notional), daySeq: r.day_seq ?? null,
    prevKind: (r.prev_kind ?? null) as FacetDerived["prevKind"], addsKind: (r.adds_kind ?? null) as FacetDerived["addsKind"],
    sizeRel: numOrNull(r.size_rel), hasStop: (r.has_stop ?? null) as boolean,
  };
}

const FIELDS = [
  "strategy", "entrySec", "tags", "holdSec", "overnight", "entryKind", "exitKind", "notional", "daySeq", "prevKind",
  "addsKind", "sizeRel", "hasStop", "isImx",
] as const;
/** Column + record type of each field (jsonb_to_recordset). */
const COLS: Record<(typeof FIELDS)[number], [string, string]> = {
  strategy: ["strategy", "text"], entrySec: ["entry_sec", "int"], tags: ["tags", "text"], holdSec: ["hold_sec", "int"],
  overnight: ["overnight", "bool"], entryKind: ["entry_kind", "text"], exitKind: ["exit_kind", "text"], notional: ["notional", "numeric"],
  daySeq: ["day_seq", "int"], prevKind: ["prev_kind", "text"], addsKind: ["adds_kind", "text"], sizeRel: ["size_rel", "numeric"],
  hasStop: ["has_stop", "bool"], isImx: ["is_imx", "bool"],
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
       t.stop, t.hold_sec, t.overnight, t.entry_kind, t.exit_kind, t.notional, t.day_seq, t.prev_kind, t.adds_kind, t.size_rel, t.has_stop, t.is_imx,
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

// ─── Market holidays ───────────────────────────────────────────────────────────────────────────────────────

const HOLIDAYS_TTL_MS = 10 * 60_000;
let holidaysCache: { at: number; days: ReadonlySet<string> } | null = null;

/**
 * Full-day market holidays (holiday_calendar «Market closed…», migrations 0016 / 0017 — the rule of lib/marketDays):
 * Overnight vs Swing count trading days. Read once per 10 minutes per process (the calendar is seeded once a year).
 */
export async function marketHolidays(q: Queryable = pool, now = Date.now()): Promise<ReadonlySet<string>> {
  if (holidaysCache && now - holidaysCache.at < HOLIDAYS_TTL_MS) return holidaysCache.days;
  const { rows } = await q.query<{ d: string }>(
    `SELECT date::text AS d FROM holiday_calendar WHERE type = 'holiday' AND description ILIKE 'market closed%'`,
  );
  const days = new Set(rows.map((r) => String(r.d).slice(0, 10)));
  holidaysCache = { at: now, days };
  return days;
}

/** The last holidays read (lib/officeStats classifies synchronously); empty before the first read. */
export function knownMarketHolidays(): ReadonlySet<string> {
  return holidaysCache?.days ?? NO_DAYS;
}

// ─── Print clusters (rule 5) ───────────────────────────────────────────────────────────────────────────────

const hhmmss = (sec: number) => [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

/** A ticker-day: upper(ticker) + LEFT(date, 10) (index trades_live_upper_ticker_date_idx). */
interface TickerDay { tk: string; d: string }

/**
 * The ticker-day of a loaded trade whose cluster can matter: its first entry is before 09:30:00 now (a candidate) or
 * was at the last derivation (stored entry_sec — it may just have left a cluster); null otherwise.
 */
function printKeyOf(r: StrategyTradeRow, input: StrategyInput): TickerDay | null {
  const tk = (r.ticker ?? "").toUpperCase();
  const d = (r.date ?? "").slice(0, 10);
  if (!tk || !d) return null;
  const now = nyParts(input.entryAt)?.sec;
  const was = r.entry_sec;
  return (now != null && now < RTH_OPEN_SEC) || (was != null && was < RTH_OPEN_SEC) ? { tk, d } : null;
}

/**
 * Desk-wide Print-cluster candidates of the given ticker-days (live trades with a trader): first entry before 09:30:00
 * and last exit in [09:30:00, 09:45:00) of the same NY day — the same entry / exit as strategyInputOf (first entry /
 * add fill, else the broker's openedAt, else a timed `date`; last exit / trim / stop fill, else closedAt), read in New
 * York time to the second. `in_cluster` = >= PRINT_CLUSTER_MIN_TRADERS distinct traders exited that ticker at that second.
 */
const PRINT_CANDIDATES_SQL = `
  WITH k AS (SELECT DISTINCT tk, d FROM unnest($1::text[], $2::text[]) AS k(tk, d)),
  c AS (
    SELECT t.id, btrim(t.trader) AS tr, k.tk,
           date_trunc('second', COALESCE(f.en AT TIME ZONE 'America/New_York',
             CASE WHEN t.context_snapshot ->> 'openedAt' IS NOT NULL THEN trades_ny_wall(t.context_snapshot ->> 'openedAt')
                  WHEN length(t.date) > 10 THEN trades_ny_wall(t.date) END)) AS en,
           date_trunc('second', COALESCE(f.ex AT TIME ZONE 'America/New_York', trades_ny_wall(t.context_snapshot ->> 'closedAt'))) AS ex
      FROM k
      JOIN trades t ON upper(t.ticker) = k.tk AND LEFT(t.date, 10) = k.d AND t.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT MIN(e.executed_at) FILTER (WHERE e.kind IN ('entry', 'add')) AS en,
               MAX(e.executed_at) FILTER (WHERE e.kind IN ('exit', 'trim', 'stop')) AS ex
          FROM trade_executions e WHERE e.trade_id = t.id AND e.executed_at IS NOT NULL
      ) f ON true
     WHERE NULLIF(btrim(t.trader), '') IS NOT NULL
  ),
  p AS (
    SELECT id, tr, tk, ex FROM c
     WHERE en IS NOT NULL AND ex IS NOT NULL AND en::date = ex::date
       AND en::time < $3::time AND ex::time >= $3::time AND ex::time < $4::time
  ),
  g AS (SELECT tk, ex FROM p GROUP BY tk, ex HAVING count(DISTINCT tr) >= $5)
  SELECT p.id, (g.tk IS NOT NULL) AS in_cluster FROM p LEFT JOIN g ON g.tk = p.tk AND g.ex = p.ex`;

/** Candidates of the given ticker-days: id -> in a cluster. */
async function openPrintCandidates(keys: readonly TickerDay[], q: Queryable = pool): Promise<Map<number, boolean>> {
  const out = new Map<number, boolean>();
  if (!keys.length) return out;
  const { rows } = await q.query<{ id: number; in_cluster: boolean }>(PRINT_CANDIDATES_SQL, [
    keys.map((k) => k.tk), keys.map((k) => k.d), hhmmss(RTH_OPEN_SEC), hhmmss(PRINT_CLUSTER_UNTIL_SEC), PRINT_CLUSTER_MIN_TRADERS,
  ]);
  for (const r of rows) out.set(Number(r.id), r.in_cluster === true);
  return out;
}

async function fillsByTrade(ids: readonly number[], q: Queryable): Promise<Map<number, StrategyFillRow[]>> {
  const { rows } = await q.query<StrategyFillRow>(
    `SELECT id, trade_id, kind, role, leg_index, price, qty, executed_at, sort_order FROM trade_executions WHERE trade_id = ANY($1::int[])`,
    [ids],
  );
  const byTrade = new Map<number, StrategyFillRow[]>();
  for (const f of rows) {
    const list = byTrade.get(Number(f.trade_id));
    if (list) list.push(f); else byTrade.set(Number(f.trade_id), [f]);
  }
  return byTrade;
}

/**
 * The other candidates of the refreshed ticker-days (not loaded by this refresh): their strategy is re-derived with
 * the new cluster and rewritten when it changed, while it still holds what was read. Strategy only — is_imx, the IMX
 * tag and the facet values do not depend on the cluster.
 */
async function rewritePeerStrategies(peers: ReadonlyMap<number, boolean>, q: Queryable, win: ImxWindow, closed: ReadonlySet<string>): Promise<number> {
  if (!peers.size) return 0;
  const ids = [...peers.keys()];
  const rows = (await q.query<StrategyTradeRow>(`SELECT ${ROW_COLS} FROM trades t WHERE t.id = ANY($1::int[])`, [ids])).rows;
  const fills = await fillsByTrade(ids, q);
  const changed = rows
    .map((r) => {
      const id = Number(r.id);
      return { id, old: r.strategy ?? null, strategy: deriveTradeStrategy(strategyInputOf(r, fills.get(id) ?? [], peers.get(id) === true), win, closed) };
    })
    .filter((x) => x.strategy !== x.old);
  if (!changed.length) return 0;
  await q.query(
    `UPDATE trades t SET strategy = u.strategy
       FROM jsonb_to_recordset($1::jsonb) AS u(id int, strategy text, o_strategy text)
      WHERE t.id = u.id AND t.strategy IS NOT DISTINCT FROM u.o_strategy`,
    [JSON.stringify(changed.map((x) => ({ id: x.id, strategy: x.strategy, o_strategy: x.old })))],
  );
  return changed.length;
}

/** Derive + write the given trades, every other trade of their trader-days and the following SIZE_REL_DAYS days (see the header). */
export async function refreshTradeStrategies(
  ids: readonly number[], q: Queryable = pool, win: ImxWindow = currentImxWindow(), holidays?: ReadonlySet<string>,
): Promise<StrategyRefreshResult> {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length) return { trades: 0, changed: 0 };
  const closed = holidays ?? (await marketHolidays(q));
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
  const byTrade = await fillsByTrade(all, q);
  // Print clusters of the loaded pre-market ticker-days, desk-wide (see the header).
  const keys = new Map<string, TickerDay>();
  for (const r of tradesRes.rows) {
    const k = printKeyOf(r, strategyInputOf(r, byTrade.get(Number(r.id)) ?? []));
    if (k) keys.set(`${k.tk}|${k.d}`, k);
  }
  const candidates = await openPrintCandidates([...keys.values()], q);
  const cluster = new Set([...candidates].filter(([, on]) => on).map(([id]) => id));
  const derived = deriveRows(tradesRes.rows, (id) => byTrade.get(id) ?? [], win, historyRes.rows, cluster, closed);
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
  // The other candidates of these ticker-days (other traders' trades) follow the new cluster.
  const loaded = new Set(all);
  const peers = new Map([...candidates].filter(([id]) => !loaded.has(id)));
  const peersChanged = await rewritePeerStrategies(peers, q, win, closed);
  return { trades: ups.length, changed: changed.length + peersChanged };
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
  const closed = ids.length ? await marketHolidays(q) : NO_DAYS;
  for (let i = 0; i < ids.length; i += chunk) {
    const r = await refreshTradeStrategies(ids.slice(i, i + chunk), q, win, closed);
    total.trades += r.trades;
    total.changed += r.changed;
  }
  return total;
}
