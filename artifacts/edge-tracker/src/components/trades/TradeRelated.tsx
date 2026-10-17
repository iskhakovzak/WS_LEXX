import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BookOpen, ChevronRight, Lightbulb, ShieldAlert, ShieldCheck, ShieldQuestion, History } from "lucide-react";
import type { Trade } from "@workspace/api-client-react";
import { Pill } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { BASE } from "@/lib/api";
import { DEFAULT_FILTERS, computeStats, dayOf, fmtDay, fmtPct, fmtR, effectiveR } from "./trade-utils";
import { ResultPill } from "./trade-bits";
import { TRADES_PAGE_KEY, buildTradesPageParams, fetchTradesPage } from "@/hooks/use-trades-page";

type PlaybookLite = { id: number; name: string; setupType: string | null; ticker: string | null; sourceType: string | null; sourceId: number | null; folder: string | null };
type IdeaLite = { id: number; ticker: string; side: string | null; status: string | null; thesis: string | null; createdAt: string; convertedTradeId?: number | null; trader?: string | null; target?: string | null };
type ChecklistResp = { id: number; passed: boolean; responses: string; createdAt: string };

const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const IDEA_STATUS: Record<string, string> = { draft: "Черновик", published: "Опубликована", approved: "Одобрена", needs_work: "На доработке", rejected: "Отклонена", converted: "Сделка" };

function Row({ icon: Icon, children, onClick, label }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-[var(--glass-hover-bg)]">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/** Checklist gate result for the trade. */
export function ChecklistStatus({ tradeId }: { tradeId: number }) {
  const q = useQuery<ChecklistResp[]>({
    queryKey: ["trade-checklist-response", tradeId],
    queryFn: () => getJson(`${BASE}/api/checklist-responses?tradeId=${tradeId}`),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <Skeleton className="h-7 w-40 rounded-full" />;
  const r = q.data?.[0];
  if (!r) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ShieldQuestion className="h-4 w-4" aria-hidden="true" /> Чек-лист не привязан (быстрый ввод)
      </span>
    );
  }
  let yes = 0, total = 0;
  try {
    const parsed = JSON.parse(r.responses) as Record<string, string>;
    for (const v of Object.values(parsed)) { if (v === "na") continue; total++; if (v === "yes") yes++; }
  } catch { /* legacy format */ }
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${r.passed ? "text-up" : "text-down"}`}>
      {r.passed ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4" aria-hidden="true" />}
      {r.passed ? "Чек-лист пройден" : "Чек-лист не пройден"}
      {total > 0 && <span className="tabular-nums text-muted-foreground">· {yes}/{total}</span>}
      <span className="text-muted-foreground">· #{r.id}</span>
    </span>
  );
}

/** Ideas for a ticker (shared cache with the "Связи" block). */
export function useTickerIdeas(ticker: string | null | undefined) {
  return useQuery<IdeaLite[]>({
    queryKey: ["trades-related-ideas", ticker ?? ""],
    queryFn: () => getJson(`${BASE}/api/trade-ideas?ticker=${encodeURIComponent(ticker ?? "")}`),
    staleTime: 2 * 60_000,
    enabled: !!ticker,
  });
}

/** Profit target of the idea this trade was converted from, if any. */
export function useSourceIdeaTarget(trade: Trade | null): string | null {
  const ideas = useTickerIdeas(trade?.ticker);
  if (!trade) return null;
  const src = (ideas.data ?? []).find((i) => i.convertedTradeId === trade.id);
  return src?.target?.trim() || null;
}

/** Cross-links: playbook setups, ideas and history for the same ticker. */
export function TradeRelated({ trade, allTrades, onOpenTrade }: { trade: Trade; allTrades: Trade[]; onOpenTrade: (t: Trade) => void }) {
  const [, setLocation] = useLocation();
  const playbook = useQuery<PlaybookLite[]>({
    queryKey: ["trades-related-playbook"],
    queryFn: () => getJson(`${BASE}/api/playbook`),
    staleTime: 5 * 60_000,
  });
  const ideas = useTickerIdeas(trade.ticker);

  const setup = (trade.setup ?? "").trim().toLowerCase();
  const pbMatches = React.useMemo(() => {
    const list = playbook.data ?? [];
    const scored = list.map((e) => {
      let score = 0;
      if (e.sourceType === "trade" && e.sourceId === trade.id) score += 10;
      if (setup && (e.setupType ?? "").trim().toLowerCase() === setup) score += 5;
      if (setup && e.name.toLowerCase().includes(setup)) score += 2;
      if (e.ticker && e.ticker.toUpperCase() === trade.ticker.toUpperCase()) score += 1;
      return { e, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, 4);
  }, [playbook.data, setup, trade.id, trade.ticker]);

  // Ticker history comes from the paginated endpoint (the page only holds one slice of the book);
  // the rows already on the page are the fallback while it loads / when the API predates it.
  const historyQ = useQuery<Trade[]>({
    queryKey: [TRADES_PAGE_KEY, "history", trade.ticker],
    queryFn: async () => {
      const params = buildTradesPageParams({ ...DEFAULT_FILTERS, ticker: trade.ticker }, { col: "date", dir: "desc" }, { limit: 200 });
      return (await fetchTradesPage(params)).items;
    },
    staleTime: 60_000,
    retry: false,
  });
  const history = React.useMemo(() => {
    const src = historyQ.data ?? allTrades;
    return src.filter((t) => t.ticker === trade.ticker && t.id !== trade.id);
  }, [historyQ.data, allTrades, trade.ticker, trade.id]);
  const hStats = React.useMemo(() => computeStats(history), [history]);
  const ideaList = (ideas.data ?? []).slice(0, 4);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1">
        <p className="micro-label px-2.5">Плейбук</p>
        {playbook.isLoading ? <Skeleton className="h-9 rounded-xl" /> : pbMatches.length === 0 ? (
          <p className="px-2.5 text-sm text-muted-foreground">{setup ? "Нет сетапа с таким названием." : "Укажите сетап — подтянем запись плейбука."}</p>
        ) : pbMatches.map(({ e, score }) => (
          <Row key={e.id} icon={BookOpen} label={`Открыть в плейбуке: ${e.name}`} onClick={() => setLocation(`/playbook?highlight=${e.id}`)}>
            <span className="block truncate">{e.name}</span>
            <span className="text-xs text-muted-foreground">{score >= 10 ? "создано из этой сделки" : e.setupType ?? e.folder ?? "по тикеру"}</span>
          </Row>
        ))}
      </div>

      <div className="space-y-1">
        <p className="micro-label px-2.5">Идеи по {trade.ticker}</p>
        {ideas.isLoading ? <Skeleton className="h-9 rounded-xl" /> : ideaList.length === 0 ? (
          <p className="px-2.5 text-sm text-muted-foreground">Идей по тикеру нет.</p>
        ) : ideaList.map((i) => (
          <Row key={i.id} icon={Lightbulb} label={`Идея ${i.ticker} #${i.id}`} onClick={() => setLocation(`/trade-ideas?highlight=${i.id}`)}>
            <span className="flex items-center gap-2">
              <span className="truncate">{i.thesis?.split("\n")[0] || `Идея #${i.id}`}</span>
              {i.convertedTradeId === trade.id && <Pill tone="accent">источник</Pill>}
            </span>
            <span className="text-xs text-muted-foreground">{fmtDay(i.createdAt.substring(0, 10))} · {IDEA_STATUS[i.status ?? ""] ?? i.status ?? "—"}</span>
          </Row>
        ))}
      </div>

      <div className="space-y-1 md:col-span-2">
        <p className="micro-label px-2.5">История по {trade.ticker}</p>
        {history.length === 0 ? (
          <p className="px-2.5 text-sm text-muted-foreground">Первая сделка по этому тикеру.</p>
        ) : (
          <>
            <p className="px-2.5 pb-1 text-sm text-muted-foreground">
              {history.length} сделок · win rate <span className="font-medium text-foreground tabular-nums">{fmtPct(hStats.winRate)}</span> · средний R{" "}
              <span className="font-medium text-foreground tabular-nums">{fmtR(hStats.avgR)}</span>
            </p>
            {history.slice(0, 5).map((t) => (
              <Row key={t.id} icon={History} label={`Открыть сделку ${t.ticker} ${dayOf(t)}`} onClick={() => onOpenTrade(t)}>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{fmtDay(dayOf(t))}</span>
                  <ResultPill result={t.result} />
                  <span className="tabular-nums text-muted-foreground">{fmtR(effectiveR(t).value, 1)}</span>
                  <span className="truncate text-muted-foreground">{t.setup ?? ""}</span>
                </span>
              </Row>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
