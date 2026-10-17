import { useMemo, useState } from "react";
import { DataTable, Pill, SortableTh, Sparkline, toneOf, toneText, useTableSort } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { BenchRow } from "./api";
import { fmtDay, fmtMinutes, fmtNum, fmtPct, fmtR, fmtUsd } from "./format";
import { PeopleSearchInput } from "@/components/people/people-search-input";
import { matchPerson, prepareQuery, usePeopleAliases } from "@/components/people/search";

type Key =
  | "trader" | "trades" | "tpd" | "winRate" | "pf" | "net" | "expectancy" | "feeShare" | "sharpe" | "sortino" | "dd"
  | "green" | "bestDay" | "streak" | "hold" | "first15" | "rcov";

const ACCESSORS: Record<Key, (r: BenchRow) => number | string | null | undefined> = {
  trader: (r) => r.trader,
  trades: (r) => r.trades,
  tpd: (r) => r.tradesPerDay,
  winRate: (r) => r.winRate,
  pf: (r) => r.profitFactor,
  net: (r) => r.net ?? (r.totalR != null ? r.totalR * 1e-6 : null),
  expectancy: (r) => r.expectancy ?? (r.expectancyR != null ? r.expectancyR * 1e-6 : null),
  feeShare: (r) => r.feeShare,
  sharpe: (r) => r.sharpe,
  sortino: (r) => r.sortino,
  dd: (r) => (r.maxDd == null ? null : -r.maxDd),
  green: (r) => r.greenShare,
  bestDay: (r) => (r.bestDayShare == null ? null : -r.bestDayShare),
  streak: (r) => -r.maxLossStreak,
  hold: (r) => r.avgHoldMin,
  first15: (r) => r.first15Share,
  rcov: (r) => r.rCoverage,
};

const CONS_TONE = { ok: "up", warn: "warn", breach: "down" } as const;

export function BenchmarkTable({
  rows, selected, onToggleSelect, me,
}: {
  rows: BenchRow[];
  selected: string[];
  onToggleSelect: (trader: string) => void;
  me: string;
}) {
  const [q, setQ] = useState("");
  const aliases = usePeopleAliases();
  const shown = useMemo(() => {
    const pq = prepareQuery(q);
    return pq.empty ? rows : rows.filter((r) => matchPerson(pq, r.trader, aliases));
  }, [rows, q, aliases]);
  const { rows: sorted, thProps } = useTableSort(shown, ACCESSORS, "net");
  const sel = useMemo(() => new Set(selected), [selected]);
  return (
    <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <PeopleSearchInput value={q} onChange={setQ} />
      {q && <span className="text-xs tabular-nums text-muted-foreground">{shown.length} из {rows.length}</span>}
    </div>
    <DataTable maxHeight="70vh" stickyFirstCol ariaLabel="Таблица трейдеров деска">
      <table>
        <thead>
          <tr>
            <SortableTh {...thProps("trader")}>Трейдер</SortableTh>
            <th scope="col">Кривая</th>
            <SortableTh {...thProps("trades")} align="right">Сделки</SortableTh>
            <SortableTh {...thProps("tpd")} align="right">В день</SortableTh>
            <SortableTh {...thProps("winRate")} align="right">Win rate</SortableTh>
            <SortableTh {...thProps("pf")} align="right">PF</SortableTh>
            <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
            <SortableTh {...thProps("expectancy")} align="right">Ожидание</SortableTh>
            <th scope="col" className="text-right" title="Средняя плюсовая / средняя минусовая сделка">Ср. + / −</th>
            <SortableTh {...thProps("feeShare")} align="right">Комиссии</SortableTh>
            <SortableTh {...thProps("sharpe")} align="right">Sharpe</SortableTh>
            <SortableTh {...thProps("sortino")} align="right">Sortino</SortableTh>
            <SortableTh {...thProps("dd")} align="right">Макс. DD</SortableTh>
            <SortableTh {...thProps("green")} align="right">Зел. дни</SortableTh>
            <SortableTh {...thProps("bestDay")} align="right">Лучший день</SortableTh>
            <SortableTh {...thProps("streak")} align="right">Серии +/−</SortableTh>
            <SortableTh {...thProps("hold")} align="right">Удержание</SortableTh>
            <SortableTh {...thProps("first15")} align="right">9:30–9:45</SortableTh>
            <SortableTh {...thProps("rcov")} align="right">R-покрытие</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const usd = r.equityUnit === "usd";
            const isSel = sel.has(r.trader);
            return (
              <tr key={r.trader} className={cn(!r.qualified && "opacity-60", isSel && "bg-primary/5")}>
                <td className="min-w-[220px] align-top">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      checked={isSel}
                      onChange={() => onToggleSelect(r.trader)}
                      aria-label={`Выбрать ${r.trader} для сравнения`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{r.trader}</span>
                        {r.trader === me && <Pill tone="accent">вы</Pill>}
                        {!r.qualified && <Pill title="Меньше минимума сделок — в перцентилях не участвует">мало сделок</Pill>}
                      </div>
                      {r.badges.length > 0 && (
                        <div className="mt-1 flex max-w-[280px] flex-wrap gap-1">
                          {r.badges.slice(0, 4).map((b) => (
                            <Pill key={b.key + b.kind} tone={b.kind === "strength" ? "up" : "down"} title={b.detail} className="text-2xs">
                              {b.kind === "strength" ? "▲" : "▼"} {b.label}
                            </Pill>
                          ))}
                          {r.badges.length > 4 && <Pill title={r.badges.slice(4).map((b) => b.label).join(", ")} className="text-2xs">+{r.badges.length - 4}</Pill>}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <Sparkline
                    data={r.equity.map((p) => p.cum)}
                    width={96}
                    height={28}
                    baseline={0}
                    ariaLabel={`Кривая ${r.trader}: ${usd ? fmtUsd(r.equity.at(-1)?.cum) : fmtR(r.equity.at(-1)?.cum)}`}
                  />
                </td>
                <td className="text-right">
                  {r.trades}
                  <div className="text-2xs text-muted-foreground">{r.days} дн</div>
                </td>
                <td className="text-right">{fmtNum(r.tradesPerDay, 1)}</td>
                <td className="text-right" title={`${r.wins} W / ${r.losses} L / ${r.be} BE`}>{fmtPct(r.winRate)}</td>
                <td className="text-right" title={r.profitFactor == null && r.losses === 0 && r.wins > 0 ? "Нет убытков — PF не определён" : undefined}>
                  {r.profitFactor != null ? fmtNum(r.profitFactor) : r.profitFactorR != null ? <span className="text-muted-foreground">{fmtNum(r.profitFactorR)}R</span> : "—"}
                </td>
                <td className={cn("text-right font-medium", toneText(toneOf(r.net ?? r.totalR)))}>
                  {r.net != null ? fmtUsd(r.net) : r.totalR != null ? fmtR(r.totalR) : "—"}
                  {r.net != null && r.gross != null && <div className="text-2xs font-normal text-muted-foreground">брутто {fmtUsd(r.gross)}</div>}
                </td>
                <td className={cn("text-right", toneText(toneOf(r.expectancy ?? r.expectancyR)))}>
                  {r.expectancy != null ? fmtUsd(r.expectancy) : fmtR(r.expectancyR)}
                </td>
                <td className="text-right text-xs">
                  <span className="text-up">{fmtUsd(r.avgWin)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-down">{fmtUsd(r.avgLoss)}</span>
                </td>
                <td className={cn("text-right", (r.feeShare ?? 0) > 0.3 && "text-down")} title={r.fees != null ? `Комиссии ${fmtUsd(r.fees, false)}` : undefined}>
                  {fmtPct(r.feeShare)}
                  {r.fees != null && <div className="text-2xs text-muted-foreground">{fmtUsd(r.fees, false)}</div>}
                </td>
                <td className="text-right">{fmtNum(r.sharpe)}</td>
                <td className="text-right">{fmtNum(r.sortino)}</td>
                <td className="text-right">
                  {r.maxDd != null ? fmtUsd(r.maxDd, false) : "—"}
                  {r.maxDd != null && r.maxDd > 0 && (
                    <div className={cn("text-2xs", r.ddRecovered ? "text-muted-foreground" : "text-down")}>
                      {r.ddRecovered ? `восст. ${r.recoveryDays} дн` : "не восстановлен"}
                    </div>
                  )}
                </td>
                <td className="text-right" title={`${r.greenDays} зелёных / ${r.redDays} красных`}>{fmtPct(r.greenShare)}</td>
                <td className="text-right">
                  {r.bestDayShare != null && r.consistencyFlag ? (
                    <Pill tone={CONS_TONE[r.consistencyFlag]} title={r.bestDay ? `${fmtDay(r.bestDay.day)}: ${fmtUsd(r.bestDay.net)}` : undefined}>
                      {r.bestDayShare > 9.99 ? ">999%" : fmtPct(r.bestDayShare)}
                    </Pill>
                  ) : "—"}
                </td>
                <td className="text-right">
                  <span className="text-up">{r.maxWinStreak}</span> / <span className="text-down">{r.maxLossStreak}</span>
                </td>
                <td className="text-right" title={`Плюсовые ${fmtMinutes(r.avgHoldWinMin)}, минусовые ${fmtMinutes(r.avgHoldLossMin)}`}>{fmtMinutes(r.avgHoldMin)}</td>
                <td className="text-right">
                  {r.first15Share != null ? fmtPct(r.first15Share) : "—"}
                  {r.first15Net != null && <div className={cn("text-2xs", toneText(toneOf(r.first15Net)))}>{fmtUsd(r.first15Net)}</div>}
                </td>
                <td className="text-right">
                  {fmtPct(r.rCoverage)}
                  {r.rTrades > 0 && <div className="text-2xs text-muted-foreground">{fmtR(r.totalR)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-2xs text-muted-foreground">
        Деньги — нетто (pnl − |комиссии|). Win rate = W/(W+L). PF = Σ⁺/|Σ⁻|, «—» если нет убытков. Sharpe/Sortino — по дневному нетто × √252, от 5 дней.
        R — только по сделкам со стопом/риском. Бледные строки — меньше минимума сделок.
      </p>
    </DataTable>
    </div>
  );
}
