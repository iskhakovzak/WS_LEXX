import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayRange } from "@/lib/period-range";
import { useCallback } from "react";
import { http } from "@/lib/api/http";
import type { BehaviorResponse, DisciplineResponse, Mistake, MistakesSummary, Rule, RuleKindDef, RuleReport, RulesReportResponse, SelfChecksResponse, Violation } from "./types";

const q = (trader: string) => `trader=${encodeURIComponent(trader)}`;
/** «Период…» on the page: the report / summary take from&to (the server's `days` is then the range length). */
const win = (days: number, range?: DayRange | null) => (range ? `days=${days}&from=${range.from}&to=${range.to}` : `days=${days}`);

export const rulesKeys = {
  kinds: ["rules", "kinds"] as const,
  rules: (t: string) => ["rules", "list", t] as const,
  violations: (t: string) => ["rules", "violations", t] as const,
  archivedViolations: (t: string) => ["rules", "violations-archive", t] as const,
  violationTotal: (t: string) => ["rules", "violations-total", t] as const,
  mistakes: (t: string) => ["rules", "mistakes", t] as const,
  discipline: (t: string, days: number) => ["rules", "discipline", t, days] as const,
  report: (t: string, days: number, range?: DayRange | null) => ["rules", "report", t, days, range?.from ?? null, range?.to ?? null] as const,
  preview: (t: string, days: number, kind: string, th: string) => ["rules", "preview", t, days, kind, th] as const,
  errorsSummary: (t: string, days: number, range?: DayRange | null) => ["rules", "errors-summary", t, days, range?.from ?? null, range?.to ?? null] as const,
  behavior: (t: string, from: string, to: string) => ["rules", "behavior", t, from, to] as const,
  selfChecks: (t: string, day: string) => ["rules", "self-checks", t, day] as const,
};

export function useRuleKinds() {
  return useQuery({
    queryKey: rulesKeys.kinds,
    queryFn: () => http.get<RuleKindDef[]>("/api/rules/kinds"),
    staleTime: Infinity,
  });
}

export function useRules(trader: string) {
  return useQuery({
    queryKey: rulesKeys.rules(trader),
    queryFn: () => http.get<Rule[]>(`/api/rules?${q(trader)}`),
    enabled: !!trader,
  });
}

export function useViolations(trader: string) {
  return useQuery({
    queryKey: rulesKeys.violations(trader),
    queryFn: () => http.get<Violation[]>(`/api/rule-violations?${q(trader)}&limit=500`),
    enabled: !!trader,
  });
}

/** How many active violations the trader has in all — the list itself is capped at 500 rows. */
export function useViolationTotal(trader: string) {
  return useQuery({
    queryKey: rulesKeys.violationTotal(trader),
    queryFn: () => http.get<{ total?: number }>(`/api/rule-violations?${q(trader)}&count=1`).then((d) => (typeof d?.total === "number" ? d.total : null)),
    enabled: !!trader,
  });
}

/** Archived violations (rule disabled / deleted, stale) — loaded only when «Показать архив» is on. */
export function useArchivedViolations(trader: string, enabled: boolean) {
  return useQuery({
    queryKey: rulesKeys.archivedViolations(trader),
    queryFn: () => http.get<Violation[]>(`/api/rule-violations?${q(trader)}&archived=only&limit=500`),
    enabled: enabled && !!trader,
  });
}

export function useMistakes(trader: string) {
  return useQuery({
    queryKey: rulesKeys.mistakes(trader),
    queryFn: () => http.get<Mistake[]>(`/api/errors?${q(trader)}&limit=1000`),
    enabled: !!trader,
  });
}

export function useDiscipline(trader: string, days: number) {
  return useQuery({
    queryKey: rulesKeys.discipline(trader, days),
    queryFn: () => http.get<DisciplineResponse>(`/api/rules/discipline?${q(trader)}&days=${days}`),
    enabled: !!trader,
  });
}

/** Live discipline report: per-rule compliance, $ impact, examples, calendar (computed on fresh trades). */
export function useRulesReport(trader: string, days: number, range?: DayRange | null) {
  return useQuery({
    queryKey: rulesKeys.report(trader, days, range),
    queryFn: () => http.get<RulesReportResponse>(`/api/rules/report?${q(trader)}&${win(days, range)}`),
    enabled: !!trader,
    staleTime: 60_000,
    placeholderData: (prev) => (prev && prev.trader === trader ? prev : undefined),
  });
}

/** What-if for a rule that doesn't exist yet (dialog + onboarding templates). */
export function useRulePreview(trader: string, days: number, kind: string, threshold: Record<string, unknown> | null, enabled = true) {
  const th = JSON.stringify(threshold ?? {});
  return useQuery({
    queryKey: rulesKeys.preview(trader, days, kind, th),
    queryFn: () => http.get<RuleReport>(`/api/rules/preview?${q(trader)}&days=${days}&kind=${encodeURIComponent(kind)}&threshold=${encodeURIComponent(th)}`),
    enabled: enabled && !!trader && !!kind && threshold != null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useMistakesSummary(trader: string, days: number, range?: DayRange | null) {
  return useQuery({
    queryKey: rulesKeys.errorsSummary(trader, days, range),
    queryFn: () => http.get<MistakesSummary>(`/api/errors/summary?${q(trader)}&${win(days, range)}`),
    enabled: !!trader,
    // A period switch keeps the old numbers on screen until the new ones arrive (same trader only).
    placeholderData: (prev, prevQuery) => (prev && prevQuery?.queryKey[2] === trader ? prev : undefined),
  });
}

/** Behavior patterns (read-only, /api/behavior — section «Поведение»). Optional: the page works without it. */
export function useBehaviorPatterns(trader: string, from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: rulesKeys.behavior(trader, from ?? "", to ?? ""),
    queryFn: () => http.get<BehaviorResponse>(`/api/behavior?${q(trader)}&from=${from}&to=${to}`),
    enabled: !!trader && !!from && !!to,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Today's «соблюдал / нарушил» marks for self-assessed rules (same endpoint the journal uses). */
export function useSelfChecks(trader: string, day: string, enabled = true) {
  return useQuery({
    queryKey: rulesKeys.selfChecks(trader, day),
    queryFn: () => http.get<SelfChecksResponse>(`/api/rules/self-checks?${q(trader)}&day=${day}`),
    enabled: enabled && !!trader && !!day,
  });
}

export function putSelfCheck(body: { trader: string; day: string; ruleId: number; ok: boolean | null; note?: string | null }) {
  return http.put<{ ruleId: number; day: string; ok: boolean | null }>(`/api/rules/self-checks`, body);
}

/** Invalidate everything on this page (rules list, violations, mistakes, discipline aggregates). */
export function useInvalidateRules() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (qq) => qq.queryKey[0] === "rules" && qq.queryKey[1] !== "kinds" }), [qc]);
}
