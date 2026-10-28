/**
 * GET /api/analyst-actions/signals (api routes/analyst-signals.ts): analyst clusters / big target changes that
 * suggest a STRONG catalyst for the plan day, with my watchlist / plan / mark flags. Keys start with "catalysts" so a
 * saved mark (shared/strategy useSaveMark) refreshes the block too.
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { Direction, Strength } from "@/components/shared/strategy/model";

export type SignalAct = { firm: string; at: string; kind: "up" | "down" | "init" | "ptUp" | "ptDown"; direction: Direction; targetPct: number | null };
export type StrengthSignal = {
  ticker: string; direction: Direction; strength: "strong"; reason: "cluster" | "target"; count: number; targetPct: number | null;
  firstAt: string; lastAt: string; acts: SignalAct[]; day: string;
  inWatchlist: boolean; inPlan: boolean; mark: { direction: Direction | null; strength: Strength | null } | null;
};
export type SignalsBoard = { day: string; opts: { clusterMin: number; windowHours: number; targetPct: number }; signals: StrengthSignal[] };

export function signalsQuery(date: string, enabled = true) {
  return queryOptions({
    queryKey: ["catalysts", "analyst-signals", date] as const,
    queryFn: ({ signal }) => http.get<SignalsBoard>("/api/analyst-actions/signals", { query: { date }, signal }),
    staleTime: STALE.short,
    enabled,
  });
}

/** Already marked strong in the signal's direction — nothing left to confirm. */
export const isConfirmed = (s: Pick<StrengthSignal, "mark" | "direction">) => s.mark?.strength === "strong" && s.mark.direction === s.direction;
