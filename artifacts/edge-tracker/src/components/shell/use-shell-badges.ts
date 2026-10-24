/**
 * Attention signals for the shell. Only things someone should act on:
 * - curator: days waiting for review (Кабинет куратора), open content reports (Админка);
 * - everyone: new discussions addressed to them, their own risk status (the sidebar «Сегодня» footer shows the
 *   numbers; the badge stays for the phone tab bar) — only on a trading day: no red dot on a weekend / holiday.
 * Each query is light, polls slowly, never in a background tab, and hides itself when the endpoint is missing.
 */
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { POLL, STALE } from "@/lib/api/keys";
import { riskMeQuery } from "@/lib/api/queries";
import { useAuth } from "@/contexts/auth-context";
import { shellI18n } from "@/i18n/ns/shell";
import { curatorApi, curatorKeys, type TodayPayload } from "@/components/curator/api";
import type { LiveInfo } from "@/components/shared/live-badge";
import { useMarketDay } from "./market-clock";

export type RiskStatus = "ok" | "warn" | "breach" | "no_limits";

export type NavBadge = { count?: number; tone: "down" | "warn" | "up"; label: string };

/** The signed-in person's day from GET /api/risk/me (P&L net, trades, daily stop usage). */
export type RiskToday = {
  status: RiskStatus;
  alerts: number;
  halted: boolean;
  /** Which stop halted the day (stop = daily, weekly, drawdown); null when not halted. */
  haltedBy: "stop" | "weekly" | "drawdown" | null;
  pnlNet: number | null;
  trades: number;
  /** 0…100+, null without a daily limit. */
  dailyUsedPct: number | null;
  dailyRemainingUsd: number | null;
  hasLimits: boolean;
  /** PropReports open-positions snapshot behind pnlNet (null without one today / on older servers). */
  live: LiveInfo | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** GET /api/risk/me answer → the few fields the shell shows; null when it has no status. */
function toRiskToday(raw: unknown): RiskToday | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const status = d?.status as RiskStatus | undefined;
  if (!status) return null;
  const limit = num(d?.limits?.dailyLossLimit ?? d?.dailyLossLimit);
  return {
    status,
    alerts: Array.isArray(d?.alerts) ? d.alerts.length : 0,
    halted: !!d?.halted,
    haltedBy: d?.halted && (d?.stop?.state === "weekly" || d?.stop?.state === "drawdown") ? d.stop.state : d?.halted ? "stop" : null,
    pnlNet: num(d?.today?.pnlNet),
    trades: num(d?.today?.trades) ?? 0,
    dailyUsedPct: limit ? num(d?.today?.dailyLimitUsedPct) : null,
    dailyRemainingUsd: limit ? num(d?.today?.dailyRemainingUsd) : null,
    hasLimits: !!limit,
    live: typeof d?.live?.fetchedAt === "string"
      ? { unrealizedUsd: num(d.live.unrealizedUsd) ?? 0, openPositions: num(d.live.openPositions) ?? 0, fetchedAt: d.live.fetchedAt, counted: d.live.counted === true }
      : null,
  };
}

/**
 * Shared by the badges and the sidebar footer — and with the dashboard / risk page: the same /api/risk/me cache entry
 * (lib/api/queries riskMeQuery, today's NY date). On an older server without the route the query errors and `data`
 * stays undefined, which hides the signal.
 */
export function useRiskToday() {
  const { user } = useAuth();
  const name = user && user.role !== "guest" ? user.traderName : null;
  const account = useHasRiskAccount();
  return useQuery({
    ...riskMeQuery(),
    select: toRiskToday,
    enabled: !!name && account.has,
    staleTime: STALE.short,
    refetchInterval: POLL.twoMinutes,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/**
 * Does the signed-in person have a trading account the risk desk tracks? Traders: yes. Staff (curator / admin): only
 * with their own limits row (GET /api/risk/limits/:me, one light row, cached) — so the shell never polls /api/risk/me
 * for a curator who does not trade, and /risk hides «Мой риск» for them. `known` = the answer has arrived.
 */
export function useHasRiskAccount(): { has: boolean; known: boolean } {
  const { user, isCurator } = useAuth();
  const name = user && user.role !== "guest" ? user.traderName : null;
  const q = useQuery({
    queryKey: ["shell", "risk-account", name],
    queryFn: ({ signal }) => http.get<unknown>(`/api/risk/limits/${encodeURIComponent(name!)}`, { signal }).catch(() => null),
    enabled: !!name && isCurator,
    staleTime: STALE.long,
    retry: false,
  });
  if (!name) return { has: false, known: true };
  if (!isCurator) return { has: true, known: true };
  return { has: !!q.data, known: !q.isPending };
}

/**
 * The curator badge = the cabinet's «Ждёт разбора» KPI: counts.reviews / reviewsOverdue (closed, not reviewed days in
 * the 14-day window); an older server without them → the review queue counts.
 */
export function shellQueueCounts(d: Pick<TodayPayload, "counts"> | null | undefined): { queue: number; overdue: number } | null {
  if (!d?.counts) return null;
  return { queue: (d.counts.reviews ?? d.counts.queue) || 0, overdue: (d.counts.reviewsOverdue ?? d.counts.queueOverdue) || 0 };
}

export function useShellBadges(): Record<string, NavBadge | undefined> {
  const { user, isCurator } = useAuth();
  const { t } = shellI18n.useT();
  const name = user && user.role !== "guest" ? user.traderName : null;

  const { data: reports } = useQuery<number>({
    queryKey: ["shell", "open-reports", name],
    queryFn: async ({ signal }) => {
      const d = await http.get<{ open?: unknown } | null>("/api/admin/reports/count", { query: { actor: name! }, signal }).catch(() => null);
      return typeof d?.open === "number" ? d.open : 0;
    },
    enabled: isCurator && !!name,
    refetchInterval: POLL.minute,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Curator review queue: same request (and cache entry) as the cabinet's «Сегодня» view, so opening the cabinet
  // after the badge costs nothing. Only counts are read here.
  const { data: queue } = useQuery<TodayPayload | null, Error, { queue: number; overdue: number } | null>({
    queryKey: curatorKeys.today("auto"),
    queryFn: () => curatorApi.today("auto"),
    select: shellQueueCounts,
    enabled: isCurator && !!name,
    staleTime: 60_000,
    refetchInterval: 180_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const { data: risk } = useRiskToday();
  // A stop is an alarm only on a trading day (the dashboard hero's rule): no red «Риск» dot on a weekend / holiday.
  const marketDay = useMarketDay();

  // Discussions: topics addressed to the viewer they have not opened yet (new in 7 days) + unread threads that mention them.
  // The server only counts threads the viewer is allowed to read (audience-filtered).
  const { data: disc } = useQuery<{ attention: number; mentions: number } | null>({
    queryKey: ["shell", "discussions-unread", name],
    queryFn: async ({ signal }) => {
      const d = await http.get<{ attention?: unknown; mentions?: unknown } | null>("/api/discussions/unread-count", { signal }).catch(() => null);
      if (typeof d?.attention !== "number") return null;
      return { attention: d.attention, mentions: typeof d.mentions === "number" ? d.mentions : 0 };
    },
    enabled: !!name,
    staleTime: STALE.default,
    refetchInterval: POLL.minute,
    refetchIntervalInBackground: false,
    retry: false,
  });

  return {
    "/curator":
      queue && queue.queue > 0
        ? {
            count: queue.queue,
            tone: queue.overdue > 0 ? "warn" : "up",
            label: queue.overdue > 0 ? t("badges.curatorOverdue", { count: queue.queue }) : t("badges.curatorQueue", { count: queue.queue }),
          }
        : undefined,
    "/discussions":
      disc && disc.attention > 0
        ? {
            count: disc.attention,
            tone: disc.mentions > 0 ? "warn" : "up",
            label: disc.mentions > 0
              ? t("badges.discussionsMentions", { count: disc.attention })
              : t("badges.discussionsNew", { count: disc.attention }),
          }
        : undefined,
    "/admin": reports && reports > 0 ? { count: reports, tone: "down", label: t("badges.openReports", { count: reports }) } : undefined,
    "/risk":
      marketDay.closed
        ? undefined
        : risk?.status === "breach"
          ? { tone: "down", label: t("badges.riskBreach"), count: risk.alerts || undefined }
          : risk?.status === "warn"
            ? { tone: "warn", label: t("badges.riskWarn") }
            : undefined,
  };
}
