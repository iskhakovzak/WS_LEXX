import { z } from "zod";
import {
  PAGE_SORT_COLS, PAGE_OUTCOMES, PAGE_HORIZONS, PAGE_SOURCES, PAGE_PRESETS, MONEY_PRESETS, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX,
  PAGE_OFFSET_MAX, type TradesPageFilters,
} from "./tradesPageQuery";
import { hasFacets, parseFacetQuery } from "./tradeFacetsSql";
import { DESK_TAGS } from "./deskTags";

/**
 * Query parsing of GET /trades/page and /trades/days (routes/trades.ts): the zod schema, empty-param stripping and
 * query → TradesPageFilters. Split out of routes/trades.ts (size ratchet).
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (max: number) => z.string().trim().max(max).optional();
export const ymd = z.string().regex(YMD_RE).optional();
const numOpt = z.coerce.number().finite().optional();

/** «Улучшенный поиск» (lib/tradeFacetsSql): excluded keys per column, comma-separated; «Исключить IMX». */
export const FACET_QUERY = {
  xYears: str(4000), xMonths: str(4000), xDays: str(4000), xTimes: str(4000), xStrategies: str(4000), xTypes: str(4000),
  xGtags: str(20000), xPtags: str(20000),
  excludeImx: z.enum(["1", "true", "0", "false"]).optional(),
};
export type FacetQueryT = { [K in keyof typeof FACET_QUERY]?: string };

/** Facet filters of a parsed query (undefined when nothing is excluded — the cache key and SQL stay as before). */
export function facetFiltersOf(q: FacetQueryT) {
  const f = parseFacetQuery(q as Record<string, unknown>, DESK_TAGS);
  return hasFacets(f) ? f : undefined;
}

export const TradesPageQuery = z.object({
  trader: str(80),
  ticker: str(16),
  date: ymd,
  from: ymd,
  to: ymd,
  setup: str(120),
  playbookId: z.coerce.number().int().positive().optional(),
  horizon: z.enum(PAGE_HORIZONS).optional(),
  source: z.enum(PAGE_SOURCES).optional(),
  side: str(10),
  outcome: z.enum(PAGE_OUTCOMES).optional(),
  // `result` is accepted as an alias of `outcome` (same vocabulary as /trades?result=).
  result: z.enum(PAGE_OUTCOMES).optional(),
  ids: z.string().regex(/^\d+(,\d+)*$/).max(4000).optional(),
  sector: str(80),
  session: str(20),
  eventType: str(20),
  tag: str(60),
  q: str(120),
  exitEffMax: numOpt,
  mfeRMin: numOpt,
  leftMin: numOpt,
  preset: z.enum(PAGE_PRESETS).optional(),
  sort: z.enum(PAGE_SORT_COLS).default("date"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).max(PAGE_OFFSET_MAX).default(0),
  cursor: z.string().max(400).optional(),
  // lite=1: only summary.total / firstDate / lastDate + horizon & option facets (no rows, curve, streak, presets).
  lite: z.enum(["1", "true", "0", "false"]).optional(),
  ...FACET_QUERY,
});

/** Empty strings (`?setup=&tag=`) mean "not set" — strip them before validation. */
export function compactQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[v.length - 1] : v;
    if (s === undefined || s === null || s === "") continue;
    out[k] = s;
  }
  return out;
}

type TradesPageQueryT = z.infer<typeof TradesPageQuery>;
export function pageFiltersOf(q: TradesPageQueryT, scope: string | null): TradesPageFilters {
  const ids = q.ids ? Array.from(new Set(q.ids.split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 500) : undefined;
  return {
    scope,
    ticker: q.ticker || undefined,
    from: q.date ?? q.from,
    to: q.date ?? q.to,
    setup: q.setup || undefined,
    playbookId: q.playbookId,
    horizon: q.horizon,
    source: q.source ?? "",
    side: q.side || undefined,
    outcome: q.outcome ?? q.result ?? "",
    ids,
    sector: q.sector || undefined,
    session: q.session || undefined,
    eventType: q.eventType || undefined,
    tag: q.tag || undefined,
    q: q.q || undefined,
    exitEffMax: q.exitEffMax ?? null,
    mfeRMin: q.mfeRMin ?? null,
    leftMin: q.leftMin ?? null,
    preset: q.preset ?? "",
    facets: facetFiltersOf(q),
  };
}

/** Filters of a book whose $ the viewer may not see: no $ preset, no free-text match on pnl. */
export function moneyBlindFilters(f: TradesPageFilters, showMoney: boolean): TradesPageFilters {
  if (showMoney) return f;
  return { ...f, moneyBlind: true, preset: f.preset && MONEY_PRESETS.has(f.preset) ? "" : f.preset };
}
