/**
 * Client for the PropReports accuracy endpoints (types mirror artifacts/api-server/src/routes/propreports-accuracy.ts,
 * lib/propreports/adjustments.ts and lib/propreports/reconcile-broker-store.ts).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type AdjustmentKind = "fee" | "transfer" | "other";

export type AdjustmentDay = {
  date: string; tradeNet: number; fees: number; transfers: number; other: number; count: number;
  netWithAdjustments: number; equityDelta: number;
};

export type AdjustmentItem = {
  id: number; date: string; account: string; trader: string | null; category: string; kind: AdjustmentKind;
  amount: number; comment: string | null; symbol: string | null;
};

export type AdjustmentsReport = {
  trader: string | null; from: string; to: string; days: AdjustmentDay[]; totals: Omit<AdjustmentDay, "date">;
  items: AdjustmentItem[]; itemsTruncated: boolean;
};

export type ReconcileStatus = "ok" | "mismatch" | "missing_ours" | "missing_broker";

export type ReconcileDayRow = {
  id: number; account: string; accountId: string | null; trader: string | null; date: string; status: ReconcileStatus;
  oursNet: number | null; brokerNet: number | null; diff: number; oursTrades: number | null; brokerFills: number | null;
  carry: boolean; adjDiff: number | null; transferDiff: number | null; checkedAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null; note: string | null;
};

export type ReconcileRun = { target: string; from: string; to: string; done: string[]; mismatches: number; skipped: number; unparsed: number; total?: number; startedAt: string; finishedAt: string | null };

export type ReconcileBrokerResponse = { rows: ReconcileDayRow[]; lastCheckedAt: string | null; openCount: number; run: ReconcileRun | null };

export type ReconcileView = "open" | "all" | "everything";

const keys = {
  adjustments: (trader: string | null, from: string | null, to: string | null) => ["propreports", "adjustments", trader ?? "*", from ?? "", to ?? ""] as const,
  reconcile: (view: ReconcileView, trader: string | null) => ["propreports", "reconcile-broker", view, trader ?? "*"] as const,
};

export function useAdjustmentDays(p: { trader?: string | null; from?: string | null; to?: string | null }, enabled = true) {
  return useQuery({
    queryKey: keys.adjustments(p.trader ?? null, p.from ?? null, p.to ?? null),
    queryFn: ({ signal }) => http.get<AdjustmentsReport>("/api/propreports/adjustments/daily", {
      query: { trader: p.trader || undefined, from: p.from || undefined, to: p.to || undefined }, signal,
    }),
    enabled,
    staleTime: STALE.short,
  });
}

export function useReconcileBroker(view: ReconcileView, trader: string | null = null, enabled = true) {
  return useQuery({
    queryKey: keys.reconcile(view, trader),
    queryFn: ({ signal }) => http.get<ReconcileBrokerResponse>("/api/propreports/reconcile-broker", { query: { view, trader: trader || undefined }, signal }),
    enabled,
    staleTime: STALE.short,
  });
}

export function useAcknowledgeReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => http.post<{ ok: true }>(`/api/propreports/reconcile-broker/${id}/acknowledge`, note ? { note } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["propreports", "reconcile-broker"] }),
  });
}
