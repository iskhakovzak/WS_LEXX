import * as React from "react";
import { Link } from "wouter";
import { Activity, Briefcase, Calculator, Check, LineChart, OctagonX, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isNotFound } from "@/lib/api/errors";
import { useRiskMe, useRiskPositions } from "./use-risk";
import { TIERS, TierPill } from "./primitives";
import { links } from "@/lib/links";
import { AlertList } from "./usage";
import { PositionsTable } from "./positions-table";
import { HistoryCharts } from "./history-charts";
import { LimitsForm } from "./limits-form";
import { StopRemaining } from "./remaining";
import { TraderDayBlock } from "./intraday";
import { BreachHistory } from "./breaches";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtR, fmtUsd } from "@/lib/format";

function Allowed({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", ok ? "text-foreground" : "text-muted-foreground line-through")}>
      {ok ? <Check className="h-3.5 w-3.5 text-up" aria-hidden="true" /> : <X className="h-3.5 w-3.5 text-down" aria-hidden="true" />}
      {label}
      <span className="sr-only">{ok ? "разрешено" : "запрещено"}</span>
    </span>
  );
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "up" | "down" | "warn" }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}

export function MyRiskView({ trader, onUpdatedAt, canEditLimits = false }: {
  trader: string;
  onUpdatedAt?: (ts: number) => void;
  /** Staff (curator/admin) may set limits right here — the same LimitsForm as in the desk trader card. */
  canEditLimits?: boolean;
}) {
  const me = useRiskMe();
  const pos = useRiskPositions(trader);
  const [limitsOpen, setLimitsOpen] = React.useState(false);

  React.useEffect(() => {
    if (me.dataUpdatedAt) onUpdatedAt?.(me.dataUpdatedAt);
  }, [me.dataUpdatedAt, onUpdatedAt]);

  if (me.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (me.isError || !me.data) {
    const notReady = isNotFound(me.error);
    return (
      <Panel>
        <EmptyState
          icon={ShieldCheck}
          title={notReady ? "Риск-деск ещё не подключён на сервере" : "Не удалось загрузить риск"}
          description={notReady ? "API /api/risk пока недоступно — обновите страницу позже." : (me.error as Error | null)?.message}
        />
      </Panel>
    );
  }

  const m = me.data;
  const L = m.limits;
  const stop = m.stop;
  const positions = pos.data?.positions ?? [];
  const tierIdx = L?.tier ? TIERS.findIndex((t) => t.value === L.tier) : -1;
  const nextTier = tierIdx >= 0 ? TIERS[tierIdx + 1] : undefined;
  const afterOpen = m.today.dailyRemainingAfterOpenRiskUsd;
  const pnl = m.today.pnlNet;
  const HeroIcon = m.halted ? OctagonX : stop.state === "warn" ? ShieldAlert : ShieldCheck;

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {/* Hero: how much is left to the stop today / this week */}
      <Panel
        className={cn(m.halted ? "ring-1 ring-inset ring-down/50" : stop.state === "warn" ? "ring-1 ring-inset ring-warn/40" : undefined)}
        bodyClassName="flex flex-col gap-4"
      >
        <div role={m.halted ? "alert" : "status"} className="flex flex-wrap items-center gap-3">
          <HeroIcon className={cn("h-6 w-6 shrink-0", m.halted ? "text-down" : stop.state === "warn" ? "text-warn" : L ? "text-up" : "text-muted-foreground")} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-base font-semibold", m.halted && "text-down", !m.halted && stop.state === "warn" && "text-warn")}>
              {stop.state === "no_limits"
                ? "Лимиты не заданы"
                : m.halted
                  ? "Стоп — на сегодня торговля закончена"
                  : stop.state === "warn"
                    ? "Близко к стопу — снизьте размер"
                    : "В пределах лимитов"}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {stop.state === "no_limits"
                ? canEditLimits ? "Задайте лимиты — здесь появится остаток до стопа на день и неделю." : "Попросите куратора задать лимиты — здесь появится остаток до стопа на день и неделю."
                : stop.message}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <Fact label="P&L сегодня, нетто" value={pnl != null ? fmtUsd(pnl, { signed: true, decimals: 0 }) : m.today.trades ? fmtR(m.today.r) : "—"} tone={(pnl ?? 0) > 0 ? "up" : (pnl ?? 0) < 0 ? "down" : undefined} />
            <Fact label="Сделок сегодня" value={m.today.trades} />
            {m.today.openPositions > 0 && <Fact label="Открытый риск" value={fmtUsd(m.today.openRiskUsd, { decimals: 0 })} tone={afterOpen != null && afterOpen < 0 ? "down" : undefined} />}
          </div>
          {stop.state === "no_limits" && canEditLimits && <Button size="sm" onClick={() => setLimitsOpen(true)}>Задать лимиты</Button>}
        </div>

        {L && <StopRemaining m={m} limits={L} big />}

        {L && m.today.openRiskUsd > 0 && afterOpen != null && (
          <p className={cn("text-xs tabular-nums", afterOpen < 0 ? "font-medium text-down" : "text-muted-foreground")}>
            Если сработают все стопы открытых позиций: {afterOpen < 0 ? `превышение дневного лимита на ${fmtUsd(-afterOpen, { decimals: 0 })}` : `останется ${fmtUsd(afterOpen, { decimals: 0 })} до дневного стопа`}.
          </p>
        )}

        {m.alerts.length > 0 && <AlertList alerts={m.alerts} />}
        {m.drawdown.redDayStreak >= 2 && (
          <p className="text-xs text-warn">{m.drawdown.redDayStreak} красных дня подряд — снизьте размер до первого зелёного дня.</p>
        )}
      </Panel>

      <div className={cn("grid grid-cols-1 gap-[var(--grid-gap)]", L && "lg:grid-cols-3")}>
        <Panel title="Мой торговый день" icon={Activity} description="Кривая P&L нетто по времени закрытия против дневного стопа" className={L ? "lg:col-span-2" : undefined}>
          <TraderDayBlock trader={trader} dailyLimit={L?.dailyLossLimit} showTrades height={200} />
        </Panel>

        {L && <Panel title="Мои параметры" icon={SlidersHorizontal} actions={<TierPill tier={L.tier} />}>
          {
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">BP на позицию</dt><dd className="font-medium tabular-nums">{fmtUsd(L.maxPositionUsd, { decimals: 0 })}</dd></div>
                <div><dt className="text-xs text-muted-foreground">1R (риск/сделка)</dt><dd className="font-medium tabular-nums">{fmtUsd(L.maxRiskPerTrade, { decimals: 0 })}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Позиций одновременно</dt><dd className="font-medium tabular-nums">{L.maxOpenPositions ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Овернайт до</dt><dd className="font-medium tabular-nums">{L.allowOvernight ? fmtUsd(L.maxOvernightExposure, { decimals: 0, compact: 10_000 }) : "—"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-3">
                <Allowed ok label="Интрадей" />
                <Allowed ok={L.allowOvernight} label="Овернайт" />
                <Allowed ok={L.allowSwing} label="Свинг" />
              </div>
              {nextTier && <p className="text-xs text-muted-foreground">Следующая ступень — <span className="font-medium text-foreground">{nextTier.label}</span> ({nextTier.hint}). Тир повышает куратор по итогам недель без нарушений.</p>}
              {L.notes && <p className="rounded-xl bg-[var(--glass-bg)] p-3 text-sm text-muted-foreground ring-1 ring-inset ring-[var(--field-border)]">{L.notes}</p>}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/calculator"><Calculator className="mr-1.5 h-4 w-4" aria-hidden="true" />Калькулятор опционов</Link>
                </Button>
                {canEditLimits && <Button variant="ghost" size="sm" onClick={() => setLimitsOpen(true)}>Изменить лимиты</Button>}
              </div>
            </div>
          }
        </Panel>}
      </div>

      {positions.length > 0 && (
        <Panel title={`Мои открытые позиции · ${positions.length}`} icon={Briefcase}>
          <PositionsTable positions={positions} limitsByTrader={new Map([[trader, L]])} storageKey="risk.me.horizon" />
        </Panel>
      )}
      {pos.isError && <p role="alert" className="text-sm text-down">Не удалось загрузить позиции: {(pos.error as Error).message}</p>}

      {L && (
        <Panel title="Нарушения лимитов" icon={ShieldAlert} description="Дни, недели и эпизоды просадки, где лимит был превышен или использован на 70%+">
          <BreachHistory trader={trader} limits={L} max={8} />
        </Panel>
      )}

      <Panel
        title="Капитал и просадка"
        icon={LineChart}
        actions={<Link href={links.journalDay(m.today.date, trader)} className="text-xs text-primary hover:underline">журнал →</Link>}
      >
        <HistoryCharts trader={trader} />
      </Panel>

      {canEditLimits && (
        <Sheet open={limitsOpen} onOpenChange={setLimitsOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>Лимиты · {trader}</SheetTitle>
              <SheetDescription>Тот же редактор, что в карточке трейдера на деске.</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <LimitsForm trader={trader} limits={L} onSaved={() => setLimitsOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
