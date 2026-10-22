/**
 * «Разрезы» on a period page (/stats, /analytics, /behavior, /what-if, /benchmark, /office): the saved panel view
 * (useFacetView — the same exclusions follow the user between sections), the buckets of the page's own window
 * (GET /api/trades/facets with from / to / trader), the x* query of the selection for server-computed numbers and the
 * filter for a page that computes from raw trades (lib/trade-facets tradePassesFacets). The panel and the hidden-value
 * chips are always shown together with the numbers they change (never a hidden filter).
 */
import { useCallback, useMemo } from "react";
import type { Trade } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { facetQuery, tradePassesFacets, type FacetView } from "@/lib/trade-facets";
import { FacetPanel } from "./FacetPanel";
import { FacetSummary } from "./FacetSummary";
import { useFacetView, useTradeFacets } from "./api";

export type RangeFacetsWindow = { from?: string | null; to?: string | null; trader?: string | null };

/** The base query of the facets request for a window (from / to / trader; empty ends are left out). */
export function rangeFacetsBase(w: RangeFacetsWindow): string {
  const p = new URLSearchParams();
  if (w.from) p.set("from", w.from);
  if (w.to) p.set("to", w.to);
  if (w.trader) p.set("trader", w.trader);
  return p.toString();
}

/** x* params of a selection as an object (a POST body / a query record); {} without exclusions. */
export function facetParamsOf(view: FacetView): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(facetQuery(view)));
}

/** The own raw trades that pass the selection (desk tags from the facets answer; IMX until it arrives). */
export function facetFilteredTrades<T extends Trade>(trades: readonly T[] | undefined, view: FacetView, deskTags: readonly string[] | undefined): T[] {
  const list = trades ?? [];
  const tags = deskTags ?? ["IMX"];
  return list.filter((t) => tradePassesFacets(t, view, tags));
}

/**
 * The panel state of a page window. `enabled: false` (a page that does not show the panel, e.g. a member on /office)
 * applies nothing: `query` is "" and `filter` returns the list as is.
 */
export function useRangeFacets(w: RangeFacetsWindow, enabled = true) {
  const fv = useFacetView();
  const base = useMemo(() => rangeFacetsBase(w), [w.from, w.to, w.trader]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useTradeFacets(base, fv.view, enabled && fv.ready);
  const view = fv.view;
  const query = enabled ? facetQuery(view) : "";
  const deskTags = q.data?.deskTags;
  const filter = useCallback(<T extends Trade>(trades: readonly T[] | undefined): T[] => (enabled ? facetFilteredTrades(trades, view, deskTags) : [...(trades ?? [])]), [enabled, view, deskTags]);
  const params = useMemo(() => (enabled ? facetParamsOf(view) : {}), [enabled, view]);
  return { fv, q, query, params, filter, enabled };
}

export type RangeFacets = ReturnType<typeof useRangeFacets>;

/** The «Разрезы» panel with its hidden-value chips (nothing when the page does not apply the selection). */
export function RangeFacetsPanel({ rf, className }: { rf: RangeFacets; className?: string }) {
  if (!rf.enabled) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <FacetPanel view={rf.fv.view} onChange={rf.fv.update} data={rf.q.data} loading={rf.q.isFetching} error={rf.q.isError} />
      <FacetSummary view={rf.fv.view} onChange={rf.fv.update} data={rf.q.data} />
    </div>
  );
}
