/**
 * «Статистика офиса» — office-wide performance for the whole desk.
 *
 *   GET /office-stats            ?years=2025,2026&from=YYYY-MM-DD&to=YYYY-MM-DD
 *        admin (partners): { role: "admin", settings (capital $ per year), usd: OfficeView, pct: OfficeView, … }
 *                          — $ and %, per-trader rows, absolute volume.
 *        member (trader / curator): { role: "member", settings (goal % + hasCapital only), pct: OfficeView, … }
 *                          — % of the partners' capital and shares only: no $ anywhere, no capital amount,
 *                            no absolute volume, no per-trader rows (stripped here, server-side).
 *        guest → 403, anonymous → 401.
 *   GET /office-stats/capital    admin: every year with capital / goal; member: goal % + hasCapital.
 *   PUT /office-stats/capital    { year, capital: number | null, goalPct? } — admin only.
 *
 * Maths and the strategy classifier live in lib/officeStats.ts (pure, unit-tested). Trades: closed, not deleted,
 * with a trader; day = close date (exit_date ?? date); net = pnl − |fees|. The office_capital table comes from
 * migration 0234. Loaded trades are cached per close year (see loadTrades).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { closeDateSql, closedSql, netPnlSql, resultSql, signedRSql, horizonSql } from "../lib/tradeMath";
import { nyDate } from "../lib/tradingDate";
import { knownMarketHolidays, marketHolidays } from "../lib/tradeStrategyStore";
import { resolveActor, type Actor } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import {
  CLOSE_CROSS_FROM_SEC, CLOSE_CROSS_TO_SEC, DEFAULT_GOAL_PCT, MOC_IMBALANCE_FROM_SEC, AFTER_CLOSE_EXIT_SEC, PRINT_CLUSTER_UNTIL_SEC,
  PRINT_REPORT_LAG_SEC, RTH_OPEN_SEC, STRATEGIES, strategyRule,
  buildOfficeView, classifyStrategy, nyParts, parsePeriod, parseYears, shiftYear, toMemberView,
  type OfficeTrade, type Result, type YearSetting,
} from "../lib/officeStats";
import { AppError, sendError, unauthorized } from "../lib/http";
import { langOf, type Lang } from "../i18n";
import { insightsT } from "../i18n/ns";
import { facetSqlTail, type FacetFilters } from "../lib/tradeFacetsSql";
import { facetCacheKey, facetsOfQuery } from "../lib/tradeFacetsFilter";

const router: IRouter = Router();


type CapitalRow = { year: number; capital: string | null; goal_pct: string; updated_by: string | null; updated_at: Date | null };
type FullSetting = YearSetting & { updatedBy: string | null; updatedAt: string | null };

async function loadSettings(): Promise<Map<number, FullSetting>> {
  const { rows } = await pool.query<CapitalRow>(`SELECT year, capital, goal_pct, updated_by, updated_at FROM office_capital ORDER BY year`);
  const m = new Map<number, FullSetting>();
  for (const r of rows) {
    const cap = r.capital == null ? null : Number(r.capital);
    m.set(Number(r.year), {
      year: Number(r.year),
      capital: cap != null && Number.isFinite(cap) && cap > 0 ? cap : null,
      goalPct: Number.isFinite(Number(r.goal_pct)) ? Number(r.goal_pct) : DEFAULT_GOAL_PCT,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    });
  }
  return m;
}

// ─── viewer ─────────────────────────────────────────────────────────────────

/** Admin = partner (full view); any other signed-in member gets the % view; guests / anonymous are refused. */
async function viewerOf(req: Request, res: Response): Promise<Actor | null> {
  if (!req.authUser) { sendError(res, unauthorized()); return null; }
  const actor = await resolveActor(req);
  if (!actor) { sendError(res, unauthorized()); return null; }
  if (actor.guest) { sendError(res, new AppError("GUEST_UNAVAILABLE")); return null; }
  return actor;
}

// ─── trades (cached) ────────────────────────────────────────────────────────

/*
 * Desk-wide trades are cached per close year — the page asks for 2025+2026, then 2024+2025+2026, then one year, and
 * every combination used to reload (1.5–1.8 s cold, DEV-10). Past years barely change, the current one changes on a
 * sync: fresh for YEAR_TTL_MS (current) / PAST_YEAR_TTL_MS (earlier), then served stale while ONE background reload
 * runs, up to STALE_MAX_MS; after that the request waits for the reload. The trade rows carry no viewer data (the $ /
 * member stripping happens per request below), so one entry serves partners and members alike.
 */
const YEAR_TTL_MS = 120_000;
const PAST_YEAR_TTL_MS = 10 * 60_000;
const STALE_MAX_MS = 30 * 60_000;
type YearEntry = { at: number; promise: Promise<OfficeTrade[]>; refreshing?: boolean };
const yearCache = new Map<number, YearEntry>();

/*
 * Built views are memoized per (years, period, today, lang, capital settings, role) for one GENERATION of the year
 * cache: every time a year's trades are (re)loaded or the cache is dropped the generation moves and the memo empties.
 * buildOfficeView over a 90k-trade desk is ~60 ms of event-loop CPU per view (x2 for partners) on every page visit.
 */
let generation = 0;
const MEMO_MAX = 40;
const viewMemo = new Map<string, unknown>();
const tradesMemo = new Map<string, OfficeTrade[]>();
function bumpGeneration(): void {
  generation++;
  viewMemo.clear();
  tradesMemo.clear();
}
function setYear(y: number, entry: YearEntry): void {
  yearCache.set(y, entry);
  bumpGeneration();
}
function memo<T>(map: Map<string, T>, key: string, build: () => T): T {
  if (map.has(key)) return map.get(key)!;
  const v = build();
  map.set(key, v);
  while (map.size > MEMO_MAX) map.delete(map.keys().next().value!);
  return v;
}

/** Drop cached trades (e.g. after a sync); the next request reloads. */
export function invalidateOfficeStatsCache(): void {
  yearCache.clear();
  dataYearsCache = null;
  bumpGeneration();
}

type TradeRow = {
  id: number; trader: string; ticker: string; day: string; date: string | null; exit_date: string | null; session: string | null;
  horizon: string | null; net: number | null; result: string | null; r: number | null; qty: number | null;
  first_entry: Date | null; last_exit: Date | null; fill_qty: number | null; strategy: string | null;
};

/**
 * Cached trades of `years` (each year from its own entry), in close-date order, and the cache generation they belong to
 * (the memo key of the views built from them; -1 = reloaded meanwhile, do not memoize).
 */
async function loadTrades(years: number[], now = Date.now()): Promise<{ trades: OfficeTrade[]; gen: number }> {
  const thisYear = Number(nyDate().slice(0, 4));
  const missing: number[] = [];
  for (const y of years) {
    const e = yearCache.get(y);
    const ttl = y >= thisYear ? YEAR_TTL_MS : PAST_YEAR_TTL_MS;
    if (!e || now - e.at >= STALE_MAX_MS) { missing.push(y); continue; }
    if (now - e.at >= ttl && !e.refreshing) {
      e.refreshing = true;
      const fresh = queryTrades([y]);
      fresh.then((m) => { setYear(y, { at: Date.now(), promise: Promise.resolve(m.get(y) ?? []) }); })
        .catch(() => { e.refreshing = false; });
    }
  }
  if (missing.length) {
    const all = queryTrades(missing);
    for (const y of missing) setYear(y, { at: now, promise: all.then((m) => m.get(y) ?? []) });
    all.catch(() => { for (const y of missing) yearCache.delete(y); bumpGeneration(); });
  }
  const gen = generation;
  const parts = await Promise.all(years.map((y) => yearCache.get(y)!.promise));
  if (gen !== generation) return { trades: mergeYears(parts), gen: -1 };
  return { trades: memo(tradesMemo, `${gen}|${years.join(",")}`, () => mergeYears(parts)), gen };
}

function mergeYears(parts: OfficeTrade[][]): OfficeTrade[] {
  const out = parts.flat();
  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id));
  return out;
}

/** One SQL for every year asked (a hash aggregate of executions — cheaper than a per-trade probe desk-wide). */
async function queryTrades(years: number[]): Promise<Map<number, OfficeTrade[]>> {
  const CLOSE = closeDateSql();
  const { rows } = await pool.query<TradeRow>(
    `SELECT t.id, t.trader, t.ticker, LEFT(${CLOSE}, 10) AS day, t.date, t.exit_date, t.session, ${horizonSql()} AS horizon,
            (CASE WHEN t.pnl IS NULL THEN NULL ELSE ${netPnlSql()} END)::float AS net, ${resultSql()} AS result,
            ${signedRSql()}::float AS r, ABS(t.qty)::float AS qty,
            x.first_entry, x.last_exit, x.fill_qty::float AS fill_qty, t.strategy
       FROM trades t
       LEFT JOIN (
         SELECT e.trade_id,
                MIN(e.executed_at) FILTER (WHERE e.kind IN ('entry','add')) AS first_entry,
                MAX(e.executed_at) FILTER (WHERE e.kind IN ('exit','trim','stop')) AS last_exit,
                SUM(ABS(e.qty)) AS fill_qty
           FROM trade_executions e GROUP BY e.trade_id
       ) x ON x.trade_id = t.id
      WHERE t.trader IS NOT NULL AND TRIM(t.trader) <> '' AND t.deleted_at IS NULL AND ${closedSql()}
        AND LEFT(${CLOSE}, 4) = ANY($1::text[])
      ORDER BY LEFT(${CLOSE}, 10), t.id`,
    [years.map(String)],
  );
  const byYear = new Map<number, OfficeTrade[]>(years.map((y) => [y, []]));
  const closed = await marketHolidays().catch(() => knownMarketHolidays());
  for (const t of rows.map((r) => toOfficeTrade(r, closed))) byYear.get(Number(t.day.slice(0, 4)))?.push(t);
  return byYear;
}

/**
 * Partners' «Разрезы» (lib/tradeFacetsSql): the cached year rows are kept, only the ids passing the selection are read
 * (one query over the same years) and the rest dropped. Members never get a selection applied (no panel for them).
 */
async function applyFacets(trades: OfficeTrade[], years: number[], facets: FacetFilters | undefined): Promise<OfficeTrade[]> {
  if (!facets) return trades;
  const CLOSE = closeDateSql();
  const params: unknown[] = [years.map(String)];
  const tail = facetSqlTail(facets, params);
  const { rows } = await pool.query<{ id: number }>(
    `SELECT t.id FROM trades t WHERE t.deleted_at IS NULL AND LEFT(${CLOSE}, 4) = ANY($1::text[])${tail}`,
    params,
  );
  const ok = new Set(rows.map((r) => Number(r.id)));
  return trades.filter((t) => ok.has(t.id));
}

/** Years (close date) with at least one closed desk trade — the page offers only those (empty 2023/2024 chips). */
let dataYearsCache: { at: number; promise: Promise<number[]> } | null = null;
async function loadDataYears(now = Date.now()): Promise<number[]> {
  if (!dataYearsCache || now - dataYearsCache.at >= PAST_YEAR_TTL_MS) {
    const CLOSE = closeDateSql();
    const promise = pool
      .query<{ y: string }>(
        `SELECT DISTINCT LEFT(${CLOSE}, 4) AS y FROM trades t
          WHERE t.trader IS NOT NULL AND TRIM(t.trader) <> '' AND t.deleted_at IS NULL AND ${closedSql()} ORDER BY 1`,
      )
      .then((r) => r.rows.map((x) => Number(x.y)).filter((y) => Number.isInteger(y) && y >= 2000));
    dataYearsCache = { at: now, promise };
    promise.catch(() => { dataYearsCache = null; });
  }
  return dataYearsCache.promise;
}

function toOfficeTrade(r: TradeRow, closed: ReadonlySet<string>): OfficeTrade {
  const res = r.result === "win" || r.result === "loss" || r.result === "be" ? (r.result as Result) : null;
  const en = nyParts(r.first_entry);
  return {
    id: r.id,
    trader: r.trader.trim(),
    ticker: (r.ticker ?? "").trim() || "—",
    day: r.day,
    net: r.net,
    result: res,
    r: r.r,
    // Shares traded = every fill; a trade without fills counts its size in and out.
    volume: r.fill_qty != null && r.fill_qty > 0 ? r.fill_qty : (r.qty ?? 0) * 2,
    strategy: classifyStrategy({
      ticker: r.ticker, session: r.session, date: r.date, exitDate: r.exit_date, horizon: r.horizon,
      entryAt: r.first_entry, exitAt: r.last_exit,
      // The desk Print cluster needs the other traders' trades: the stored derivation (lib/tradeStrategyStore) knows it.
      isOpenPrintCluster: r.strategy === "Print",
    }, closed),
    entrySec: en ? en.sec : null,
    session: r.session,
  };
}

const hhmm = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}${sec % 60 ? `:${String(sec % 60).padStart(2, "0")}` : ""}`;

/** The rules as the page's «Как считается» popover shows them (single source: lib/officeStats). */
function rulesPayload(lang: Lang) {
  const t = insightsT.tFor(lang);
  return {
    strategies: STRATEGIES.map((key) => ({ key, text: strategyRule(key, lang) })),
    order: t("order"),
    thresholds: {
      open: hhmm(RTH_OPEN_SEC),
      printUntil: hhmm(RTH_OPEN_SEC + PRINT_REPORT_LAG_SEC),
      printClusterUntil: hhmm(PRINT_CLUSTER_UNTIL_SEC),
      afterCloseExit: hhmm(AFTER_CLOSE_EXIT_SEC),
      mocFrom: hhmm(MOC_IMBALANCE_FROM_SEC),
      closeCross: `${hhmm(CLOSE_CROSS_FROM_SEC)}–${hhmm(CLOSE_CROSS_TO_SEC)}`,
    },
    notes: [t("note.fold"), t("note.time"), t("note.result"), t("note.pct"), t("note.volume")],
  };
}

// ─── routes ─────────────────────────────────────────────────────────────────

router.get("/office-stats", asyncHandler(async (req, res) => {
  const actor = await viewerOf(req, res);
  if (!actor) return;
  const today = nyDate();
  const years = parseYears(req.query.years, today);
  const { from, to } = parsePeriod(req.query.from, req.query.to, years, today);
  const loadYears = [...new Set([...years, Number(from.slice(0, 4)), Number(to.slice(0, 4)), Number(shiftYear(from, -1).slice(0, 4)), Number(shiftYear(to, -1).slice(0, 4))])].sort();
  const isAdmin = actor.role === "admin";
  const facets = isAdmin ? facetsOfQuery(req.query as Record<string, unknown>) : undefined;
  const [settings, loaded, dataYears] = await Promise.all([loadSettings(), loadTrades(loadYears), loadDataYears()]);
  const { gen } = loaded;
  const trades = await applyFacets(loaded.trades, loadYears, facets);
  const base = { years, period: { from, to }, today, dataYears, rules: rulesPayload(langOf(req)) };
  const viewOpts = { years, settings, from, to, today, lang: langOf(req) };
  const settingsKey = [...settings.values()].map((s) => `${s.year}:${s.capital}:${s.goalPct}`).join(",");
  const view = <T,>(kind: string, build: () => T): T => gen < 0
    ? build()
    : (memo(viewMemo, `${gen}|${kind}|${years.join(",")}|${loadYears.join(",")}|${from}|${to}|${today}|${viewOpts.lang}|${settingsKey}|${facetCacheKey(facets)}`, build) as T);

  res.setHeader("Cache-Control", "private, no-store");
  if (isAdmin) {
    res.json({
      role: "admin" as const,
      ...base,
      settings: years.map((y) => {
        const s = settings.get(y);
        return { year: y, capital: s?.capital ?? null, goalPct: s?.goalPct ?? DEFAULT_GOAL_PCT, updatedBy: s?.updatedBy ?? null, updatedAt: s?.updatedAt ?? null };
      }),
      usd: view("usd", () => buildOfficeView(trades, { ...viewOpts, unit: "usd", traders: true })),
      pct: view("pct", () => buildOfficeView(trades, { ...viewOpts, unit: "pct", traders: true })),
    });
    return;
  }
  res.json({
    role: "member" as const,
    ...base,
    settings: years.map((y) => ({ year: y, goalPct: settings.get(y)?.goalPct ?? DEFAULT_GOAL_PCT, hasCapital: !!settings.get(y)?.capital })),
    pct: view("member", () => toMemberView(buildOfficeView(trades, { ...viewOpts, unit: "pct", traders: false }))),
  });
}));

router.get("/office-stats/capital", asyncHandler(async (req, res) => {
  const actor = await viewerOf(req, res);
  if (!actor) return;
  const settings = [...(await loadSettings()).values()];
  res.setHeader("Cache-Control", "private, no-store");
  if (actor.role === "admin") { res.json({ role: "admin", settings }); return; }
  res.json({ role: "member", settings: settings.map((s) => ({ year: s.year, goalPct: s.goalPct, hasCapital: s.capital != null })) });
}));

router.put("/office-stats/capital", asyncHandler(async (req, res) => {
  const actor = await viewerOf(req, res);
  if (!actor) return;
  if (actor.role !== "admin") {
    throw new AppError("ADMIN_ONLY");
  }
  const body = (req.body ?? {}) as { year?: unknown; capital?: unknown; goalPct?: unknown };
  const ty = Number(nyDate().slice(0, 4));
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > ty + 1) throw new AppError("INVALID_FIELD", undefined, { field: "year" });
  let capital: number | null;
  if (body.capital === null || body.capital === "") capital = null;
  else {
    capital = Number(body.capital);
    if (!Number.isFinite(capital) || capital <= 0 || capital > 1e11) throw new AppError("INVALID_FIELD", undefined, { field: "capital" });
    capital = Math.round(capital * 100) / 100;
  }
  let goalPct: number | null = null;
  if (body.goalPct !== undefined && body.goalPct !== null && body.goalPct !== "") {
    goalPct = Number(body.goalPct);
    if (!Number.isFinite(goalPct) || goalPct <= 0 || goalPct > 1000) throw new AppError("INVALID_FIELD", undefined, { field: "target" });
    goalPct = Math.round(goalPct * 100) / 100;
  }
  const { rows } = await pool.query<CapitalRow>(
    `INSERT INTO office_capital (year, capital, goal_pct, updated_by, updated_at)
          VALUES ($1, $2, COALESCE($3, ${DEFAULT_GOAL_PCT}), $4, NOW())
     ON CONFLICT (year) DO UPDATE SET capital = EXCLUDED.capital,
                                      goal_pct = COALESCE($3, office_capital.goal_pct),
                                      updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING year, capital, goal_pct, updated_by, updated_at`,
    [year, capital, goalPct, actor.name],
  );
  await logAudit({ actor: actor.name, action: "office_capital.set", targetType: "office_capital", targetId: String(year), details: { capital, goalPct } });
  const r = rows[0];
  res.json({
    year: Number(r.year), capital: r.capital == null ? null : Number(r.capital), goalPct: Number(r.goal_pct),
    updatedBy: r.updated_by, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  });
}));

export default router;
