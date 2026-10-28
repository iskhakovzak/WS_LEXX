/**
 * Optimistic cache writes for small, predictable actions (toggles, check-offs, read marks, pin, single-field edits):
 * the cache flips at click time, a failed write rolls back to the snapshot and says so, and the server answer is
 * always refetched afterwards. Spread into useMutation:
 *
 *   useMutation({ mutationFn, ...optimistic(qc, { queryKey, update }) })
 *
 * Not for outcomes the server decides (risk / stop / leak-guard, capital, PropReports, AI, auth, admin user actions,
 * deletes without an undo): those stay server-confirmed with a pending state on the button.
 *
 * A mutation with its own `onError` skips the global «Действие не выполнено» toast (App.tsx MutationCache), so the
 * rollback path shows the same toast itself unless the caller passes its own `onError`.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { humanizeApiError, isAuthError } from "@/lib/api/errors";
import { shellI18n } from "@/i18n/ns/shell";

/** What every matching cached query held before the optimistic write (restored on error). */
export type OptimisticSnapshot = ReadonlyArray<readonly [QueryKey, unknown]>;

type KeyOf<TVars> = QueryKey | ((vars: TVars) => QueryKey);

export interface OptimisticOptions<TVars, TData> {
  /** Cached queries to patch — prefix match, like invalidateQueries (every list variant under the key). */
  queryKey: KeyOf<TVars>;
  /** Pure: the next cache value. Never called for a query that has no data yet. */
  update: (old: TData, vars: TVars) => TData;
  /** More keys to refetch once the write settles (the patched key is always refetched). */
  invalidate?: readonly QueryKey[] | ((vars: TVars) => readonly QueryKey[]);
  /** Replaces the default error toast (after the rollback); pass `() => {}` when the call site toasts itself. */
  onError?: (error: Error, vars: TVars) => void;
}

/** The app-wide mutation error toast (same text as the MutationCache fallback; a 401 is handled by the auth context). */
export function toastMutationError(error: unknown, title?: string): void {
  if (isAuthError(error)) return;
  toast({ title: title ?? shellI18n.t("app.actionFailed"), description: humanizeApiError(error), variant: "destructive" });
}

/** Cancel in-flight reads of `queryKey`, snapshot every match, then write `update(old)` into each one that has data. */
export async function patchQueries<TData>(qc: QueryClient, queryKey: QueryKey, update: (old: TData) => TData): Promise<OptimisticSnapshot> {
  await qc.cancelQueries({ queryKey });
  const snapshot = qc.getQueriesData<TData>({ queryKey });
  qc.setQueriesData<TData>({ queryKey }, (old) => (old === undefined ? old : update(old)));
  return snapshot;
}

/** Put the snapshot back (the rollback of `patchQueries`). */
export function restoreQueries(qc: QueryClient, snapshot: OptimisticSnapshot | undefined): void {
  for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data);
}

const resolveKey = <TVars>(key: KeyOf<TVars>, vars: TVars): QueryKey => (typeof key === "function" ? key(vars) : key);

/** onMutate / onError / onSettled for one optimistic cache patch. */
export function optimistic<TVars, TData>(qc: QueryClient, o: OptimisticOptions<TVars, TData>) {
  return {
    onMutate: (vars: TVars): Promise<OptimisticSnapshot> => patchQueries<TData>(qc, resolveKey(o.queryKey, vars), (old) => o.update(old, vars)),
    onError: (error: Error, vars: TVars, snapshot: OptimisticSnapshot | undefined): void => {
      restoreQueries(qc, snapshot);
      if (o.onError) o.onError(error, vars);
      else toastMutationError(error);
    },
    // Fire-and-forget refetch: the cache already shows the result, so the button need not stay pending for it.
    // `never` (unused) keeps useMutation inferring its data type from mutationFn rather than from this callback.
    onSettled: (_data: never, _error: Error | null, vars: TVars): void => {
      const extra = typeof o.invalidate === "function" ? o.invalidate(vars) : (o.invalidate ?? []);
      for (const queryKey of [resolveKey(o.queryKey, vars), ...extra]) void qc.invalidateQueries({ queryKey });
    },
  };
}
