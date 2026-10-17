/**
 * Dry-run preview: summary tiles + per-trip diff table (new / updated / unchanged / adopt / conflict / skip).
 * Used by both the file import zone and the API "run now" dialog.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DataTable, Pill, Segmented, SortableTh, StatCard, StatGrid, useTableSort, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import {
  ACTION_LABEL, FIELD_LABEL, feeLabel, orderedFeeKeys, HORIZON_LABEL, REASON_LABEL, SESSION_LABEL,
  fmtPrice, fmtSigned, fmtUsd, type PlanAction, type PlanItemView, type Preview, type TripView,
} from "./api";

const ACTION_TONE: Record<PlanAction, Tone> = { insert: "up", update: "accent", unchanged: "neutral", adopt: "purple", conflict: "warn", skip: "down" };
type Filter = "all" | PlanAction;

// Action order mirrors the filter chips: what will change first, no-ops last.
const ACTION_RANK: Record<PlanAction, number> = { insert: 0, update: 1, adopt: 2, conflict: 3, unchanged: 4, skip: 5 };
const HORIZON_RANK: Record<string, number> = { intraday: 0, overnight: 1, swing: 2 };
const RESULT_RANK: Record<string, number> = { win: 0, breakeven: 1, loss: 2, open: 3 };
const PREVIEW_ACCESSORS = {
  action: (it: PlanItemView) => ACTION_RANK[it.action] ?? null,
  account: (it: PlanItemView) => it.trader ?? it.account,
  date: (it: PlanItemView) => it.trip.openedAt || it.trip.date,
  symbol: (it: PlanItemView) => it.trip.symbol,
  side: (it: PlanItemView) => it.trip.side,
  qty: (it: PlanItemView) => it.trip.qty,
  entry: (it: PlanItemView) => it.trip.avgEntry,
  exit: (it: PlanItemView) => it.trip.avgExit,
  gross: (it: PlanItemView) => it.trip.grossPnl,
  fees: (it: PlanItemView) => it.trip.totalFees,
  net: (it: PlanItemView) => it.trip.netPnl,
  horizon: (it: PlanItemView) => HORIZON_RANK[it.trip.horizon] ?? null,
  hold: (it: PlanItemView) => (it.trip.closedAt && it.trip.openedAt ? (Date.parse(it.trip.closedAt) - Date.parse(it.trip.openedAt)) || null : null),
  result: (it: PlanItemView) => RESULT_RANK[it.trip.result] ?? null,
};
const PREVIEW_FIRST_DIR = { action: "asc", account: "asc", symbol: "asc", side: "asc", horizon: "asc", result: "asc" } as const;

export function resultTone(r: TripView["result"]): Tone {
  return r === "win" ? "up" : r === "loss" ? "down" : r === "open" ? "accent" : "neutral";
}

export function FeesBreakdown({ fees, total }: { fees: Record<string, number>; total: number }) {
  const parts = orderedFeeKeys(fees).filter((k) => Math.abs(fees[k] ?? 0) >= 0.005);
  if (!parts.length) return <span className="text-muted-foreground">{fmtUsd(total)}</span>;
  return (
    <span title={parts.map((k) => `${feeLabel(k)}: ${fmtUsd(fees[k])}`).join("\n")} className="cursor-help underline decoration-dotted underline-offset-2">
      {fmtUsd(total)}
    </span>
  );
}

export function ExecutionsList({ trip }: { trip: TripView }) {
  const KIND: Record<string, string> = { entry: "вход", add: "добор", trim: "частичный", exit: "выход" };
  return (
    <div className="grid gap-1 text-xs tabular-nums">
      {trip.executions.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="w-16 text-muted-foreground">{KIND[e.kind] ?? e.kind}</span>
          <span className={cn("w-8 font-medium", e.side === "B" || e.side === "C" ? "text-up" : "text-down")}>{e.side}</span>
          <span className="w-14 text-right">{e.qty}</span>
          <span className="w-20 text-right">@ {fmtPrice(e.price)}</span>
          <span className="text-muted-foreground">{e.at.replace("T", " ")}</span>
          {e.fees ? <span className="text-muted-foreground">комиссия {fmtUsd(e.fees)}</span> : null}
          {e.fillId && <span className="text-2xs text-muted-foreground">#{e.fillId}</span>}
        </div>
      ))}
      {trip.open && <div className="text-muted-foreground">Позиция ещё открыта: {trip.openQty} шт.</div>}
    </div>
  );
}

function ChangeList({ changes }: { changes: PlanItemView["changes"] }) {
  if (!changes.length) return null;
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
  return (
    <ul className="grid gap-0.5 text-xs">
      {changes.map((c) => (
        <li key={c.field} className="flex flex-wrap gap-1.5">
          <span className="text-muted-foreground">{FIELD_LABEL[c.field] ?? c.field}:</span>
          <span className="line-through opacity-70">{show(c.from)}</span>
          <span>→</span>
          <span className="font-medium">{show(c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PreviewSummary({ preview }: { preview: Preview }) {
  const s = preview.summary;
  const c = preview.counts;
  return (
    <div className="grid gap-3">
      <StatGrid>
        <StatCard label="Раунд-трипов" value={s.trips} hint={`${s.closed} закрытых · ${s.open} открытых · ${s.tradingDays} дн.`} />
        <StatCard label="Net P&L (по брокеру)" value={fmtSigned(s.net)} tone={s.net > 0 ? "up" : s.net < 0 ? "down" : "neutral"} hint={`gross ${fmtSigned(s.gross)} · комиссии ${fmtUsd(s.fees)}`} />
        <StatCard label="Новых / обновится" value={`${c.insert} / ${c.update}`} tone={c.insert ? "up" : "neutral"} hint={`${c.unchanged} без изменений · ${c.adopt} привяжется`} />
        <StatCard label="На сверку / пропуск" value={`${c.conflict} / ${c.skip}`} tone={c.conflict ? "warn" : c.skip ? "down" : "neutral"} hint={`${s.byHorizon.intraday} интрадей · ${s.byHorizon.overnight} овернайт · ${s.byHorizon.swing} свинг`} />
      </StatGrid>
      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {preview.kind === "fills" && preview.fills != null && <Pill tone="neutral">{preview.fills} fills{preview.skippedRows ? ` · ${preview.skippedRows} отменённых пропущено` : ""}</Pill>}
        {preview.reportRows != null && <Pill tone="neutral">{preview.reportRows} строк отчёта</Pill>}
        {!!preview.unmappedAccounts.length && <Pill tone="warn" dot>Счета без трейдера: {preview.unmappedAccounts.join(", ")}</Pill>}
        {!!preview.inactiveAccounts.length && <Pill tone="neutral">Выключенные счета: {preview.inactiveAccounts.join(", ")}</Pill>}
        {!!preview.orphanCount && <Pill tone="warn">{preview.orphanCount} fills закрывают позицию, открытую до начала периода — не учтены</Pill>}
        {!!preview.issueCount && <Pill tone="down">{preview.issueCount} строк не распознано</Pill>}
        {preview.truncated && <Pill tone="warn">Показаны первые 3000</Pill>}
      </div>
      {!!preview.issues?.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Проблемные строки</summary>
          <ul className="mt-1 grid gap-0.5">{preview.issues.map((i, n) => <li key={n}>строка {i.line}: {i.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export function PreviewTable({ preview }: { preview: Preview }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const filtered = React.useMemo(() => (filter === "all" ? preview.items : preview.items.filter((i) => i.action === filter)), [filter, preview.items]);
  const sort = useTableSort(filtered, PREVIEW_ACCESSORS, "date", "asc", PREVIEW_FIRST_DIR);
  const items = sort.rows;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const options: Array<{ value: Filter; label: string; count: number }> = [
    { value: "all", label: "Все", count: preview.items.length },
    ...(["insert", "update", "adopt", "conflict", "unchanged", "skip"] as PlanAction[]).filter((a) => preview.counts[a]).map((a) => ({ value: a as Filter, label: ACTION_LABEL[a], count: preview.counts[a] })),
  ];
  return (
    <div className="grid gap-3">
      <Segmented ariaLabel="Фильтр предпросмотра" size="sm" value={filter} onChange={setFilter} options={options} />
      <DataTable maxHeight="70vh" ariaLabel="Предпросмотр импорта">
        <table>
          <thead>
            <tr>
              <th className="w-6" />
              <SortableTh {...sort.thProps("action")}>Действие</SortableTh>
              <SortableTh {...sort.thProps("account")}>Счёт / трейдер</SortableTh>
              <SortableTh {...sort.thProps("date")}>Дата</SortableTh>
              <SortableTh {...sort.thProps("symbol")}>Тикер</SortableTh>
              <SortableTh {...sort.thProps("side")}>Сторона</SortableTh>
              <SortableTh {...sort.thProps("qty")} align="right">Объём</SortableTh>
              <SortableTh {...sort.thProps("entry")} align="right">Вход</SortableTh>
              <SortableTh {...sort.thProps("exit")} align="right">Выход</SortableTh>
              <SortableTh {...sort.thProps("gross")} align="right">Gross</SortableTh>
              <SortableTh {...sort.thProps("fees")} align="right">Комиссии</SortableTh>
              <SortableTh {...sort.thProps("net")} align="right">Net</SortableTh>
              <SortableTh {...sort.thProps("horizon")}>Горизонт</SortableTh>
              <SortableTh {...sort.thProps("hold")}>Удерж.</SortableTh>
              <SortableTh {...sort.thProps("result")}>Итог</SortableTh>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const t = it.trip;
              const isOpen = open.has(it.externalId);
              return (
                <React.Fragment key={it.externalId}>
                  <tr className={cn(it.action === "conflict" && "bg-[hsl(var(--chart-3))]/5", it.action === "skip" && "opacity-60")}>
                    <td>
                      <button type="button" onClick={() => toggle(it.externalId)} aria-expanded={isOpen} aria-label="Показать исполнения" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td>
                      <Pill tone={ACTION_TONE[it.action]}>{ACTION_LABEL[it.action]}</Pill>
                      {it.reason && <div className="text-2xs text-muted-foreground">{REASON_LABEL[it.reason] ?? it.reason}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="text-xs">{it.account}</div>
                      <div className={cn("text-2xs", it.trader ? "text-muted-foreground" : "text-[hsl(var(--chart-3))]")}>{it.trader ?? "не привязан"}</div>
                    </td>
                    <td className="whitespace-nowrap">{t.date}{t.exitDate && t.exitDate !== t.date ? <span className="text-muted-foreground"> → {t.exitDate}</span> : null}</td>
                    <td className="font-medium">{t.symbol}</td>
                    <td><span className={t.side === "Long" ? "text-up" : "text-down"}>{t.side === "Long" ? "Лонг" : "Шорт"}</span></td>
                    <td className="text-right">{t.qty}{t.open && t.openQty ? <span className="text-muted-foreground"> ({t.openQty} откр.)</span> : null}</td>
                    <td className="text-right">{fmtPrice(t.avgEntry)}</td>
                    <td className="text-right">{fmtPrice(t.avgExit)}</td>
                    <td className={cn("text-right", t.grossPnl > 0 ? "text-up" : t.grossPnl < 0 ? "text-down" : "")}>{fmtSigned(t.grossPnl)}</td>
                    <td className="text-right"><FeesBreakdown fees={t.fees} total={t.totalFees} /></td>
                    <td className={cn("text-right font-medium", t.netPnl > 0 ? "text-up" : t.netPnl < 0 ? "text-down" : "")}>{fmtSigned(t.netPnl)}</td>
                    <td className="whitespace-nowrap text-xs">{HORIZON_LABEL[t.horizon]} <span className="text-muted-foreground">· {SESSION_LABEL[t.session]}</span></td>
                    <td className="whitespace-nowrap text-xs">{t.holdTime ?? "—"}</td>
                    <td><Pill tone={resultTone(t.result)}>{t.result === "open" ? "Открыта" : t.result === "win" ? "Прибыль" : t.result === "loss" ? "Убыток" : "В ноль"}</Pill></td>
                  </tr>
                  {(isOpen || it.changes.length > 0 || it.candidates.length > 0) && (
                    <tr>
                      <td />
                      <td colSpan={14} className="!py-2">
                        <div className="grid gap-2">
                          {it.changes.length > 0 && <ChangeList changes={it.changes} />}
                          {it.candidates.length > 0 && (
                            <div className="text-xs">
                              <span className="text-[hsl(var(--chart-3))]">Совпадает с ручной записью:</span>{" "}
                              {it.candidates.map((c) => `#${c.id} ${c.ticker} ${c.side ?? ""} ${c.date}${c.pnl != null ? ` (${fmtSigned(c.pnl)})` : ""}`).join("; ")}
                              <span className="text-muted-foreground"> — после импорта появится во «Входящих на сверку»</span>
                            </div>
                          )}
                          {isOpen && <ExecutionsList trip={t} />}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!items.length && (
              <tr><td colSpan={15} className="py-6 text-center text-sm text-muted-foreground">Пусто</td></tr>
            )}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}
