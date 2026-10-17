import * as React from "react";
import { Link } from "wouter";
import { History, Moon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, Segmented } from "@/components/ds";
import { links } from "@/lib/links";
import type { DeskRow, LimitEvent, RiskPosition } from "./use-risk";
import { useLimitsHistory, useTraderDay } from "./use-risk";
import { HistoryCharts } from "./history-charts";
import { LimitsForm } from "./limits-form";
import { PositionsTable } from "./positions-table";
import { AlertList } from "./usage";
import { LevelBadge, TierPill } from "./primitives";
import { rankLevel } from "./risk-math";
import { rankInput } from "./desk-table";
import { StopRemaining } from "./remaining";
import { DayTradesList, DaySkeleton, TraderDayBlock } from "./intraday";
import { BreachHistory, useBreaches } from "./breaches";
import { cn } from "@/lib/utils";
import { fmtDate, fmtR, fmtUsd } from "@/lib/format";

type Tab = "overview" | "trades" | "breaches" | "limits";

function TradesTab({ trader }: { trader: string }) {
  const q = useTraderDay(trader);
  const day = q.data;
  if (q.isLoading) return <DaySkeleton height={160} />;
  if (!day?.date || !day.trades.length) return <p className="text-sm text-muted-foreground">За последние 10 дней закрытых сделок нет.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {day.isToday ? "Сегодня" : `Последний торговый день · ${fmtDate(day.date, "dayMonthNumeric")}`} · {day.trades.length} сд. · нетто{" "}
        <span className={cn("font-semibold", (day.net ?? 0) > 0 ? "text-up" : (day.net ?? 0) < 0 ? "text-down" : "text-foreground")}>{fmtUsd(day.net, { signed: true, decimals: 0 })}</span>
        {day.fees > 0 && <> · комиссии {fmtUsd(day.fees, { decimals: 0 })}</>}
      </p>
      <DayTradesList day={day} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link href={links.journalDay(day.date, trader)}>Журнал дня</Link></Button>
        <Button asChild variant="outline" size="sm"><Link href={links.trades({ date: day.date })}>Все сделки дня</Link></Button>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  tier: "тир",
  accountSize: "счёт",
  dailyLossLimit: "дневной лимит",
  weeklyLossLimit: "недельный лимит",
  maxDrawdown: "макс. просадка",
  maxRiskPerTrade: "риск/сделка",
  maxPositionUsd: "BP на позицию",
  maxOvernightExposure: "макс. овернайт",
  maxOpenPositions: "макс. позиций",
  allowOvernight: "овернайт",
  allowSwing: "свинг",
  notes: "заметка",
};

function fmtVal(k: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "number") return k === "maxOpenPositions" ? String(v) : fmtUsd(v, { decimals: 0 });
  return String(v);
}

/** Only the fields that actually changed between before/after. */
function diff(e: LimitEvent): { key: string; from: string; to: string }[] {
  const keys = Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[];
  const out: { key: string; from: string; to: string }[] = [];
  for (const k of keys) {
    const a = (e.before as Record<string, unknown> | null)?.[k];
    const b = (e.after as Record<string, unknown>)?.[k];
    if ((a ?? null) === (b ?? null)) continue;
    out.push({ key: FIELD_LABEL[k], from: fmtVal(k, a), to: fmtVal(k, b) });
  }
  return out;
}

function LimitsHistory({ trader }: { trader: string }) {
  const q = useLimitsHistory(trader);
  if (q.isLoading) return <Skeleton className="h-16 rounded-xl" />;
  if (q.isError) return <p className="text-xs text-muted-foreground">История изменений недоступна.</p>;
  const events = q.data ?? [];
  if (events.length === 0) return <p className="text-xs text-muted-foreground">Изменений ещё не было.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {events.map((e) => {
        const d = diff(e);
        return (
          <li key={e.id} className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs ring-1 ring-inset ring-[var(--field-border)]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
              <span className="tabular-nums">{fmtDate(e.changedAt, "shortDateTime")}</span>
              {e.changedBy && <span>· {e.changedBy}</span>}
              {!e.before && <Pill tone="accent">первые лимиты</Pill>}
            </div>
            {e.reason && <div className="mt-0.5 font-medium text-foreground">{e.reason}</div>}
            {d.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                {d.map((x) => (
                  <li key={x.key}><span className="text-muted-foreground">{x.key}:</span> {x.from} → <span className="font-medium text-foreground">{x.to}</span></li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TraderSheet({
  row,
  positions,
  open,
  onOpenChange,
  initialTab = "overview",
}: {
  row: DeskRow | null;
  positions: RiskPosition[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: "overview" | "limits";
}) {
  const [tab, setTab] = React.useState<Tab>(initialTab);
  React.useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab, row?.trader]);

  const mine = React.useMemo(() => (row ? positions.filter((p) => p.trader === row.trader) : []), [positions, row]);
  const limitsMap = React.useMemo(() => new Map(row ? [[row.trader, row.limits]] : []), [row]);
  const breaches = useBreaches(row?.trader ?? null, row?.limits, open && !!row);
  const breachCount = breaches.rows.filter((b) => b.level === "breach").length;

  const level = row ? rankLevel(rankInput(row)) : "none";
  const pnl = row ? row.today.pnlNet ?? null : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <div className="flex flex-col gap-5">
            <SheetHeader className="pr-10 text-left">
              <div className="flex flex-wrap items-center gap-3">
                <SheetTitle className="text-xl">{row.trader}</SheetTitle>
                <LevelBadge level={level} />
                <TierPill tier={row.limits?.tier} />
              </div>
              <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span>
                  Сегодня{" "}
                  <span className={cn("font-medium", (pnl ?? row.today.r) > 0 ? "text-up" : (pnl ?? row.today.r) < 0 ? "text-down" : "text-foreground")}>
                    {pnl != null ? fmtUsd(pnl, { signed: true, decimals: 0 }) : row.today.trades ? fmtR(row.today.r) : "сделок нет"}
                  </span>
                </span>
                <span>Неделя <span className="font-medium text-foreground">{row.week.pnlNet != null ? fmtUsd(row.week.pnlNet, { signed: true, decimals: 0 }) : row.week.trades ? fmtR(row.week.r) : "сделок нет"}</span></span>
                <span>Сделок сегодня <span className="font-medium text-foreground">{row.today.trades}</span></span>
                {row.today.carriedTonight > 0 && (
                  <span className={cn("inline-flex items-center gap-1", row.limits && !row.limits.allowOvernight && "text-down")}>
                    <Moon className="h-3 w-3" aria-hidden="true" />{row.today.carriedTonight} поз. через закрытие
                  </span>
                )}
              </SheetDescription>
              {row.stop.state !== "no_limits" && (row.halted || row.stop.state === "warn") && (
                <p role="status" className={cn("text-sm font-medium tabular-nums", row.halted ? "text-down" : "text-warn")}>{row.stop.message}</p>
              )}
            </SheetHeader>

            <Segmented
              ariaLabel="Раздел карточки трейдера"
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "Обзор" },
                { value: "trades", label: "Сделки" },
                { value: "breaches", label: "Нарушения", count: breachCount || undefined },
                { value: "limits", label: row.limits ? "Лимиты" : "Задать лимиты" },
              ]}
            />

            {tab === "overview" && (
              <div className="flex flex-col gap-6">
                {row.alerts.length > 0 && <AlertList alerts={row.alerts} />}
                {row.limits ? (
                  <section aria-label="Остаток до стопа">
                    <h3 className="micro-label mb-2">Остаток до стопа</h3>
                    <StopRemaining m={row} limits={row.limits} />
                  </section>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5 text-sm ring-1 ring-inset ring-[var(--field-border)]">
                    <span className="text-muted-foreground">Лимиты не заданы — стоп и предупреждения не считаются.</span>
                    <Button size="sm" variant="outline" onClick={() => setTab("limits")}>Задать лимиты</Button>
                  </div>
                )}
                <section aria-label="Торговый день">
                  <h3 className="micro-label mb-2">Кривая дня против дневного стопа</h3>
                  <TraderDayBlock trader={row.trader} dailyLimit={row.limits?.dailyLossLimit} />
                </section>
                {mine.length > 0 && (
                  <section aria-label="Открытые позиции">
                    <h3 className="micro-label mb-2">Открытые позиции · {mine.length}</h3>
                    <PositionsTable positions={mine} limitsByTrader={limitsMap} storageKey="risk.sheet.horizon" compact />
                  </section>
                )}
                <section aria-label="История">
                  <h3 className="micro-label mb-2">Кривая и дни</h3>
                  <HistoryCharts trader={row.trader} compact />
                </section>
              </div>
            )}

            {tab === "trades" && <TradesTab trader={row.trader} />}

            {tab === "breaches" && <BreachHistory trader={row.trader} limits={row.limits} />}

            {tab === "limits" && (
              <div className="flex flex-col gap-6">
                <LimitsForm trader={row.trader} limits={row.limits} />
                <section aria-label="История изменений лимитов">
                  <h3 className="micro-label mb-2 flex items-center gap-1"><History className="h-3 w-3" aria-hidden="true" />История изменений</h3>
                  <LimitsHistory trader={row.trader} />
                </section>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
