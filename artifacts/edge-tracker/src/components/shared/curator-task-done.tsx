/**
 * «Готово» on a curator task (Волна 2 п. 2.13): the trader tells the curator the manual task («curator_task» quest) is
 * done — POST /api/curator/tasks/:id/done (api routes/curatorTasks.ts). The curator is notified and confirms it; the
 * report itself earns a few discipline points once per day (the toast says how many). Once reported the button turns
 * into «Отмечено … — ждём подтверждения куратора».
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import { KEYS } from "@/lib/api/keys";
import { fmtDate } from "@/lib/format";
import { askCuratorI18n } from "@/i18n/ns/askCurator";
import type { Quest } from "@/lib/quests/types";

export type TaskDoneAnswer = { ok: true; reportedOn: string; points: number; already: boolean };

/** Show «Готово»? Only the trader's own active manual task not yet reported (pure; quest rows and tests share it). */
export function canReportTask(q: Pick<Quest, "template" | "status" | "reportedOn">): boolean {
  return q.template === "curator_task" && q.status === "active" && !q.reportedOn;
}

export function TaskDoneButton({ q }: { q: Pick<Quest, "id" | "template" | "status" | "reportedOn"> }) {
  const { t } = askCuratorI18n.useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => http.post<TaskDoneAnswer>(`/api/curator/tasks/${q.id}/done`, {}),
    onSuccess: (r) => {
      toast({ title: t("taskDone.sent"), description: r.points > 0 ? t("taskDone.points", { points: r.points }) : undefined });
      void qc.invalidateQueries({ queryKey: KEYS.questsMe() });
      void qc.invalidateQueries({ queryKey: ["gamification"] });
    },
    onError: (e) => toast({ title: t("taskDone.failed"), description: (e as Error).message, variant: "destructive" }),
  });
  if (q.template !== "curator_task" || q.status !== "active") return null;
  const on = q.reportedOn ?? (send.data?.reportedOn ?? null);
  if (on) return <span className="shrink-0 text-xs text-muted-foreground">{t("taskDone.reported", { date: fmtDate(on, "dayMonth") })}</span>;
  return (
    <Button type="button" size="sm" className="h-10 shrink-0 px-3 sm:h-8" title={t("taskDone.hint")} onClick={() => send.mutate()} disabled={send.isPending}>
      <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("taskDone.button")}
    </Button>
  );
}
