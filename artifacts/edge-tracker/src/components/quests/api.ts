/**
 * Quests client (api-server routes/quests.ts): GET /api/quests/me, GET /api/quests/trader/:name (staff),
 * GET /api/quests/templates (curator catalog), POST /api/quests/assign, POST /api/quests/:id/cancel | complete.
 * Texts travel as keys (rendered by the `quests` dictionaries), so a language switch needs no refetch.
 * 403 / a missing route → null: the role has no quests, or the API build does not have them yet.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { apiErrorStatus } from "@/lib/api/errors";
import { KEYS, POLL, STALE } from "@/lib/api/keys";
import type { AssignQuestBody, Quest, QuestsMe, TextItem } from "@/lib/quests/types";

export const questKeys = {
  all: ["quests"] as const,
  me: KEYS.questsMe,
  trader: (name: string) => ["quests", "trader", name] as const,
  templates: () => ["quests", "templates"] as const,
};

const enc = encodeURIComponent;

/** 403 (no quests for this role) and 404 (route not deployed yet) read as «nothing to show». */
function orNull<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    const s = apiErrorStatus(e);
    if (s === 403 || s === 404) return null;
    throw e;
  });
}

/** The viewer's quests and achievements: dashboard strip + «Квесты и достижения» tab share one cache entry. */
export function useQuestsMe(enabled = true) {
  return useQuery({
    queryKey: questKeys.me(),
    queryFn: ({ signal }) => orNull(http.get<QuestsMe>("/api/quests/me", { signal })),
    enabled,
    retry: false,
    staleTime: STALE.default,
    refetchOnWindowFocus: true,
    refetchInterval: POLL.fiveMinutes,
    meta: { i18n: false },
  });
}

/** One trader's quests and achievements for the curator profile. */
export function useTraderQuests(trader: string | null) {
  return useQuery({
    queryKey: questKeys.trader(trader ?? ""),
    queryFn: ({ signal }) => orNull(http.get<QuestsMe>(`/api/quests/trader/${enc(trader!)}`, { signal })),
    enabled: !!trader,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

/** A curator-assignable template: plain-language text, target bounds and the default reward from the settings. */
export type QuestTemplate = {
  template: string;
  title?: TextItem;
  description?: TextItem;
  unit: "days" | "count";
  defaultTarget: number;
  minTarget: number;
  maxTarget: number;
  defaultPoints: number;
};

/** Used until the API serves GET /api/quests/templates (then its catalog and the settings' points win). */
export const FALLBACK_TEMPLATES: readonly QuestTemplate[] = [
  { template: "contract_days", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 },
  { template: "focus_absent_days", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 },
  { template: "review_days", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 },
  { template: "plan_days", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 },
  { template: "replay_own_days", unit: "count", defaultTarget: 3, minTarget: 1, maxTarget: 50, defaultPoints: 10 },
  { template: "beat_yourself", unit: "count", defaultTarget: 2, minTarget: 1, maxTarget: 50, defaultPoints: 10 },
  { template: "read_game_plan", unit: "days", defaultTarget: 5, minTarget: 1, maxTarget: 60, defaultPoints: 10 },
  { template: "curator_task", unit: "count", defaultTarget: 1, minTarget: 1, maxTarget: 1, defaultPoints: 10 },
];

/** The manual template: the curator's note is the task, the curator marks it done (POST /api/quests/:id/complete). */
export const MANUAL_TEMPLATE = "curator_task";

export function useQuestTemplates(enabled: boolean) {
  return useQuery({
    queryKey: questKeys.templates(),
    queryFn: async ({ signal }) => {
      const r = await orNull(http.get<{ templates: QuestTemplate[]; maxPoints?: number; maxDeadlineDays?: number }>("/api/quests/templates", { signal }));
      return { templates: r?.templates?.length ? r.templates : FALLBACK_TEMPLATES, maxPoints: r?.maxPoints ?? null, maxDeadlineDays: r?.maxDeadlineDays ?? null };
    },
    enabled,
    retry: false,
    staleTime: STALE.long,
    meta: { i18n: false },
  });
}

function useInvalidateQuests() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: questKeys.all });
    void qc.invalidateQueries({ queryKey: ["curator"] });
  };
}

export function useAssignQuest() {
  const invalidate = useInvalidateQuests();
  return useMutation({
    mutationFn: (b: AssignQuestBody) => http.post<Quest | { quest: Quest }>("/api/quests/assign", b),
    onSuccess: invalidate,
  });
}

/** The curator marks a manual quest (curator_task) done. */
export function useCompleteQuest() {
  const invalidate = useInvalidateQuests();
  return useMutation({
    mutationFn: (id: number) => http.post<unknown>(`/api/quests/${id}/complete`, {}),
    onSuccess: invalidate,
  });
}

export function useCancelQuest() {
  const invalidate = useInvalidateQuests();
  return useMutation({
    mutationFn: (id: number) => http.post<unknown>(`/api/quests/${id}/cancel`, {}),
    onSuccess: invalidate,
  });
}
