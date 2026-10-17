/**
 * Curator overview of «Отчёт недели»: every trader for the week with review status and key numbers.
 */
import * as React from "react";
import { ClipboardList, Users } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, SortableTh, StatCard, StatGrid, toneOf, useTableSort } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { cn } from "@/lib/utils";
import { fmtPct, fmtR, fmtUsd, useWeeklyOverview, type OverviewRow } from "./api";
import { ReviewStatusPill, ScorePill } from "./collab";

const ACCESSORS = {
  trader: (r: OverviewRow) => r.trader,
  status: (r: OverviewRow) => ({ submitted: 0, draft: 1, none: 2, reviewed: 3 }[r.status]),
  trades: (r: OverviewRow) => r.trades,
  netPnl: (r: OverviewRow) => r.netPnl,
  totalR: (r: OverviewRow) => r.totalR,
  winRate: (r: OverviewRow) => r.winRate,
  mistakes: (r: OverviewRow) => r.mistakes + r.violations,
  journalDays: (r: OverviewRow) => r.journalDays,
  score: (r: OverviewRow) => r.curatorScore,
};

export function TeamOverview({ week, onOpen }: { week: string; onOpen: (trader: string) => void }) {
  const q = useWeeklyOverview(week);
  const rows = q.data?.traders ?? [];
  const { rows: sorted, thProps } = useTableSort(rows, ACCESSORS, "status", "asc");
  const s = q.data?.summary;

  if (q.isError) return <Panel><QueryError error={q.error} onRetry={() => q.refetch()} /></Panel>;
  if (q.isPending) {
    return (
      <>
        <StatGrid>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</StatGrid>
        <Skeleton className="h-72 rounded-2xl" />
      </>
    );
  }
  if (!s) return null;
  return (
    <>
      <StatGrid>
        <StatCard label="Разобрано" value={`${s.reviewed} / ${s.traders}`} tone={s.pending === 0 ? "up" : "neutral"} hint={s.submitted ? `${s.submitted} ждут разбора` : "никто не ждёт"} />
        <StatCard label="P&L нетто команды" value={s.netPnl != null ? fmtUsd(s.netPnl, { signed: true }) : fmtR(s.totalR)} tone={toneOf(s.netPnl ?? s.totalR)} hint={s.netPnl != null ? fmtR(s.totalR) : "нет $ данных"} />
        <StatCard label="Сделок" value={String(s.trades)} hint={`${s.active} активных трейдеров`} />
        <StatCard label="Ошибок и нарушений" value={String(s.mistakes + s.violations)} tone={s.mistakes + s.violations > 0 ? "warn" : "up"} hint={`${s.mistakes} ошибок · ${s.violations} нарушений`} />
      </StatGrid>
      <Panel title="Команда за неделю" description="нажмите на строку, чтобы открыть отчёт трейдера" icon={Users} padded={false} bodyClassName="p-2 sm:p-3">
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Нет трейдеров" description="Активные трейдеры появятся здесь автоматически." />
        ) : (
          <DataTable maxHeight="64vh" ariaLabel="Трейдеры за неделю">
            <table>
              <thead>
                <tr>
                  <SortableTh {...thProps("trader")}>Трейдер</SortableTh>
                  <SortableTh {...thProps("status")}>Статус</SortableTh>
                  <SortableTh {...thProps("trades")} align="right">Сделки</SortableTh>
                  <SortableTh {...thProps("netPnl")} align="right">P&L нетто</SortableTh>
                  <SortableTh {...thProps("totalR")} align="right">R</SortableTh>
                  <SortableTh {...thProps("winRate")} align="right">WR</SortableTh>
                  <SortableTh {...thProps("mistakes")} align="right">Ошибки</SortableTh>
                  <SortableTh {...thProps("journalDays")} align="right">Журнал</SortableTh>
                  <SortableTh {...thProps("score")} align="right">Оценка</SortableTh>
                  <th scope="col" className="text-right">Цели</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.trader} className="cursor-pointer" onClick={() => onOpen(r.trader)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.trader); }}>
                    <td className="font-medium text-foreground">{r.trader}{r.role && r.role !== "trader" ? <span className="ml-1 text-xs text-muted-foreground">{r.role}</span> : null}</td>
                    <td><div className="flex items-center gap-1.5"><ReviewStatusPill status={r.status} />{r.selfDone && r.status !== "reviewed" && <span className="text-2xs text-muted-foreground">самооценка есть</span>}</div></td>
                    <td className="text-right">{r.trades}<span className="text-xs text-muted-foreground"> / {r.tradingDays} дн.</span></td>
                    <td className={cn("text-right font-medium", r.netPnl == null ? "text-muted-foreground" : r.netPnl >= 0 ? "text-up" : "text-down")}>{fmtUsd(r.netPnl, { signed: true })}</td>
                    <td className={cn("text-right", r.totalR > 0 ? "text-up" : r.totalR < 0 ? "text-down" : "")}>{r.trades ? fmtR(r.totalR) : "—"}</td>
                    <td className="text-right">{fmtPct(r.winRate)}</td>
                    <td className="text-right">{r.mistakes + r.violations > 0 ? <Pill tone="warn">{r.mistakes + r.violations}</Pill> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="text-right">{r.journalDays}/5</td>
                    <td className="text-right">{r.curatorScore != null ? <ScorePill score={r.curatorScore} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-right text-muted-foreground">{r.goals ? `${r.goalsDone}/${r.goals}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Panel>
    </>
  );
}
