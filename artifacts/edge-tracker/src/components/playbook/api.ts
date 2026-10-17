/** Data hooks + request helper for the playbook page. Query keys are shared with other pages — keep them stable. */
import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { BASE } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import type {
  ActivityItem, FolderSetting, PickerTrade, PlaybookEntry, SetupExample, SetupStats, SetupSummary, ViewerLike,
} from "./model";

export class ApiError extends Error {
  status: number;
  code?: string;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.code = data?.code;
    this.data = data;
  }
}

/** fetch + JSON + readable error (server `error` field when present). */
export async function pbRequest<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data?.error ?? `HTTP ${r.status}`, r.status, data);
  return data as T;
}

export function usePlaybookEntries() {
  return useQuery<PlaybookEntry[]>({
    queryKey: ["playbook"],
    queryFn: () => pbRequest<PlaybookEntry[]>("/api/playbook"),
    // ~300 KB: don't refetch on every visit; every write invalidates this key anyway.
    staleTime: 30_000,
  });
}

/** Trader sees their own trades' edge; curators see the whole team. */
export function useUserKey(): string | null {
  const { user } = useAuth();
  return user?.role === "trader" && user.traderName ? user.traderName : null;
}

/**
 * Per-setup aggregates. Optional: an older API build without /summary just yields an empty map,
 * so the page keeps working (no edge badges) instead of failing.
 */
export function usePlaybookSummary() {
  const userKey = useUserKey();
  const qs = userKey ? `?userKey=${encodeURIComponent(userKey)}` : "";
  const q = useQuery<SetupSummary[]>({
    queryKey: ["playbook-summary", userKey],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook/summary${qs}`);
      if (!r.ok) throw new Error(`summary ${r.status}`); // keeps isSuccess=false so the UI shows "—" instead of fake zeros
      const j = await r.json().catch(() => []);
      return Array.isArray(j) ? j : [];
    },
    staleTime: 30_000,
    retry: 1,
  });
  const map = useMemo(() => new Map((q.data ?? []).map((s) => [s.id, s])), [q.data]);
  return { ...q, map };
}

export function useFolderSettings() {
  return useQuery<FolderSetting[]>({
    queryKey: ["playbook-folder-settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook/folder-settings`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    staleTime: 30_000,
  });
}

export function usePlaybookActivity(enabled: boolean) {
  return useQuery<ActivityItem[]>({
    queryKey: ["playbook-activity"],
    queryFn: async () => {
      const all = await pbRequest<any[]>("/api/activity");
      return (Array.isArray(all) ? all : []).filter((a: any) => a.section === "playbook").slice(0, 40);
    },
    staleTime: 30_000,
    enabled,
  });
}

/** Everything that depends on playbook rows / their trade links. */
export function invalidatePlaybook(qc: QueryClient, id?: number) {
  qc.invalidateQueries({ queryKey: ["playbook"] });
  qc.invalidateQueries({ queryKey: ["playbook-children"] });
  qc.invalidateQueries({ queryKey: ["playbook-summary"] });
  qc.invalidateQueries({ queryKey: ["playbook-activity"] });
  qc.invalidateQueries({ queryKey: ["playbook-health"] });
  qc.invalidateQueries({ queryKey: ["playbook-tags"] });
  qc.invalidateQueries({ queryKey: ["playbook-folder-settings"] });
  if (id != null) {
    qc.invalidateQueries({ queryKey: ["playbook-revisions", id] });
    qc.invalidateQueries({ queryKey: ["playbook-trades", id] });
  }
}

export function invalidateTradeLinks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["all-trades-for-link"] });
  qc.invalidateQueries({ queryKey: ["playbook-trade-picker"] });
  qc.invalidateQueries({ queryKey: ["all-playbook-trades-stats"] });
  qc.invalidateQueries({ queryKey: ["playbook-edge"] });
  qc.invalidateQueries({ queryKey: ["playbook-health"] });
  qc.invalidateQueries({ queryKey: ["playbook-trades"] });
  qc.invalidateQueries({ queryKey: ["playbook-summary"] });
}

/* ───────────────────────── spaces · examples · stats (routes/playbook-spaces.ts) ───────────────────────── */

export type PlaybookMe = {
  name: string | null; guest: boolean; mayShare: boolean; editOwn: boolean; editAny: boolean; review: boolean;
  stage: string | null; cohorts: number[]; teamWide: boolean;
};

/** GET /api/playbook/me — null on an older API (404), so callers fall back to role-based rules. */
export function usePlaybookMe() {
  return useQuery<PlaybookMe | null>({
    queryKey: ["playbook-me"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/playbook/me`);
      if (!r.ok) return null;
      return (await r.json().catch(() => null)) as PlaybookMe | null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Viewer for accessOf(): session role + server capabilities when the new API answers. */
export function usePlaybookViewer(): ViewerLike & { mayShare: boolean; live: boolean } {
  const { user, canEdit, isCurator } = useAuth();
  const me = usePlaybookMe().data ?? null;
  return useMemo(
    () => ({
      name: me?.name ?? (user?.role !== "guest" ? user?.traderName ?? null : null),
      canEdit: me ? me.editOwn || me.editAny : canEdit,
      isCurator: me ? me.editAny || me.review : isCurator,
      isSenior: me?.stage === "senior",
      mayShare: me?.mayShare ?? isCurator,
      live: !!me,
    }),
    [me, user, canEdit, isCurator],
  );
}

/** 404 from a route that only exists after the API restart → a readable message. */
export function notLiveMessage(e: unknown): string | null {
  return e instanceof ApiError && e.status === 404 && !e.data?.error ? "Функция включится после обновления сервера" : null;
}

export function useSetupExamples(id: number | null, enabled = true) {
  return useQuery<SetupExample[]>({
    queryKey: ["playbook-examples", id],
    queryFn: () => pbRequest<SetupExample[]>(`/api/playbook/${id}/examples`),
    enabled: !!id && enabled,
    staleTime: 15_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
}

export type GalleryFilter = {
  tier?: number; setupId?: number | null; trader?: string | null; space?: string | null; limit?: number;
  /** Close date range, YYYY-MM-DD (inclusive). */
  from?: string | null; to?: string | null;
};
export function useGallery(f: GalleryFilter, enabled = true) {
  const qs = new URLSearchParams();
  if (f.tier) qs.set("tier", String(f.tier));
  if (f.setupId) qs.set("setupId", String(f.setupId));
  if (f.trader) qs.set("trader", f.trader);
  if (f.space) qs.set("space", f.space);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  qs.set("limit", String(f.limit ?? 120));
  const s = qs.toString();
  return useQuery<SetupExample[]>({
    queryKey: ["playbook-gallery", s],
    queryFn: () => pbRequest<SetupExample[]>(`/api/playbook-tools/gallery?${s}`),
    enabled,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
}

export type PickerFilter = { setupId: number; trader?: string | null; q?: string; from?: string; to?: string; result?: "" | "win" | "loss"; match?: boolean };
export type PickerResponse = { trader: string | null; setup: { id: number; name: string } | null; trades: PickerTrade[]; truncated: boolean };
export function useTradePicker(f: PickerFilter, enabled: boolean) {
  const qs = new URLSearchParams({ setupId: String(f.setupId), limit: "300" });
  if (f.trader) qs.set("trader", f.trader);
  if (f.q?.trim()) qs.set("q", f.q.trim());
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.result) qs.set("result", f.result);
  if (f.match) qs.set("match", "1");
  const s = qs.toString();
  return useQuery<PickerResponse>({
    queryKey: ["playbook-trade-picker", s],
    queryFn: () => pbRequest<PickerResponse>(`/api/playbook-tools/trade-picker?${s}`),
    enabled,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
}

export function useSetupStats(id: number | null, enabled = true) {
  const userKey = useUserKey();
  return useQuery<SetupStats>({
    queryKey: ["playbook-stats", id, userKey],
    queryFn: () => pbRequest<SetupStats>(`/api/playbook/${id}/stats${userKey ? `?userKey=${encodeURIComponent(userKey)}` : ""}`),
    enabled: !!id && enabled,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
}

export type ShareTargets = { users: { name: string; role: string }[]; cohorts: { id: number; name: string; members: number }[] };
export function useShareTargets(enabled: boolean) {
  return useQuery<ShareTargets>({
    queryKey: ["playbook-share-targets"],
    queryFn: () => pbRequest<ShareTargets>("/api/playbook-tools/share-targets"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** After any example change. */
export function invalidateExamples(qc: QueryClient, ...ids: (number | null | undefined)[]) {
  for (const id of ids) if (id != null) qc.invalidateQueries({ queryKey: ["playbook-examples", id] });
  if (!ids.length) qc.invalidateQueries({ queryKey: ["playbook-examples"] });
  qc.invalidateQueries({ queryKey: ["playbook-gallery"] });
  qc.invalidateQueries({ queryKey: ["playbook-trade-picker"] });
  qc.invalidateQueries({ queryKey: ["playbook-summary"] });
  qc.invalidateQueries({ queryKey: ["playbook-health"] });
  qc.invalidateQueries({ queryKey: ["playbook-for-trade"] });
  qc.invalidateQueries({ queryKey: ["playbook-stats"] });
  qc.invalidateQueries({ queryKey: ["playbook-inbox"] });
}

/* ───────────────────────── inbox: own recent trades without an example ───────────────────────── */

export type InboxTrade = {
  id: number; ticker: string; date: string; closeDate: string | null; side: string | null; result: string | null;
  netPnl: number | null; signedR: number | null; horizon: string | null; trader: string | null; setup: string | null;
  playbookId: number | null; playbookName: string | null; autoSetup: string | null;
  suggestion: { id: number; name: string; reason: string; via: "linked" | "auto" | "text" } | null;
  suggestedTier: 1 | 2 | 3;
  redacted?: boolean;
};
export type InboxResponse = { trader: string | null; days: number; total: number; trades: InboxTrade[] };

/** GET /api/playbook-tools/inbox — null on an older API (404) so the home hides the block. */
export function usePlaybookInbox(days = 14, enabled = true) {
  return useQuery<InboxResponse | null>({
    queryKey: ["playbook-inbox", days],
    queryFn: async () => {
      try {
        return await pbRequest<InboxResponse>(`/api/playbook-tools/inbox?days=${days}&limit=40`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
