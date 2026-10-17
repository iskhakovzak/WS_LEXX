/**
 * Sync history: propreports_sync_runs table with expandable error text / details.
 */
import * as React from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, type Tone } from "@/components/ds";
import { fmtDateTime, type SyncRun } from "./api";

const STATUS: Record<SyncRun["status"], { label: string; tone: Tone }> = {
  running: { label: "идёт", tone: "accent" },
  ok: { label: "успешно", tone: "up" },
  partial: { label: "частично", tone: "warn" },
  error: { label: "ошибка", tone: "down" },
};

export function SyncHistory({ runs, loading }: { runs: SyncRun[]; loading: boolean }) {
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Panel title="История синхронизаций" description="Каждый импорт файла и запуск по API. Предпросмотры (dry-run) сюда не попадают — они ничего не пишут." icon={History}>
      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Загрузка…</div>
      ) : !runs.length ? (
        <EmptyState icon={History} title="Запусков ещё не было" />
      ) : (
        <DataTable maxHeight="50vh" ariaLabel="История синхронизаций">
          <table>
            <thead>
              <tr>
                <th className="w-6" />
                <th>Когда</th>
                <th>Источник</th>
                <th>Период / файл</th>
                <th>Статус</th>
                <th className="text-right">Новых</th>
                <th className="text-right">Обновл.</th>
                <th className="text-right">Без изм.</th>
                <th className="text-right">Сверка</th>
                <th className="text-right">Пропуск</th>
                <th className="text-right">Ошибки</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
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
                      <td className="whitespace-nowrap">{fmtDateTime(r.startedAt)}{dur != null && <span className="text-muted-foreground"> · {dur}с</span>}</td>
                      <td>{r.source === "api" ? <Pill tone="accent">API</Pill> : <Pill tone="neutral">файл</Pill>}</td>
                      <td className="max-w-[16rem] truncate text-xs text-muted-foreground" title={r.fileName ?? undefined}>{r.fileName ?? (r.dateFrom ? `${r.dateFrom} → ${r.dateTo}` : "—")}</td>
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
                          {r.details && <pre className="whitespace-pre-wrap text-2xs text-muted-foreground">{JSON.stringify(r.details, null, 1)}</pre>}
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
