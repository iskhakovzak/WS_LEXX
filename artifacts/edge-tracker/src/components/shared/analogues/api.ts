/**
 * Library of analogues (api routes/analogues.ts, lib/analogues/*): playbook cases, «похожие прошлые случаи» and the
 * academy quiz «на что похоже». queryOptions + mutations; keys start with "playbook" (cases) / "analogues".
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { Direction, Kind, Strength } from "@/components/shared/strategy/model";

export type Trait = "setup" | "kind" | "gap" | "gapNear" | "direction" | "strength" | "regime";
export type Profile = {
  ticker: string; day: string; setupId: number | null; kind: Kind | null; direction: Direction | null; strength: Strength | null;
  gapPct: number | null; regime: string | null;
};
export type Analogue = Profile & {
  key: string; source: "trade" | "example" | "case"; setupName: string | null; trades: number; wins: number; losses: number;
  avgR: number | null; caseId: number | null; note: string | null; score: number; matched: Trait[];
};
export type Weights = Record<"setup" | "kind" | "gap" | "direction" | "strength" | "regime", number>;
export type AnaloguesResponse = { query: Profile; analogues: Analogue[]; weights: Weights; bands: number[] };

export function analoguesQuery(ticker: string, day: string, setupId: number | null, enabled = true) {
  return queryOptions({
    queryKey: ["analogues", ticker, day, setupId] as const,
    queryFn: ({ signal }) => http.get<AnaloguesResponse>("/api/analogues", { query: { ticker, day, setupId: setupId ?? undefined }, signal }),
    staleTime: STALE.long,
    enabled,
  });
}

export type PlaybookCase = {
  id: number; playbookId: number; ticker: string; day: string; entryTime: string | null; exitTime: string | null;
  side: "long" | "short" | null; note: string | null; addedBy: string; createdAt: string;
};
export type CaseBody = { ticker: string; day: string; entryTime?: string | null; exitTime?: string | null; side?: "long" | "short" | null; note?: string | null };

const casesKey = (setupId: number) => ["playbook", "cases", setupId] as const;

export function casesQuery(setupId: number) {
  return queryOptions({
    queryKey: casesKey(setupId),
    queryFn: ({ signal }) => http.get<{ cases: PlaybookCase[]; canAdd: boolean }>(`/api/playbook/${setupId}/cases`, { signal }),
    staleTime: STALE.short,
  });
}

export function useCaseMutations(setupId: number) {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: casesKey(setupId) });
    void qc.invalidateQueries({ queryKey: ["analogues"] });
  };
  return {
    add: useMutation({ mutationFn: (b: CaseBody) => http.post<PlaybookCase>(`/api/playbook/${setupId}/cases`, b), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => http.del(`/api/playbook/${setupId}/cases/${id}`), onSuccess: done }),
  };
}

export type QuizBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type QuizQuestion = { ref: string; bars: QuizBar[]; entryAt: number | null; side: "long" | "short" | null; choices: { id: number; name: string }[] };
export type QuizAnswer = { correct: boolean; setup: { id: number; name: string }; ticker: string; day: string; note: string | null; entryTime: string | null; side: string | null };

export function quizQuery(round: number, exclude: readonly string[]) {
  return queryOptions({
    queryKey: ["analogues", "quiz", round] as const,
    queryFn: ({ signal }) => http.get<{ question: QuizQuestion | null }>("/api/academy/analogue-quiz", { query: { exclude: exclude.join(",") || undefined }, signal }),
    staleTime: Infinity,
  });
}

export const answerQuiz = (ref: string, setupId: number) => http.post<QuizAnswer>("/api/academy/analogue-quiz/answer", { ref, setupId });
