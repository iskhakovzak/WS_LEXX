/** Attention badges for nav items: curator open reports, the trader's own risk status, new discussions for the viewer. */
import { useQuery } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

export type RiskStatus = "ok" | "warn" | "breach" | "no_limits";

export type NavBadge = { count?: number; tone: "down" | "warn" | "up"; label: string };

export function useShellBadges(): Record<string, NavBadge | undefined> {
  const { user, isCurator } = useAuth();
  const name = user && user.role !== "guest" ? user.traderName : null;

  const { data: reports } = useQuery<number>({
    queryKey: ["shell", "open-reports", name],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/admin/reports/count?actor=${encodeURIComponent(name!)}`);
      if (!r.ok) return 0;
      const d = await r.json();
      return typeof d?.open === "number" ? d.open : 0;
    },
    enabled: isCurator && !!name,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // /api/risk/me may not exist on older servers: any non-OK answer just hides the dot.
  const { data: risk } = useQuery<{ status: RiskStatus; alerts: number } | null>({
    queryKey: ["shell", "risk-status", name],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/risk/me`);
      if (!r.ok) return null;
      const d = await r.json().catch(() => null);
      const status = d?.status as RiskStatus | undefined;
      if (!status) return null;
      return { status, alerts: Array.isArray(d?.alerts) ? d.alerts.length : 0 };
    },
    enabled: !!name,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Discussions: topics addressed to the viewer they have not opened yet (new in 7 days) + unread threads that mention them.
  // The server only counts threads the viewer is allowed to read (audience-filtered).
  const { data: disc } = useQuery<{ attention: number; mentions: number } | null>({
    queryKey: ["shell", "discussions-unread", name],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/discussions/unread-count`);
      if (!r.ok) return null;
      const d = await r.json().catch(() => null);
      if (typeof d?.attention !== "number") return null;
      return { attention: d.attention, mentions: typeof d.mentions === "number" ? d.mentions : 0 };
    },
    enabled: !!name,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  return {
    "/discussions":
      disc && disc.attention > 0
        ? {
            count: disc.attention,
            tone: disc.mentions > 0 ? "warn" : "up",
            label: disc.mentions > 0
              ? `Обсуждения: ${disc.attention} новых для вас, есть упоминания`
              : `Обсуждения: ${disc.attention} новых тем для вас`,
          }
        : undefined,
    "/admin": reports && reports > 0 ? { count: reports, tone: "down", label: `${reports} открытых жалоб` } : undefined,
    "/risk":
      risk?.status === "breach"
        ? { tone: "down", label: "Лимит риска превышен", count: risk.alerts || undefined }
        : risk?.status === "warn"
          ? { tone: "warn", label: "Близко к лимиту риска" }
          : undefined,
  };
}
