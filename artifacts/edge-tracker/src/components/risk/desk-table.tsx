/**
 * Curator desk table: one row per trader, sorted by risk (stop → near → ok → no limits, then worst usage).
 * Limit usage as bars (day / week / drawdown), today's net P&L, open book (long / short / gross), overnight,
 * ticker concentration; row → trader card.
 */
import * as React from "react";
import { Moon, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, SortableTh, useTableSort } from "@/components/ds";
import { Button } from "@/components/ui/button";
import type { DeskRow } from "./use-risk";
import { rankLevel, riskScore, worstUsage, type RankInput, type RankLevel, type TraderExposure } from "./risk-math";
import { LevelBadge, UsageCell, fmtSignedUsd, fmtUsd, tierLabel } from "./primitives";

export type DeskTableRow = {
  row: DeskRow;
  level: RankLevel;
  score: number;
  worst: number | null;
  exposure: TraderExposure | null;
};

export function rankInput(r: DeskRow): RankInput {
  const alertPct = r.alerts.reduce<number | null>((m, a) => (a.pct != null && (m == null || a.pct > m) ? a.pct : m), null);
  return {
    halted: r.halted,
    status: r.status,
    stopState: r.stop.state,
    dailyPct: r.stop.dailyPct,
    weeklyPct: r.stop.weeklyPct,
    drawdownPct: r.stop.drawdownPct,
    alertPct,
    todayPnl: r.today.pnlNet,
  };
}

export function toTableRows(rows: DeskRow[], exposure: Map<string, TraderExposure>): DeskTableRow[] {
  return rows.map((row) => {
    const ri = rankInput(row);
    return { row, level: rankLevel(ri), score: riskScore(ri), worst: worstUsage(ri), exposure: exposure.get(row.trader) ?? null };
  });
}

/** Short reason next to the status: what exactly is near / over. */
function statusDetail(t: DeskTableRow): string | null {
  const r = t.row;
  if (t.level === "none") return null;
  if (r.halted) return r.stop.label.toLowerCase();
  const top = r.alerts[0];
  if (top) return `${top.label.toLowerCase()}${top.pct != null ? ` ${Math.round(top.pct)}%` : ""}`;
  if (r.stop.dailyRemainingUsd != null) return `ещё ${fmtUsd(r.stop.dailyRemainingUsd)} до стопа`;
  return null;
}

const ACCESSORS = {
  risk: (t: DeskTableRow) => t.score,
  trader: (t: DeskTableRow) => t.row.trader,
  daily: (t: DeskTableRow) => t.row.stop.dailyPct,
  weekly: (t: DeskTableRow) => t.row.stop.weeklyPct,
  drawdown: (t: DeskTableRow) => t.row.stop.drawdownPct,
  pnl: (t: DeskTableRow) => t.row.today.pnlNet,
  gross: (t: DeskTableRow) => t.exposure?.grossUsd ?? null,
  overnight: (t: DeskTableRow) => t.exposure?.overnightUsd ?? (t.row.today.overnightExposureUsd || null),
};

const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function DeskTable({ rows, onOpen }: { rows: DeskTableRow[]; onOpen: (trader: string) => void }) {
  const { rows: sorted, thProps } = useTableSort(rows, ACCESSORS, "risk");

  return (
    <DataTable ariaLabel="Трейдеры по риску" density="comfortable">
      <table>
        <thead>
          <tr>
            <SortableTh {...thProps("trader")}>Трейдер</SortableTh>
            <SortableTh {...thProps("risk")}>Статус</SortableTh>
            <SortableTh {...thProps("daily")}>День</SortableTh>
            <SortableTh {...thProps("weekly")}>Неделя</SortableTh>
            <SortableTh {...thProps("drawdown")}>Просадка</SortableTh>
            <SortableTh {...thProps("pnl")} align="right">P&L сегодня</SortableTh>
            <SortableTh {...thProps("gross")} align="right">Позиции</SortableTh>
            <SortableTh {...thProps("overnight")} align="right">Овернайт</SortableTh>
            <th scope="col">Топ-тикер</th>
            <th scope="col" className="w-12"><span className="sr-only">Карточка</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const r = t.row;
            const L = r.limits;
            const e = t.exposure;
            const pnl = r.today.pnlNet;
            const detail = statusDetail(t);
            const todayLoss = Math.max(0, -(pnl ?? 0));
            const weekLoss = Math.max(0, -(r.week.pnlNet ?? 0));
            const overnightBad = L != null && !L.allowOvernight && (e?.overnightCount ?? r.today.carriedTonight) > 0;
            const concentrated = e?.topTickerPct != null && e.count >= 2 && e.topTickerPct >= 50;
            return (
              <tr
                key={r.trader}
                onClick={() => onOpen(r.trader)}
                className={cn(
                  "cursor-pointer",
                  t.level === "stop" && "bg-down/[0.06]",
                  t.level === "near" && "bg-warn/[0.06]",
                )}
              >
                <td>
                  <button
                    type="button"
                    onClick={(ev) => { ev.stopPropagation(); onOpen(r.trader); }}
                    className="whitespace-nowrap rounded-md text-left font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r.trader}
                  </button>
                  <div className="text-xs text-muted-foreground">{tierLabel(L?.tier) ?? "без тира"}</div>
                </td>
                <td>
                  <LevelBadge level={t.level} />
                  {detail && <div className="mt-0.5 max-w-[150px] truncate text-xs text-muted-foreground" title={r.stop.message}>{detail}</div>}
                </td>
                <td><UsageCell label={`${r.trader}, дневной лимит`} pct={r.stop.dailyPct} used={todayLoss} limit={L?.dailyLossLimit} /></td>
                <td><UsageCell label={`${r.trader}, недельный лимит`} pct={r.stop.weeklyPct} used={weekLoss} limit={L?.weeklyLossLimit} /></td>
                <td><UsageCell label={`${r.trader}, макс. просадка`} pct={r.stop.drawdownPct} used={r.drawdown.currentUsd} limit={L?.maxDrawdown} /></td>
                <td className="text-right">
                  <div className={cn("font-semibold", pnl == null ? "text-muted-foreground" : pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "")}>
                    {pnl != null ? fmtSignedUsd(pnl) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.today.trades ? `${r.today.trades} сд.` : r.lastTradeDate ? `посл. ${ddmm(r.lastTradeDate)}` : "нет сделок"}
                  </div>
                </td>
                <td className="text-right">
                  {e && e.count > 0 ? (
                    <>
                      <div className="font-medium">{e.count} · {fmtUsd(e.grossUsd, { compact: true })}</div>
                      <div className="text-xs text-muted-foreground">
                        лонг {fmtUsd(e.longUsd, { compact: true })} / шорт {fmtUsd(e.shortUsd, { compact: true })}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">нет</span>
                  )}
                </td>
                <td className="text-right">
                  {e && e.overnightCount > 0 ? (
                    <span className={cn("inline-flex items-center gap-1 font-medium", overnightBad && "text-down")} title={overnightBad ? "Овернайт запрещён лимитами" : undefined}>
                      <Moon className="h-3 w-3" aria-hidden="true" />
                      {e.overnightCount} · {fmtUsd(e.overnightUsd, { compact: true })}
                      {overnightBad && <span className="sr-only">овернайт запрещён</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td>
                  {e?.topTicker ? (
                    <span className={cn("text-xs", concentrated ? "font-medium text-warn" : "text-muted-foreground")} title={concentrated ? "Больше половины экспозиции в одном тикере" : undefined}>
                      {e.topTicker} {Math.round(e.topTickerPct ?? 0)}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Карточка трейдера ${r.trader}`}
                    title="Карточка трейдера"
                    onClick={(ev) => { ev.stopPropagation(); onOpen(r.trader); }}
                  >
                    <PanelRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DataTable>
  );
}
