/**
 * «Разрезы» (lib/tradeFacetsSql) for loaders that keep their own cache or read trades through drizzle: the trade ids
 * of a list that pass the selection, from ONE indexed query (`t.id = ANY(...)` + the facet predicates). Loaders with
 * a hand-written SQL append facetSqlTail directly instead.
 */
import { z } from "zod";
import { pool } from "@workspace/db";
import { facetSqlTail, hasFacets, type FacetFilters } from "./tradeFacetsSql";
import { FACET_QUERY, compactQuery, facetFiltersOf } from "./tradesPageParams";
import { badRequest } from "./http";

/** Stable cache-key part of a selection ("" without one). */
export function facetCacheKey(f: FacetFilters | null | undefined): string {
  if (!hasFacets(f)) return "";
  const off = Object.fromEntries(Object.entries(f!.off).filter(([, v]) => v?.length).map(([k, v]) => [k, [...v!].sort()] as const).sort((a, b) => a[0].localeCompare(b[0])));
  return JSON.stringify({ off, imx: f!.excludeImx });
}

/** The ids among `ids` that pass the selection; every id without a selection. */
export async function facetPassingIds(f: FacetFilters | null | undefined, ids: readonly number[]): Promise<Set<number>> {
  if (!hasFacets(f) || !ids.length) return new Set(ids);
  const params: unknown[] = [[...new Set(ids)]];
  const tail = facetSqlTail(f, params);
  const { rows } = await pool.query<{ id: number }>(`SELECT t.id FROM trades t WHERE t.id = ANY($1::int[])${tail}`, params);
  return new Set(rows.map((r) => Number(r.id)));
}

/** The items whose trade passes the selection (order kept); the same array without a selection. */
export async function keepFacetPassing<T>(f: FacetFilters | null | undefined, items: T[], idOf: (x: T) => number): Promise<T[]> {
  if (!hasFacets(f) || !items.length) return items;
  const ok = await facetPassingIds(f, items.map(idOf));
  return items.filter((x) => ok.has(idOf(x)));
}

const FacetQuery = z.object(FACET_QUERY);

/** The «Разрезы» selection of a raw request query (validated like /trades/page); undefined without one. */
export function facetsOfQuery(query: Record<string, unknown>): FacetFilters | undefined {
  const parsed = FacetQuery.safeParse(compactQuery(query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  return facetFiltersOf(parsed.data);
}
