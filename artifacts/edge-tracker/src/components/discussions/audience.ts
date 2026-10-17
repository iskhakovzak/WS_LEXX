/**
 * Discussions audience («Кому видна тема») — client mirror of api-server lib/discussionAudience.ts.
 *
 * A thread's `audience` is [] (everyone) or a union of tokens: trainee | junior | trader | senior (academy stage),
 * "staff" (curators/admins), "cohort:<id>". The server decides who reads what; this file only labels, counts and
 * filters what the server already returned.
 */
import { useQuery } from "@tanstack/react-query";
import { BASE } from "@/lib/api";

export type AudienceGroup = { token: string; label: string; kind: "stage" | "staff" | "cohort"; members: string[] };
export type AudienceViewerInfo = { name: string | null; stage: string | null; staff: boolean; moderator: boolean; cohorts: number[]; tokens: string[] };
export type AudienceOptions = {
  everyone: string[];
  moderators: string[];
  groups: AudienceGroup[];
  cohortLabels: Record<string, string>;
  viewer: AudienceViewerInfo;
};

export const STAGE_TOKENS = ["trainee", "junior", "trader", "senior"] as const;
/** Dative labels, same as the server. */
export const AUDIENCE_LABELS: Record<string, string> = {
  trainee: "Стажёрам", junior: "Джунам", trader: "Трейдерам", senior: "Сеньорам", staff: "Кураторам",
};

export const AUDIENCE_QUERY_KEY = ["discussions-audience"] as const;

export function useAudienceOptions(enabled = true) {
  return useQuery<AudienceOptions | null>({
    queryKey: AUDIENCE_QUERY_KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/discussions/audience`);
      if (!r.ok) return null;
      return (await r.json()) as AudienceOptions;
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function isRestricted(audience: readonly string[] | null | undefined): boolean {
  return !!audience && audience.length > 0;
}

export function tokenLabel(token: string, opts?: AudienceOptions | null): string {
  const m = /^cohort:(\d+)$/.exec(token);
  if (m) return opts?.cohortLabels?.[m[1]] ?? `Когорта #${m[1]}`;
  return AUDIENCE_LABELS[token] ?? token;
}

export function audienceText(audience: readonly string[] | null | undefined, opts?: AudienceOptions | null): string {
  if (!isRestricted(audience)) return "Всем";
  return audience!.map((t) => tokenLabel(t, opts)).join(", ");
}

/** Canonical order (stages → curators → cohorts), like the server. */
export function sortTokens(tokens: Iterable<string>): string[] {
  const rank = (t: string) => {
    const i = (STAGE_TOKENS as readonly string[]).indexOf(t);
    if (i >= 0) return i;
    if (t === "staff") return 10;
    const m = /^cohort:(\d+)$/.exec(t);
    return m ? 100 + Number(m[1]) : 1000;
  };
  return [...new Set(tokens)].sort((a, b) => rank(a) - rank(b));
}

/**
 * Who will read a thread with this audience, besides the author: members of the chosen groups and, for a
 * restricted thread, moderators (they see every thread). `names` = members only (moderators are shown apart).
 */
export function audienceReach(audience: readonly string[], opts: AudienceOptions | null | undefined, me: string | null): { count: number; names: string[]; moderators: string[] } | null {
  if (!opts) return null;
  if (!isRestricted(audience)) {
    const names = opts.everyone.filter((n) => n !== me);
    return { count: names.length, names, moderators: [] };
  }
  const names = new Set<string>();
  for (const g of opts.groups) if (audience.includes(g.token)) g.members.forEach((n) => names.add(n));
  names.delete(me ?? "");
  const moderators = opts.moderators.filter((n) => n !== me && !names.has(n));
  return { count: names.size + moderators.length, names: [...names].sort((a, b) => a.localeCompare(b, "ru")), moderators };
}

/** Restricted thread addressed to the viewer (their stage / curators / their cohort) — the «Для меня» tab. */
export function addressedToMe(audience: readonly string[] | null | undefined, opts: AudienceOptions | null | undefined): boolean {
  if (!isRestricted(audience) || !opts) return false;
  return opts.viewer.tokens.some((t) => audience!.includes(t));
}

export function peopleWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "человек";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "человека";
  return "человек";
}
