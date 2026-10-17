import * as React from "react";
import { Link } from "wouter";
import { ArrowUpRight, CalendarRange, CornerDownLeft, LineChart } from "lucide-react";
import { type Trade } from "@workspace/api-client-react";
import { useTradesWindow } from "@/hooks/use-trades-window";
import { Panel, Pill, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { horizonOf, netPnl, resultOf, signedR } from "@/lib/trade-math";
import type { SectionKey } from "./junior-lib";

type Horizon = "intraday" | "overnight" | "swing";

const H_LABEL: Record<Horizon, string> = { intraday: "Интрадей", overnight: "Овернайт", swing: "Свинг" };

function fmtUsd(n: number): string {
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${s}`;
}

function fmtR(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;
}

/** One line per trade, ready to drop into the matching section of the summary. */
export function tradeLine(t: Trade): string {
  const bits = [t.ticker, t.side ?? "", t.setup ?? ""].filter(Boolean).join(" · ");
  const r = signedR(t);
  const pnl = netPnl(t);
  const outcome = resultOf(t);
  const res = [r != null ? fmtR(r) : "", pnl != null ? fmtUsd(pnl) : "", outcome === "win" ? "плюс" : outcome === "loss" ? "минус" : outcome === "be" ? "в ноль" : ""]
    .filter(Boolean)
    .join(", ");
  return `${bits}${res ? ` — ${res}` : ""}. `;
}

/**
 * Right-rail context for a summary day: the day's trades (plus carried overnight/swing positions)
 * grouped by horizon, a one-click "insert into summary", and a link to that day's game plan.
 */
export function JuniorDayContext({
  trader,
  date,
  onInsert,
  className,
}: {
  trader: string;
  date: string;
  onInsert?: (section: SectionKey, text: string) => void;
  className?: string;
}) {
  const { data, isLoading, isError } = useTradesWindow(
    { trader, from: date, to: date },
    { enabled: !!trader, staleTime: 60_000 },
  );

  const { opened, carried } = React.useMemo(() => {
    const all = Array.isArray(data) ? data : [];
    const opened = all.filter((t) => t.date === date);
    const carried = all.filter(
      (t) => t.date < date && horizonOf(t) !== "intraday" && (!t.exitDate || t.exitDate >= date),
    );
    return { opened, carried };
  }, [data, date]);

  const totals = React.useMemo(() => {
    // Signed R from the shared math (a loss stored as R=2 counts −2R, not +2R); net $ = gross − |fees|.
    const rs = opened.map(signedR).filter((v): v is number => v != null);
    const r = rs.reduce((s, v) => s + v, 0);
    const pnls = opened.map(netPnl).filter((v): v is number => v != null);
    const pnl = pnls.reduce((s, v) => s + v, 0);
    const wins = opened.filter((t) => resultOf(t) === "win").length;
    return { r: rs.length ? r : null, pnl: pnls.length ? pnl : null, wins };
  }, [opened]);

  const groups = (["intraday", "overnight", "swing"] as Horizon[])
    .map((h) => ({ h, items: opened.filter((t) => horizonOf(t) === h) }))
    .filter((g) => g.items.length);

  return (
    <Panel
      title="Сделки дня"
      icon={LineChart}
      className={className}
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href={`/game-plan?date=${date}`}>
            <CalendarRange aria-hidden="true" />
            План дня
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Не удалось загрузить сделки.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Сделок" value={String(opened.length)} />
            <Tile label="Итог, R" value={totals.r == null ? "—" : fmtR(totals.r)} tone={toneText(toneOf(totals.r))} />
            <Tile label="P&L net" value={totals.pnl == null ? "—" : fmtUsd(totals.pnl)} tone={toneText(toneOf(totals.pnl))} />
          </div>

          {opened.length === 0 && carried.length === 0 && (
            <p className="text-sm text-muted-foreground">
              За этот день сделок нет. Если торговал — внеси их в «Сделки», и они появятся здесь.
            </p>
          )}

          {groups.map((g) => (
            <div key={g.h} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="micro-label">{H_LABEL[g.h]}</span>
                {onInsert && (
                  <button
                    type="button"
                    onClick={() => onInsert(g.h, g.items.map(tradeLine).join("\n"))}
                    className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                    В сводку
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {g.items.map((t) => <TradeRow key={t.id} t={t} />)}
              </ul>
            </div>
          ))}

          {carried.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="micro-label">Перенесено с прошлых дней</span>
                {onInsert && (
                  <button
                    type="button"
                    onClick={() =>
                      onInsert(
                        carried.some((t) => horizonOf(t) === "swing") ? "swing" : "overnight",
                        carried.map((t) => `${t.ticker} (с ${t.date}) — `).join("\n"),
                      )
                    }
                    className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                    В сводку
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {carried.map((t) => <TradeRow key={t.id} t={t} carried />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function TradeRow({ t, carried }: { t: Trade; carried?: boolean }) {
  const pnl = netPnl(t);
  const r = signedR(t);
  return (
    <li>
      <Link
        href={`/trades?highlight=${t.id}`}
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-semibold">{t.ticker}</span>
        {t.side && <span className="text-xs text-muted-foreground">{t.side}</span>}
        {carried && <Pill tone="purple">{horizonOf(t) === "swing" ? "свинг" : "овернайт"}</Pill>}
        <span className="ml-auto flex items-center gap-2 tabular-nums">
          {r != null && <span className={toneText(toneOf(r))}>{fmtR(r)}</span>}
          {pnl != null && <span className={cn("text-xs", toneText(toneOf(pnl)))}>{fmtUsd(pnl)}</span>}
          {r == null && pnl == null && (
            <span className="text-xs text-muted-foreground">{t.result === "open" ? "открыта" : t.result}</span>
          )}
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
