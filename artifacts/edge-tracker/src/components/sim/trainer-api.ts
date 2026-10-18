/**
 * «Тренажёр» API (server: api-server routes/trainer.ts, lib/trainer/*; shapes: lib/trainer/types.ts).
 *   GET  /api/trainer/home                → TrainerHome (the four mode cards + 30-day stats)
 *   GET  /api/trainer/daily               → DailyChallengeState (status, reveal, desk ranking)
 *   POST /api/trainer/daily/start         → a simulator Snapshot (played through /api/sim/games/:id/step)
 *   GET  /api/trainer/drill/next?setupId= → FindEntryDrill («Найди вход»)
 *   POST /api/trainer/drill/:id/answer    → FindEntryAnswer
 */
import { queryOptions } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { DailyChallengeState, FindEntryAnswer, FindEntryDrill, TrainerHome } from "@/lib/trainer/types";
import type { Snapshot } from "./api";

export const trainerKeys = {
  all: ["trainer"] as const,
  home: () => ["trainer", "home"] as const,
  daily: () => ["trainer", "daily"] as const,
};

/** Setup names come from the playbook as typed; numbers only otherwise — no refetch on a language switch. */
const meta = { i18n: false } as const;

export const trainerHomeQuery = () => queryOptions({
  queryKey: trainerKeys.home(),
  queryFn: () => http.get<TrainerHome>("/api/trainer/home"),
  staleTime: STALE.short,
  meta,
});

export const dailyQuery = () => queryOptions({
  queryKey: trainerKeys.daily(),
  queryFn: () => http.get<DailyChallengeState>("/api/trainer/daily"),
  staleTime: STALE.short,
  meta,
});

export const trainerApi = {
  dailyStart: () => http.post<Snapshot>("/api/trainer/daily/start", {}),
  drillNext: (setupId: number | null, opts?: { signal?: AbortSignal }) =>
    http.get<FindEntryDrill>(`/api/trainer/drill/next${setupId != null ? `?setupId=${setupId}` : ""}`, opts),
  drillAnswer: (id: number, body: { barIndex: number; price: number }) => http.post<FindEntryAnswer>(`/api/trainer/drill/${id}/answer`, body),
};

/** Ranking label → display: "t<n>" is a day alias («Трейдер N»), anything else is a stored name. */
export function aliasOf(label: string): number | null {
  const m = /^t(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

const WHAT_IF_PARAMS = ["r", "p", "trader"];

/** Where an old /simulator link goes: /trainer with the same query, or /what-if for the older «Что если» links. */
export function simulatorTarget(search: string, hash: string): string {
  const sp = new URLSearchParams(search);
  const whatIf = WHAT_IF_PARAMS.some((k) => sp.has(k)) || hash === "#fees";
  const q = sp.toString();
  return `${whatIf ? "/what-if" : "/trainer"}${q ? `?${q}` : ""}${whatIf ? hash : ""}`;
}
