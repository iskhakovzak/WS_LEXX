import { useState } from "react";
import { UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, Pill, Segmented, toneOf } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsiders } from "./use-offerings-data";
import { fmtDay, type InsiderSummary } from "./types";
import { fmtUsd } from "@/lib/format";

type Scope = "day" | "mine";

/** Buys vs sells split bar (open-market P vs S, $). */
export function BuySellBar({ s }: { s: InsiderSummary }) {
  const total = s.buys.usd + s.sells.usd;
  const buyPct = total > 0 ? (s.buys.usd / total) * 100 : 0;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" role="img" aria-label={`Покупки ${fmtUsd(s.buys.usd, { compact: true })}, продажи ${fmtUsd(s.sells.usd, { compact: true })}`}>
      {total > 0 && <div className="h-full bg-up" style={{ width: `${buyPct}%` }} />}
      {total > 0 && <div className="h-full bg-down" style={{ width: `${100 - buyPct}%` }} />}
    </div>
  );
}

function InsiderRow({ s, onOpen }: { s: InsiderSummary; onOpen: (t: string) => void }) {
  const quiet = s.buys.count === 0 && s.sells.count === 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(s.ticker)}
        className="flex w-full flex-col gap-1.5 rounded-xl px-2 py-2 text-left hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{s.ticker}</span>
          {s.buys.count > 0 && s.buyers >= 2 && <Pill tone="up" className="text-2xs">кластер покупок</Pill>}
          <span className={cn("ml-auto text-sm font-medium tabular-nums", quiet ? "text-muted-foreground" : s.netUsd >= 0 ? "text-up" : "text-down")}>
            {quiet ? "тихо" : fmtUsd(s.netUsd, { signed: true, compact: true })}
          </span>
        </div>
        {!quiet && <BuySellBar s={s} />}
        <div className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
          <span className="text-up">↑ {s.buys.count} · {fmtUsd(s.buys.usd, { compact: true })}</span>
          <span className="text-down">↓ {s.sells.count} · {fmtUsd(s.sells.usd, { compact: true })}</span>
          {s.planSellPct != null && s.sells.count > 0 && <span>10b5-1: {s.planSellPct}%</span>}
          {s.lastBuyDate && <span>посл. покупка {fmtDay(s.lastBuyDate)}</span>}
        </div>
      </button>
    </li>
  );
}

/**
 * Open-market insider buys/sells (Form 4, codes P/S) for 90 days.
 * "По заявкам дня" = top dilution-risk names today; "Мои тикеры" = positions + watchlist.
 */
export function InsiderPanel({
  dayTickers,
  myTickers,
  onOpenTicker,
}: {
  dayTickers: string[];
  myTickers: string[];
  onOpenTicker: (t: string) => void;
}) {
  const [scope, setScope] = useState<Scope>(() => (myTickers.length ? "mine" : "day"));
  const tickers = scope === "day" ? dayTickers : myTickers;
  const q = useInsiders(tickers);
  const items = [...(q.data?.items ?? [])].sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd));
  const netAll = items.reduce((s, i) => s + i.netUsd, 0);

  return (
    <Panel
      title="Инсайдеры, 90 дней"
      icon={UserCheck}
      description="Сделки в рынке по Form 4 (P — покупка, S — продажа)"
      actions={
        <Segmented<Scope>
          ariaLabel="Набор тикеров для инсайдеров"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "day", label: "Заявки дня", count: dayTickers.length },
            { value: "mine", label: "Мои", count: myTickers.length },
          ]}
        />
      }
    >
      {tickers.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title={scope === "mine" ? "Нет позиций и вотчлиста" : "Нет торгуемых тикеров в заявках дня"}
          description={scope === "mine" ? "Добавьте тикеры в вотчлист — здесь появятся покупки и продажи инсайдеров." : "Выберите другой день или откройте тикер из календаря."}
          className="py-8"
        />
      ) : q.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка Form 4">
          {Array.from({ length: Math.min(6, tickers.length) }).map((_, i) => (
            <div key={i} className="space-y-1.5 px-2">
              <div className="flex justify-between"><Skeleton className="h-4 w-14 rounded-full" /><Skeleton className="h-4 w-16 rounded-full" /></div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
          <p className="px-2 text-xs text-muted-foreground">Читаем Form 4 с SEC — первый раз до 20 секунд.</p>
        </div>
      ) : q.error ? (
        <p role="alert" className="px-2 text-sm text-down">Не удалось загрузить Form 4: {q.error instanceof Error ? q.error.message : "ошибка"}</p>
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between px-2">
            <span className="text-xs text-muted-foreground">Нетто по {items.length} тикерам</span>
            <span className={cn("text-lg font-semibold tabular-nums", toneOf(netAll) === "up" ? "text-up" : toneOf(netAll) === "down" ? "text-down" : "text-foreground")}>
              {fmtUsd(netAll, { signed: true, compact: true })}
            </span>
          </div>
          <ul className="grid gap-0.5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((s) => <InsiderRow key={s.ticker} s={s} onOpen={onOpenTicker} />)}
          </ul>
          {!!q.data?.missing.length && (
            <p className="mt-2 px-2 text-xs text-muted-foreground">Нет в базе SEC: {q.data.missing.join(", ")}</p>
          )}
        </>
      )}
    </Panel>
  );
}
