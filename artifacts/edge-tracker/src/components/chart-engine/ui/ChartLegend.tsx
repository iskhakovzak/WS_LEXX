import * as React from "react";
import { cn } from "@/lib/utils";
import type { Bar, PositionState, Side } from "../types";
import { fmtEtDateTime, formatDuration } from "../lib/time";
import { fmtMoney, fmtPct, fmtPrice, fmtR, fmtVol } from "../lib/format";

export type LegendInfo = {
  bar: Bar;
  idx: number;
  /** Whether the legend follows the mouse (vs. the replay cursor). */
  hovered: boolean;
  position: PositionState | null;
  /** Seconds since the entry fill at this bar (null before entry). */
  sinceEntry: number | null;
  vwap: { vwap: number; sd: number } | null;
  avwap: number | null;
  rvol: number | null;
  risk: number | null;
  side: Side;
  prevClose: number | null;
};

const tone = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || n === 0 ? "text-foreground" : n > 0 ? "text-up" : "text-down");

/** OHLCV + position readout at the crosshair (or the replay cursor). */
export function ChartLegend({ info, ticker, className }: { info: LegendInfo | null; ticker: string; className?: string }) {
  if (!info) return null;
  const { bar, position: pos } = info;
  const chg = bar.c - bar.o;
  const chgPct = bar.o ? (chg / bar.o) * 100 : null;
  const vsPrev = info.prevClose ? ((bar.c - info.prevClose) / info.prevClose) * 100 : null;
  const unreal = pos?.unrealized ?? null;
  const r = unreal != null && info.risk && pos && pos.qty > 0 ? unreal / (info.risk * pos.qty) : null;
  return (
    <div
      className={cn(
        // One line only: at narrow widths the tail is clipped with a fade instead of wrapping over the chart.
        "pointer-events-none absolute left-2 top-2 z-raised flex max-w-[calc(100%-1rem)] items-center gap-x-3 overflow-hidden whitespace-nowrap rounded-xl border border-[var(--glass-border)] bg-background/80 px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground shadow-[var(--glass-shadow-sm)] backdrop-blur [&>*]:shrink-0 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]",
        className,
      )}
      aria-live="polite"
    >
      <span className="font-semibold text-foreground">{ticker}</span>
      <span className="text-foreground">{fmtEtDateTime(bar.t)}</span>
      <span>O <b className="text-foreground">{fmtPrice(bar.o)}</b></span>
      <span>H <b className="text-foreground">{fmtPrice(bar.h)}</b></span>
      <span>L <b className="text-foreground">{fmtPrice(bar.l)}</b></span>
      <span>C <b className={tone(chg)}>{fmtPrice(bar.c)}</b> <span className={tone(chg)}>{fmtPct(chgPct)}</span></span>
      {vsPrev != null && <span title="К закрытию предыдущего дня">Δпред <b className={tone(vsPrev)}>{fmtPct(vsPrev)}</b></span>}
      <span>V <b className="text-foreground">{fmtVol(bar.v)}</b>{info.rvol != null && <span className={cn("ml-1", info.rvol >= 2 ? "text-[hsl(var(--chart-3))]" : "")} title="Относительный объём к среднему того же времени в другие дни">RVOL {info.rvol.toFixed(2)}</span>}</span>
      {info.vwap && <span>VWAP <b className="text-[hsl(var(--chart-5))]">{fmtPrice(info.vwap.vwap)}</b> <span title="±1σ">σ {fmtPrice(info.vwap.sd)}</span></span>}
      {info.avwap != null && <span>AVWAP <b className="text-primary">{fmtPrice(info.avwap)}</b></span>}
      {pos && pos.fillsSoFar > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--glass-bg)] px-2 py-0.5 text-foreground">
          {pos.avg != null ? (
            <>
              <span>{info.side === "short" ? "Шорт" : "Лонг"} {pos.qty > 0 ? `${pos.qty.toLocaleString("en-US")} шт.` : ""}{pos.qtyAssumed ? "≈" : ""}</span>
              <span>ср. {fmtPrice(pos.avg)}</span>
              <b className={tone(unreal)}>{unreal != null ? fmtMoney(unreal) : "—"}{r != null ? ` · ${fmtR(r)}` : ""}</b>
              {pos.realized !== 0 && <span className={tone(pos.realized)}>реализ. {fmtMoney(pos.realized)}</span>}
            </>
          ) : (
            <span>закрыто · итог <b className={tone(pos.realized)}>{fmtMoney(pos.realized)}</b></span>
          )}
          {info.sinceEntry != null && info.sinceEntry >= 0 && <span className="text-muted-foreground">· {formatDuration(info.sinceEntry)} от входа</span>}
        </span>
      )}
      {info.hovered && <span className="opacity-70">(курсор)</span>}
    </div>
  );
}
