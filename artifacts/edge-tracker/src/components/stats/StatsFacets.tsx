/**
 * «Улучшенный поиск» on /stats: the same «Фильтры» panel as /trades (components/shared/trade-facets) over the period.
 * Staff aggregates get the selection as x* params (components/stats/aggregate facets); a trader's own raw book is
 * filtered here with the same rules (lib/trade-facets tradePassesFacets). Shows «Исключить IMX» and «из них IMX».
 */
import { useMemo } from "react";
import type { Trade } from "@workspace/api-client-react";
import { FacetPanel } from "@/components/shared/trade-facets/FacetPanel";
import { FacetSummary } from "@/components/shared/trade-facets/FacetSummary";
import { useTradeFacets, type useFacetView } from "@/components/shared/trade-facets/api";
import { tradePassesFacets, type FacetView, type FacetsResponse } from "@/lib/trade-facets";
import type { Range } from "./metrics";

type FV = ReturnType<typeof useFacetView>;

/** Buckets of the period (and trader) for the panel. */
export function useStatsFacets(cur: Range, trader: string | null, fv: FV) {
  const base = useMemo(() => {
    const p = new URLSearchParams();
    if (cur.from) p.set("from", cur.from);
    if (cur.to) p.set("to", cur.to);
    if (trader) p.set("trader", trader);
    return p.toString();
  }, [cur.from, cur.to, trader]);
  return useTradeFacets(base, fv.view, fv.ready);
}

/** The own raw trades that pass the selection (desk tags from the facets answer; IMX until it arrives). */
export function facetFilteredTrades(trades: Trade[] | undefined, view: FacetView, deskTags: readonly string[] | undefined): Trade[] {
  const list = trades ?? [];
  const tags = deskTags ?? ["IMX"];
  return list.filter((t) => tradePassesFacets(t, view, tags));
}

export function StatsFacets({ fv, data, loading, error }: { fv: FV; data: FacetsResponse | undefined; loading: boolean; error: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <FacetPanel view={fv.view} onChange={fv.update} data={data} loading={loading} error={error} />
      <FacetSummary view={fv.view} onChange={fv.update} data={data} />
    </div>
  );
}

