/**
 * Briefing video library (api routes/academy-briefings.ts): queryOptions + mutations. Keys start with
 * "academy-content" so the lesson progress mutations of the academy refresh the library too.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { VideoEmbed } from "./content/api";

export type Briefing = {
  lessonId: number; title: string; summary: string | null; tags: string[]; mustWatch: boolean; setups: { id: number; name: string }[];
  video: VideoEmbed | null; videoUrl: string | null; mediaId: number | null; mediaLink: string | null; durationMin: number | null;
  createdBy: string | null; createdAt: string; watched: boolean;
};
export type WatchRow = { lessonId: number; juniors: number; watched: number; missing: string[] };
export type BriefingsPage = { items: Briefing[]; tags: { tag: string; count: number }[]; mustWatchLeft: number; canAdd: boolean; progress: WatchRow[] | null };
export type BriefingBody = {
  title: string; summary?: string | null; tags: string[]; playbookIds: number[]; mustWatch: boolean;
  videoUrl?: string | null; mediaId?: number | null; durationMin?: number | null;
};

export const MEDIA_MAX_MB = 25;
const key = (tag: string | null) => ["academy-content", "briefings", tag] as const;

export const briefingsQuery = (tag: string | null) => queryOptions({
  queryKey: key(tag),
  queryFn: ({ signal }) => http.get<BriefingsPage>("/api/academy/briefings", { query: { tag: tag ?? undefined }, signal }),
  staleTime: STALE.short,
});

export const mediaUrlQuery = (id: number) => queryOptions({
  queryKey: ["academy-content", "briefing-media", id] as const,
  queryFn: ({ signal }) => http.get<{ url: string }>(`/api/academy/briefings/media/${id}/url`, { signal }),
  staleTime: 5 * 60_000, // the token lives 10 minutes
});

export function useBriefingMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["academy-content", "briefings"] });
  return {
    upload: useMutation({
      mutationFn: (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        return http.post<{ id: number }>("/api/academy/briefings/media", fd);
      },
    }),
    create: useMutation({ mutationFn: (b: BriefingBody) => http.post<{ lessonId: number }>("/api/academy/briefings", b), onSuccess: done }),
    watched: useMutation({
      mutationFn: (x: { lessonId: number; completed: boolean }) => http.post(`/api/academy/content/lessons/${x.lessonId}/progress`, { completed: x.completed }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ["academy-content"] }),
    }),
  };
}
