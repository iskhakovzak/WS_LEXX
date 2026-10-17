import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { KEYS, POLL, STALE } from "@/lib/api/keys";
import { tradeIdeasQuery } from "@/lib/api/queries";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { screenshotUrlsToString } from "@/components/screenshot-fields";
import type { TradeIdeaFormData } from "@/components/trade-idea-form";
import { horizonOf, type IdeaComment, type TradeIdea, type TrackingResponse } from "./model";

/** GET /api/trade-ideas — one key for the ideas page, stats, ratings and global search (lib/api/queries). */
export const IDEAS_KEY = KEYS.tradeIdeas();
export const TRACKING_KEY = ["trade-ideas", "tracking"] as const;

/** All ideas (shared cache entry, see `tradeIdeasQuery`). */
export const ideasQuery = () => tradeIdeasQuery<TradeIdea>();

export function useIdeas() {
  return useQuery(ideasQuery());
}

/** Live outcome tracking (price vs target/stop since publication). Refreshes every 2 minutes. */
export function useTracking(enabled: boolean) {
  return useQuery<TrackingResponse>({
    queryKey: TRACKING_KEY,
    queryFn: ({ signal }) => http.get<TrackingResponse>("/api/trade-ideas/tracking", { signal }),
    enabled,
    staleTime: STALE.short,
    refetchInterval: POLL.twoMinutes,
    retry: 1,
  });
}

export function useIdeaComments(ideaId: number | null) {
  return useQuery<IdeaComment[]>({
    queryKey: ["idea-comments", ideaId],
    queryFn: ({ signal }) => http.get<IdeaComment[]>(`/api/trade-ideas/${ideaId}/comments`, { signal }),
    enabled: ideaId != null,
  });
}

export function toPayload(data: TradeIdeaFormData) {
  const { screenshotUrls, ...rest } = data;
  return {
    ...rest,
    screenshotUrl: screenshotUrlsToString(screenshotUrls) || null,
    score: data.score ? Number(data.score) : null,
    // Dedicated columns; the horizon tag is kept in sync by the form for legacy filters.
    horizon: data.horizon ?? horizonOf(data.tags) ?? null,
    validUntil: data.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(data.validUntil) ? data.validUntil : null,
  };
}

/** All write operations for the ideas page. Each invalidates the shared ["trade-ideas"] key (stats page too). */
export function useIdeaMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: IDEAS_KEY });
  const fail = (title: string) => (e: Error) => toast({ title, description: humanizeApiError(e), variant: "destructive" });

  const create = useMutation({
    mutationFn: async ({ data, publish }: { data: TradeIdeaFormData; publish?: boolean }) => {
      const row = await http.post<TradeIdea>("/api/trade-ideas", { ...toPayload(data), status: "draft" });
      if (publish) await http.post(`/api/trade-ideas/${row.id}/publish`);
      return row;
    },
    onSuccess: (_r, v) => { invalidate(); toast({ title: v.publish ? "Идея опубликована" : "Черновик сохранён", description: v.publish ? "Кураторы получили уведомление" : undefined }); },
    onError: fail("Не удалось сохранить идею"),
  });

  const update = useMutation({
    mutationFn: async ({ id, data, publish }: { id: number; data: TradeIdeaFormData; publish?: boolean }) => {
      const row = await http.patch<TradeIdea>(`/api/trade-ideas/${id}`, toPayload(data));
      if (publish) await http.post(`/api/trade-ideas/${id}/publish`);
      return row;
    },
    onSuccess: () => { invalidate(); toast({ title: "Изменения сохранены" }); },
    onError: fail("Ошибка сохранения"),
  });

  const publish = useMutation({
    mutationFn: (id: number) => http.post(`/api/trade-ideas/${id}/publish`),
    onSuccess: () => { invalidate(); toast({ title: "Опубликовано", description: "Кураторы получили уведомление" }); },
    onError: fail("Ошибка публикации"),
  });

  const resubmit = useMutation({
    mutationFn: (id: number) => http.post(`/api/trade-ideas/${id}/resubmit`),
    onSuccess: () => { invalidate(); toast({ title: "Отправлено на повторное ревью" }); },
    onError: fail("Не удалось отправить на ревью"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => http.del(`/api/trade-ideas/${id}`),
    // The page shows an undo toast («Идея … удалена · Отменить»), so no second toast here.
    onSuccess: () => { invalidate(); },
    onError: fail("Ошибка удаления"),
  });

  const review = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: "approved" | "rejected" | "needs_work"; reason?: string }) =>
      http.post(`/api/trade-ideas/${id}/review`, { review_status: status, review_reason: reason || undefined }),
    onSuccess: (_r, v) => {
      invalidate();
      toast({ title: v.status === "approved" ? "Идея одобрена" : v.status === "rejected" ? "Идея отклонена" : "Отправлено на доработку" });
    },
    onError: fail("Не удалось сохранить ревью"),
  });

  const react = useMutation({
    mutationFn: ({ id, reaction, remove: rm }: { id: number; reaction?: string; remove?: boolean }) =>
      rm
        ? http.del(`/api/trade-ideas/${id}/reactions`)
        : http.post(`/api/trade-ideas/${id}/reactions`, { reaction }),
    onSuccess: invalidate,
    onError: fail("Не удалось сохранить реакцию"),
  });

  /** Opening an idea marks its notifications read; refresh the header bell (layout query keys). */
  const markRead = useMutation({
    mutationFn: (id: number) => http.patch(`/api/notifications/read-idea/${id}`),
    onSuccess: () => {
      invalidate();
      if (user?.traderName) {
        qc.invalidateQueries({ queryKey: ["notifications-count", user.traderName] });
        qc.invalidateQueries({ queryKey: ["notifications", user.traderName] });
      }
    },
  });

  return { create, update, publish, resubmit, remove, review, react, markRead };
}
