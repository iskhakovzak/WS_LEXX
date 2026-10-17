import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Eye, Lightbulb, LineChart, ArrowUpRight, Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { pluralRu } from "@/components/rules/constants";

type TickerContextData = {
  ticker: string;
  watchlist: { id: number; status: string; catalyst: string | null; targetPrice: string | null; stopPrice: string | null; score: number | null }[];
  ideas: { id: number; side: string | null; setup: string | null; status: string; trader: string | null; score: number | null; ideaDate: string | null }[];
  trades: { count: number; lastDate: string | null; traders: number; wins: number; losses: number };
  discussions: number;
};

const WATCH_STATUS: Record<string, string> = { watching: "Наблюдаем", active: "Активен", triggered: "Сработал", closed: "Закрыт", archived: "Архив" };
const IDEA_STATUS: Record<string, string> = { draft: "Черновик", published: "Опубликована", active: "Активна", closed: "Закрыта", converted: "В сделке", invalidated: "Отменена" };

function fmtPrice(v: string | null) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : v;
}

function TickerContextBody({ ticker, onFilter }: { ticker: string; onFilter?: (t: string) => void }) {
  const { data, isLoading, isError } = useQuery<TickerContextData>({
    queryKey: ["discussions-ticker-context", ticker],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/discussions/ticker-context/${encodeURIComponent(ticker)}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "Ошибка загрузки");
      return body as TickerContextData;
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold tabular-nums">${ticker}</span>
        {data && <span className="text-xs text-muted-foreground">{data.discussions} {pluralRu(data.discussions, "тема", "темы", "тем")} в обсуждениях</span>}
      </div>
      {isLoading && <div className="space-y-2"><Skeleton className="h-10 rounded-xl" /><Skeleton className="h-10 rounded-xl" /></div>}
      {isError && <p className="text-xs text-down">Не удалось загрузить контекст тикера.</p>}
      {data && (
        <>
          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="micro-label inline-flex items-center gap-1"><Eye className="h-3 w-3" aria-hidden="true" />Вотчлист</span>
              <Link href={links.watchlist(data.ticker)} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">Открыть<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
            </div>
            {data.watchlist.length === 0 ? (
              <p className="text-xs text-muted-foreground">Нет в вотчлисте</p>
            ) : data.watchlist.slice(0, 2).map((w) => (
              <div key={w.id} className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Pill tone="accent">{WATCH_STATUS[w.status] ?? w.status}</Pill>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    цель <span className="text-up">{fmtPrice(w.targetPrice)}</span> · стоп <span className="text-down">{fmtPrice(w.stopPrice)}</span>
                  </span>
                </div>
                {w.catalyst && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.catalyst}</p>}
              </div>
            ))}
          </section>
          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="micro-label inline-flex items-center gap-1"><Lightbulb className="h-3 w-3" aria-hidden="true" />Идеи</span>
              <Link href="/trade-ideas" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">Открыть<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
            </div>
            {data.ideas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Идей по тикеру нет</p>
            ) : data.ideas.slice(0, 3).map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  {i.side && <Pill tone={/short|шорт/i.test(i.side) ? "down" : "up"}>{/short|шорт/i.test(i.side) ? "Шорт" : "Лонг"}</Pill>}
                  <span className="truncate">{i.setup || "Без сетапа"}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{i.trader ?? ""} · {IDEA_STATUS[i.status] ?? i.status}</span>
              </div>
            ))}
          </section>
          <section className="flex items-center justify-between gap-2 rounded-xl bg-[var(--glass-bg)] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LineChart className="h-3.5 w-3.5" aria-hidden="true" />Сделки команды</span>
            {data.trades.count > 0 ? (
              <Link href={links.trades({ ticker: data.ticker })} className="text-xs tabular-nums hover:underline" title="Сделки команды по тикеру">
                {data.trades.count} · <span className="text-up">+{data.trades.wins}</span> / <span className="text-down">−{data.trades.losses}</span>
                {data.trades.lastDate && <span className="text-muted-foreground"> · {data.trades.lastDate}</span>}
              </Link>
            ) : <span className="text-xs text-muted-foreground">нет</span>}
          </section>
        </>
      )}
      {onFilter && (
        <button type="button" onClick={() => onFilter(ticker)} className="chip inline-flex min-h-8 w-full items-center justify-center gap-1.5 px-3 text-xs font-medium">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />Темы по ${ticker}
        </button>
      )}
    </div>
  );
}

/** Ticker chip / cashtag that opens a cross-section context popover. */
export function TickerLink({ ticker, onFilter, variant = "inline", className }: {
  ticker: string;
  onFilter?: (t: string) => void;
  variant?: "inline" | "chip";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Контекст тикера ${ticker}`}
          className={cn(
            variant === "chip"
              ? "inline-flex min-h-6 items-center gap-1 rounded-full bg-primary/15 px-2 text-xs font-semibold tabular-nums text-primary hover:bg-primary/25"
              : "rounded px-0.5 font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary",
            className,
          )}
        >
          ${ticker}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4" align="start" onClick={(e) => e.stopPropagation()}>
        {open && <TickerContextBody ticker={ticker} onFilter={onFilter ? (t) => { setOpen(false); onFilter(t); } : undefined} />}
      </PopoverContent>
    </Popover>
  );
}
