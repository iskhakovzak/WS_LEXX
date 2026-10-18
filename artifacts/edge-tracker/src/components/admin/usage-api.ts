/**
 * «Использование» API (artifacts/api-server/src/routes/usage.ts → lib/usage/stats.ts UsageOverview): GET /api/admin/usage,
 * capability usage.read (admins). Shapes mirror the server.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export type UsageRole = "trader" | "curator" | "admin";
export type FunnelStep = "visit" | "plan" | "today" | "traded" | "reviewed" | "tagged" | "trainer";
export type TagState = "all" | "part" | "none";

export interface ActivityPoint { day: string; dau: number; wau: number; byRole: Record<UsageRole, number> }
export interface UsageCount { key: string; users: number; traders: number; count: number }
export interface FunnelCells {
  visit: boolean[]; plan: boolean[]; today: boolean[]; traded: boolean[]; reviewed: boolean[];
  tagged: (TagState | null)[]; trainer: boolean[];
}
export interface FunnelTrader { name: string; tier: string | null; pilot: boolean; cells: FunnelCells; totals: Record<FunnelStep, number> }
export interface InactiveTrader { name: string; tier: string | null; pilot: boolean; lastSeen: string | null; missedDays: number; capped: boolean }
export interface UsageOverview {
  today: string;
  enabled: boolean;
  retentionDays: number;
  trackedSince: string | null;
  activity: ActivityPoint[];
  screens: { d7: UsageCount[]; d30: UsageCount[] };
  actions: { d7: UsageCount[]; d30: UsageCount[] };
  funnel: { days: string[]; traders: FunnelTrader[] };
  inactive: InactiveTrader[];
  pilot: { names: string[]; unknown: string[] };
}

export const USAGE_KEY = ["admin-console", "usage"] as const;

export function useUsageOverview(enabled: boolean) {
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: ({ signal }) => http.get<UsageOverview>("/api/admin/usage", { signal }),
    staleTime: STALE.default,
    enabled,
  });
}
