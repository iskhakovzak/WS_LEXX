/**
 * Sync history: propreports_sync_runs table with expandable error text / details.
 */
import * as React from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, SortableTh, useTableSort, type Tone } from "@/components/ds";
import { type SyncRun } from "./api";
import { fmtDate } from "@/lib/format";

const STATUS: Record<SyncRun["status"], { label: string; tone: Tone }> = {
  running: { label: "идёт", tone: "accent" },
  ok: { label: "успешно", tone: "up" },
  partial: { label: "частично", tone: "warn" },
  error: { label: "ошибка", tone: "down" },
};

const STATUS_RANK: Record<SyncRun["status"], number> = { running: 0, ok: 1, partial: 2, error: 3 };

const RUN_ACCESSORS = {
  when: (r: SyncRun) => Date.parse(r.startedAt) || null,
  source: (r: SyncRun) => r.source,
  period: (r: SyncRun) => r.fileName ?? r.dateFrom ?? null,
  status: (r: SyncRun) => STATUS_RANK[r.status] ?? null,
  inserted: (r: SyncRun) => r.inserted,
  updated: (r: SyncRun) => r.updated,
  unchanged: (r: SyncRun) => r.unchanged,
  conflicts: (r: SyncRun) => r.conflicts,
  skipped: (r: SyncRun) => r.skipped,
  errors: (r: SyncRun) => r.errors,
  actor: (r: SyncRun) => r.actor,
};
const RUN_FIRST_DIR = { source: "asc", period: "asc", actor: "asc" } as const;

export function SyncHistory({ runs, loading }: { runs: SyncRun[]; loading: boolean }) {
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());
  const sort = useTableSort(runs, RUN_ACCESSORS, "when", "desc", RUN_FIRST_DIR);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Panel title="История синхронизаций" description="Каждый импорт файла и запуск по API. Предпросмотры (dry-run) сюда не попадают — они ничего не пишут." icon={History}>
      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Загрузка…</div>
      ) : !runs.length ? (
        <EmptyState icon={History} title="Запусков ещё не было" />
      ) : (
        <DataTable maxHeight="70vh" ariaLabel="История синхронизаций" className="[&_tbody_td]:px-2 [&_thead_th]:px-2">
          <table>
            <thead>
              <tr>
                <th className="w-6" />
                <SortableTh {...sort.thProps("when")}>Когда</SortableTh>
                <SortableTh {...sort.thProps("source")}>Источник</SortableTh>
                <SortableTh {...sort.thProps("period")}>Период / файл</SortableTh>
                <SortableTh {...sort.thProps("status")}>Статус</SortableTh>
                <SortableTh {...sort.thProps("inserted")} align="right">Новых</SortableTh>
                <SortableTh {...sort.thProps("updated")} align="right">Обновл.</SortableTh>
                <SortableTh {...sort.thProps("unchanged")} align="right">Без изм.</SortableTh>
                <SortableTh {...sort.thProps("conflicts")} align="right">Сверка</SortableTh>
                <SortableTh {...sort.thProps("skipped")} align="right">Пропуск</SortableTh>
                <SortableTh {...sort.thProps("errors")} align="right">Ошибки</SortableTh>
                <SortableTh {...sort.thProps("actor")}>Кто</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sort.rows.map((r) => {
                const isOpen = open.has(r.id);
                const expandable = !!r.errorText || !!r.details;
                const st = STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
                const dur = r.finishedAt ? Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)) : null;
                return (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td>
                        {expandable && (
                          <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen} aria-label="Подробности" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{fmtDate(r.startedAt, "numericDateTime")}{dur != null && <span className="text-muted-foreground"> · {dur}с</span>}</td>
                      <td>{r.source === "api" ? <Pill tone="accent">API</Pill> : <Pill tone="neutral">файл</Pill>}</td>
                      <td className="max-w-[10rem] truncate text-xs text-muted-foreground" title={r.fileName ?? undefined}>{r.fileName ?? (r.dateFrom ? `${r.dateFrom} → ${r.dateTo}` : "—")}</td>
                      <td><Pill tone={st.tone} dot>{st.label}</Pill></td>
                      <td className="text-right">{r.inserted}</td>
                      <td className="text-right">{r.updated}</td>
                      <td className="text-right text-muted-foreground">{r.unchanged}</td>
                      <td className="text-right">{r.conflicts ? <span className="text-[hsl(var(--chart-3))]">{r.conflicts}</span> : 0}</td>
                      <td className="text-right text-muted-foreground">{r.skipped}</td>
                      <td className="text-right">{r.errors ? <span className="text-down">{r.errors}</span> : 0}</td>
                      <td className="text-xs">{r.actor ?? "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={11} className="!py-2">
                          {r.errorText && <pre className="mb-2 whitespace-pre-wrap rounded-lg bg-down/10 p-2 text-xs text-down">{r.errorText}</pre>}
                          {r.details && <pre className="max-w-[min(90vw,64rem)] whitespace-pre-wrap break-words text-2xs text-muted-foreground">{JSON.stringify(r.details, null, 1)}</pre>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}
