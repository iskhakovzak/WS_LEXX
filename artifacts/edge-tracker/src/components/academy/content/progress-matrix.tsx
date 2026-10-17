/**
 * Progress per student and per cohort for one program: KPI summary (avg / median / finished / stale) and a
 * students × modules matrix. Students come from F2 enrollments when that table exists (filtered by cohort),
 * otherwise from everyone with activity in the program.
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/components/analytics-page/metrics";
import { DataTable, EmptyState, Panel, Pill, SortableTh, StatCard, StatGrid, useTableSort } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, useProgressMatrix, type ProgressStudent, type Stage } from "./api";
import { PctBar } from "./bits";
import { academyLinks } from "./links";
import { relativeDays } from "./time";
import { pluralRu } from "@/components/rules/constants";

function cellTone(pct: number, total: number) {
  if (!total) return "text-muted-foreground";
  if (pct >= 100) return "bg-up/15 text-up";
  if (pct > 0) return "bg-primary/10 text-foreground";
  return "text-muted-foreground";
}

type SortKey = "name" | "pct" | "activity" | "pending";

export function ProgressMatrix({ programId, cohortId }: { programId: number | null; cohortId: number | null }) {
  const q = useProgressMatrix(programId, cohortId);
  const d = q.data;
  const rows = d?.students ?? [];
  const sorter = useMemo(() => ({
    name: (r: ProgressStudent) => r.userName,
    pct: (r: ProgressStudent) => r.pct,
    activity: (r: ProgressStudent) => r.lastActivity ?? "",
    pending: (r: ProgressStudent) => r.pendingReviews,
  }), []);
  const sort = useTableSort<ProgressStudent, SortKey>(rows, sorter, "pct");

  if (q.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (q.isError) return <Panel><p className="text-sm text-down">Не удалось загрузить прогресс: {(q.error as Error).message}</p></Panel>;
  if (!d?.program) return <Panel><EmptyState icon={Users} title="Программ ещё нет" description="Создайте программу в редакторе контента или загрузите демо-курс." /></Panel>;

  const s = d.summary;
  return (
    <div className="flex flex-col gap-4">
      {!d.enrollmentsAvailable && (
        <p className="text-xs text-muted-foreground">Модуль когорт ещё не подключён: показаны все, кто начал эту программу.</p>
      )}
      <StatGrid>
        <StatCard label="Учеников" value={s.students} />
        <StatCard label="Средний прогресс" value={s.avgPct != null ? `${s.avgPct}%` : "—"} hint={s.medianPct != null ? `медиана ${s.medianPct}%` : undefined} />
        <StatCard label="Закончили" value={s.completed} tone={s.completed ? "up" : "neutral"} />
        <StatCard label="Без активности 7+ дней" value={s.stale.length} tone={s.stale.length ? "warn" : "neutral"} hint={s.stale.slice(0, 3).join(", ") || undefined} />
      </StatGrid>

      {!rows.length ? (
        <Panel><EmptyState icon={Users} title="Нет учеников" description={cohortId ? "В этой когорте пока нет зачисленных." : "Никто ещё не начал эту программу."} /></Panel>
      ) : (
        <Panel padded={false} title={d.program.title} description={`${d.modules.length} ${pluralRu(d.modules.length, "модуль", "модуля", "модулей")} · клик по ученику — его прогресс глазами ученика`}
          actions={
            <Button variant="outline" size="sm" className="h-8" title="Прогресс учеников — CSV для Excel / Google Таблиц" onClick={() => {
              const quizzes = d.quizzes ?? [];
              downloadCsv(
                `academy_progress_${d.program!.id}.csv`,
                ["Ученик", "Ступень", "Прогресс, %", ...d.modules.map((m, i) => `М${i + 1}. ${m.title}`), ...quizzes.map((qz) => qz.title), "На проверке", "Последняя активность", "Дальше"],
                sort.rows.map((r) => [
                  r.userName, r.stage ? STAGE_LABELS[r.stage as Stage] ?? r.stage : "", Math.round(r.pct),
                  ...r.modules.map((m) => (m.total ? `${m.done} из ${m.total}` : "")), // «4/4» would turn into a date in Excel
                  ...quizzes.map((qz) => { const v = r.quizBest[String(qz.id)]; return v == null ? "" : Math.round(v); }),
                  r.pendingReviews, r.lastActivity ?? "", r.next?.title ?? "курс пройден",
                ]),
              );
            }}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />CSV
            </Button>
          }>
          <DataTable ariaLabel="Прогресс учеников" stickyFirstCol maxHeight="65vh">
            <table>
              <thead>
                <tr>
                  <SortableTh {...sort.thProps("name")}>Ученик</SortableTh>
                  <SortableTh {...sort.thProps("pct")}>Прогресс</SortableTh>
                  {d.modules.map((m, i) => <th key={m.id} scope="col" title={m.title} className="max-w-[9rem] truncate">М{i + 1}. {m.title}</th>)}
                  {(d.quizzes ?? []).map((qz) => <th key={qz.id} scope="col" title={qz.title}>Тест: {qz.title.replace(/^Тест:\s*/, "").slice(0, 18)}</th>)}
                  <SortableTh {...sort.thProps("pending")}>На проверке</SortableTh>
                  <SortableTh {...sort.thProps("activity")}>Активность</SortableTh>
                  <th scope="col">Дальше</th>
                </tr>
              </thead>
              <tbody>
                {sort.rows.map((r) => (
                  <tr key={r.userName}>
                    <td>
                      <Link href={academyLinks.learn({ program: d.program!.id, user: r.userName })} className="font-medium text-foreground hover:text-primary">{r.userName}</Link>
                      {r.stage && <span className="ml-2 text-xs text-muted-foreground">{STAGE_LABELS[r.stage as Stage] ?? r.stage}</span>}
                    </td>
                    <td className="min-w-[9rem]">
                      <div className="flex items-center gap-2">
                        <PctBar pct={r.pct} className="w-20" label={`Прогресс ${r.userName}`} />
                        <span className="tabular-nums">{Math.round(r.pct)}%</span>
                      </div>
                    </td>
                    {r.modules.map((m) => (
                      <td key={m.moduleId} className="text-center">
                        <span className={cn("inline-block min-w-[3.5rem] rounded-md px-1.5 py-0.5 tabular-nums", cellTone(m.pct, m.total))}>{m.total ? `${m.done}/${m.total}` : "—"}</span>
                      </td>
                    ))}
                    {(d.quizzes ?? []).map((qz) => {
                      const v = r.quizBest[String(qz.id)];
                      return (
                        <td key={qz.id} className="text-center tabular-nums">
                          {v == null ? <span className="text-muted-foreground">—</span> : <Pill tone={qz.passPct != null && v >= qz.passPct ? "up" : "down"}>{Math.round(v)}%</Pill>}
                        </td>
                      );
                    })}
                    <td className="text-center tabular-nums">{r.pendingReviews ? <Pill tone="accent">{r.pendingReviews}</Pill> : <span className="text-muted-foreground">0</span>}</td>
                    <td className={cn("whitespace-nowrap", s.stale.includes(r.userName) && "text-[hsl(var(--chart-3))]")}>{relativeDays(r.lastActivity)}</td>
                    <td className="max-w-[14rem] truncate text-muted-foreground" title={r.next?.title}>{r.next ? r.next.title : <span className="text-up">курс пройден</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
