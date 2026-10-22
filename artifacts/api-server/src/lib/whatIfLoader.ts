/**
 * Trades of the «Что-если» engine (lib/whatIf*) for one trader or the whole desk: the SQL loader with its short
 * in-memory cache, and the row → SimTrade mapping. Moved out of routes/whatif.ts (which re-exports it) so the
 * background job whatif.honesty (lib/whatIfHonestyJob) can load trades without importing a route module.
 * Trading day = the NY date stored in trades.date; entry time / hold come from trade_executions, else the
 * PropReports snapshot (openedAt/closedAt in ET), else the hold_time text.
 */
import { pool } from "@workspace/db";
import { num, normResult, signedR } from "./tradeMath";
import { nyMinutes } from "./tradingDate";
import { execSpanJoin } from "./execSpan";
import type { Horizon, Side, SimTrade } from "./whatIfTypes";
import { currentImxWindow, imxSql } from "./imx";
import { inImxWindow, type ImxWindow } from "./tradeStrategy";
import { isDeskTag } from "./deskTags";
import { codesOf } from "./tradingErrors";
import { facetSqlTail, type FacetFilters } from "./tradeFacetsSql";
import { facetCacheKey } from "./tradeFacetsFilter";

export type SimRow = {
  id: number; ticker: string; date: string; exit_date?: string | null; side: string | null; qty: unknown; entry: unknown; exit: unknown; stop: unknown;
  result: string; pnl: unknown; fees: unknown; r_multiple: unknown; risk_usd: unknown; hold_time: string | null; setup: string | null; confidence_grade: string | null;
  tags: string | null; horizon: string | null; context_snapshot: Record<string, unknown> | null;
  first_entry: Date | string | null; last_exit: Date | string | null;
  trader?: string | null; is_imx?: boolean | null; reentry_of?: number | null; size_rel?: unknown; has_stop?: boolean | null;
};

/** "5m", "2h 29m", "17s", "1:30", "45 мин", "3 д" → seconds; null when unparsable. */
export function parseHoldSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const hm = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60 + Number(hm[3] ?? 0);
  let total = 0, matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(d|д|дн|h|ч|m|min|мин|м|s|sec|с|сек)\b/g; // i18n-ignore (parses RU / EN duration input)
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const v = Number(m[1]);
    const u = m[2];
    if (u.startsWith("d") || u.startsWith("д")) total += v * 86400; // i18n-ignore (input parsing)
    else if (u.startsWith("h") || u.startsWith("ч")) total += v * 3600; // i18n-ignore (input parsing)
    else if (u.startsWith("s") || u === "с" || u === "сек") total += v; // i18n-ignore (input parsing)
    else total += v * 60;
  }
  if (matched) return total;
  const bare = /^(\d+(?:\.\d+)?)$/.exec(s);
  return bare ? Number(bare[1]) * 60 : null;
}

/** "2026-10-15T15:59:16" (ET, no zone) → minutes since midnight; null when malformed. */
function etMinutesOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60;
}

function secondsBetweenEt(a: unknown, b: unknown): number | null {
  if (typeof a !== "string" || typeof b !== "string") return null;
  const ta = Date.parse(a.length <= 19 ? `${a}Z` : a), tb = Date.parse(b.length <= 19 ? `${b}Z` : b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb < ta) return null;
  return (tb - ta) / 1000;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `imxWin` = the desk IMX window. For the what-if a trade is IMX only when it was ENTERED inside the window (the stored
 * mark is set by any fill there, an exit too): «не торгуй IMX» must be a choice made before the entry, not one that
 * takes the credit for a morning trade held into the close auction.
 */
export function rowToSim(r: SimRow, seq: number, imxWin: ImxWindow = currentImxWindow()): SimTrade {
  const snap = r.context_snapshot ?? {};
  const first = toDate(r.first_entry), last = toDate(r.last_exit);
  let entryMin: number | null = first ? nyMinutes(first) + first.getUTCSeconds() / 60 : null;
  if (entryMin == null) entryMin = etMinutesOf(snap.openedAt);
  if (entryMin == null) {
    const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(r.date);
    if (m) entryMin = Number(m[1]) * 60 + Number(m[2]);
  }
  let holdSec: number | null = first && last && last.getTime() >= first.getTime() ? (last.getTime() - first.getTime()) / 1000 : null;
  if (holdSec == null) holdSec = secondsBetweenEt(snap.openedAt, snap.closedAt);
  if (holdSec == null) holdSec = parseHoldSeconds(r.hold_time);
  const sideRaw = String(r.side ?? "").trim().toLowerCase();
  const side: Side | null = sideRaw.startsWith("s") ? "short" : sideRaw.startsWith("l") || sideRaw.startsWith("b") ? "long" : null;
  const res = normResult(r.result);
  const h = String(r.horizon ?? "").trim();
  const horizon: Horizon = h === "overnight" || h === "swing" ? h : "intraday";
  const breakdown = snap.feesByType && typeof snap.feesByType === "object" ? (snap.feesByType as Record<string, number>) : null;
  const fills = num(snap.fillCount);
  const tags = String(r.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sizeRel = num(r.size_rel);
  return {
    id: r.id,
    day: r.date.slice(0, 10),
    ...(r.exit_date && r.exit_date.slice(0, 10) !== r.date.slice(0, 10) ? { closeDay: r.exit_date.slice(0, 10) } : {}),
    entryMin,
    ticker: String(r.ticker ?? "").toUpperCase(),
    side,
    qty: num(r.qty) != null ? Math.abs(num(r.qty)!) : null,
    entry: num(r.entry), exit: num(r.exit),
    gross: num(r.pnl),
    fees: Math.abs(num(r.fees) ?? 0),
    holdSec,
    r: signedR({ result: r.result, side: r.side, entry: r.entry, exit: r.exit, stop: r.stop, r_multiple: r.r_multiple, pnl: r.pnl, risk_usd: r.risk_usd }),
    stop: num(r.stop),
    setup: r.setup?.trim() || null,
    tags,
    horizon,
    result: res === "win" || res === "loss" || res === "be" ? res : null,
    feeBreakdown: breakdown,
    fills,
    seq,
    grade: r.confidence_grade?.trim() || null,
    trader: r.trader ?? null,
    imx: r.is_imx === true && entryMin != null && inImxWindow(Math.floor(entryMin * 60 + 1e-6), imxWin),
    reentry: r.reentry_of != null,
    sizeRel: sizeRel != null && sizeRel > 0 ? sizeRel : null,
    hasStop: r.has_stop ?? null,
    // Mistakes by code (any spelling: «Реванш» → revenge); personal tags = the rest without the desk tags.
    mistakes: [...codesOf(tags)],
    ptags: tags.filter((t) => !isDeskTag(t)),
  };
}

/** Closed trades with a money result for the scope/period, in simulation order. */
/*
 * The page fires /base, /suggestions, /fees (and /run) at once for the same scope: one SQL load serves them all.
 * Short TTL — trades only change on a PropReports sync, and a 20 s old snapshot is fine for a what-if.
 * The engine never mutates trade objects (it sorts copies), so callers share them; each gets its own array.
 */
const SIM_CACHE_TTL_MS = 60_000;
const SIM_CACHE_MAX = 24;
const simCache = new Map<string, { at: number; promise: Promise<SimTrade[]> }>();

const simKey = (scope: string | null, from?: string, to?: string, facets?: FacetFilters) =>
  `${scope ?? "*"}|${from ?? ""}|${to ?? ""}|${facetCacheKey(facets)}`;

/** `facets` = the page's «Разрезы» (lib/tradeFacetsSql): excluded trades never reach the engine. */
export async function loadSimTrades(scope: string | null, from?: string, to?: string, facets?: FacetFilters): Promise<SimTrade[]> {
  const key = simKey(scope, from, to, facets);
  const now = Date.now();
  const hit = simCache.get(key);
  if (hit && now - hit.at < SIM_CACHE_TTL_MS) return (await hit.promise).slice();
  const promise = querySimTrades(scope, from, to, facets);
  simCache.set(key, { at: now, promise });
  promise.catch(() => simCache.delete(key));
  if (simCache.size > SIM_CACHE_MAX) {
    for (const [k, v] of simCache) if (now - v.at >= SIM_CACHE_TTL_MS || simCache.size > SIM_CACHE_MAX) simCache.delete(k);
  }
  return (await promise).slice();
}

/**
 * The trades as they are now (uncached), and the loader's cache entry for the scope/period replaced by them. The
 * suggestions route calls it when the cached snapshot's signature has no honest-verdict row: a sync may have landed
 * since, and the job (which loads uncached) may already have moved the row to the new signature.
 */
export async function freshSimTrades(scope: string | null, from?: string, to?: string): Promise<SimTrade[]> {
  const key = simKey(scope, from, to);
  const promise = querySimTrades(scope, from, to);
  simCache.set(key, { at: Date.now(), promise });
  promise.catch(() => simCache.delete(key));
  return (await promise).slice();
}

/** SQL of the loader (exported for tests): IMX by the stored mark with the strategy MOC fallback (lib/imx imxSql). */
export function simTradesQuery(scope: string | null, from?: string, to?: string, facets?: FacetFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const cond: string[] = [`t.deleted_at IS NULL`, `t.pnl IS NOT NULL`, `LOWER(TRIM(t.result)) <> 'open'`];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (scope != null) cond.push(`t.trader = ${p(scope)}`);
  if (from) cond.push(`substring(t.date from 1 for 10) >= ${p(from)}`);
  if (to) cond.push(`substring(t.date from 1 for 10) <= ${p(to)}`);
  const tail = facetSqlTail(facets, params);
  // One trader → per-trade index probe; desk-wide → one hash aggregate (lib/execSpan).
  const sql = `
    SELECT t.id, t.ticker, t.date, t.exit_date, t.side, t.qty, t.entry, t.exit, t.stop, t.result, t.pnl, t.fees, t.r_multiple, t.risk_usd,
           t.hold_time, t.setup, t.confidence_grade, t.tags, t.horizon, t.context_snapshot, e.first_entry, e.last_exit,
           t.trader, ${imxSql("t")} AS is_imx, t.reentry_of, t.size_rel, t.has_stop
    FROM trades t ${execSpanJoin(scope != null ? "lateral" : "global")}
    WHERE ${cond.join(" AND ")}${tail}
    ORDER BY substring(t.date from 1 for 10), e.first_entry NULLS LAST, t.id`;
  return { sql, params };
}

/** Uncached load (the background job: a signature must see the trades as they are now, not a 60 s old copy). */
export async function querySimTrades(scope: string | null, from?: string, to?: string, facets?: FacetFilters): Promise<SimTrade[]> {
  const { sql, params } = simTradesQuery(scope, from, to, facets);
  const { rows } = await pool.query<SimRow>(sql, params);
  const imxWin = currentImxWindow();
  return rows.map((r, i) => rowToSim(r, i, imxWin));
}
