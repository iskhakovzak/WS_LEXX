/**
 * «Что-если» simulator + commission optimizer (engine: lib/whatIf.ts — pure, no I/O).
 *
 *   GET  /whatif/base?trader=&from=&to=[&enc=2]  input trades + baseline metrics/equity + presets (enc=2: compact
 *                                                trade table, see compactTrades)
 *   POST /whatif/run   {trader, from, to, rules[]} scenario vs baseline (read-only computation, nothing stored)
 *   GET  /whatif/suggestions?trader=&from=&to=[&window=rolling]   best single rules: for one trader on a growing
 *                                                period («всё время», «с начала года») the honest verdict (walk-forward
 *                                                + Romano–Wolf, job whatif.honesty, cached per data signature in
 *                                                whatif_honesty_cache) once ready, the fast search marked
 *                                                «предварительно» until then; the whole desk, a rolling window or a
 *                                                closed range (lib/whatIfHonestyBody honestWindow): the fast search
 *   GET  /whatif/fees?trader=&from=&to=          fee breakdown by price/size/hold/hour/ticker, break-even, advice
 *   GET  /whatif/scenarios?trader=               saved rule sets (table whatif_scenarios)
 *   POST /whatif/scenarios {trader?, name, rules[]}
 *   DELETE /whatif/scenarios/:id                 soft delete (archived_at)
 *
 * Scope: lib/auth scopeTrader — a trader always sees their own trades, staff may pick any trader, guests get nothing.
 * Trades come from lib/whatIfLoader (trading day = the NY date stored in trades.date).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader, isGuest, isStaffRole } from "../lib/auth";
import { TtlCache } from "../lib/hotCache";
import {
  type SimTrade, type Rule,
  computeMetrics, dailyResults, equityByDay, runScenario, feeReport, describeRule, presets, RULE_TYPES, GRADES,
} from "../lib/whatIf";
import { MAX_SETUP_LEN, MAX_TAG_LEN } from "../lib/whatIfTypes";
import { findSuggestions, type SuggestionsResult } from "../lib/whatIfSuggest";
import { freshSimTrades, loadSimTrades } from "../lib/whatIfLoader";
import { tradesSignature } from "../lib/whatIfSignature";
import * as honestyStore from "../lib/whatIfHonestyStore";
import { type SuggestionsHead, honestWindow, honestyKey, suggestionsBody } from "../lib/whatIfHonestyBody";
import { WHATIF_HONESTY_JOB, WHATIF_HONESTY_REQUESTED } from "../lib/whatIfHonestyJobDefs";
import { emitJobEvent, listJobs } from "../jobs/registry";
import { config } from "../config";
import { logger } from "../lib/logger";
import { nyDate } from "../lib/tradingDate";
import { isDeskTag } from "../lib/deskTags";
import { ERROR_VOCAB, type ErrorVocabCode } from "../lib/tradingErrors";
import { AppError, badRequest, unauthorized } from "../lib/http";
import { langOf, type Lang } from "../i18n";
import { acceptsGzip } from "../lib/jsonCompression";
import { FACET_QUERY, facetFiltersOf } from "../lib/tradesPageParams";
import { facetCacheKey } from "../lib/tradeFacetsFilter";

const router: IRouter = Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/* ─── Validation ─────────────────────────────────────────────────────────── */

const rangeSchema = z.object({
  trader: z.string().trim().max(120).optional(),
  from: z.string().regex(YMD_RE).optional(),
  to: z.string().regex(YMD_RE).optional(),
  // /whatif/suggestions: the page's 30 / 90-day periods move `from` every day (no honest verdict can resolve there).
  window: z.enum(["rolling"]).optional(),
  ...FACET_QUERY, // the page's «Разрезы» (lib/tradeFacetsSql): excluded trades never reach the engine
});

const ERROR_CODES = ERROR_VOCAB.map((v) => v.code) as [ErrorVocabCode, ...ErrorVocabCode[]];

export const ruleSchema: z.ZodType<Rule> = z.discriminatedUnion("type", [
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
  z.object({ type: z.literal("excludeSetups"), setups: z.array(z.string().trim().min(1).max(MAX_SETUP_LEN)).max(50) }),
  z.object({ type: z.literal("minGrade"), grade: z.enum(GRADES) }),
  z.object({ type: z.literal("excludeImx") }),
  z.object({ type: z.literal("noReentry") }),
  z.object({ type: z.literal("requireStop") }),
  z.object({ type: z.literal("maxSizeRel"), x: z.coerce.number().min(0.5).max(10) }),
  z.object({ type: z.literal("excludeMistakes"), codes: z.array(z.enum(ERROR_CODES)).min(1).max(14).refine((a) => new Set(a).size === a.length) }),
  // Personal tags only: IMX and the mistakes vocabulary have their own rules.
  z.object({ type: z.literal("excludeTags"), tags: z.array(z.string().trim().min(1).max(MAX_TAG_LEN)).min(1).max(20).refine((a) => !a.some(isDeskTag)) }),
  z.object({ type: z.literal("profitGiveback"), peak: z.coerce.number().positive().max(1e7), pct: z.coerce.number().int().min(10).max(90) }),
  z.object({ type: z.literal("dailyProfitTarget"), usd: z.coerce.number().positive().max(1e7) }),
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

/* ─── Loading trades (lib/whatIfLoader; re-exported for existing imports and tests) ─────────────────────── */

export { type SimRow, parseHoldSeconds, rowToSim, loadSimTrades, simTradesQuery } from "../lib/whatIfLoader";

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
    trader: t.trader ?? null, imx: t.imx === true, reentry: t.reentry === true, sizeRel: t.sizeRel ?? null, hasStop: t.hasStop ?? null,
    mistakes: t.mistakes ?? [], ptags: t.ptags ?? [],
  };
}

/* ─── Compact trade table (?enc=2) ───────────────────────────────────────────
 * The plain preview list is still 14.7 MB for the whole desk (45k trades), a third of it the per-trade fee breakdown
 * and repeated key names (DEV-10). enc=2 sends one tuple per trade in WHATIF_COLS order, the repeated strings (day,
 * ticker, side, setup, grade) as indexes into `dicts`, and only the regulatory-fee sum (`reg`) instead of the
 * breakdown — the client's tariff preview reads nothing else (edge-tracker components/what-if/api.ts decodeTrades).
 * Plain `trades` stays the default so an older bundle keeps working against a newer API. */
export const WHATIF_COLS = [
  "id", "day", "entryMin", "ticker", "side", "qty", "entry", "gross", "fees", "holdSec", "seq", "fills", "reg", "setup", "grade",
  "trader", "imx", "reentry", "sizeRel", "hasStop", "ptags", "mistakes",
] as const;
export const WHATIF_DICT_COLS = ["day", "ticker", "side", "setup", "grade", "trader", "ptags", "mistakes"] as const;
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
    // 1/0 flags (hasStop null = unknown); tag lists joined with "," (tags never contain one), null when empty.
    code("trader", t.trader ?? null), t.imx ? 1 : 0, t.reentry ? 1 : 0, t.sizeRel ?? null, t.hasStop == null ? null : t.hasStop ? 1 : 0,
    code("ptags", t.ptags?.length ? t.ptags.join(",") : null), code("mistakes", t.mistakes?.length ? t.mistakes.join(",") : null),
  ]);
  return { cols: WHATIF_COLS, rows, dicts };
}

/*
 * Suggestions (~70 candidates on the fast path + one family-wise bootstrap) and the fee report are cached per viewer
 * kind + scope + period + language for RESULT_TTL_MS (DEV-10). Staff and members never share an entry, even for the
 * same trader. A PropReports sync shows up after at most that long. A trader's suggestions also depend on the data
 * signature: the entry stores it next to the body and a hit must match it — keyed by the signature, every sync would
 * leave entries behind that are never read (and so never expire) again.
 */
const RESULT_TTL_MS = 120_000;
const suggestionsCache = new TtlCache<string, unknown>(RESULT_TTL_MS);
const feesCache = new TtlCache<string, unknown>(RESULT_TTL_MS);

export function resultKey(req: Request, scope: string | null, from: string | undefined, to: string | undefined, facets = ""): string {
  return `${isStaffRole(req.authUser?.role) ? "staff" : "member"}|${scope ?? "*"}|${from ?? ""}|${to ?? ""}|${langOf(req)}${facets ? `|${facets}` : ""}`;
}

/** The cached value of `key` when it was computed for this data signature. */
function cachedFor<T>(key: string, sig: string): T | undefined {
  const hit = suggestionsCache.get(key) as { sig: string; value: T } | undefined;
  return hit && hit.sig === sig ? hit.value : undefined;
}
const cacheFor = (key: string, sig: string, value: unknown) => suggestionsCache.set(key, { sig, value });

/** Tests: entries held by the suggestions cache (bounded by viewer kind × scope × period × language). */
export const suggestionsCacheSize = (): number => suggestionsCache.size;

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

/* ─── Suggestions: the honest verdict (lib/whatIfHonesty, job whatif.honesty) or the fast path ─────────────── */

function suggestionsHead(scope: string | null, trades: SimTrade[], q: { from?: string; to?: string }): SuggestionsHead {
  const baseline = computeMetrics(trades);
  return {
    scope, period: periodMeta(trades, q.from, q.to),
    baselineNet: baseline.net, trades: baseline.trades, days: baseline.days,
    // Too little to call anything robust: every card is a guide («ориентир»).
    smallSample: baseline.days < 30 || baseline.trades < 60,
    generatedAt: new Date().toISOString(),
  };
}

/** The fast search, cached like the old body (the polls while the honest run is queued stay cheap). */
function fastSuggestions(cacheKey: string, sig: string, trades: SimTrade[], lang: Lang): SuggestionsResult {
  const hit = cachedFor<SuggestionsResult>(cacheKey, sig);
  if (hit) return hit;
  const found = findSuggestions(trades, { lang, team: false });
  cacheFor(cacheKey, sig, found);
  return found;
}

let honestyStoreWarned = false;

/** The cache row; ok = false when the store is unreachable (no table before 0244): the fast path only. */
async function honestyRow(k: honestyStore.HonestyKey): Promise<{ row: honestyStore.HonestyRow | null; ok: boolean }> {
  try {
    return { row: await honestyStore.get(pool, k), ok: true };
  } catch (err) {
    if (!honestyStoreWarned) {
      honestyStoreWarned = true;
      logger.warn({ err }, "whatif: honesty cache unavailable, suggestions use the fast path only");
    }
    return { row: null, ok: false };
  }
}

const honestyJobOn = () => config.jobsEnabled && listJobs().some((j) => j.name === WHATIF_HONESTY_JOB);

/**
 * Queue the key (or retry a failed row when allowed); the state the client should see and since when it is pending,
 * null = unavailable. A viewer asking for an existing row marks the key as used (the evening precompute warms only keys
 * viewers asked for).
 */
async function queueHonesty(k: honestyStore.HonestyKey, row: honestyStore.HonestyRow | null): Promise<{ state: honestyStore.HonestyState; since: Date } | null> {
  try {
    if (!row) {
      if (await honestyStore.enqueue(pool, k)) emitJobEvent(WHATIF_HONESTY_REQUESTED, { trader: k.trader });
      return { state: "queued", since: new Date() };
    }
    void honestyStore.touch(pool, row.id).catch(() => undefined);
    if (row.state === "failed" && (await honestyStore.retryFailed(pool, row.id))) {
      emitJobEvent(WHATIF_HONESTY_REQUESTED, { trader: k.trader });
      return { state: "queued", since: new Date() };
    }
    return { state: row.state, since: row.requestedAt };
  } catch (err) {
    logger.warn({ err }, "whatif: could not queue the honest verdict");
    return null;
  }
}

/* ─── Routes ─────────────────────────────────────────────────────────────── */

router.get("/whatif/base", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const trades = await loadSimTrades(scope, q.from, q.to, facetFiltersOf(q));
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

/** A tariff (commissionPlan) what-if is staff-only (roadmap R2.4; the desk does not choose its broker fees — owner 2026-10-22). */
export function feePlanAllowed(role: string | null | undefined, rules: readonly Rule[]): boolean {
  return isStaffRole(role) || !rules.some((r) => r.type === "commissionPlan");
}

router.post("/whatif/run", asyncHandler(async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  if (!feePlanAllowed(req.authUser?.role, q.rules)) throw new AppError("WHATIF_FEE_PLAN_STAFF_ONLY");
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const trades = await loadSimTrades(scope, q.from, q.to, facetFiltersOf(q));
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
  const lang = langOf(req);
  const facets = facetFiltersOf(q);
  const key = resultKey(req, scope, q.from, q.to, facetCacheKey(facets));
  if (scope == null) {
    // Whole desk: the fast path only (day rules per trader, no share-size or personal-tag candidates).
    const hit = suggestionsCache.get(key);
    if (hit) { res.json(hit); return; }
    const trades = await loadSimTrades(scope, q.from, q.to, facets);
    const body = suggestionsBody({ head: suggestionsHead(scope, trades, q), lang, team: true, fast: findSuggestions(trades, { lang, team: true }), row: null, available: false });
    suggestionsCache.set(key, body);
    res.json(body);
    return;
  }
  let trades = await loadSimTrades(scope, q.from, q.to, facets);
  // The honest verdict of exactly these trades (a sync or an edited mark gives a new signature, so a new key).
  let sig = tradesSignature(trades);
  const win = honestWindow(q.from, q.to, q.window === "rolling", nyDate());
  const fastKey = `${key}|${q.window ?? ""}|fast`;
  // The honest verdict is kept per whole book (job whatif.honesty): a «Разрезы» selection takes the fast path.
  if (!trades.length || isGuest(req) || !win.honest || facets) {
    const found = fastSuggestions(fastKey, sig, trades, lang);
    const head = suggestionsHead(scope, trades, q);
    res.json(trades.length && !isGuest(req) ? suggestionsBody({ head, lang, team: false, window: !facets, filtered: !!facets, fast: found, row: null, available: false })
      : { ...head, suggestions: found.suggestions, tested: found.tested });
    return;
  }
  const readyKey = `${key}|ready`;
  const hit = cachedFor(readyKey, sig);
  if (hit) { res.json(hit); return; }
  let hk = honestyKey(scope, q.from, q.to, sig);
  let { row, ok } = await honestyRow(hk);
  if (ok && !row && honestyJobOn()) {
    // No row for the cached snapshot's signature: a sync may have landed since (the job loads uncached and may have
    // moved the row to the new signature already). Look again with the trades as they are now before queueing.
    const fresh = await freshSimTrades(scope, q.from, q.to);
    const freshSig = tradesSignature(fresh);
    if (freshSig !== sig) {
      trades = fresh;
      sig = freshSig;
      hk = honestyKey(scope, q.from, q.to, sig);
      ({ row, ok } = await honestyRow(hk));
    }
  }
  const head = suggestionsHead(scope, trades, q);
  if (row?.state === "ready") {
    const body = suggestionsBody({ head, lang, team: false, reachDays: win.reachDays, fast: null, row, available: true });
    cacheFor(readyKey, sig, body);
    void honestyStore.touch(pool, row.id).catch(() => undefined);
    res.json(body);
    return;
  }
  const queued = ok && honestyJobOn() ? await queueHonesty(hk, row) : null;
  res.json(suggestionsBody({
    head, lang, team: false, fast: fastSuggestions(fastKey, sig, trades, lang), now: new Date(),
    row: queued ? { state: queued.state, result: null, finishedAt: null, requestedAt: queued.since } : null, available: queued != null,
  }));
}));

router.get("/whatif/fees", asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await resolveScope(req, q.trader);
  if (scope === undefined) throw unauthorized();
  const facets = facetFiltersOf(q);
  const key = resultKey(req, scope, q.from, q.to, facetCacheKey(facets));
  const hit = feesCache.get(key);
  if (hit) { res.json(hit); return; }
  const trades = await loadSimTrades(scope, q.from, q.to, facets);
  const body = { scope, period: periodMeta(trades, q.from, q.to), ...feeReport(trades, langOf(req)), generatedAt: new Date().toISOString() };
  feesCache.set(key, body);
  res.json(body);
}));

/* ─── Saved scenarios ────────────────────────────────────────────────────── */

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
