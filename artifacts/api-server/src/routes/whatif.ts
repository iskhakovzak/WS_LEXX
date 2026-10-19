/**
 * «Что-если» simulator + commission optimizer (engine: lib/whatIf.ts — pure, no I/O).
 *
 *   GET  /whatif/base?trader=&from=&to=[&enc=2]  input trades + baseline metrics/equity + presets (enc=2: compact
 *                                                trade table, see compactTrades)
 *   POST /whatif/run   {trader, from, to, rules[]} scenario vs baseline (read-only computation, nothing stored)
 *   GET  /whatif/suggestions?trader=&from=&to=   best single rules by net improvement beyond bootstrap noise
 *   GET  /whatif/fees?trader=&from=&to=          fee breakdown by price/size/hold/hour/ticker, break-even, advice
 *   GET  /whatif/scenarios?trader=               saved rule sets (table whatif_scenarios, ensured lazily)
 *   POST /whatif/scenarios {trader?, name, rules[]}
 *   DELETE /whatif/scenarios/:id                 soft delete (archived_at)
 *
 * Scope: lib/auth scopeTrader — a trader always sees their own trades, staff may pick any trader, guests get nothing.
 * Trading day = the NY date stored in trades.date; entry time / hold come from trade_executions, else the
 * PropReports snapshot (openedAt/closedAt in ET), else the hold_time text.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader, isGuest, isStaffRole } from "../lib/auth";
import { TtlCache } from "../lib/hotCache";
import { num, normResult, signedR } from "../lib/tradeMath";
import { nyMinutes } from "../lib/tradingDate";
import { execSpanJoin } from "../lib/execSpan";
import { logger } from "../lib/logger";
import {
  type SimTrade, type Rule, type Side, type Horizon,
  computeMetrics, dailyResults, equityByDay, runScenario, findSuggestions, feeReport, describeRule, presets, RULE_TYPES, GRADES,
} from "../lib/whatIf";
import { AppError, badRequest, unauthorized } from "../lib/http";
import { langOf, type Lang } from "../i18n";
import { acceptsGzip } from "../lib/jsonCompression";

const router: IRouter = Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/* ─── Validation ─────────────────────────────────────────────────────────── */

const rangeSchema = z.object({
  trader: z.string().trim().max(120).optional(),
  from: z.string().regex(YMD_RE).optional(),
  to: z.string().regex(YMD_RE).optional(),
});

const ruleSchema: z.ZodType<Rule> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dailyLossLimit"), usd: z.coerce.number().positive().max(1e7) }),
  z.object({ type: z.literal("maxTradesPerDay"), n: z.coerce.number().int().min(1).max(1000) }),
  z.object({ type: z.literal("stopAfterLosses"), n: z.coerce.number().int().min(1).max(100) }),
  z.object({ type: z.literal("timeWindow"), from: z.string().regex(HM_RE).nullish(), to: z.string().regex(HM_RE).nullish() }),
  z.object({ type: z.literal("priceRange"), min: z.coerce.number().nonnegative().nullish(), max: z.coerce.number().positive().nullish() }),
  z.object({ type: z.literal("minHold"), seconds: z.coerce.number().positive().max(86400 * 30) }),
  z.object({ type: z.literal("excludeTickers"), tickers: z.array(z.string().trim().min(1).max(16)).max(100) }),
  z.object({ type: z.literal("excludeSide"), side: z.enum(["long", "short"]) }),
  z.object({
    type: z.literal("commissionPlan"),
    perShare: z.coerce.number().nonnegative().max(10), minPerOrder: z.coerce.number().nonnegative().max(1000),
    ecnPerShare: z.coerce.number().nonnegative().max(10), keepRegulatory: z.coerce.boolean().optional(),
  }),
  z.object({ type: z.literal("capLoss"), usd: z.coerce.number().positive().max(1e7) }),
  z.object({ type: z.literal("sizeRange"), min: z.coerce.number().nonnegative().max(1e7).nullish(), max: z.coerce.number().positive().max(1e7).nullish() }),
  z.object({ type: z.literal("afterLoss"), minutes: z.coerce.number().positive().max(24 * 60) }),
  z.object({ type: z.literal("excludeSetups"), setups: z.array(z.string().trim().min(1).max(80)).max(50) }),
  z.object({ type: z.literal("minGrade"), grade: z.enum(GRADES) }),
]);

const runSchema = rangeSchema.extend({
  rules: z.array(ruleSchema).max(20).default([]),
  iters: z.coerce.number().int().min(100).max(5000).optional(),
});

const scenarioBodySchema = z.object({
  trader: z.string().trim().max(120).optional(),
  name: z.string().trim().min(1).max(120),
  rules: z.array(ruleSchema).min(1).max(20),
});

function normQuery(q: Request["query"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim() !== "") out[k] = s;
  }
  return out;
}

/* ─── Loading trades ─────────────────────────────────────────────────────── */

type Row = {
  id: number; ticker: string; date: string; exit_date?: string | null; side: string | null; qty: unknown; entry: unknown; exit: unknown; stop: unknown;
  result: string; pnl: unknown; fees: unknown; r_multiple: unknown; risk_usd: unknown; hold_time: string | null; setup: string | null; confidence_grade: string | null;
  tags: string | null; horizon: string | null; context_snapshot: Record<string, unknown> | null;
  first_entry: Date | string | null; last_exit: Date | string | null;
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

export function rowToSim(r: Row, seq: number): SimTrade {
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
    tags: String(r.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    horizon,
    result: res === "win" || res === "loss" || res === "be" ? res : null,
    feeBreakdown: breakdown,
    fills,
    seq,
    grade: r.confidence_grade?.trim() || null,
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

export async function loadSimTrades(scope: string | null, from?: string, to?: string): Promise<SimTrade[]> {
  const key = `${scope ?? "*"}|${from ?? ""}|${to ?? ""}`;
  const now = Date.now();
  const hit = simCache.get(key);
  if (hit && now - hit.at < SIM_CACHE_TTL_MS) return (await hit.promise).slice();
  const promise = querySimTrades(scope, from, to);
  simCache.set(key, { at: now, promise });
  promise.catch(() => simCache.delete(key));
  if (simCache.size > SIM_CACHE_MAX) {
    for (const [k, v] of simCache) if (now - v.at >= SIM_CACHE_TTL_MS || simCache.size > SIM_CACHE_MAX) simCache.delete(k);
  }
  return (await promise).slice();
}

async function querySimTrades(scope: string | null, from?: string, to?: string): Promise<SimTrade[]> {
  const params: unknown[] = [];
  const cond: string[] = [`t.deleted_at IS NULL`, `t.pnl IS NOT NULL`, `LOWER(TRIM(t.result)) <> 'open'`];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (scope != null) cond.push(`t.trader = ${p(scope)}`);
  if (from) cond.push(`substring(t.date from 1 for 10) >= ${p(from)}`);
  if (to) cond.push(`substring(t.date from 1 for 10) <= ${p(to)}`);
  // One trader → per-trade index probe; desk-wide → one hash aggregate (lib/execSpan).
  const sql = `
    SELECT t.id, t.ticker, t.date, t.exit_date, t.side, t.qty, t.entry, t.exit, t.stop, t.result, t.pnl, t.fees, t.r_multiple, t.risk_usd,
           t.hold_time, t.setup, t.confidence_grade, t.tags, t.horizon, t.context_snapshot, e.first_entry, e.last_exit
    FROM trades t ${execSpanJoin(scope != null ? "lateral" : "global")}
    WHERE ${cond.join(" AND ")}
    ORDER BY substring(t.date from 1 for 10), e.first_entry NULLS LAST, t.id`;
  const { rows } = await pool.query<Row>(sql, params);
  return rows.map((r, i) => rowToSim(r, i));
}

async function resolveScope(req: Request, requested?: string): Promise<string | null | undefined> {
  return scopeTrader(req, requested);
}

function periodMeta(trades: SimTrade[], from?: string, to?: string) {
  return {
    from: from ?? (trades[0]?.day ?? null),
    to: to ?? (trades[trades.length - 1]?.day ?? null),
    withEntryTime: trades.filter((t) => t.entryMin != null).length,
    withHold: trades.filter((t) => t.holdSec != null).length,
    withR: trades.filter((t) => t.r != null).length,
    withQty: trades.filter((t) => t.qty != null).length,
  };
}

/**
 * What the page needs per trade for its live previews (rule builder, questions, fees) — the engine fields it never
 * reads (exit, r, stop, tags, horizon, result) stay on the server. Team-wide «всё время» was 19 MB of JSON.
 */
function previewOf(t: SimTrade) {
  return {
    id: t.id, day: t.day, entryMin: t.entryMin == null ? null : Math.round(t.entryMin * 100) / 100, ticker: t.ticker, side: t.side,
    qty: t.qty, entry: t.entry, gross: t.gross, fees: t.fees, holdSec: t.holdSec, seq: t.seq,
    fills: t.fills ?? null, feeBreakdown: t.feeBreakdown ?? null, setup: t.setup, grade: t.grade ?? null,
  };
}

/* ─── Compact trade table (?enc=2) ───────────────────────────────────────────
 * The plain preview list is still 14.7 MB for the whole desk (45k trades), a third of it the per-trade fee breakdown
 * and repeated key names (DEV-10). enc=2 sends one tuple per trade in WHATIF_COLS order, the repeated strings (day,
 * ticker, side, setup, grade) as indexes into `dicts`, and only the regulatory-fee sum (`reg`) instead of the
 * breakdown — the client's tariff preview reads nothing else (edge-tracker components/what-if/api.ts decodeTrades).
 * Plain `trades` stays the default so an older bundle keeps working against a newer API. */
export const WHATIF_COLS = ["id", "day", "entryMin", "ticker", "side", "qty", "entry", "gross", "fees", "holdSec", "seq", "fills", "reg", "setup", "grade"] as const;
export const WHATIF_DICT_COLS = ["day", "ticker", "side", "setup", "grade"] as const;
const REG_KEYS = ["sec", "taf", "cat", "orf", "nfa"];
type Cell = string | number | null;

/** Σ |regulatory fee| of the broker breakdown; null without a breakdown (same keys as lib/whatIf recomputeFees). */
export function regulatoryFees(b: Record<string, number> | null | undefined): number | null {
  if (!b) return null;
  let s = 0;
  for (const k of REG_KEYS) s += Math.abs(Number(b[k]) || 0);
  return Math.round(s * 1e4) / 1e4;
}

export function compactTrades(trades: SimTrade[]): { cols: typeof WHATIF_COLS; rows: Cell[][]; dicts: Record<(typeof WHATIF_DICT_COLS)[number], string[]> } {
  const dicts = Object.fromEntries(WHATIF_DICT_COLS.map((k) => [k, [] as string[]])) as Record<(typeof WHATIF_DICT_COLS)[number], string[]>;
  const idx = Object.fromEntries(WHATIF_DICT_COLS.map((k) => [k, new Map<string, number>()])) as Record<(typeof WHATIF_DICT_COLS)[number], Map<string, number>>;
  const code = (k: (typeof WHATIF_DICT_COLS)[number], v: string | null | undefined): number | null => {
    if (v == null) return null;
    let n = idx[k].get(v);
    if (n === undefined) { n = dicts[k].length; dicts[k].push(v); idx[k].set(v, n); }
    return n;
  };
  const rows = trades.map((t): Cell[] => [
    t.id, code("day", t.day), t.entryMin == null ? null : Math.round(t.entryMin * 100) / 100, code("ticker", t.ticker), code("side", t.side),
    t.qty, t.entry, t.gross, t.fees, t.holdSec, t.seq, t.fills ?? null, regulatoryFees(t.feeBreakdown), code("setup", t.setup), code("grade", t.grade ?? null),
  ]);
  return { cols: WHATIF_COLS, rows, dicts };
}

/*
 * Suggestions (~40 scenario runs with a bootstrap each: 1.8–2.7 s desk-wide) and the fee report are cached per viewer
 * kind + scope + period + language for RESULT_TTL_MS (DEV-10). Staff and members never share an entry, even for the
 * same trader. A PropReports sync shows up after at most that long.
 */
const RESULT_TTL_MS = 120_000;
const suggestionsCache = new TtlCache<string, unknown>(RESULT_TTL_MS);
const feesCache = new TtlCache<string, unknown>(RESULT_TTL_MS);

export function resultKey(req: Request, scope: string | null, from: string | undefined, to: string | undefined): string {
  return `${isStaffRole(req.authUser?.role) ? "staff" : "member"}|${scope ?? "*"}|${from ?? ""}|${to ?? ""}|${langOf(req)}`;
}

const gzipAsync = promisify(gzip);

/**
 * Large JSON gzipped when the client accepts it; small bodies as is. (The check used to be a regex with two literal
 * backspace bytes instead of word boundaries, so it never matched and /whatif/base always went out uncompressed.)
 */
export async function sendJsonGz(req: Request, res: Response, body: unknown): Promise<void> {
  const json = JSON.stringify(body);
  if (json.length < 64 * 1024 || !acceptsGzip(req)) {
    res.type("application/json").send(json);
    return;
  }
  const buf = await gzipAsync(json, { level: 6 });
  res.setHeader("Content-Encoding", "gzip");
  res.setHeader("Vary", "Accept-Encoding");
  res.type("application/json").send(buf);
}

/* ─── Routes ─────────────────────────────────────────────────────────────── */

router.get("/whatif/base", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const trades = await loadSimTrades(scope, q.from, q.to);
  const daily = dailyResults(trades);
  const compact = req.query.enc === "2";
  await sendJsonGz(req, res, {
    scope, period: periodMeta(trades, q.from, q.to),
    ...(compact ? { enc: 2, tradeTable: compactTrades(trades) } : { trades: trades.map(previewOf) }),
    baseline: computeMetrics(trades),
    equity: equityByDay(daily),
    daily,
    presets: presets(langOf(req)),
    ruleTypes: RULE_TYPES,
    generatedAt: new Date().toISOString(),
  });
}));

router.post("/whatif/run", asyncHandler(async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const trades = await loadSimTrades(scope, q.from, q.to);
  const result = runScenario(trades, q.rules, { iters: q.iters ?? 1000, lang: langOf(req) });
  res.json({
    scope, period: periodMeta(trades, q.from, q.to),
    ...result,
    ruleLabels: result.rules.map((r) => describeRule(r, langOf(req))),
    generatedAt: new Date().toISOString(),
  });
}));

router.get("/whatif/suggestions", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const key = resultKey(req, scope, q.from, q.to);
  const hit = suggestionsCache.get(key);
  if (hit) { res.json(hit); return; }
  const trades = await loadSimTrades(scope, q.from, q.to);
  const baseline = computeMetrics(trades);
  const suggestions = findSuggestions(trades, { lang: langOf(req) });
  const body = {
    scope, period: periodMeta(trades, q.from, q.to),
    baselineNet: baseline.net, trades: baseline.trades, days: baseline.days,
    smallSample: baseline.trades < 30 || baseline.days < 30,
    suggestions,
    generatedAt: new Date().toISOString(),
  };
  suggestionsCache.set(key, body);
  res.json(body);
}));

router.get("/whatif/fees", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const key = resultKey(req, scope, q.from, q.to);
  const hit = feesCache.get(key);
  if (hit) { res.json(hit); return; }
  const trades = await loadSimTrades(scope, q.from, q.to);
  const body = { scope, period: periodMeta(trades, q.from, q.to), ...feeReport(trades, langOf(req)), generatedAt: new Date().toISOString() };
  feesCache.set(key, body);
  res.json(body);
}));

/* ─── Saved scenarios ────────────────────────────────────────────────────── */

let ensured: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `CREATE TABLE IF NOT EXISTS whatif_scenarios (
           id SERIAL PRIMARY KEY,
           trader TEXT NOT NULL,
           name TEXT NOT NULL,
           rules JSONB NOT NULL DEFAULT '[]'::jsonb,
           created_by TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           archived_at TIMESTAMPTZ
         );
         CREATE INDEX IF NOT EXISTS whatif_scenarios_trader_idx ON whatif_scenarios(trader);`,
      )
      .then(() => undefined)
      .catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

type ScenarioRow = { id: number; trader: string; name: string; rules: Rule[]; created_by: string | null; created_at: string; updated_at: string };

function scenarioJson(r: ScenarioRow, lang: Lang = "ru") {
  return { id: r.id, trader: r.trader, name: r.name, rules: r.rules, labels: r.rules.map((x) => describeRule(x, lang)), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at };
}

router.get("/whatif/scenarios", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest();
  const scope = await resolveScope(req, parsed.data.trader);
  if (scope === undefined) throw unauthorized();
  if (isGuest(req)) { res.json([]); return; }
  try { await ensureTables(); } catch (err) { logger.warn({ err }, "whatif: ensure tables failed"); res.json([]); return; }
  const params: unknown[] = [];
  let where = `archived_at IS NULL`;
  if (scope != null) { params.push(scope); where += ` AND trader = $1`; }
  const { rows } = await pool.query<ScenarioRow>(`SELECT id, trader, name, rules, created_by, created_at, updated_at FROM whatif_scenarios WHERE ${where} ORDER BY updated_at DESC LIMIT 100`, params);
  res.json(rows.map((r) => scenarioJson(r, langOf(req))));
}));

router.post("/whatif/scenarios", asyncHandler(async (req, res) => {
  const parsed = scenarioBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  if (!req.authUser || isGuest(req)) throw new AppError("MEMBERS_ONLY");
  const scope = await resolveScope(req, parsed.data.trader);
  if (scope === undefined) throw unauthorized();
  // Staff without an explicit trader save under their own name.
  const trader = scope ?? req.authUser.name;
  await ensureTables();
  const { rows } = await pool.query<ScenarioRow>(
    `INSERT INTO whatif_scenarios (trader, name, rules, created_by) VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, trader, name, rules, created_by, created_at, updated_at`,
    [trader, parsed.data.name, JSON.stringify(parsed.data.rules), req.authUser.name],
  );
  res.status(201).json(scenarioJson(rows[0], langOf(req)));
}));

router.delete("/whatif/scenarios/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID");
  if (!req.authUser || isGuest(req)) throw new AppError("MEMBERS_ONLY");
  await ensureTables();
  const { rows } = await pool.query<{ trader: string }>(`SELECT trader FROM whatif_scenarios WHERE id = $1 AND archived_at IS NULL`, [id]);
  if (!rows[0]) throw new AppError("SCENARIO_NOT_FOUND");
  const scope = await resolveScope(req, rows[0].trader);
  if (scope === undefined) throw unauthorized();
  if (scope != null && scope !== rows[0].trader) throw new AppError("FORBIDDEN");
  await pool.query(`UPDATE whatif_scenarios SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
  res.json({ ok: true, id });
}));

export const whatifRouter = router;
export default router;
