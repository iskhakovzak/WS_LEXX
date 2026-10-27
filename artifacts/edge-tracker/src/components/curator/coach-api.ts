/**
 * Coaching evidence for the curator cabinet (roadmap Wave 1): the intervention log (GET /api/interventions, R9a).
 * Contract: api-server routes/coach.ts. Plateau and priority additions live next to it.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type InterventionKind =
  | "limit_change" | "size_change" | "rule_added" | "rule_removed" | "rule_trial" | "focus_set" | "one_on_one" | "pause"
  | "quest" | "fee_plan" | "concern_note" | "plateau_review" | "scaling_decision";
export type InterventionTrigger = "scheduled" | "after_bad_period" | "plateau" | "breach" | "random" | "trader_request";

export type Intervention = {
  id: number;
  trader: string;
  kind: InterventionKind;
  params: Record<string, unknown>;
  targetMetric: string | null;
  targetSlice: string | null;
  trigger: InterventionTrigger;
  startedOn: string;
  endsOn: string | null;
  author: string | null;
  sourceTable: string | null;
  createdAt: string;
  /** R9b (Wave 2) fills it; null = not estimated yet. */
  effect: null;
};

export const coachKeys = {
  all: ["curator", "coach"] as const,
  interventions: (trader: string) => ["curator", "coach", "interventions", trader] as const,
};

// ─── R6: «Застряли» (GET /api/curator/stuck, POST /api/curator/stuck/:trader/one-on-one) ──────────────────────

export type EdgeSliceBrief = { sliceKey: string; perDay: number; perDayLo: number; perDayHi: number };

export type StuckItem = {
  trader: string;
  asOf: string;
  kind: "monthly" | "weekly";
  tenure: number;
  stage: string | null;
  severity: "slow" | "stuck" | "stuck_long";
  pace: number | null;
  mean: number | null;
  lo80: number | null;
  hi80: number | null;
  pImpr: number | null;
  escalated: boolean;
  adminEscalated: boolean;
  escalationOpen: boolean;
  reviewedOn: string | null;
  diagnosis: { binding: null; edge: { leaks: EdgeSliceBrief[]; strengths: EdgeSliceBrief[] }; feeSharePct: number | null };
};

export function useStuck(scope: "mine" | "desk" | "auto") {
  return useQuery({
    queryKey: [...coachKeys.all, "stuck", scope] as const,
    queryFn: ({ signal }) => http.get<{ scope: string; items: StuckItem[] }>("/api/curator/stuck", { query: scope === "auto" ? {} : { scope }, signal }),
    staleTime: STALE.long,
  });
}

export function scheduleReview(trader: string) {
  return http.post<{ meetingId: number; metAt: string; interventionId: number | null }>(`/api/curator/stuck/${encodeURIComponent(trader)}/one-on-one`);
}

export function useInterventions(trader: string) {
  return useQuery({
    queryKey: coachKeys.interventions(trader),
    queryFn: ({ signal }) => http.get<{ trader: string; interventions: Intervention[] }>("/api/interventions", { query: { trader, limit: 50 }, signal }),
    staleTime: STALE.short,
  });
}
