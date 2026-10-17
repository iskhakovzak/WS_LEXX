/**
 * The trader's own results on the board tickers: net, win rate and best hour per ticker plus an
 * hour-of-day strip. Rendered only when there are trades (the page hides it otherwise).
 */
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { DataTable, Panel, Segmented, TermTooltip, toneOf, toneText } from "@/components/ds";
import { fmtMoney } from "@/components/chart-engine/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { MyHour, MyStats, MyTicker } from "./use-big7";

export type StatsPeriod = "90" | "0";

/** `wr` comes from the API in percent (52.3). */
const wrText = (wr: number | null) => (wr == null ? "—" : `${Math.round(wr)}%`);
/** WR coloured only when clearly away from a coin flip (desk rule: no green for 51%). */
const wrTone = (wr: number | null) => (wr == null ? "text-muted-foreground" : wr >= 60 ? "text-up" : wr <= 40 ? "text-down" : "text-foreground");

function HoursStrip({ hours }: { hours: MyHour[] }) {
  const max = Math.max(1, ...hours.map((h) => Math.abs(h.net)));
  return (
    <div className="flex h-full min-h-[148px] flex-col gap-2">
      <span className="text-xs text-muted-foreground">Нетто по времени входа (ET)</span>
      <div className="grid flex-1 grid-cols-8 items-stretch gap-1.5" role="list">
        {hours.map((h) => {
          const pct = (Math.abs(h.net) / max) * 50;
          return (
            <div
              key={h.key}
              role="listitem"
              className="flex min-w-0 flex-col items-center gap-1"
              title={`${h.label}: ${h.n} сд. · ${fmtMoney(h.net)} · WR ${wrText(h.wr)}`}
            >
              <div className="relative w-full flex-1 rounded-md bg-[var(--glass-bg)]">
                <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
                {h.n > 0 && (
                  <span
                    className={cn("absolute inset-x-1 rounded-sm", h.net >= 0 ? "bg-up/80" : "bg-down/80")}
                    style={h.net >= 0 ? { bottom: "50%", height: `${pct}%` } : { top: "50%", height: `${pct}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <span className="w-full truncate text-center text-xs text-muted-foreground">{h.label}</span>
              <span className={cn("text-xs tabular-nums", h.n ? toneText(toneOf(h.net)) : "text-muted-foreground")}>{h.n ? h.n : "·"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MyStatsPanel({ stats, period, onPeriod, onOpen }: {
  stats: MyStats;
  period: StatsPeriod;
  onPeriod: (p: StatsPeriod) => void;
  onOpen: (symbol: string) => void;
}) {
  const tickers = stats.tickers.filter((t) => t.n > 0);
  const t = stats.total;
  return (
    <Panel
      title="Мои сделки в мегакэпах"
      description={
        t.n > 0
          ? <>{t.n} сд. · <span className={toneText(toneOf(t.net))}>{fmtMoney(t.net)}</span> <TermTooltip term="net">нетто</TermTooltip> · WR {wrText(t.wr)}</>
          : "За этот период сделок нет"
      }
      actions={
        <Segmented
          ariaLabel="Период"
          size="sm"
          value={period}
          onChange={onPeriod}
          options={[{ value: "90", label: "90 дней" }, { value: "0", label: "Всё время" }]}
        />
      }
    >
      {t.n > 0 && (
        <div className="grid grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <DataTable ariaLabel="Мои результаты по тикерам">
            <table>
              <thead>
                <tr>
                  <th scope="col">Тикер</th>
                  <th scope="col" className="text-right">Сделок</th>
                  <th scope="col" className="text-right">Нетто</th>
                  <th scope="col" className="text-right"><TermTooltip term="winrate">WR</TermTooltip></th>
                  <th scope="col" className="text-right">Лонг / шорт</th>
                  <th scope="col">Лучшее время</th>
                  <th scope="col"><span className="sr-only">Сделки</span></th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((r: MyTicker) => (
                  <tr key={r.ticker} className="cursor-pointer" onClick={() => onOpen(r.ticker)}>
                    <td className="font-semibold">{r.ticker}</td>
                    <td className="text-right">{r.n}</td>
                    <td className={cn("text-right font-medium", toneText(toneOf(r.net)))}>{fmtMoney(r.net)}</td>
                    <td className={cn("text-right", wrTone(r.wr))}>{wrText(r.wr)}</td>
                    <td className="text-right text-xs">
                      <span className={toneText(toneOf(r.longNet))}>{fmtMoney(r.longNet, 0)}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className={toneText(toneOf(r.shortNet))}>{fmtMoney(r.shortNet, 0)}</span>
                    </td>
                    <td className="text-xs">
                      {r.bestHour ? (
                        <span className="whitespace-nowrap"><span className="text-foreground">{r.bestHour.label}</span> <span className="text-up">{fmtMoney(r.bestHour.net, 0)}</span></span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-right">
                      <Link
                        href={links.trades({ ticker: r.ticker })}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
                        aria-label={`Сделки по ${r.ticker}`}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          <HoursStrip hours={stats.hours} />
        </div>
      )}
    </Panel>
  );
}

/** Compact block for the detail sheet: one ticker's numbers. */
export function MyTickerStats({ row }: { row: MyTicker | undefined }) {
  if (!row || row.n === 0) return null;
  const cells: Array<[string, React.ReactNode]> = [
    ["Сделок", row.n],
    ["Нетто", <span className={toneText(toneOf(row.net))}>{fmtMoney(row.net)}</span>],
    ["WR", <span className={wrTone(row.wr)}>{wrText(row.wr)}</span>],
    ["Средняя", <span className={toneText(toneOf(row.avg))}>{fmtMoney(row.avg)}</span>],
    ["Лучшее время", row.bestHour ? `${row.bestHour.label} · ${fmtMoney(row.bestHour.net, 0)}` : "—"],
    ["Худшее время", row.worstHour ? `${row.worstHour.label} · ${fmtMoney(row.worstHour.net, 0)}` : "—"],
  ];
  return (
    <Panel
      title={`Мои сделки ${row.ticker}`}
      actions={
        <Link href={links.trades({ ticker: row.ticker })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          Все сделки <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {cells.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
