/**
 * Quests client (api-server routes/quests.ts): GET /api/quests/me, GET /api/quests/trader/:name (staff),
 * GET /api/quests/templates (curator catalog), POST /api/quests/assign, POST /api/quests/:id/cancel | complete;
 * achievements v2: GET /api/quests/catalog, POST /api/quests/achievements/seen, POST /api/quests/kudos, GET /api/quests/kudos/:name.
 * Texts travel as keys (rendered by the `quests` dictionaries), so a language switch needs no refetch.
 * 403 / a missing route → null: the role has no quests, or the API build does not have them yet.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { apiErrorStatus } from "@/lib/api/errors";
import { KEYS, POLL, STALE } from "@/lib/api/keys";
import { optimistic } from "@/hooks/optimistic";
import type { AchievementCatalogEntry, AssignQuestBody, Quest, QuestsMe, TextItem } from "@/lib/quests/types";

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

/** The curator marks a manual quest (curator_task) done — optimistic on the profile; the caller toasts the result. */
export function useCompleteQuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => http.post<unknown>(`/api/quests/${id}/complete`, {}),
    ...optimistic<number, QuestsMe | null>(qc, {
      queryKey: ["quests", "trader"],
      update: (me, id) => (me ? { ...me, quests: me.quests.map((x) => (x.id === id && x.status === "active" ? { ...x, status: "done", completedAt: new Date().toISOString() } : x)) } : me),
      invalidate: [questKeys.all, ["curator"]],
      onError: () => {},
    }),
  });
}

export function useCancelQuest() {
  const invalidate = useInvalidateQuests();
  return useMutation({
    mutationFn: (id: number) => http.post<unknown>(`/api/quests/${id}/cancel`, {}),
    onSuccess: invalidate,
  });
}

// ─── achievements v2: catalog, ceremony seen, kudos ─────────────────────────

export type CatalogResponse = { entries: AchievementCatalogEntry[]; kudosEnabled: boolean; enabled: boolean };

/** Every achievement line with its criteria (staff). */
export function useAchievementCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ["quests", "catalog"] as const,
    queryFn: ({ signal }) => orNull(http.get<CatalogResponse>("/api/quests/catalog", { signal })),
    enabled,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

/** Switches lines off / on: the desk setting achievements.disabled (admin, PUT /api/admin/settings). */
export function useSaveDisabledLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly string[]) => http.put("/api/admin/settings", { changes: [{ key: "achievements.disabled", value: [...ids].sort().join(",") }] }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["quests"] });
      void qc.invalidateQueries({ queryKey: ["admin-console", "desk-settings"] });
    },
  });
}

/** The viewer saw these ceremonies ("line|tier"). */
export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: readonly string[]) => http.post<{ ok: boolean }>("/api/quests/achievements/seen", { keys }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: questKeys.me() }),
  });
}

export type Kudos = { id: number; trader: string; author: string; day: string; tradeId: number | null; note: string | null; createdAt: string };

export function useKudos(trader: string | null) {
  return useQuery({
    queryKey: ["quests", "kudos", trader ?? ""] as const,
    queryFn: ({ signal }) => orNull(http.get<{ kudos: Kudos[] }>(`/api/quests/kudos/${enc(trader!)}`, { signal })),
    enabled: !!trader,
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}

type KudosBody = { trader: string; day: string; tradeId?: number | null; note?: string };

/** Optimistic: the kudos tops the trader's list at once (temporary negative id until the refetch). The caller toasts. */
export function useGiveKudos(author: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KudosBody) => http.post<{ ok: boolean; kudos: Kudos }>("/api/quests/kudos", body),
    ...optimistic<KudosBody, { kudos: Kudos[] } | null>(qc, {
      queryKey: (body) => ["quests", "kudos", body.trader],
      update: (cur, b) => (cur && author ? { ...cur, kudos: [{ id: -Date.now(), trader: b.trader, author, day: b.day, tradeId: b.tradeId ?? null, note: b.note ?? null, createdAt: new Date().toISOString() }, ...cur.kudos] } : cur),
      invalidate: (body) => [questKeys.trader(body.trader)],
      onError: () => {},
    }),
  });
}

export type DayTrade = { id: number; ticker: string; date: string; pnl: number | null };

/** The trader's trades of one NY day (kudos tied to a trade). */
export function useDayTrades(trader: string | null, day: string, next: string) {
  return useQuery({
    queryKey: ["quests", "dayTrades", trader ?? "", day, next] as const,
    queryFn: async ({ signal }) => {
      const rows = await orNull(http.get<DayTrade[]>(`/api/trades?trader=${enc(trader!)}&from=${day}&to=${next}&lite=1`, { signal }));
      return (rows ?? []).filter((t) => String(t.date).slice(0, 10) === day);
    },
    enabled: !!trader && /^\d{4}-\d{2}-\d{2}$/.test(day),
    retry: false,
    staleTime: STALE.default,
    meta: { i18n: false },
  });
}
