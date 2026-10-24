/**
 * «Улучшенный поиск» on /trades: the «Фильтры» panel (components/shared/trade-facets) over the page's current filters,
 * the hidden-value chips, «Исключить IMX» and the «из них IMX» line. The selection reaches the book as `filters.facets`
 * (x* params of /api/trades/page|days, hooks/use-trades-page buildTradesPageParams).
 */
import { useMemo } from "react";
import { buildTradesPageParams } from "@/hooks/use-trades-page";
import { FacetPanel } from "@/components/shared/trade-facets/FacetPanel";
import { FacetSummary } from "@/components/shared/trade-facets/FacetSummary";
import { useTradeFacets, type useFacetView } from "@/components/shared/trade-facets/api";
import { facetQuery, type FacetView } from "@/lib/trade-facets";
import { HelpButton, PageHint } from "@/components/shared/page-hint";
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

export function TradesFacets({ filters, fv }: { filters: TradeFilters; fv: ReturnType<typeof useFacetView> }) {
  const base = useMemo(() => facetsBaseQuery(filters), [filters]);
  const q = useTradeFacets(base, fv.view, fv.ready);
  return (
    <div className="flex flex-col gap-2">
      <PageHint id="facets" />
      <FacetPanel view={fv.view} onChange={fv.update} data={q.data} loading={q.isFetching} error={q.isError} help={<HelpButton id="facets" />} />
      <FacetSummary view={fv.view} onChange={fv.update} data={q.data} />
    </div>
  );
}
