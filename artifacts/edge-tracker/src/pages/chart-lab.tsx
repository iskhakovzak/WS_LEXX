/**
 * Replay & training page for one trade: /chart-lab?trade=<id>&mode=replay|training
 * Renders <WsChart/> (analysis / replay / training), the session's training results with the exit score,
 * and recent trades as sparklines to switch quickly. Reads only: GET /api/trades, GET /api/trades/:id.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { CandlestickChart, PlayCircle } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel, Pill, Segmented, StatCard, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BASE } from "@/lib/api";
import { TradeSparkline, WsChart, fmtEtTime, fmtMoney, fmtPrice, formatDuration, type ChartMode, type Timeframe, type TradeLike, type TrainingResult } from "@/components/chart-engine";

type TradeRow = TradeLike & { trader?: string | null };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export default function ChartLabPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const tradeId = Number(params.get("trade")) || null;
  const initialMode = (params.get("mode") as ChartMode | null) ?? "analysis";
  const initialTf = (params.get("tf") as Timeframe | null) ?? "1m";
  const [mode, setMode] = React.useState<ChartMode>(initialMode);
  const [height, setHeight] = React.useState<"420" | "560" | "720">("560");
  const [results, setResults] = React.useState<TrainingResult[]>([]);

  const trade = useQuery<TradeRow, Error>({
    queryKey: ["chart-lab", "trade", tradeId],
    queryFn: () => getJson<TradeRow>(`${BASE}/api/trades/${tradeId}`),
    enabled: tradeId != null,
    retry: false,
  });
  const recent = useQuery<TradeRow[], Error>({
    queryKey: ["chart-lab", "recent"],
    queryFn: async () => {
      const r = await getJson<unknown>(`${BASE}/api/trades?limit=12`);
      const list = Array.isArray(r) ? r : (r as { trades?: unknown; items?: unknown })?.trades ?? (r as { items?: unknown })?.items;
      return (Array.isArray(list) ? list : []).filter((t): t is TradeRow => !!t && typeof (t as TradeRow).ticker === "string").slice(0, 12);
    },
    staleTime: 60_000,
  });

  const scored = results.filter((r) => r.score != null);
  const open = (id: number) => navigate(`/chart-lab?trade=${id}${mode !== "analysis" ? `&mode=${mode}` : ""}`);

  return (
    <Page>
      <PageHeader
        title="Реплей сделки"
        description="Проиграй сделку бар за баром или потренируйся: реши, где выйти, и сравни с тем, что было на самом деле."
        icon={PlayCircle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" ariaLabel="Режим" value={mode} onChange={setMode} options={[{ value: "analysis", label: "Анализ" }, { value: "replay", label: "Реплей" }, { value: "training", label: "Тренировка" }]} />
            <Segmented size="sm" ariaLabel="Высота" value={height} onChange={setHeight} options={[{ value: "420", label: "420" }, { value: "560", label: "560" }, { value: "720", label: "720" }]} />
          </div>
        }
      />

      {tradeId == null ? (
        <EmptyState icon={CandlestickChart} title="Выбери сделку" description="Открой реплей из карточки сделки или выбери одну из последних ниже." />
      ) : trade.isLoading ? (
        <Skeleton className="rounded-2xl" style={{ height: Number(height) + 80 }} />
      ) : trade.error || !trade.data ? (
        <EmptyState icon={CandlestickChart} title={`Сделка #${tradeId} недоступна`} description={trade.error?.message ?? "Не найдена"} />
      ) : (
        <Panel
          title={<span className="inline-flex items-center gap-2">{trade.data.ticker} <Pill tone={(trade.data.pnl ?? 0) >= 0 ? "up" : "down"}>{fmtMoney(trade.data.pnl)}</Pill> <span className="text-xs font-normal text-muted-foreground">#{trade.data.id} · {trade.data.date.slice(0, 10)} · {trade.data.side ?? "long"} · {trade.data.qty ?? "?"} шт. · вход {fmtPrice(Number(trade.data.entry))} → выход {fmtPrice(Number(trade.data.exit))}{trade.data.stop != null ? ` · стоп ${fmtPrice(Number(trade.data.stop))}` : ""}</span></span>}
        >
          <WsChart
            key={`${trade.data.id}:${mode}`}
            trade={trade.data}
            mode={mode}
            initialTimeframe={initialTf}
            height={Number(height)}
            onTrainingResult={(r) => setResults((xs) => [r, ...xs].slice(0, 10))}
          />
        </Panel>
      )}

      {results.length > 0 && (
        <Panel title="Результаты тренировки" description="Последние попытки «я бы вышел здесь» за эту сессию. Оценка: 100 — лучший возможный выход между входом и реальным выходом, 0 — худший.">
          <StatGrid>
            <StatCard label="Попыток" value={String(results.length)} />
            <StatCard label="Лучше реального" value={String(results.filter((r) => (r.diffUsd ?? 0) > 0).length)} tone="up" />
            <StatCard label="Хуже реального" value={String(results.filter((r) => (r.diffUsd ?? 0) < 0).length)} tone="down" />
            <StatCard label="Средняя разница с фактом" value={fmtMoney(results.reduce((s, r) => s + (r.diffUsd ?? 0), 0) / results.length)} />
            {scored.length > 0 && <StatCard label="Средняя оценка выхода" value={`${Math.round(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length)}/100`} />}
          </StatGrid>
          <ul className="mt-3 divide-y divide-[var(--glass-border)] text-xs tabular-nums">
            {results.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                {r.score != null && <span className="font-semibold">{r.score}/100</span>}
                <span>выход {fmtPrice(r.userExitPrice)} в {fmtEtTime(r.userExitTime)} ET</span>
                <span className="text-muted-foreground">реальный {fmtPrice(r.actualExitPrice)}</span>
                <Pill tone={(r.diffUsd ?? 0) > 0 ? "up" : (r.diffUsd ?? 0) < 0 ? "down" : "neutral"}>{fmtMoney(r.diffUsd)}</Pill>
                {r.diffSeconds != null && <span className="text-muted-foreground">{r.diffSeconds < 0 ? "раньше" : "позже"} на {formatDuration(Math.abs(r.diffSeconds))}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Последние сделки" description="Клик — открыть сделку в реплее.">
        {recent.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : !recent.data?.length ? (
          <EmptyState icon={CandlestickChart} title="Сделок нет" description="Список /api/trades пуст." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recent.data.map((t) => (
              <Button key={t.id} variant="outline" className="h-auto justify-between gap-3 px-3 py-2" onClick={() => open(t.id)} aria-label={`Открыть сделку ${t.ticker} #${t.id}`}>
                <span className="flex flex-col items-start text-left">
                  <span className="text-sm font-semibold">{t.ticker} <span className="text-xs font-normal text-muted-foreground">#{t.id}</span></span>
                  <span className="text-xs text-muted-foreground">{t.date.slice(0, 10)} · {t.side ?? "long"} · <span className={(t.pnl ?? 0) >= 0 ? "text-up" : "text-down"}>{fmtMoney(t.pnl)}</span></span>
                </span>
                <TradeSparkline trade={t} width={120} height={36} />
              </Button>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
