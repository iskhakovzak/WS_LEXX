import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { BASE } from "@/lib/api";
import type { BehaviorResponse, DisciplineResponse, Mistake, MistakesSummary, Rule, RuleKindDef, RuleReport, RulesReportResponse, SelfChecksResponse, Violation } from "./types";

async function errorText(r: Response, fallback: string): Promise<string> {
  try { const j = await r.json(); return j?.error || fallback; } catch { return fallback; }
}

export async function apiJson<T>(path: string, init?: RequestInit & { json?: unknown }, fallback = "Ошибка запроса"): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!r.ok) throw new Error(await errorText(r, `${fallback} (HTTP ${r.status})`));
  return r.json() as Promise<T>;
}

const q = (trader: string) => `trader=${encodeURIComponent(trader)}`;

export const rulesKeys = {
  kinds: ["rules", "kinds"] as const,
  rules: (t: string) => ["rules", "list", t] as const,
  violations: (t: string) => ["rules", "violations", t] as const,
  archivedViolations: (t: string) => ["rules", "violations-archive", t] as const,
  mistakes: (t: string) => ["rules", "mistakes", t] as const,
  discipline: (t: string, days: number) => ["rules", "discipline", t, days] as const,
  report: (t: string, days: number) => ["rules", "report", t, days] as const,
  preview: (t: string, days: number, kind: string, th: string) => ["rules", "preview", t, days, kind, th] as const,
  errorsSummary: (t: string, days: number) => ["rules", "errors-summary", t, days] as const,
  behavior: (t: string, from: string, to: string) => ["rules", "behavior", t, from, to] as const,
  selfChecks: (t: string, day: string) => ["rules", "self-checks", t, day] as const,
};

export function useRuleKinds() {
  return useQuery({
    queryKey: rulesKeys.kinds,
    queryFn: () => apiJson<RuleKindDef[]>("/rules/kinds", undefined, "Не удалось загрузить типы правил"),
    staleTime: Infinity,
  });
}

export function useRules(trader: string) {
  return useQuery({
    queryKey: rulesKeys.rules(trader),
    queryFn: () => apiJson<Rule[]>(`/rules?${q(trader)}`, undefined, "Не удалось загрузить правила"),
    enabled: !!trader,
  });
}

export function useViolations(trader: string) {
  return useQuery({
    queryKey: rulesKeys.violations(trader),
    queryFn: () => apiJson<Violation[]>(`/rule-violations?${q(trader)}&limit=500`, undefined, "Не удалось загрузить нарушения"),
    enabled: !!trader,
  });
}

/** Archived violations (rule disabled / deleted, stale) — loaded only when «Показать архив» is on. */
export function useArchivedViolations(trader: string, enabled: boolean) {
  return useQuery({
    queryKey: rulesKeys.archivedViolations(trader),
    queryFn: () => apiJson<Violation[]>(`/rule-violations?${q(trader)}&archived=only&limit=500`, undefined, "Не удалось загрузить архив нарушений"),
    enabled: enabled && !!trader,
  });
}

export function useMistakes(trader: string) {
  return useQuery({
    queryKey: rulesKeys.mistakes(trader),
    queryFn: () => apiJson<Mistake[]>(`/errors?${q(trader)}&limit=1000`, undefined, "Не удалось загрузить журнал ошибок"),
    enabled: !!trader,
  });
}

export function useDiscipline(trader: string, days: number) {
  return useQuery({
    queryKey: rulesKeys.discipline(trader, days),
    queryFn: () => apiJson<DisciplineResponse>(`/rules/discipline?${q(trader)}&days=${days}`, undefined, "Не удалось загрузить статистику дисциплины"),
    enabled: !!trader,
  });
}

/** Live discipline report: per-rule compliance, $ impact, examples, calendar (computed on fresh trades). */
export function useRulesReport(trader: string, days: number) {
  return useQuery({
    queryKey: rulesKeys.report(trader, days),
    queryFn: () => apiJson<RulesReportResponse>(`/rules/report?${q(trader)}&days=${days}`, undefined, "Не удалось загрузить отчёт по правилам"),
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
    queryFn: () => apiJson<RuleReport>(`/rules/preview?${q(trader)}&days=${days}&kind=${encodeURIComponent(kind)}&threshold=${encodeURIComponent(th)}`, undefined, "Предпросмотр недоступен"),
    enabled: enabled && !!trader && !!kind && threshold != null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useMistakesSummary(trader: string, days: number) {
  return useQuery({
    queryKey: rulesKeys.errorsSummary(trader, days),
    queryFn: () => apiJson<MistakesSummary>(`/errors/summary?${q(trader)}&days=${days}`, undefined, "Не удалось загрузить сводку ошибок"),
    enabled: !!trader,
  });
}

/** Behavior patterns (read-only, /api/behavior — section «Поведение»). Optional: the page works without it. */
export function useBehaviorPatterns(trader: string, from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: rulesKeys.behavior(trader, from ?? "", to ?? ""),
    queryFn: () => apiJson<BehaviorResponse>(`/behavior?${q(trader)}&from=${from}&to=${to}`, undefined, "Паттерны недоступны"),
    enabled: !!trader && !!from && !!to,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Today's «соблюдал / нарушил» marks for self-assessed rules (same endpoint the journal uses). */
export function useSelfChecks(trader: string, day: string, enabled = true) {
  return useQuery({
    queryKey: rulesKeys.selfChecks(trader, day),
    queryFn: () => apiJson<SelfChecksResponse>(`/rules/self-checks?${q(trader)}&day=${day}`, undefined, "Не удалось загрузить самооценку"),
    enabled: enabled && !!trader && !!day,
  });
}

export function putSelfCheck(body: { trader: string; day: string; ruleId: number; ok: boolean | null; note?: string | null }) {
  return apiJson<{ ruleId: number; day: string; ok: boolean | null }>(`/rules/self-checks`, { method: "PUT", json: body }, "Не удалось сохранить отметку");
}

/** Invalidate everything on this page (rules list, violations, mistakes, discipline aggregates). */
export function useInvalidateRules() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (qq) => qq.queryKey[0] === "rules" && qq.queryKey[1] !== "kinds" }), [qc]);
}
