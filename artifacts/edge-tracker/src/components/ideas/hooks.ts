import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { screenshotUrlsToString } from "@/components/screenshot-fields";
import type { TradeIdeaFormData } from "@/components/trade-idea-form";
import { horizonOf, type IdeaComment, type TradeIdea, type TrackingResponse } from "./model";

export const IDEAS_KEY = ["trade-ideas"] as const;
export const TRACKING_KEY = ["trade-ideas", "tracking"] as const;

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.clone().json()) as { error?: string; message?: string };
    if (j?.error || j?.message) return String(j.error ?? j.message);
  } catch { /* not json */ }
  const t = await r.text().catch(() => "");
  return t || `HTTP ${r.status}`;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await readError(r));
  return r.json() as Promise<T>;
}

export async function sendJson<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json() as Promise<T>;
}

export function useIdeas() {
  return useQuery<TradeIdea[]>({
    queryKey: IDEAS_KEY,
    queryFn: () => fetchJson<TradeIdea[]>(`${BASE}/api/trade-ideas`),
  });
}

/** Live outcome tracking (price vs target/stop since publication). Refreshes every 2 minutes. */
export function useTracking(enabled: boolean) {
  return useQuery<TrackingResponse>({
    queryKey: TRACKING_KEY,
    queryFn: () => fetchJson<TrackingResponse>(`${BASE}/api/trade-ideas/tracking`),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
}

export function useIdeaComments(ideaId: number | null) {
  return useQuery<IdeaComment[]>({
    queryKey: ["idea-comments", ideaId],
    queryFn: () => fetchJson<IdeaComment[]>(`${BASE}/api/trade-ideas/${ideaId}/comments`),
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
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const create = useMutation({
    mutationFn: async ({ data, publish }: { data: TradeIdeaFormData; publish?: boolean }) => {
      const row = await sendJson<TradeIdea>(`${BASE}/api/trade-ideas`, "POST", { ...toPayload(data), status: "draft" });
      if (publish) await sendJson(`${BASE}/api/trade-ideas/${row.id}/publish`, "POST");
      return row;
    },
    onSuccess: (_r, v) => { invalidate(); toast({ title: v.publish ? "Идея опубликована" : "Черновик сохранён", description: v.publish ? "Кураторы получили уведомление" : undefined }); },
    onError: fail("Не удалось сохранить идею"),
  });

  const update = useMutation({
    mutationFn: async ({ id, data, publish }: { id: number; data: TradeIdeaFormData; publish?: boolean }) => {
      const row = await sendJson<TradeIdea>(`${BASE}/api/trade-ideas/${id}`, "PATCH", toPayload(data));
      if (publish) await sendJson(`${BASE}/api/trade-ideas/${id}/publish`, "POST");
      return row;
    },
    onSuccess: () => { invalidate(); toast({ title: "Изменения сохранены" }); },
    onError: fail("Ошибка сохранения"),
  });

  const publish = useMutation({
    mutationFn: (id: number) => sendJson(`${BASE}/api/trade-ideas/${id}/publish`, "POST"),
    onSuccess: () => { invalidate(); toast({ title: "Опубликовано", description: "Кураторы получили уведомление" }); },
    onError: fail("Ошибка публикации"),
  });

  const resubmit = useMutation({
    mutationFn: (id: number) => sendJson(`${BASE}/api/trade-ideas/${id}/resubmit`, "POST"),
    onSuccess: () => { invalidate(); toast({ title: "Отправлено на повторное ревью" }); },
    onError: fail("Не удалось отправить на ревью"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => sendJson(`${BASE}/api/trade-ideas/${id}`, "DELETE"),
    onSuccess: () => { invalidate(); toast({ title: "Идея удалена" }); },
    onError: fail("Ошибка удаления"),
  });

  const review = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: "approved" | "rejected" | "needs_work"; reason?: string }) =>
      sendJson(`${BASE}/api/trade-ideas/${id}/review`, "POST", { review_status: status, review_reason: reason || undefined }),
    onSuccess: (_r, v) => {
      invalidate();
      toast({ title: v.status === "approved" ? "Идея одобрена" : v.status === "rejected" ? "Идея отклонена" : "Отправлено на доработку" });
    },
    onError: fail("Не удалось сохранить ревью"),
  });

  const react = useMutation({
    mutationFn: ({ id, reaction, remove: rm }: { id: number; reaction?: string; remove?: boolean }) =>
      rm
        ? sendJson(`${BASE}/api/trade-ideas/${id}/reactions`, "DELETE")
        : sendJson(`${BASE}/api/trade-ideas/${id}/reactions`, "POST", { reaction }),
    onSuccess: invalidate,
    onError: fail("Не удалось сохранить реакцию"),
  });

  /** Opening an idea marks its notifications read; refresh the header bell (layout query keys). */
  const markRead = useMutation({
    mutationFn: (id: number) => sendJson(`${BASE}/api/notifications/read-idea/${id}`, "PATCH"),
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
