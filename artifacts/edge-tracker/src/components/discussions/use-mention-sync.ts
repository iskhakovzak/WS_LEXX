import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

/**
 * «Упоминания» in sync with the shell badge and the bell (OLGA-28): the shell polls /api/discussions/unread-count every
 * minute (same cache entry here) and learns about a new mention before the discussions list does — when it counts more
 * unread mentions than the list (`unreadMentions`; null = no server read state), the list is refetched once.
 */
export function useMentionSync(me: string | null, unreadMentions: number | null, refetch: () => unknown) {
  const { data } = useQuery<{ attention: number; mentions: number } | null>({
    queryKey: ["shell", "discussions-unread", me],
    queryFn: async ({ signal }) => {
      const d = await http.get<{ attention?: unknown; mentions?: unknown } | null>("/api/discussions/unread-count", { signal }).catch(() => null);
      if (typeof d?.attention !== "number") return null;
      return { attention: d.attention, mentions: typeof d.mentions === "number" ? d.mentions : 0 };
    },
    enabled: !!me,
    staleTime: STALE.default,
  });
  useEffect(() => {
    if (unreadMentions != null && data && data.mentions > unreadMentions) void refetch();
  }, [data, unreadMentions, refetch]);
}
