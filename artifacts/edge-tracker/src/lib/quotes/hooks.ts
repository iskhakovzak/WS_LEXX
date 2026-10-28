/** React Query hooks over ./api.ts: library quotes by id (dashboard card, its history, the profile). */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cachedQuote, fetchQuotes, keepQuote } from "./api";
import type { Quote, QuoteLang } from "./types";

const itemsKey = (lang: QuoteLang, ids: readonly string[]) => ["quotes", "items", lang, ids.join(",")] as const;

/** Quotes by id in one language, in that order; instant for quotes already received. */
export function useQuotes(lang: QuoteLang, ids: readonly string[], enabled = true) {
  const known = ids.map((id) => cachedQuote(lang, id));
  const complete = known.every(Boolean);
  return useQuery<Quote[]>({
    queryKey: itemsKey(lang, ids),
    queryFn: () => fetchQuotes(lang, ids),
    enabled: enabled && ids.length > 0,
    initialData: complete ? (known as Quote[]) : undefined,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    meta: { i18n: false },
  });
}

/** Warm `useQuotes(lang, ids)` (a hover on the history button). */
export function usePrefetchQuotes() {
  const qc = useQueryClient();
  return React.useCallback((lang: QuoteLang, ids: readonly string[]) => {
    if (ids.length === 0) return;
    void qc.prefetchQuery({ queryKey: itemsKey(lang, ids), queryFn: () => fetchQuotes(lang, ids), staleTime: Infinity });
  }, [qc]);
}

/** The quote on screen (null id → nothing); kept across reloads like a pick. */
export function useQuote(lang: QuoteLang, id: string | null) {
  const q = useQuotes(lang, id ? [id] : [], !!id);
  const quote = id ? q.data?.find((x) => x.id === id) ?? null : null;
  React.useEffect(() => { if (quote) keepQuote(lang, quote); }, [lang, quote]);
  return { quote, isError: q.isError, refetch: q.refetch };
}
