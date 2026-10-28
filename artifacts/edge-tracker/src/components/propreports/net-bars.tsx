/**
 * Diverging net P&L bars (by entry time / by weekday) in the shared chart language: a centred zero hairline, rounded
 * data ends with a soft gradient (the zero side flat), the value right at the bar's end, trades · win rate as a muted
 * second line, the best / worst rows marked, and focus + context on hover (the other rows recede). No grey track.
 */
import { Crown, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct, fmtUsd } from "@/lib/format";
import { propreportsI18n } from "@/i18n/ns/propreports";
import { commonI18n } from "@/i18n/ns/common";
import type { PerfRow } from "./api";

const pct = (v: number | null | undefined) => fmtPct(v, { decimals: 0, signed: false });

/** Room kept beyond the longest bar for its value label (the label always sits outside, at the bar's end). */
const LABEL_ROOM = "4.75rem";

export function NetBars({ rows, labelOf, title, className }: { rows: PerfRow[]; labelOf: (label: string) => string; title: string; className?: string }) {
  const { t } = propreportsI18n.useT();
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.totals.net)));
  const nets = rows.map((r) => r.totals.net);
  const best = rows.length > 1 ? Math.max(...nets) : null;
  const worst = rows.length > 1 ? Math.min(...nets) : null;
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 sm:p-4", className)} aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="group/bars relative grid gap-1" role="list">
        {/* The zero axis: one crisp hairline through every row. */}
        <div className="pointer-events-none absolute inset-y-0 left-[calc(50%+4rem)] w-px bg-foreground/25" aria-hidden="true" />
        {rows.map((r) => {
          const net = r.totals.net;
          const up = net >= 0;
          const k = Math.abs(net) / max;
          const mark = net === best && net > 0 ? "best" : net === worst && net < 0 ? "worst" : null;
          const label = labelOf(r.label);
          const half = `(50% - ${LABEL_ROOM})`;
          return (
            <div
              key={r.label}
              role="listitem"
              data-row=""
              className={cn(
                "grid grid-cols-[7.5rem_1fr] items-center gap-2 rounded-lg px-1 py-1 text-xs transition-[opacity,background-color] duration-[var(--dur-1)]",
                "hover:bg-[var(--glass-hover-bg)] group-has-[[data-row]:hover]/bars:[&:not(:hover)]:opacity-50",
              )}
              title={t("perf.barTitle", { label, trades: commonI18n.t("units.trades", { count: r.trades }), winRate: pct(r.totals.winRate), gross: fmtUsd(r.totals.gross), fees: fmtUsd(r.totals.fees) })}
            >
              <span className="flex min-w-0 flex-col leading-tight">
                <span className={cn("truncate", mark ? "font-semibold text-foreground" : "text-foreground/85")}>{label}</span>
                <span className="truncate text-2xs tabular-nums text-muted-foreground">
                  {commonI18n.t("units.trades", { count: r.trades })} · {pct(r.totals.winRate)}
                </span>
              </span>
              <div className="relative h-7">
                {net !== 0 && (
                  <div
                    className={cn("absolute top-1/2 h-3.5 -translate-y-1/2", up ? "rounded-r-[6px] rounded-l-[1px]" : "rounded-l-[6px] rounded-r-[1px]")}
                    style={{
                      [up ? "left" : "right"]: "50%",
                      width: `max(3px, calc(${half} * ${k.toFixed(4)}))`,
                      backgroundImage: `linear-gradient(${up ? "to right" : "to left"}, hsl(var(--${up ? "up" : "down"}) / 0.5), hsl(var(--${up ? "up" : "down"}) / 0.95))`,
                    }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn("absolute top-1/2 inline-flex -translate-y-1/2 items-center gap-1 whitespace-nowrap font-semibold tabular-nums", up ? "text-up" : "text-down", net === 0 && "text-muted-foreground")}
                  style={up ? { left: `calc(50% + max(3px, calc(${half} * ${k.toFixed(4)})) + 0.375rem)` } : { right: `calc(50% + max(3px, calc(${half} * ${k.toFixed(4)})) + 0.375rem)` }}
                >
                  {!up && mark && <MarkIcon kind={mark} label={t(mark === "best" ? "perf.barBest" : "perf.barWorst")} />}
                  {fmtUsd(net, { signed: true })}
                  {up && mark && <MarkIcon kind={mark} label={t(mark === "best" ? "perf.barBest" : "perf.barWorst")} />}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Subtle best / worst marker: a small icon chip with an accessible name (never colour alone). */
function MarkIcon({ kind, label }: { kind: "best" | "worst"; label: string }) {
  const Icon = kind === "best" ? Crown : TrendingDown;
  return (
    <span role="img" aria-label={label} title={label} className={cn("grid size-4 place-items-center rounded-full", kind === "best" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
      <Icon className="size-2.5" aria-hidden="true" />
    </span>
  );
}
