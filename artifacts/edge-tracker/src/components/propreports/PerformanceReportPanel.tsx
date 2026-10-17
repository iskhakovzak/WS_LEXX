/**
 * «Брокерская статистика (PropReports)» — aggregate Trade Performance reports stored via
 * POST /api/propreports/import (kind=performance) and read from GET /api/propreports/performance.
 *
 * Reusable: <PerformanceReportPanel trader="Ориф" /> on a trader profile / analytics page,
 * or without `trader` on /integrations (curators see every trader, with a filter).
 */
import * as React from "react";
import { BarChart3, Trash2 } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, SortableTh, StatCard, StatGrid, StatRow, Segmented, useTableSort, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  HttpError, feeLabel, fmtSigned, fmtUsd, orderedFeeKeys, useDeletePerformance, usePerformance,
  type PerfRow, type PerformanceReport, type PerformanceReportRow,
} from "./api";

const WEEKDAY_RU: Record<string, string> = { monday: "Пн", tuesday: "Вт", wednesday: "Ср", thursday: "Чт", friday: "Пт", saturday: "Сб", sunday: "Вс" };
const TIME_RU: Record<string, string> = { "pre-market": "Премаркет", "post-market": "Постмаркет" };

function toneOf(v: number | null | undefined): Tone {
  if (v == null || v === 0) return "neutral";
  return v > 0 ? "up" : "down";
}

export function fmtHold(seconds: number | null | undefined, raw?: string | null): string {
  if (seconds == null) return raw ?? "—";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (h > 0) return `${h} ч ${m} м`;
  if (m > 0) return `${m} м ${s} с`;
  return `${s} с`;
}

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

function periodText(r: { periodFrom: string; periodTo: string }): string {
  return `${r.periodFrom} — ${r.periodTo}`;
}

/* ── bars ─────────────────────────────────────────────────────────────────── */

function NetBars({ rows, labelOf, title }: { rows: PerfRow[]; labelOf: (label: string) => string; title: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.totals.net)));
  if (!rows.length) return null;
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid gap-1.5" role="list" aria-label={title}>
        {rows.map((r) => {
          const w = Math.max(2, Math.round((Math.abs(r.totals.net) / max) * 100));
          const up = r.totals.net >= 0;
          return (
            <div key={r.label} role="listitem" className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs" title={`${labelOf(r.label)}: ${r.trades} сделок, win rate ${pct(r.totals.winRate)}, gross ${fmtUsd(r.totals.gross)}, комиссии ${fmtUsd(r.totals.fees)}`}>
              <span className="truncate text-muted-foreground">{labelOf(r.label)}</span>
              <div className="relative h-4 rounded bg-[var(--glass-bg)]">
                <div
                  className={cn("absolute inset-y-0 rounded", up ? "bg-up/70" : "bg-down/70")}
                  style={{ left: up ? "50%" : `${50 - w / 2}%`, width: `${w / 2}%` }}
                  aria-hidden="true"
                />
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
              </div>
              <span className={cn("w-24 text-right font-medium tabular-nums", up ? "text-up" : "text-down")}>{fmtSigned(r.totals.net)}</span>
              <span className="sr-only">{r.trades} сделок</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── side comparison ──────────────────────────────────────────────────────── */

function SideCard({ title, row }: { title: string; row: PerfRow | null }) {
  if (!row) return null;
  return (
    <div className="rounded-xl border border-[var(--glass-border)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <Pill tone={toneOf(row.totals.net)}>{fmtSigned(row.totals.net)} net</Pill>
      </div>
      <StatRow label="Сделок" value={`${row.trades} (${row.wins.count} W / ${row.losses.count} L)`} />
      <StatRow label="Win rate" value={pct(row.totals.winRate)} tone={row.totals.winRate != null && row.totals.winRate >= 50 ? "up" : "neutral"} />
      <StatRow label="Gross" value={fmtSigned(row.totals.gross)} tone={toneOf(row.totals.gross)} />
      <StatRow label="Комиссии" value={fmtUsd(row.totals.fees)} />
      <StatRow label="Средний win / loss" value={`${fmtUsd(row.wins.avgGross)} / ${fmtUsd(row.losses.avgGross)}`} />
      <StatRow label="W/L ratio" value={row.totals.wlRatio?.toFixed(2) ?? "—"} />
      <StatRow label="Среднее удержание" value={fmtHold(row.totals.avgHoldSeconds, row.totals.avgHold)} />
    </div>
  );
}

/* ── symbol table ─────────────────────────────────────────────────────────── */

const SYMBOL_ACCESSORS = {
  label: (r: PerfRow) => r.label,
  trades: (r: PerfRow) => r.trades,
  winRate: (r: PerfRow) => r.totals.winRate,
  gross: (r: PerfRow) => r.totals.gross,
  fees: (r: PerfRow) => r.totals.fees,
  net: (r: PerfRow) => r.totals.net,
  avgWin: (r: PerfRow) => r.wins.avgGross,
  avgLoss: (r: PerfRow) => r.losses.avgGross,
  hold: (r: PerfRow) => r.totals.avgHoldSeconds,
};

function SymbolTable({ rows }: { rows: PerfRow[] }) {
  const [mode, setMode] = React.useState<"all" | "best" | "worst">("all");
  const sorted = useTableSort(rows, SYMBOL_ACCESSORS, "net");
  const visible = React.useMemo(() => {
    if (mode === "all") return sorted.rows;
    const byNet = [...rows].sort((a, b) => b.totals.net - a.totals.net);
    return mode === "best" ? byNet.slice(0, 15) : byNet.slice(-15).reverse();
  }, [mode, rows, sorted.rows]);
  const best = rows.length ? Math.max(...rows.map((r) => r.totals.net)) : 0;
  const worst = rows.length ? Math.min(...rows.map((r) => r.totals.net)) : 0;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">По тикерам · {rows.length}</div>
        <Segmented
          ariaLabel="Фильтр тикеров"
          value={mode}
          onChange={setMode}
          options={[{ value: "all", label: "Все" }, { value: "best", label: "Лучшие 15" }, { value: "worst", label: "Худшие 15" }]}
        />
      </div>
      <DataTable maxHeight={420} stickyFirstCol ariaLabel="Статистика по тикерам">
        <table>
          <thead>
            <tr>
              <SortableTh {...sorted.thProps("label")}>Тикер</SortableTh>
              <SortableTh {...sorted.thProps("trades")} align="right">Сделок</SortableTh>
              <SortableTh {...sorted.thProps("winRate")} align="right">Win rate</SortableTh>
              <SortableTh {...sorted.thProps("gross")} align="right">Gross</SortableTh>
              <SortableTh {...sorted.thProps("fees")} align="right">Комиссии</SortableTh>
              <SortableTh {...sorted.thProps("net")} align="right">Net</SortableTh>
              <SortableTh {...sorted.thProps("avgWin")} align="right">Ср. win</SortableTh>
              <SortableTh {...sorted.thProps("avgLoss")} align="right">Ср. loss</SortableTh>
              <SortableTh {...sorted.thProps("hold")} align="right">Удержание</SortableTh>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.label} className={cn(r.totals.net === best && rows.length > 1 && "bg-up/5", r.totals.net === worst && rows.length > 1 && "bg-down/5")}>
                <td className="font-medium">{r.label}</td>
                <td className="text-right">{r.trades}</td>
                <td className="text-right">{pct(r.totals.winRate, 0)}</td>
                <td className={cn("text-right", r.totals.gross > 0 ? "text-up" : r.totals.gross < 0 ? "text-down" : "")}>{fmtSigned(r.totals.gross)}</td>
                <td className="text-right text-muted-foreground">{fmtUsd(r.totals.fees)}</td>
                <td className={cn("text-right font-medium", r.totals.net > 0 ? "text-up" : r.totals.net < 0 ? "text-down" : "")}>{fmtSigned(r.totals.net)}</td>
                <td className="text-right">{r.wins.count ? fmtUsd(r.wins.avgGross) : "—"}</td>
                <td className="text-right">{r.losses.count ? fmtUsd(r.losses.avgGross) : "—"}</td>
                <td className="text-right text-muted-foreground">{fmtHold(r.totals.avgHoldSeconds, r.totals.avgHold)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

/* ── report body (shared by the panel and the import preview) ─────────────── */

export function PerformanceReportBody({ data, compact = false }: { data: PerformanceReport; compact?: boolean }) {
  const s = data.summary;
  const timeLabel = (l: string) => TIME_RU[l.toLowerCase()] ?? l;
  const dayLabel = (l: string) => WEEKDAY_RU[l.toLowerCase()] ?? l;
  return (
    <div className="grid gap-4">
      <StatGrid className="md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Сделок" value={s.trades} hint={`${s.wins} W / ${s.losses} L`} />
        <StatCard label="Win rate" value={pct(s.winRate)} tone={s.winRate != null && s.winRate >= 50 ? "up" : "neutral"} />
        <StatCard label="Gross P&L" value={fmtSigned(s.gross)} tone={toneOf(s.gross)} />
        <StatCard label="Комиссии" value={fmtUsd(s.fees)} tone={s.feesPctOfGross != null && s.feesPctOfGross > 50 ? "warn" : "neutral"} hint={s.feesPctOfGross != null ? `${s.feesPctOfGross.toFixed(0)}% от gross` : undefined} />
        <StatCard label="Net P&L" value={fmtSigned(s.net)} tone={toneOf(s.net)} />
        <StatCard label="W/L ratio" value={s.wlRatio?.toFixed(2) ?? "—"} hint={`${fmtUsd(s.avgWin)} / ${fmtUsd(s.avgLoss)}`} />
        <StatCard label="Ср. удержание" value={fmtHold(s.avgHoldSeconds, s.avgHold)} />
      </StatGrid>

      {s.feesPctOfGross != null && s.feesPctOfGross >= 50 && (
        <div className="rounded-xl border border-[hsl(var(--chart-3)/0.4)] bg-[hsl(var(--chart-3)/0.08)] px-3 py-2 text-xs">
          Комиссии съедают {s.feesPctOfGross.toFixed(0)}% gross-прибыли: при {s.trades} сделках средняя комиссия {fmtUsd(s.trades ? s.fees / s.trades : 0)} на сделку против среднего net {fmtUsd(s.trades ? s.net / s.trades : 0)}.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <SideCard title="Long" row={data.bySide.long} />
        <SideCard title="Short" row={data.bySide.short} />
      </div>

      {!compact && (
        <div className="grid gap-4 lg:grid-cols-2">
          <NetBars rows={data.byTime} labelOf={timeLabel} title="Net P&L по времени входа (ET)" />
          <NetBars rows={data.byWeekday} labelOf={dayLabel} title="Net P&L по дням недели" />
        </div>
      )}

      {!compact && data.bySymbol.length > 0 && <SymbolTable rows={data.bySymbol} />}

      {data.perTradeAverages.length > 0 && (
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Средняя сделка: комиссии по типам</div>
          {data.perTradeAverages.map((a) => {
            const keys = orderedFeeKeys(a.fees);
            const total = keys.reduce((x, k) => x + (a.fees[k] ?? 0), 0);
            return (
              <div key={a.group} className="flex flex-wrap items-center gap-2 text-xs">
                <Pill tone="accent">{a.group}</Pill>
                {a.qty != null && <Pill tone="neutral">{a.qty.toFixed(0)} акций</Pill>}
                {a.held && <Pill tone="neutral">{fmtHold(a.heldSeconds, a.held)}</Pill>}
                {keys.filter((k) => (a.fees[k] ?? 0) !== 0).map((k) => (
                  <span key={k} className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 tabular-nums">{feeLabel(k)} ${a.fees[k].toFixed(4)}</span>
                ))}
                <span className="font-medium tabular-nums">= ${total.toFixed(4)} / сделка</span>
              </div>
            );
          })}
        </div>
      )}

      {data.issues.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Замечания парсера ({data.issues.length})</summary>
          <ul className="mt-1 list-disc pl-4">{data.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/* ── panel ────────────────────────────────────────────────────────────────── */

export function PerformanceReportPanel({ trader, staff = false, compact = false, className }: { trader?: string | null; staff?: boolean; compact?: boolean; className?: string }) {
  const { toast } = useToast();
  const [traderFilter, setTraderFilter] = React.useState<string>("");
  const [reportId, setReportId] = React.useState<number | null>(null);
  const effectiveTrader = trader ?? (traderFilter || null);
  const q = usePerformance(effectiveTrader, reportId);
  const del = useDeletePerformance();

  const reports: PerformanceReportRow[] = q.data?.reports ?? [];
  const traders = React.useMemo(() => [...new Set(reports.map((r) => r.traderName).filter((x): x is string => !!x))].sort(), [reports]);
  const latest = q.data?.latest ?? null;
  // when the filter changes the chosen id may vanish → fall back to the newest report
  React.useEffect(() => { if (reportId && !reports.some((r) => r.id === reportId)) setReportId(null); }, [reports, reportId]);

  const err = q.error instanceof HttpError ? q.error : null;
  const title = "Брокерская статистика (PropReports)";
  const description = latest
    ? `Отчёт Trade Performance · счёт ${latest.account} · ${periodText(latest)}${latest.traderName ? ` · ${latest.traderName}` : ""} · загружен ${new Date(latest.uploadedAt).toLocaleDateString("ru-RU")}${latest.uploadedBy ? ` (${latest.uploadedBy})` : ""}`
    : "Агрегированный отчёт Trade Performance из PropReports (сделки в журнал из него не создаются)";

  return (
    <Panel
      title={title}
      description={description}
      icon={BarChart3}
      className={className}
      actions={
        <>
          {!trader && traders.length > 1 && (
            <Select value={traderFilter || "__all"} onValueChange={(v) => { setTraderFilter(v === "__all" ? "" : v); setReportId(null); }}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Трейдер"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Все трейдеры</SelectItem>
                {traders.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {reports.length > 1 && (
            <Select value={String(latest?.id ?? reports[0]?.id ?? "")} onValueChange={(v) => setReportId(Number(v))}>
              <SelectTrigger className="h-8 w-64 text-xs" aria-label="Период отчёта"><SelectValue placeholder="Период" /></SelectTrigger>
              <SelectContent>
                {reports.map((r) => <SelectItem key={r.id} value={String(r.id)}>{periodText(r)} · {r.account}{r.traderName ? ` · ${r.traderName}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {staff && latest && (
            <Button
              variant="ghost" size="icon" aria-label="Удалить отчёт" disabled={del.isPending}
              onClick={async () => {
                if (!window.confirm(`Удалить отчёт ${latest.account} ${periodText(latest)}?`)) return;
                try { await del.mutateAsync(latest.id); setReportId(null); toast({ title: "Отчёт удалён" }); }
                catch (e) { toast({ title: "Не удалось удалить", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : err ? (
        <EmptyState icon={BarChart3} title="Не удалось загрузить статистику" description={err.message} />
      ) : !latest ? (
        <EmptyState
          icon={BarChart3}
          title="Отчётов пока нет"
          description={trader ? `Для трейдера ${trader} ещё не загружен отчёт Trade Performance.` : "Загрузите XLS «Trade Performance» из PropReports (Reports → Trade Performance → Export) во вкладке «Импорт» — формат определится автоматически."}
        />
      ) : (
        <PerformanceReportBody data={latest.data} compact={compact} />
      )}
    </Panel>
  );
}

export default PerformanceReportPanel;
