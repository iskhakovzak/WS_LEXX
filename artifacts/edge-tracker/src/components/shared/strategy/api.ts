/**
 * Requests of the strategy features (api routes/catalysts.ts; the formula rides on PATCH /api/playbook/:id). Every
 * catalyst key starts with CATALYST_DOMAIN, so a saved mark refreshes the analytics slice too.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { toast } from "@/hooks/use-toast";
import { strategyI18n } from "@/i18n/ns/strategy";
import type { CatalystDay, CatalystEdge, CatalystHint, CatalystMark, Direction, Kind, MarkSource, Strength, StrategyFormula } from "./model";

export const CATALYST_DOMAIN = "catalysts";

export const strategyKeys = {
  day: (date: string, trader?: string | null) => [CATALYST_DOMAIN, "day", trader || "me", date] as const,
  hint: (date: string, ticker: string) => [CATALYST_DOMAIN, "hint", date, ticker] as const,
  edge: (trader: string | null, from: string | null, to: string | null) => [CATALYST_DOMAIN, "edge", trader || "me", from, to] as const,
};

/** The marks of one day (all tickers at once: one request for the whole plan / watchlist). */
export function catalystDayQuery(date: string, trader?: string | null) {
  return queryOptions({
    queryKey: strategyKeys.day(date, trader),
    queryFn: ({ signal }) => http.get<CatalystDay>("/api/catalysts/day", { query: { date, trader: trader || undefined }, signal }),
    staleTime: STALE.short,
  });
}

/** The suggested direction of one ticker of a day (event / earnings / gap) — read only while it has no mark. */
export function catalystHintQuery(date: string, ticker: string) {
  return queryOptions({
    queryKey: strategyKeys.hint(date, ticker),
    queryFn: ({ signal }) => http.get<CatalystDay>("/api/catalysts/day", { query: { date, tickers: ticker }, signal }).then((d): CatalystHint | null => d.hints[0] ?? null),
    staleTime: STALE.long,
  });
}

export function catalystEdgeQuery(trader: string | null, from: string | null, to: string | null) {
  return queryOptions({
    queryKey: strategyKeys.edge(trader, from, to),
    queryFn: ({ signal }) => http.get<CatalystEdge>("/api/catalysts/edge", { query: { trader: trader || undefined, from: from || undefined, to: to || undefined }, signal }),
    staleTime: STALE.long,
  });
}

export type MarkBody = { date: string; ticker: string; direction: Direction | null; strength: Strength | null; kind?: Kind | null; source: MarkSource; suggested: boolean };

/** Saves a mark (own day). Optimistic: the taps answer at once; a failure puts the old state back and says so. */
export function useSaveMark(date: string) {
  const qc = useQueryClient();
  const key = strategyKeys.day(date);
  return useMutation({
    mutationFn: (b: MarkBody) => http.put<CatalystMark>("/api/catalysts/mark", b),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CatalystDay>(key);
      qc.setQueryData<CatalystDay>(key, (old) => {
        if (!old) return old;
        const mark: CatalystMark = {
          trader: old.trader, day: date, ticker: b.ticker, direction: b.direction, strength: b.strength, kind: b.kind ?? null, source: b.source, suggested: b.suggested,
        };
        return { ...old, marks: [...old.marks.filter((m) => m.ticker !== b.ticker), mark] };
      });
      return { prev };
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast({ title: strategyI18n.t("catalyst.saveFailed"), variant: "destructive" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: [CATALYST_DOMAIN, "edge"], refetchType: "none" });
    },
  });
}

/** Saves a setup's strategy formula (PATCH /api/playbook/:id); the playbook list in the cache follows at once. */
export function useSaveFormula(setupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formula: StrategyFormula | null) => http.patch<{ formula: StrategyFormula | null }>(`/api/playbook/${setupId}`, { formula }),
    onMutate: (formula) => {
      qc.setQueriesData<unknown>({ queryKey: ["playbook"] }, (old: unknown) =>
        Array.isArray(old) ? old.map((e) => (e && typeof e === "object" && (e as { id?: number }).id === setupId ? { ...e, formula } : e)) : old);
    },
    onError: () => toast({ title: strategyI18n.t("formula.saveFailed"), variant: "destructive" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["playbook"] });
      void qc.invalidateQueries({ queryKey: ["playbook-children"] });
    },
  });
}

/** A person's own setups (top level and variants) with their formulas — the academy lesson's exercise. */
export type OwnSetup = { id: number; name: string; parentId: number | null; trader?: string | null; space?: string | null; formula?: StrategyFormula | null; locked?: boolean };
export function ownSetupsQuery(person: string, self: boolean) {
  return queryOptions({
    queryKey: ["playbook", "own-setups", person, self] as const,
    queryFn: ({ signal }) => http.get<OwnSetup[]>("/api/playbook", { query: self ? { space: "personal" } : {}, signal })
      .then((rows) => rows.filter((r) => r.trader === person && r.space !== "office" && !r.locked)),
    staleTime: STALE.short,
  });
}
