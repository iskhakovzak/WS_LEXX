/**
 * «Улучшенный поиск» on /stats: the same «Фильтры» panel as /trades (components/shared/trade-facets) over the period.
 * Staff aggregates get the selection as x* params (components/stats/aggregate facets); a trader's own raw book is
 * filtered here with the same rules (lib/trade-facets tradePassesFacets). Shows «Исключить IMX» and «из них IMX».
 * The period pages share the model: components/shared/trade-facets/range-facets.
 */
import { useMemo } from "react";
import { FacetPanel } from "@/components/shared/trade-facets/FacetPanel";
import { FacetSummary } from "@/components/shared/trade-facets/FacetSummary";
import { useTradeFacets, type useFacetView } from "@/components/shared/trade-facets/api";
import { rangeFacetsBase } from "@/components/shared/trade-facets/range-facets";
import type { FacetsResponse } from "@/lib/trade-facets";
import type { Range } from "./metrics";

export { facetFilteredTrades } from "@/components/shared/trade-facets/range-facets";

type FV = ReturnType<typeof useFacetView>;

/** Buckets of the period (and trader) for the panel. */
export function useStatsFacets(cur: Range, trader: string | null, fv: FV) {
  const base = useMemo(() => rangeFacetsBase({ from: cur.from, to: cur.to, trader }), [cur.from, cur.to, trader]);
  return useTradeFacets(base, fv.view, fv.ready);
}

export function StatsFacets({ fv, data, loading, error }: { fv: FV; data: FacetsResponse | undefined; loading: boolean; error: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <FacetPanel view={fv.view} onChange={fv.update} data={data} loading={loading} error={error} />
      <FacetSummary view={fv.view} onChange={fv.update} data={data} />
    </div>
  );
}
