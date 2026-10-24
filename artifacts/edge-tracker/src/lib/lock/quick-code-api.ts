/**
 * Quick-unlock code («код быстрого входа») — GET / PUT / DELETE /api/auth/quick-code (api-server routes/screen-lock.ts).
 * The code is hashed on the server and never comes back: the client only learns whether one is set and its kind.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import type { QuickCodeKind } from "./lock-model";

export type QuickCodeStatus = { set: boolean; kind: QuickCodeKind | null; setAt: string | null };

export const QUICK_CODE_KEY = ["auth", "quick-code"] as const;

/** Client copy of the server rule (api-server lib/security/screenLock quickCodeKind): 4–8 digits or a 6–32 char phrase. */
export function quickCodeKind(code: string): QuickCodeKind | null {
  const v = code.normalize("NFC");
  if (/^\d+$/.test(v)) return v.length >= 4 && v.length <= 8 ? "digits" : null;
  const len = [...v].length;
  return v.trim() === v && len >= 6 && len <= 32 ? "phrase" : null;
}

export function useQuickCode(enabled = true) {
  return useQuery<QuickCodeStatus>({
    queryKey: QUICK_CODE_KEY,
    queryFn: ({ signal }) => http.get<QuickCodeStatus>("/api/auth/quick-code", { signal }),
    staleTime: STALE.default,
    enabled,
  });
}

export function useSaveQuickCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => http.put<{ ok: boolean; kind: QuickCodeKind }>("/api/auth/quick-code", { code }),
    onSuccess: (r) => qc.setQueryData<QuickCodeStatus>(QUICK_CODE_KEY, { set: true, kind: r.kind, setAt: new Date().toISOString() }),
  });
}

export function useRemoveQuickCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.del<{ ok: boolean }>("/api/auth/quick-code"),
    onSuccess: () => qc.setQueryData<QuickCodeStatus>(QUICK_CODE_KEY, { set: false, kind: null, setAt: null }),
  });
}
