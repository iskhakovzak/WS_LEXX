/**
 * Data of the «Фильтры» panel (lib/trade-facets): the saved view (GET|PUT /api/trades/facets/view — follows the user
 * across devices, like the themes view) and the buckets (GET /api/trades/facets with the page's own query).
 */
import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, type ApiError } from "@/lib/api/http";
import { EMPTY_FACET_VIEW, facetQuery, normalizeFacetView, type FacetView, type FacetsResponse } from "@/lib/trade-facets";

export const FACET_VIEW_KEY = ["/api/trades/facets/view"] as const;
export const FACETS_KEY = "/api/trades/facets";

/** The viewer's panel + «Исключить IMX»; `update` saves at once (optimistic; a guest keeps it for the session). */
export function useFacetView() {
  const qc = useQueryClient();
  const q = useQuery<FacetView, ApiError>({
    queryKey: FACET_VIEW_KEY,
    queryFn: async ({ signal }) => normalizeFacetView(await http.get<unknown>("/api/trades/facets/view", { signal })),
    staleTime: 5 * 60_000,
  });
  const { mutate: save } = useMutation<FacetView, ApiError, FacetView>({
    mutationFn: async (v) => normalizeFacetView(await http.put<unknown>("/api/trades/facets/view", v)),
  });
  const view = q.data ?? EMPTY_FACET_VIEW;
  const update = useCallback((next: FacetView | ((v: FacetView) => FacetView)) => {
    const cur = qc.getQueryData<FacetView>(FACET_VIEW_KEY) ?? EMPTY_FACET_VIEW;
    const v = typeof next === "function" ? next(cur) : next;
    qc.setQueryData(FACET_VIEW_KEY, v);
    save(v);
  }, [qc, save]);
  return { view, update, ready: q.isFetched };
}

/** Buckets for the page's base query (from / to / trader / outcome… without x* params) and the current selection. */
export function useTradeFacets(baseQuery: string, view: FacetView, enabled = true) {
  const sel = facetQuery(view);
  const qs = [baseQuery, sel].filter(Boolean).join("&");
  return useQuery<FacetsResponse, ApiError>({
    queryKey: [FACETS_KEY, qs],
    queryFn: ({ signal }) => http.get<FacetsResponse>(`${FACETS_KEY}${qs ? `?${qs}` : ""}`, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
