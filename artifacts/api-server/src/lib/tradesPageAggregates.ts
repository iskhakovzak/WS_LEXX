/**
 * The sort / page independent half of GET /trades/page: summary aggregates, curve, streak and the facet counts
 * (routes/trades.ts). Full requests go through the 60 s per-filter-set cache (lib/tradesPageCache, DEV-02); lite=1
 * (count + option facets only) is cheap and always computed fresh.
 */
import { pool } from "@workspace/db";
import {
  buildCountQuery, buildCurveQuery, buildHorizonFacetQuery, buildOptionsQuery, buildOutcomeFacetQuery, buildPresetFacetQuery,
  buildStreakQuery, buildSummaryQuery, type TradesPageFilters,
} from "./tradesPageQuery";
import { tradesPageAggregatesCache } from "./tradesPageCache";

type QRows<T> = { rows: T[] };
export type PageAggregates = {
  summaryRes: QRows<Record<string, unknown>>;
  curveRes: QRows<{ i: string | number; cum: string | number; label: string }>;
  streakRes: QRows<{ res: string | null }>;
  outcomeRes: QRows<{ k: string; n: number }>;
  horizonRes: QRows<{ k: string; n: number }>;
  optionsRes: QRows<{ kind: string; name: string; n: number }>;
  presetRes: QRows<Record<string, number>>;
};

type Input = { filters: TradesPageFilters; quality: boolean; scope: string | null; lite: boolean; onPresetError: (err: unknown) => void };

function loadPageAggregates({ filters, quality, scope, lite, onPresetError }: Input): Promise<PageAggregates> {
  const none = <T,>() => Promise.resolve({ rows: [] as T[] });
  const q = <T extends Record<string, unknown>>(b: { sql: string; params: unknown[] }) => pool.query<T>(b.sql, b.params);
  return Promise.all([
    q<Record<string, unknown>>(lite ? buildCountQuery(filters, quality) : buildSummaryQuery(filters, quality)),
    lite ? none<{ i: string | number; cum: string | number; label: string }>() : q<{ i: string | number; cum: string | number; label: string }>(buildCurveQuery(filters, quality)),
    lite ? none<{ res: string | null }>() : q<{ res: string | null }>(buildStreakQuery(filters, quality)),
    lite ? none<{ k: string; n: number }>() : q<{ k: string; n: number }>(buildOutcomeFacetQuery(filters, quality)),
    q<{ k: string; n: number }>(buildHorizonFacetQuery(filters, quality)),
    q<{ kind: string; name: string; n: number }>(buildOptionsQuery(scope)),
    // Preset badges are a nicety: a failure there must not break the book.
    lite ? none<Record<string, number>>() : q<Record<string, number>>(buildPresetFacetQuery(filters, quality)).catch((err) => {
      onPresetError(err);
      return { rows: [] as Record<string, number>[] };
    }),
  ]).then(([summaryRes, curveRes, streakRes, outcomeRes, horizonRes, optionsRes, presetRes]) => ({
    summaryRes, curveRes, streakRes, outcomeRes, horizonRes, optionsRes, presetRes,
  }));
}

/** Aggregates for one /trades/page request: cached 60 s per filter set (scope included) unless lite. */
export function pageAggregates(input: Input): Promise<PageAggregates> {
  if (input.lite) return loadPageAggregates(input);
  const key = JSON.stringify({ filters: input.filters, quality: input.quality });
  return tradesPageAggregatesCache.getOrLoad(key, () => loadPageAggregates(input)) as Promise<PageAggregates>;
}
