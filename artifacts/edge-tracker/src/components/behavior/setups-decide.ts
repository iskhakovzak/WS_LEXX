/**
 * «Сетапы» decisions on one trade: accept (writes the setup into the trade) / reject the classifier's suggestion.
 * Both are optimistic on the cached lists (hooks/optimistic); the table toasts the outcome.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { invalidateTradeDependents } from "@/lib/query-keys";
import { optimistic } from "@/hooks/optimistic";
import { behaviorKeys, setupsAutoKeys, type SetupsAutoResponse } from "./api";

/** Pure: the list with one trade's suggestion decided (accepted also writes the setup into the trade). */
function withDecision(res: SetupsAutoResponse, tradeId: number, status: "accepted" | "rejected", setup?: string): SetupsAutoResponse {
  if (!res?.items) return res;
  return {
    ...res,
    items: res.items.map((i) => {
      if (i.tradeId !== tradeId || !i.suggestion) return i;
      const written = status === "accepted" ? (setup ?? i.suggestion.setup) : null;
      return { ...i, currentSetup: written ?? i.currentSetup, suggestion: { ...i.suggestion, status } };
    }),
  };
}

/** Принять предложение: пишет setup в сделку тем же механизмом, что правка сделки. Optimistic on the table; the caller toasts. */
export function useAcceptSetup() {
  const qc = useQueryClient();
  type Vars = { tradeId: number; setup?: string };
  const o = optimistic<Vars, SetupsAutoResponse>(qc, {
    queryKey: [...setupsAutoKeys.all, "list"],
    update: (res, v) => withDecision(res, v.tradeId, "accepted", v.setup),
    onError: () => {},
  });
  return useMutation({
    mutationFn: ({ tradeId, setup }: Vars) =>
      http.post<{ ok: boolean; tradeId: number; setup: string }>(`/api/setups-auto/${tradeId}/accept`, setup ? { setup } : {}),
    onMutate: o.onMutate,
    onError: o.onError,
    onSettled: async (_d, _e, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: setupsAutoKeys.all }),
        qc.invalidateQueries({ queryKey: behaviorKeys.all }),
        invalidateTradeDependents(qc, { tradeId: v.tradeId }),
      ]);
    },
  });
}

export function useRejectSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId }: { tradeId: number }) => http.post<{ ok: boolean }>(`/api/setups-auto/${tradeId}/reject`, {}),
    ...optimistic<{ tradeId: number }, SetupsAutoResponse>(qc, {
      queryKey: [...setupsAutoKeys.all, "list"],
      update: (res, v) => withDecision(res, v.tradeId, "rejected"),
      invalidate: [setupsAutoKeys.all],
      onError: () => {},
    }),
  });
}
