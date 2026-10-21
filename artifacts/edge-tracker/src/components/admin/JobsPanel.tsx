/**
 * Admin console → «Данные» → «Фоновые задачи»: the server job registry (src/jobs/registry.ts) with the last run of
 * each job from job_runs. Read: admin.audit; «Запустить»: admins only. Texts: adminJobs namespace.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-error";
import { EmptyState, ListSkeleton, Panel, Pill, type Tone } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import { nullIfMissing } from "@/lib/api/errors";
import { POLL, STALE } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRelative, fmtWeekday } from "@/i18n/format";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { jobState, parseCron, sendsMessages, type JobState } from "./jobs-model";
import { adminJobsI18n } from "@/i18n/ns/adminJobs";

type JobStatus = "running" | "ok" | "error" | "timeout" | "skipped";

export interface JobRow {
  name: string;
  cron: string | null;
  on: string[];
  enabled: boolean;
  running: boolean;
  timeoutMs: number;
  nextRunAt: string | null;
  last: { id: number; status: JobStatus; trigger: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null } | null;
  lastOk: string | null;
  failures24h: number;
}

const JOBS_KEY = ["admin-console", "jobs"] as const;

const TONE: Record<JobState, Tone> = {
  running: "accent", ok: "up", flaky: "warn", error: "down", timeout: "down", skipped: "neutral", never: "neutral", disabled: "neutral",
};

function useJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: ({ signal }) => http.get<{ jobs: JobRow[]; timezone: string }>("/api/admin/console/jobs", { signal }).catch(nullIfMissing),
    staleTime: STALE.default,
    refetchInterval: POLL.minute,
  });
}

export function JobsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = adminJobsI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const jobs = useJobs();
  const run = useMutation({
    mutationFn: (name: string) => http.post<{ ok: boolean }>(`/api/admin/console/jobs/${encodeURIComponent(name)}/run`),
    onSuccess: () => {
      toast({ title: t("started") });
      setTimeout(() => void qc.invalidateQueries({ queryKey: JOBS_KEY }), 1500);
    },
    onError: (e) => toast({ title: t("startFailed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const [confirm, setConfirm] = useState<string | null>(null);
  const label = (name: string) => adminJobsI18n.tryT(`names.${name}`) ?? name;
  // OWNER-15: the cron line in words («по будням каждые 15 мин, 09:00–17:00»); the raw cron stays in the tooltip.
  const cronText = (cron: string) => {
    const c = parseCron(cron);
    switch (c.kind) {
      case "daily": return t("schedule.daily", { time: c.time });
      case "weekdays": return t("schedule.weekdays", { time: c.time });
      case "weekly": return t("schedule.weekly", { day: fmtWeekday(c.day, "long"), time: c.time });
      case "every":
        if (c.from && c.to) return t(c.weekdays ? "schedule.everyWeekdaysHours" : "schedule.everyHours", { minutes: c.minutes, from: c.from, to: c.to });
        return t(c.weekdays ? "schedule.everyWeekdays" : "schedule.every", { minutes: c.minutes });
      default: return c.cron;
    }
  };
  const schedule = (j: JobRow) => {
    const parts: string[] = [];
    if (j.cron) parts.push(cronText(j.cron));
    if (j.on.includes("propreports.synced")) parts.push(t("schedule.onEvent"));
    if (!parts.length) parts.push(t("schedule.onStart"));
    return parts.join(" · ");
  };
  const list = jobs.data?.jobs ?? [];

  return (
    <Panel
      title={t("title")}
      icon={Clock}
      description={t("description")}
      actions={
        <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("refresh")} onClick={() => jobs.refetch()} disabled={jobs.isFetching}>
          <RefreshCw className={cn(jobs.isFetching && "animate-spin motion-reduce:animate-none")} />
        </Button>
      }
    >
      {jobs.isError ? (
        <QueryError error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : jobs.isLoading ? (
        <ListSkeleton rows={5} />
      ) : jobs.data === null ? (
        <EmptyState compact icon={AlertTriangle} title={t("unavailable")} />
      ) : list.length === 0 ? (
        <EmptyState compact icon={Clock} title={t("empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t("col.job")}</th>
                <th className="px-2 py-1.5 font-medium">{t("col.schedule")}</th>
                <th className="px-2 py-1.5 font-medium">{t("col.status")}</th>
                <th className="px-2 py-1.5 font-medium">{t("col.last")}</th>
                <th className="px-2 py-1.5 font-medium">{t("col.next")}</th>
                {isAdmin && <th className="px-2 py-1.5" aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {list.map((j) => {
                const state = jobState(j);
                return (
                  <tr key={j.name} className="border-t border-[var(--glass-border)] align-top">
                    <td className="max-w-[16rem] px-2 py-2">
                      <div className="truncate font-medium" title={label(j.name)}>{label(j.name)}</div>
                      <div className="truncate font-mono text-2xs text-muted-foreground" title={j.name}>{j.name}</div>
                    </td>
                    <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground" title={j.cron ? t("schedule.rawTitle", { cron: j.cron }) : undefined}>{schedule(j)}</td>
                    <td className="px-2 py-2">
                      <Pill tone={TONE[state]}>{t(`status.${state}`)}</Pill>
                      {j.failures24h > 0 && <div className="mt-1 text-2xs text-down">{t("failures24h", { count: j.failures24h })}</div>}
                      {j.last?.error && (j.last.status === "error" || j.last.status === "timeout") && (
                        <div className="mt-1 max-w-[280px] truncate text-2xs text-muted-foreground" title={j.last.error}>{j.last.error}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs tabular-nums">
                      {j.last ? (
                        <span title={fmtDate(j.last.startedAt, "dateTime")}>
                          {fmtRelative(j.last.startedAt)}
                          {j.last.durationMs != null && <span className="text-muted-foreground"> · {t("duration", { seconds: Math.max(0, Math.round(j.last.durationMs / 100) / 10) })}</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-2 text-xs tabular-nums">{j.nextRunAt ? <span title={fmtDate(j.nextRunAt, "dateTime")}>{fmtRelative(j.nextRunAt)}</span> : "—"}</td>
                    {isAdmin && (
                      <td className="px-2 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          aria-label={t("runAria", { job: label(j.name) })}
                          disabled={j.running || (run.isPending && run.variables === j.name)}
                          onClick={() => (sendsMessages(j.name) ? setConfirm(j.name) : run.mutate(j.name))}
                        >
                          {run.isPending && run.variables === j.name
                            ? <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            : <Play aria-hidden="true" />} {t("run")}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? t("confirmTitle", { job: label(confirm) }) : ""}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmText")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) run.mutate(confirm); setConfirm(null); }}>{t("confirmRun")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
