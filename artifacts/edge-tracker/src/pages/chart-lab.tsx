/**
 * Chart workspace for one trade: /chart-lab?trade=<id>&mode=analysis|replay|training&tf=1m
 * or any ticker and day without a trade: /chart-lab?ticker=AAPL&date=2026-10-14
 *
 * Full-height on desktop (the chart takes the space, the page does not scroll, so the wheel always zooms the chart).
 * The header has the trade picker (search by ticker / day, recent trades) and «Случайная задача» — a random trade
 * opened in training. Mode and timeframe live in the chart toolbar and are mirrored to the URL.
 * Reads only: GET /api/trades/:id, GET /api/trades/page.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { CandlestickChart, ChevronDown, Dices, Search } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WsChart, TIMEFRAMES, fmtMoney, fmtR, type ChartMode, type Timeframe, type TradeLike } from "@/components/chart-engine";

type TradeRow = TradeLike & { rMultiple?: number | string | null };
type PageResp = { items?: TradeRow[] };

const MODES: ChartMode[] = ["analysis", "replay", "training"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Stable negative id for a ticker + day chart without a trade (keeps its drawings apart, never fetches fills). */
function adHocId(ticker: string, date: string): number {
  let h = 0;
  for (const ch of `${ticker}|${date}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return -Math.max(1, Math.abs(h));
}

/** «AAPL», «2026-10-14» or «AAPL 2026-10-14» → /api/trades/page filters. */
function searchParams(text: string): URLSearchParams {
  const p = new URLSearchParams({ limit: "40", sort: "date", dir: "desc" });
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const date = parts.find((x) => YMD.test(x));
  const rest = parts.filter((x) => x !== date).join(" ");
  if (date) p.set("date", date);
  if (rest) p.set("q", rest);
  return p;
}

const rOf = (t: TradeRow) => {
  const n = Number(t.rMultiple);
  return t.rMultiple != null && Number.isFinite(n) ? n : null;
};

/** Result as the viewer may see it: $ for own trades, R for others' (the API nulls their $). */
function ResultText({ t }: { t: TradeRow }) {
  const r = rOf(t);
  if (!t.redacted && t.pnl != null) return <span className={t.pnl >= 0 ? "text-up" : "text-down"}>{fmtMoney(t.pnl)}</span>;
  if (r != null) return <span className={r >= 0 ? "text-up" : "text-down"}>{fmtR(r)}</span>;
  return <span className="text-muted-foreground">—</span>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

function TradePicker({ label, onPick, onTickerDay }: { label: React.ReactNode; onPick: (t: TradeRow) => void; onTickerDay: (ticker: string, date: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const q = useDebounced(text, 250);
  const list = useQuery<TradeRow[], Error>({
    queryKey: ["chart-lab", "search", q],
    queryFn: async () => (await getJson<PageResp>(`${BASE}/api/trades/page?${searchParams(q)}`)).items ?? [],
    enabled: open,
    staleTime: 30_000,
  });
  const parts = text.trim().toUpperCase().split(/\s+/);
  const tdTicker = parts.find((x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x)) ?? null;
  const tdDate = parts.find((x) => YMD.test(x)) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 min-w-0 max-w-full flex-1 justify-between gap-2 px-3 sm:flex-none" aria-label="Выбрать сделку">
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Тикер, день (2026-10-14) или оба"
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" aria-label="Поиск сделки"
            onKeyDown={(e) => { if (e.key === "Enter" && list.data?.[0]) { onPick(list.data[0]); setOpen(false); } }}
          />
        </div>
        {tdTicker && tdDate && (
          <button type="button" className="flex w-full items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2 text-left text-sm hover:bg-[var(--glass-hover-bg)]" onClick={() => { onTickerDay(tdTicker, tdDate); setOpen(false); }}>
            <CandlestickChart className="h-4 w-4 text-primary" aria-hidden="true" /> Открыть график {tdTicker} за {tdDate} без сделки
          </button>
        )}
        <div className="max-h-[min(22rem,60svh)] overflow-y-auto py-1">
          {list.isLoading ? (
            <div className="flex flex-col gap-1.5 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
          ) : list.error ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Не удалось загрузить: {list.error.message}</p>
          ) : !list.data?.length ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{text.trim() ? "Ничего не нашлось. Для графика без сделки введи тикер и день: AAPL 2026-10-14" : "Сделок нет."}</p>
          ) : (
            <ul>
              {list.data.map((t) => (
                <li key={t.id}>
                  <button type="button" className="grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-2 px-3 py-1.5 text-left text-sm tabular-nums hover:bg-[var(--glass-hover-bg)]" onClick={() => { onPick(t); setOpen(false); }}>
                    <span className="font-semibold">{t.ticker}</span>
                    <span className="truncate text-xs text-muted-foreground">{t.date.slice(0, 10)} · {String(t.side ?? "").toLowerCase() === "short" ? "шорт" : "лонг"}{t.trader ? ` · ${t.trader}` : ""}</span>
                    <ResultText t={t} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t border-[var(--glass-border)] px-3 py-1.5 text-2xs text-muted-foreground">Чужие сделки — в R, без долларов.</p>
      </PopoverContent>
    </Popover>
  );
}

export default function ChartLabPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const tradeId = Number(params.get("trade")) || null;
  const adTicker = params.get("ticker")?.trim().toUpperCase() || null;
  const adDate = params.get("date") && YMD.test(params.get("date") as string) ? (params.get("date") as string) : null;
  const modeParam = params.get("mode");
  const mode: ChartMode = MODES.includes(modeParam as ChartMode) ? (modeParam as ChartMode) : "analysis";
  const tfParam = params.get("tf");
  const tf: Timeframe = TIMEFRAMES.includes(tfParam as Timeframe) ? (tfParam as Timeframe) : "1m";

  const setParams = React.useCallback((patch: Record<string, string | null>, replace = true) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v); }
    if (p.get("mode") === "analysis") p.delete("mode");
    if (p.get("tf") === "1m") p.delete("tf");
    navigate(`/chart-lab${p.toString() ? `?${p}` : ""}`, { replace });
  }, [search, navigate]);

  const trade = useQuery<TradeRow, Error>({
    queryKey: ["chart-lab", "trade", tradeId],
    queryFn: () => getJson<TradeRow>(`${BASE}/api/trades/${tradeId}`),
    enabled: tradeId != null,
    retry: false,
  });
  const pool = useQuery<TradeRow[], Error>({
    queryKey: ["chart-lab", "pool"],
    queryFn: async () => (await getJson<PageResp>(`${BASE}/api/trades/page?limit=300&sort=date&dir=desc`)).items ?? [],
    staleTime: 5 * 60_000,
  });

  const adHoc: TradeLike | null = React.useMemo(() => (tradeId == null && adTicker && adDate ? { id: adHocId(adTicker, adDate), ticker: adTicker, date: adDate } : null), [tradeId, adTicker, adDate]);
  const current: TradeRow | null = tradeId != null ? trade.data ?? null : adHoc;

  const pickRandom = React.useCallback(() => {
    const list = (pool.data ?? []).filter((t) => t.id !== tradeId && t.entry != null && t.exit != null);
    if (!list.length) return;
    const t = list[Math.floor(Math.random() * list.length)];
    navigate(`/chart-lab?trade=${t.id}&mode=training${tf !== "1m" ? `&tf=${tf}` : ""}`);
  }, [pool.data, tradeId, tf, navigate]);

  const training = mode === "training";
  const label = current ? (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="font-semibold">{current.ticker}</span>
      <span className="text-muted-foreground">{current.date.slice(0, 10)}</span>
      {/* No side / result in training: that is what the trader has to find out. */}
      {tradeId != null && !training && <><span className="text-muted-foreground">{String(current.side ?? "").toLowerCase() === "short" ? "шорт" : "лонг"}</span><ResultText t={current} /></>}
      {current.trader && current.redacted && <span className="hidden text-muted-foreground sm:inline">· {current.trader}</span>}
    </span>
  ) : <span className="text-muted-foreground">Выбрать сделку</span>;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[var(--page-max)] flex-col gap-2 md:-mb-[2.25rem] md:h-[calc(100svh-6.25rem)] md:min-h-[520px]">
      <header className="flex items-center gap-2">
        <h1 className="sr-only text-lg font-semibold tracking-tight sm:not-sr-only sm:mr-1">{training ? "Тренировка" : mode === "replay" ? "Реплей" : "График"}</h1>
        <TradePicker
          label={label}
          onPick={(t) => navigate(`/chart-lab?trade=${t.id}${mode !== "analysis" ? `&mode=${mode}` : ""}${tf !== "1m" ? `&tf=${tf}` : ""}`)}
          onTickerDay={(tk, d) => navigate(`/chart-lab?ticker=${encodeURIComponent(tk)}&date=${d}${tf !== "1m" ? `&tf=${tf}` : ""}`)}
        />
        <Button variant={training ? "default" : "outline"} className="h-9 gap-2" onClick={pickRandom} disabled={!pool.data?.length} title="Случайная сделка в режиме тренировки: будущее скрыто, решаешь сам">
          <Dices className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Случайная задача</span><span className="sm:hidden">Задача</span>
        </Button>
      </header>

      {tradeId == null && !adHoc ? (
        <EmptyState
          icon={CandlestickChart}
          title="Выбери сделку"
          description="Найди сделку по тикеру или дню, открой график любого тикера за день или возьми случайную задачу — потренируйся принимать решения бар за баром."
          action={<Button onClick={pickRandom} disabled={!pool.data?.length}><Dices className="mr-2 h-4 w-4" /> Случайная задача</Button>}
        />
      ) : tradeId != null && trade.isLoading ? (
        <Skeleton className="min-h-[420px] flex-1 rounded-2xl" />
      ) : tradeId != null && (trade.error || !trade.data) ? (
        <EmptyState icon={CandlestickChart} title={`Сделка #${tradeId} недоступна`} description={trade.error?.message ?? "Не найдена"} />
      ) : current ? (
        <WsChart
          key={`${current.id}`}
          className={cn("md:min-h-0 md:flex-1")}
          layout="workspace"
          trade={current}
          executions={adHoc ? [] : undefined}
          mode={adHoc && mode === "training" ? "replay" : mode}
          onModeChange={(m) => setParams({ mode: m })}
          initialTimeframe={tf}
          onTimeframeChange={(t) => setParams({ tf: t })}
          onNextTask={pool.data?.length ? pickRandom : undefined}
          showModes
        />
      ) : null}
    </div>
  );
}
