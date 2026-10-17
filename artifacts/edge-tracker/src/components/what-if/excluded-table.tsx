import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ListX } from "lucide-react";
import { DataTable, EmptyState, Pill, Segmented, SortableTh, toneOf, useTableSort } from "@/components/ds";
import { fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { REASON_LABEL } from "./rules";
import type { ChangedTrade, ExcludedTrade } from "./api";

type Row = { id: number; day: string; ticker: string; kind: "excluded" | "changed"; reason: string; detail: string; amount: number; estimate: boolean };

const ACCESSORS = {
  day: (r: Row) => r.day,
  ticker: (r: Row) => r.ticker,
  reason: (r: Row) => r.reason,
  amount: (r: Row) => r.amount,
} as const;

/** Trades the scenario removed or changed. Rendered bare (inside the page's «Какие сделки убраны» section). */
export function ExcludedTable({ excluded, changed }: { excluded: ExcludedTrade[]; changed: ChangedTrade[] }) {
  const [filter, setFilter] = useState<"all" | "excluded" | "changed">("all");
  const rows = useMemo<Row[]>(() => {
    const a: Row[] = excluded.map((e) => ({ id: e.id, day: e.day, ticker: e.ticker, kind: "excluded", reason: e.reason, detail: e.detail, amount: -e.net, estimate: false }));
    const b: Row[] = changed.map((c) => ({ id: c.id, day: c.day, ticker: c.ticker, kind: "changed", reason: c.reason, detail: c.detail, amount: c.reason === "commissionPlan" ? c.before - c.after : c.after - c.before, estimate: c.estimate }));
    return [...a, ...b];
  }, [excluded, changed]);
  const filtered = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.kind === filter)), [rows, filter]);
  const { rows: sorted, thProps } = useTableSort(filtered, ACCESSORS, "day", "asc");
  const totalExcluded = excluded.reduce((s, e) => s + e.net, 0);
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of excluded) m.set(e.reason, (m.get(e.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [excluded]);

  if (!rows.length) {
    return <EmptyState compact icon={ListX} title="Правила ничего не изменили" description="Добавь правило или измени его значение." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          Убрано {commonI18n.t("units.trades", { count: excluded.length })}, их нетто {fmtUsd(totalExcluded, { signed: true, decimals: "auto" })}{changed.length ? ` · изменено ${changed.length}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {reasons.map(([r, n]) => <Pill key={r} tone="neutral">{REASON_LABEL[r] ?? r} {n}</Pill>)}
          {changed.length > 0 && excluded.length > 0 && (
            <Segmented
              ariaLabel="Фильтр изменений" size="sm" value={filter} onChange={setFilter}
              options={[{ value: "all", label: "Все" }, { value: "excluded", label: "Убраны", count: excluded.length }, { value: "changed", label: "Изменены", count: changed.length }]}
            />
          )}
        </div>
      </div>
      <DataTable maxHeight="60vh" ariaLabel="Убранные и изменённые сделки">
        <table>
          <thead>
            <tr>
              <SortableTh {...thProps("day")}>Дата</SortableTh>
              <SortableTh {...thProps("ticker")}>Тикер</SortableTh>
              <SortableTh {...thProps("reason")}>Почему</SortableTh>
              <th scope="col">Подробно</th>
              <SortableTh {...thProps("amount")} align="right">Влияние на нетто</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.kind}-${r.id}`}>
                <td className="whitespace-nowrap">{r.day}</td>
                <td><Link href={links.trade(r.id)} className="font-medium text-primary underline-offset-4 hover:underline">{r.ticker}</Link></td>
                <td>
                  <Pill tone={r.kind === "excluded" ? "neutral" : r.estimate ? "warn" : "accent"}>{REASON_LABEL[r.reason] ?? r.reason}{r.estimate ? " · оценка" : ""}</Pill>
                </td>
                <td className="text-muted-foreground">{r.detail}</td>
                <td className={cn("text-right font-medium", toneOf(r.amount) === "up" ? "text-up" : toneOf(r.amount) === "down" ? "text-down" : "")}>{fmtUsd(r.amount, { signed: true, decimals: "auto" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}
