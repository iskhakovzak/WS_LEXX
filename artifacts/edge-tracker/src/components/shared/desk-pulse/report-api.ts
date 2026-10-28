/**
 * «Автоотчёт за сезон» on the client (api routes/season-report.ts, lib/deskPulse/seasonReport): every number is the
 * api's (computed from PropReports trades with the shared $ math). The only write is the trader's conclusions, which
 * the api saves into his Playbook as a note.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { STALE } from "@/lib/api/keys";
import { toastMutationError } from "@/hooks/optimistic";
import type { Timing } from "@/components/shared/session-flow/timing";
import { deskPulseI18n } from "@/i18n/ns/deskPulse";
import type { Family } from "./api";
import type { EasyStatus } from "./easy-api";

export type UsdStats = {
  n: number; wins: number; losses: number; winrate: number | null; net: number | null; expectancy: number | null;
  avgWin: number | null; avgLoss: number | null; payoff: number | null; profitFactor: number | null; best: number | null; worst: number | null;
};
type RowStats = UsdStats & { netExTop3: number | null; outliers: boolean; judged: boolean };
export type SetupTimingRow = RowStats & { setupId: number | null; setup: string | null; timing: Timing | null };
export type TimingRow = RowStats & { timing: Timing | null };
export type FamilyRow = RowStats & { family: Family };
export type TradeLine = { id: number; day: string; ticker: string; side: "long" | "short" | null; setup: string | null; timing: Timing | null; net: number };
export type Season = { key: string; from: string; to: string };
export type SeasonPeriod = "current" | "previous";

export type SeasonReport = {
  trader: string; from: string; to: string; minTrades: number; season: Season | null; seasons: { current: Season; previous: Season };
  totals: UsdStats & { days: number; netExTop3: number | null; outliers: boolean };
  rows: SetupTimingRow[]; timings: TimingRow[]; best: TradeLine[]; worst: TradeLine[]; families: FamilyRow[];
  flow: { reentry: UsdStats; giveback: { days: number; total: number }; greenToRedDays: number };
  tiers: { tiers: (UsdStats & { tier: "1" | "2" | "3" | "none" })[]; authored: UsdStats; marked: number };
  easy: {
    days: number; capped: boolean; moves: number; took: { n: number; net: number | null }; against: { n: number; net: number | null };
    skipped: number; missed: number;
    top: { day: string; ticker: string; side: "long" | "short"; family: Family; timing: Timing | null; movePct: number; status: EasyStatus; days: number }[];
  } | null;
  conclusions: { text: string; playbookId: number; updatedAt: string | null } | null;
};

export type GroupReport = {
  from: string; to: string; season: Season | null; scope: string;
  rows: { trader: string; totals: UsdStats; netExTop3: number | null; outliers: boolean; written: boolean }[];
};

/** The period of the page: a season, or an explicit range. */
export type ReportPeriod = { season: SeasonPeriod } | { from: string; to: string };
const periodQuery = (p: ReportPeriod) => ("season" in p ? { season: p.season } : { from: p.from, to: p.to });
const periodKey = (p: ReportPeriod) => ("season" in p ? p.season : `${p.from}_${p.to}`);

export const reportKeys = {
  report: (trader: string | null, p: ReportPeriod) => ["trades", "season-report", trader || "me", periodKey(p)] as const,
  group: (p: ReportPeriod) => ["trades", "season-report", "group", periodKey(p)] as const,
};

export const seasonReportQuery = (trader: string | null, p: ReportPeriod) => queryOptions({
  queryKey: reportKeys.report(trader, p),
  queryFn: ({ signal }) => http.get<SeasonReport>("/api/season-report", { query: { trader: trader || undefined, ...periodQuery(p) }, signal }),
  staleTime: STALE.long,
});

export const groupReportQuery = (p: ReportPeriod) => queryOptions({
  queryKey: reportKeys.group(p),
  queryFn: ({ signal }) => http.get<GroupReport>("/api/season-report/group", { query: periodQuery(p), signal }),
  staleTime: STALE.long,
});

export function useSaveConclusions(trader: string | null, p: ReportPeriod) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { from: string; to: string; title: string; folder: string; text: string }) =>
      http.put<{ text: string; playbookId: number; updatedAt: string | null }>("/api/season-report/conclusions", v),
    onSuccess: (c) => {
      qc.setQueryData<SeasonReport>(reportKeys.report(trader, p), (old) => (old ? { ...old, conclusions: c } : old));
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: reportKeys.group(p) });
    },
    onError: (err) => toastMutationError(err, deskPulseI18n.t("report.conclusions.failed")),
  });
}
