/**
 * GET /api/game-plan/my/prefill (api lib/planPrefill): what the evening hands to the plan of `date` — the own «Фокус на
 * завтра» (item 1.5) and the costliest pattern of two weeks as the suggested own rule (item 1.9). Shared by «Мой план»
 * and the journal's focus step (same cache entry). An older API without the route answers 404 → null (no prefill).
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { isNotFound } from "@/lib/api/errors";

export type PlanPrefill = {
  date: string;
  focus: { text: string; source: "journal" | "eod"; from: string } | null;
  rule: { mistake: string; costNet: number; count: number; days: number; window: { from: string; to: string } } | null;
};

export const planPrefillKey = (date: string) => ["game-plan", "prefill", date] as const;

export function usePlanPrefill(date: string | null, enabled = true) {
  return useQuery<PlanPrefill | null>({
    queryKey: planPrefillKey(date ?? ""),
    enabled: enabled && !!date,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await http.get<PlanPrefill>("/api/game-plan/my/prefill", { query: { date: date ?? "" }, signal });
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
  });
}
