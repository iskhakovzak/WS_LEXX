/** Mentor review queue: submissions waiting for a grade (oldest first), with inline rubric grading. */
import { useState } from "react";
import { Link } from "wouter";
import { Inbox } from "lucide-react";
import { EmptyState, Panel, Segmented } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useReviewQueue } from "./api";
import { GradeForm, SubmissionCard } from "./assignment-panel";
import { academyLinks } from "./links";
import { relativeDays } from "./time";

type Status = "submitted" | "returned" | "graded" | "all";

export function ReviewQueue({ cohortId }: { cohortId: number | null }) {
  const [status, setStatus] = useState<Status>("submitted");
  const [open, setOpen] = useState<number | null>(null);
  const q = useReviewQueue(status, cohortId);
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        ariaLabel="Статус сдач"
        value={status}
        onChange={setStatus}
        options={[
          { value: "submitted", label: "Ждут проверки" },
          { value: "returned", label: "На доработке" },
          { value: "graded", label: "Проверенные" },
          { value: "all", label: "Все" },
        ]}
      />
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError ? (
        <Panel><p className="text-sm text-down">Не удалось загрузить очередь: {(q.error as Error).message}</p></Panel>
      ) : !items.length ? (
        <Panel><EmptyState icon={Inbox} title={status === "submitted" ? "Очередь пуста" : "Ничего нет"} description={status === "submitted" ? "Все сдачи проверены." : undefined} /></Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <li key={s.id} className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{s.programTitle} · {s.moduleTitle} ·</span>
                <Link href={academyLinks.item("assignment", s.assignmentId, { submission: s.id })} className="font-medium text-foreground hover:text-primary">{s.assignmentTitle}</Link>
                {s.status === "submitted" && <span>· ждёт {relativeDays(s.createdAt).replace(" назад", "")}</span>}
              </p>
              <SubmissionCard
                s={s}
                rubric={s.rubric}
                showUser
                actions={
                  <Button size="sm" variant={open === s.id ? "secondary" : "outline"} onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                    {s.status === "submitted" ? "Проверить" : "Изменить оценку"}
                  </Button>
                }
              />
              {open === s.id && <GradeForm submission={s} rubric={s.rubric} passPct={s.passPct} onDone={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
