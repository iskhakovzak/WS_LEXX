// Data hooks of the playbook «Сегодня»: GET /api/playbook/today (shared cache entry, lib/api/queries), the ticking NY
// clock (with the dev `?ny=HH:MM` override) and PUT /api/playbook/today/picks.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { KEYS } from "@/lib/api/keys";
import { trackAction } from "@/lib/usage";
import { playbookTodayQuery } from "@/lib/api/queries";
import type { PlaybookToday, TodayPicksBody } from "@/lib/playbook-today/types";
import { nyNow, nyOverride } from "./today-model";

export function usePlaybookToday(enabled = true, trader?: string | null) {
  return useQuery({ ...playbookTodayQuery(trader), enabled, refetchOnWindowFocus: true });
}

/** The NY minute, ticking every 30 s: the server's minute at fetch + elapsed, or the dev override from the URL. */
export function useNyMinutes(today: PlaybookToday | null | undefined, fetchedAt: number): number | null {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const forced = typeof window !== "undefined" ? nyOverride(window.location.search, import.meta.env.DEV) : null;
  if (forced != null) return forced;
  if (!today) return null;
  return nyNow(today.nyMinutes, fetchedAt || tick, tick);
}

/** «Сегодня торгую» → the personal plan of today (doc.setups). The answer is the saved list. */
export function useSavePicks(date: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setupIds: number[]) => http.put<number[]>("/api/playbook/today/picks", { setupIds } satisfies TodayPicksBody),
    // Optimistic: a star on «Сегодня» saves at once, the plan cards follow without waiting; an error rolls back.
    onMutate: async (sent) => {
      await qc.cancelQueries({ queryKey: ["playbook-today"] });
      const prev = qc.getQueriesData<PlaybookToday | null>({ queryKey: ["playbook-today"] });
      qc.setQueriesData<PlaybookToday | null>({ queryKey: ["playbook-today"] }, (old) => (old && Array.isArray(old.picks) ? { ...old, picks: sent } : old));
      return { prev };
    },
    onError: (_e, _sent, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (picks, sent) => {
      trackAction("playbook.picks");
      const saved = Array.isArray(picks) ? picks : sent;
      qc.setQueriesData<PlaybookToday | null>({ queryKey: ["playbook-today"] }, (prev) => (prev ? { ...prev, picks: saved } : prev));
      if (date) void qc.invalidateQueries({ queryKey: KEYS.myPlan(date) });
      void qc.invalidateQueries({ queryKey: KEYS.questsMe() });
    },
  });
}
