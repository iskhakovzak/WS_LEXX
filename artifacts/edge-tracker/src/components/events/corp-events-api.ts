/**
 * Corporate and index events (api routes/corp-events.ts, lib/corpEvents/*): queryOptions + mutations. Keys start with
 * "events" so the page's own invalidations reach them.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";

export const CORP_TYPES = ["lockup_expiry", "sp_add", "sp_remove", "index_rebalance", "quad_witching", "spinoff", "pricing", "offering", "ipo"] as const;
export type CorpType = (typeof CORP_TYPES)[number];
export const INDEX_CODES = ["sp500", "sp400", "sp600", "msci", "russell", "nasdaq100", "other"] as const;
export type IndexCode = (typeof INDEX_CODES)[number];
/** Types a curator enters by hand (quad witching and the scheduled rebalances come by rule). */
export const MANUAL_TYPES: readonly CorpType[] = ["sp_add", "sp_remove", "index_rebalance", "lockup_expiry", "spinoff", "pricing", "offering", "ipo"];

export type CorpEvent = {
  key: string; id: number | null; day: string; type: CorpType; ticker: string | null; indexCode: IndexCode | null;
  source: "manual" | "rule" | "offerings" | "news";
  rule: "quad_witching" | "sp_quarterly" | "msci_quarterly" | "msci_semiannual" | "ndx_annual" | null;
  estimated: boolean; note: string | null; setup: { id: number; name: string } | null; createdBy: string | null;
};
export type CorpCalendar = { from: string; to: string; events: CorpEvent[]; typeSetups: Partial<Record<CorpType, { id: number; name: string }>>; canEdit: boolean };
export type CorpBody = { day: string; type: CorpType; ticker?: string | null; indexCode?: IndexCode | null; note?: string | null };

const corpKey = ["events", "corp"] as const;

export function corpEventsQuery(from: string) {
  return queryOptions({
    queryKey: [...corpKey, from] as const,
    queryFn: ({ signal }) => http.get<CorpCalendar>("/api/corp-events", { query: { from }, signal }),
    staleTime: STALE.long,
  });
}

export function useCorpMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: corpKey });
  return {
    create: useMutation({ mutationFn: (b: CorpBody) => http.post<{ id: number }>("/api/corp-events", b), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: CorpBody & { id: number }) => http.patch(`/api/corp-events/${id}`, b), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => http.del(`/api/corp-events/${id}`), onSuccess: done }),
    setSetup: useMutation({
      mutationFn: (x: { type: CorpType; playbookId: number | null }) => http.put(`/api/corp-events/type-setups/${x.type}`, { playbookId: x.playbookId }),
      onSuccess: done,
    }),
  };
}

/** Office setups (top level) a type can point at. */
export type SetupOption = { id: number; name: string };
export function officeSetupsQuery(enabled: boolean) {
  return queryOptions({
    queryKey: ["playbook", "corp-event-setups"] as const,
    queryFn: ({ signal }) => http.get<{ id: number; name: string; parentId?: number | null; space?: string | null; trader?: string | null }[]>("/api/playbook", { signal })
      .then((rows) => rows.filter((r) => !r.parentId && (r.space === "office" || !r.trader)).map((r) => ({ id: r.id, name: r.name }))),
    staleTime: STALE.long,
    enabled,
  });
}
