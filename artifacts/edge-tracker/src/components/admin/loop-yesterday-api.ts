/**
 * «Петля вчера» API (artifacts/api-server/src/routes/admin-loop.ts → lib/admin/loopYesterday.ts):
 * GET /api/admin/loop-yesterday[?scope=group|all], capability team.read (admins + curators). Shapes mirror the server.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type LoopScope = "group" | "all";

export interface LoopRow {
  name: string;
  group: string | null;
  plan: boolean;
  /** First saved before 09:30 NY of the day. */
  planBeforeOpen: boolean;
  trades: number;
  closed: boolean;
  closedAt: string | null;
  reviewed: boolean;
  reviewedBy: string | null;
  /** Trading hours from the close to the review (or to now while waiting); null while the day is open. */
  reviewHours: number | null;
  overSla: boolean;
  telegram: boolean;
}

export interface LoopTotals {
  traders: number; plan: number; planBeforeOpen: number; traded: number; trades: number;
  closed: number; reviewed: number; waiting: number; overdue: number; telegram: number;
}

export interface LoopYesterday {
  date: string;
  scope: LoopScope;
  /** The viewer leads anyone (show the «Моя группа / Все» switch). */
  mine: boolean;
  slaHours: number;
  rows: LoopRow[];
  totals: LoopTotals;
}

/** `scope` null = the server default («Моя группа» for a viewer who leads anyone, else everyone). */
export function useLoopYesterday(scope: LoopScope | null) {
  return useQuery({
    queryKey: ["admin-console", "loop-yesterday", scope ?? "default"] as const,
    queryFn: ({ signal }) => http.get<LoopYesterday>(`/api/admin/loop-yesterday${scope ? `?scope=${scope}` : ""}`, { signal }),
    staleTime: STALE.default,
  });
}
