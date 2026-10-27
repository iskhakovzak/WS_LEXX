/**
 * «Разрезы» on /trades: the page filters with the facet selection attached (what the book queries are built from) and
 * the buckets of the current filters. The grid and «Исключить IMX» live in «Фильтры (n)» (TradeFilterBar →
 * FacetFilterSections), the hidden values are chips under the toolbar (facetChips) and the «из них IMX» line ends the
 * KPI line. The selection reaches the book as `filters.facets` (x* params of /api/trades/page|days,
 * hooks/use-trades-page buildTradesPageParams).
 */
import { useMemo } from "react";
import { buildTradesPageParams } from "@/hooks/use-trades-page";
import { useTradeFacets, type useFacetView } from "@/components/shared/trade-facets/api";
import { facetQuery, type FacetView } from "@/lib/trade-facets";
import type { TradeFilters } from "./trade-utils";

/** The page filters with the facet selection attached (what the book queries are built from). */
export function useFacetFilters(filters: TradeFilters, view: FacetView): TradeFilters {
  const sel = facetQuery(view);
  return useMemo(() => (sel ? { ...filters, facets: sel } : filters), [filters, sel]);
}

/** Base query of the facets request: the page filters without sort / page params. */
export function facetsBaseQuery(filters: TradeFilters): string {
  const p = buildTradesPageParams({ ...filters, facets: undefined }, { col: "date", dir: "desc" }, { limit: 1 });
  for (const k of ["sort", "dir", "limit"]) p.delete(k);
  return p.toString();
}

/** The buckets (and total / IMX lines) for the page's current filters. */
export function useTradesFacets(filters: TradeFilters, fv: ReturnType<typeof useFacetView>, enabled = true) {
  const base = useMemo(() => facetsBaseQuery(filters), [filters]);
  return useTradeFacets(base, fv.view, enabled && fv.ready);
}
