/**
 * The trader's day state (server lib/dayState, GET /api/me/state · /api/state/team · POST /api/state/message): types and
 * query factories shared by the dashboard (what it leads with), its team view (a state column) and the curator cabinet
 * («молчит N дней» + «Написать»). The state is computed on the server only; nothing here decides it.
 */
import { queryOptions } from "@tanstack/react-query";
import { nyDate } from "@/lib/trading-date";
import { http } from "@/lib/api/http";
import { POLL, STALE } from "@/lib/api/keys";

export type TraderStateKey = "stopped" | "paused" | "newcomer" | "premarket" | "session" | "after_session";
export type ClockState = "premarket" | "session" | "after_session";

export type TraderState = {
  trader: string;
  state: TraderStateKey;
  clock: ClockState;
  phase: "premarket" | "session" | "afterclose" | "closed";
  today: string;
  stop: { state: string } | null;
  lastTrade: { date: string; trades: number; pnl: number | null } | null;
  /** Trading days without trades since the last trade day (null = never traded). */
  silentDays: number | null;
  closedTrades: number;
  newcomer: { trades: number; target: number } | null;
  /** Own days without a closed review; `stale` of them are older than `freshFrom` (never «the next step»). */
  backlog: { count: number; stale: number; oldest: string | null; latest: string | null; freshFrom: string };
  thresholds: { pausedDays: number; newcomerTrades: number; staleStepDays: number };
};

export type TeamStates = { today: string | null; states: TraderState[] };

export const dayStateKeys = {
  me: (date: string) => ["day-state", "me", date] as const,
  team: (date: string) => ["day-state", "team", date] as const,
};

/** The viewer's own state; refreshed every few minutes (the clock moves premarket → session → after). */
export const traderStateQuery = (date: string = nyDate()) =>
  queryOptions({
    queryKey: dayStateKeys.me(date),
    queryFn: ({ signal }) => http.get<TraderState>("/api/me/state", { signal }),
    staleTime: STALE.default,
    refetchInterval: POLL.fiveMinutes,
    retry: false,
  });

/** Staff: the states of the traders in scope (403 for others — callers enable it for staff only). */
export const teamStatesQuery = (date: string = nyDate()) =>
  queryOptions({
    queryKey: dayStateKeys.team(date),
    queryFn: ({ signal }) => http.get<TeamStates>("/api/state/team", { signal }),
    staleTime: STALE.short,
    retry: false,
  });

/** «Написать»: an in-app message from the curator to the trader. */
export function sendTraderMessage(trader: string, text: string): Promise<{ ok: boolean; delivered: boolean }> {
  return http.post("/api/state/message", { trader, text });
}

/** Silent long enough to say so (the server's paused threshold), and not on a stop. */
export function isSilent(s: Pick<TraderState, "state" | "silentDays" | "lastTrade" | "thresholds">): boolean {
  return s.state !== "stopped" && !!s.lastTrade && s.silentDays != null && s.silentDays >= s.thresholds.pausedDays;
}

/** A day is still fit to be «the next step» (not older than the desk's staleStepDays trading days). */
export function freshDay(day: string | null | undefined, state: Pick<TraderState, "backlog"> | null | undefined): boolean {
  if (!day) return false;
  return !state || day.slice(0, 10) >= state.backlog.freshFrom;
}
