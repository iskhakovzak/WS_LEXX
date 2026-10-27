/**
 * «График и разбор» — analysis and replay of real trades and days:
 *   /chart-lab?trade=<id>&mode=analysis|replay&tf=1m[&src=mine|desk]  or any ticker and day: /chart-lab?ticker=AAPL&date=2026-10-14
 *
 * Not a game: the training game lives in the «Тренажёр» (/trainer); old `mode=training` links are sent there.
 * Full-height on desktop (the chart takes the space, the page does not scroll, so the wheel always zooms the chart).
 * The header has the trade picker (search by ticker / day, recent trades) and the links back to the trade and its day.
 * Mode and timeframe live in the chart toolbar and are mirrored to the URL. Without a trade the page offers the
 * viewer's latest trades (prefill), so one click opens a chart.
 * Plan against execution (Волна 2 п. 2.12): the morning plan's levels of the ticker-day are dotted «План» lines on the
 * chart and the trade's setup is a chip in the header (GET /api/chart/plan-overlay).
 * Reads only: GET /api/trades/:id, GET /api/trades/page, GET /api/training/trades/:id (a desk trade, $ nulled for others).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { CalendarDays, CandlestickChart, ChevronDown, Dumbbell, ListChecks, Loader2, RefreshCw, Search } from "lucide-react";
import { EmptyState, Panel, Pill, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PlaybookSheetButton } from "@/components/shared/playbook-sheet";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { http } from "@/lib/api/http";
import { links } from "@/lib/links";
import { WsChart, TIMEFRAMES, type ChartMode, type Execution, type Timeframe, type TradeLike, type TradeStructureDto } from "@/components/chart-engine";
import { fmtR, fmtUsd } from "@/lib/format";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { useAuth } from "@/contexts/auth-context";
import { chartLabI18n } from "@/i18n/ns/chartLab";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";
import { entryTimeOf, netOf, searchParams } from "@/components/chart-engine/lib/picker";
import { usePlanOverlay } from "@/components/chart-engine/hooks/usePlanOverlay";
import type { PlanOverlay } from "@/components/chart-engine/lib/plan-levels";
import { DecisionDrill } from "@/components/chart-lab/DecisionDrill";
import { OverlayView } from "@/components/chart-lab/OverlayView";
import { ExitsView } from "@/components/chart-lab/ExitsView";
import { StaffTraderPicker } from "@/components/people/staff-trader-picker";
import { comparePersonNames } from "@/i18n";

/** `movePct`: side-aware entry → exit move, % (desk payload) — the result when neither $ nor R is available. */
type TradeRow = TradeLike & { rMultiple?: number | string | null; movePct?: number | null };
type PageResp = { items?: TradeRow[] };
type DeskTradeResp = { trade: TradeRow; executions: Execution[]; structure: TradeStructureDto | null };

const MODES: ChartMode[] = ["analysis", "replay"];
/** «Сделка» (one trade / day on the chart), «Наложение» (all entries of a setup aligned), «Выходы» (where to exit). */
type LabView = "trade" | "overlay" | "exits";
const VIEWS: LabView[] = ["trade", "overlay", "exits"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** The trainer page (TRAINER-WEB); old chart-lab training links land there. */
const TRAINER_HREF = "/trainer";

/** Stable negative id for a ticker + day chart without a trade (never fetches fills). */
function adHocId(ticker: string, date: string): number {
  let h = 0;
  for (const ch of `${ticker}|${date}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return -Math.max(1, Math.abs(h));
}

const rOf = (t: TradeRow) => {
  const n = Number(t.rMultiple);
  return t.rMultiple != null && Number.isFinite(n) ? n : null;
};

/**
 * Result as the viewer may see it: $ for own trades; for others' (the API nulls their $) R, else the % move, else
 * just win / loss.
 */
function ResultText({ t }: { t: TradeRow }) {
  const { t: tl } = chartLabI18n.useT();
  const r = rOf(t);
  const net = t.redacted ? null : netOf(t);
  if (net != null) {
    const gross = t.fees ? tl("result.grossTitle", { gross: fmtUsd(t.pnl ?? null, { signed: true, decimals: "auto" }), fees: fmtUsd(Math.abs(t.fees), { decimals: "auto" }) }) : undefined;
    return <span className={net >= 0 ? "text-up" : "text-down"} title={gross}>{fmtUsd(net, { signed: true, decimals: "auto" })}</span>;
  }
  if (r != null) return <span className={r >= 0 ? "text-up" : "text-down"}>{fmtR(r)}</span>;
  const pct = t.movePct != null && Number.isFinite(t.movePct) ? t.movePct : null;
  if (pct != null) return <span className={pct >= 0 ? "text-up" : "text-down"} title={tl("result.moveTitle")}>{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct).toFixed(2)}%</span>;
  const res = String(t.result ?? "").toLowerCase();
  if (res === "win") return <span className="text-up">{tl("result.win")}</span>;
  if (res === "loss") return <span className="text-down">{tl("result.loss")}</span>;
  return <span className="text-muted-foreground">—</span>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

function TradeRowButton({ t, onPick }: { t: TradeRow; onPick: (t: TradeRow) => void }) {
  const { t: tl } = chartLabI18n.useT();
  return (
    <button type="button" className="grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm tabular-nums hover:bg-[var(--glass-hover-bg)]" onClick={() => onPick(t)}>
      <span className="font-semibold">{t.ticker}</span>
      <span className="truncate text-xs text-muted-foreground">{t.date.slice(0, 10)}{entryTimeOf(t) ? ` ${entryTimeOf(t)}` : ""} · {String(t.side ?? "").toLowerCase() === "short" ? tl("picker.short") : tl("picker.long")}{t.trader && t.redacted ? ` · ${personName(t.trader)}` : ""}</span>
      <ResultText t={t} />
    </button>
  );
}

function TradePicker({ label, onPick, onTickerDay }: { label: React.ReactNode; onPick: (t: TradeRow) => void; onTickerDay: (ticker: string, date: string) => void }) {
  const { t: tl } = chartLabI18n.useT();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const q = useDebounced(text, 250);
  const list = useQuery<TradeRow[], Error>({
    queryKey: ["chart-lab", "search", q],
    queryFn: async ({ signal }) => (await http.get<PageResp>(`/api/trades/page?${searchParams(q)}`, { signal })).items ?? [],
    enabled: open,
    staleTime: 30_000,
  });
  // The typed text is not searched yet (debounce) or the new answer is on its way: the list shown is the old one (MAKSIM-22).
  const searching = open && (text !== q || list.isFetching);
  const parts = text.trim().toUpperCase().split(/\s+/);
  const tdTicker = parts.find((x) => /^[A-Z][A-Z.\-]{0,9}$/.test(x)) ?? null;
  const tdDate = parts.find((x) => YMD.test(x)) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 min-w-0 max-w-full basis-full justify-between gap-2 px-3 sm:basis-auto" aria-label={tl("picker.aria")}>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2">
          {searching && !list.isLoading
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={tl("picker.searching")} />
            : <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <Input
            autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={tl("picker.placeholder")}
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" aria-label={tl("picker.searchAria")}
            onKeyDown={(e) => { if (e.key === "Enter" && list.data?.[0]) { onPick(list.data[0]); setOpen(false); } }}
          />
        </div>
        {tdTicker && tdDate && (
          <button type="button" className="flex w-full items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2 text-left text-sm hover:bg-[var(--glass-hover-bg)]" onClick={() => { onTickerDay(tdTicker, tdDate); setOpen(false); }}>
            <CandlestickChart className="h-4 w-4 text-primary" aria-hidden="true" /> {tl("picker.openTickerDay", { ticker: tdTicker, date: tdDate })}
          </button>
        )}
        <div className="max-h-[min(22rem,60svh)] overflow-y-auto py-1">
          {list.isLoading ? (
            <div className="flex flex-col gap-1.5 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
          ) : list.error ? (
            <div className="flex flex-wrap items-center gap-2 px-3 py-4 text-sm text-muted-foreground" role="alert">
              <span className="min-w-0 flex-1">{tl("picker.loadFailed", { message: list.error.message })}</span>
              <Button variant="ghost" size="sm" onClick={() => void list.refetch()} disabled={list.isFetching}>
                <RefreshCw className={list.isFetching ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" /> {commonI18n.t("actions.retry")}
              </Button>
            </div>
          ) : !list.data?.length ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">{text.trim() ? tl("picker.nothing") : tl("picker.noTrades")}</p>
          ) : (
            <ul className={searching ? "opacity-60 transition-opacity duration-[var(--dur-1)]" : "transition-opacity duration-[var(--dur-1)]"} aria-busy={searching || undefined}>{list.data.map((t) => <li key={t.id}><TradeRowButton t={t} onPick={(x) => { onPick(x); setOpen(false); }} /></li>)}</ul>
          )}
        </div>
        <p className="border-t border-[var(--glass-border)] px-3 py-1.5 text-2xs text-muted-foreground">{tl("picker.othersInR")}</p>
      </PopoverContent>
    </Popover>
  );
}

/** The trade's setup and how many plan levels are on the chart (nothing when neither is known). */
function OverlayChips({ overlay }: { overlay: PlanOverlay | null }) {
  const { t: tl } = chartLabI18n.useT();
  if (!overlay || (!overlay.setup && !overlay.levels.length)) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {overlay.setup && <Pill tone="accent" title={tl("overlay.setupTitle")} className="max-w-[14rem]"><span className="truncate">{tl("overlay.setup", { name: overlay.setup })}</span></Pill>}
      {overlay.levels.length > 0 && (
        <Pill tone="neutral" title={overlay.source === "desk" ? tl("overlay.planDesk") : tl("overlay.planOwn")}>{tl("overlay.plan", { count: overlay.levels.length })}</Pill>
      )}
    </span>
  );
}

/** No trade picked: the latest trades as one-click rows (prefill) and the way to the trainer. */
function StartState({ onPick }: { onPick: (t: TradeRow) => void }) {
  const { t: tl } = chartLabI18n.useT();
  const recent = useQuery<TradeRow[], Error>({
    queryKey: ["chart-lab", "recent"],
    queryFn: async ({ signal }) => (await http.get<PageResp>(`/api/trades/page?${searchParams("", 6)}`, { signal })).items ?? [],
    staleTime: 60_000,
  });
  // In a Panel: over a photo background the start state was unreadable (design audit wave 2).
  return (
    <Panel>
      <EmptyState
        icon={CandlestickChart}
        title={tl("empty.title")}
        description={tl("empty.description")}
        action={(
          <div className="flex w-full max-w-md flex-col gap-3">
            {recent.isLoading ? (
              <div className="flex flex-col gap-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
            ) : recent.data?.length ? (
              <div className="flex flex-col rounded-xl border border-[var(--glass-border)] py-1 text-left">
                <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{tl("empty.recent")}</p>
                {recent.data.map((t) => <TradeRowButton key={t.id} t={t} onPick={onPick} />)}
              </div>
            ) : null}
            <Button variant="ghost" asChild className="self-center">
              <Link href={TRAINER_HREF}><Dumbbell className="mr-2 h-4 w-4" aria-hidden="true" /> {tl("empty.trainer")}</Link>
            </Button>
          </div>
        )}
      />
    </Panel>
  );
}

export default function ChartLabPage() {
  const { t: tl } = chartLabI18n.useT();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const tradeId = Number(params.get("trade")) || null;
  const adTicker = params.get("ticker")?.trim().toUpperCase() || null;
  const adDate = params.get("date") && YMD.test(params.get("date") as string) ? (params.get("date") as string) : null;
  const modeParam = params.get("mode");
  const mode: ChartMode = MODES.includes(modeParam as ChartMode) ? (modeParam as ChartMode) : "analysis";
  const viewParam = params.get("view");
  const view: LabView = VIEWS.includes(viewParam as LabView) ? (viewParam as LabView) : "trade";
  const tfParam = params.get("tf");
  const tf: Timeframe = TIMEFRAMES.includes(tfParam as Timeframe) ? (tfParam as Timeframe) : "1m";

  // The training game moved to the «Тренажёр»: old links (bookmarks, notifications) go there.
  React.useEffect(() => { if (modeParam === "training") navigate(TRAINER_HREF, { replace: true }); }, [modeParam, navigate]);

  const setParams = React.useCallback((patch: Record<string, string | null>, replace = true) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) { if (v == null) p.delete(k); else p.set(k, v); }
    if (p.get("mode") === "analysis") p.delete("mode");
    if (p.get("tf") === "1m") p.delete("tf");
    if (p.get("view") === "trade") p.delete("view");
    navigate(`/chart-lab${p.toString() ? `?${p}` : ""}`, { replace });
  }, [search, navigate]);

  // A trade opened from the desk (`src`): its fills and structure come from the desk endpoint, which serves someone
  // else's trade with $ / size nulled for non-staff.
  const viaDesk = tradeId != null && (params.get("src") === "mine" || params.get("src") === "desk");
  const trade = useQuery<DeskTradeResp, Error>({
    queryKey: ["chart-lab", "trade", tradeId, viaDesk],
    queryFn: async () => viaDesk
      ? http.get<DeskTradeResp>(`/api/training/trades/${tradeId}`)
      : { trade: await http.get<TradeRow>(`/api/trades/${tradeId}`), executions: [], structure: null },
    enabled: tradeId != null && modeParam !== "training",
    retry: false,
    placeholderData: (prev) => (prev && prev.trade.id === tradeId ? prev : undefined),
  });

  const { user, isCurator, dbUsers } = useAuth();
  // Staff = traders: their own book by default, any trader by name (the multi-trade views only).
  const [labTrader, setLabTrader] = React.useState("");
  const traderNames = React.useMemo(() => dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort(comparePersonNames), [dbUsers]);
  const adHoc: TradeLike | null = React.useMemo(() => (tradeId == null && adTicker && adDate ? { id: adHocId(adTicker, adDate), ticker: adTicker, date: adDate } : null), [tradeId, adTicker, adDate]);
  const current: TradeRow | null = tradeId != null ? trade.data?.trade ?? null : adHoc;
  const overlay = usePlanOverlay(tradeId != null ? { tradeId } : adTicker && adDate ? { ticker: adTicker, date: adDate } : null);
  const openTrade = (t: TradeRow) => navigate(`/chart-lab?trade=${t.id}${mode !== "analysis" ? `&mode=${mode}` : ""}${tf !== "1m" ? `&tf=${tf}` : ""}`);

  const label = current ? (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="font-semibold">{current.ticker}</span>
      <span className="text-muted-foreground">{current.date.slice(0, 10)}</span>
      {tradeId != null && <><span className="hidden text-muted-foreground sm:inline">{String(current.side ?? "").toLowerCase() === "short" ? tl("picker.short") : tl("picker.long")}</span><ResultText t={current} /></>}
      {tradeId != null && current.trader && current.redacted && <span className="hidden text-muted-foreground sm:inline">· {personName(current.trader)}</span>}
    </span>
  ) : <span className="text-muted-foreground">{tl("picker.pick")}</span>;

  if (modeParam === "training") return null;
  const viewSwitch = (
    <Segmented<LabView> size="sm" ariaLabel={tl("views.aria")} value={view} onChange={(v) => setParams({ view: v }, false)}
      options={VIEWS.map((v) => ({ value: v, label: tl(`views.${v}`) }))} />
  );
  if (view !== "trade") {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-[var(--page-max)] flex-col gap-3">
        <header className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{tl("title.page")}</h1>
          {viewSwitch}
          {isCurator && (
            <StaffTraderPicker value={labTrader || (user?.traderName ?? "")} onChange={setLabTrader} me={user?.traderName} names={traderNames} team={false} className="h-9 w-auto min-w-[12rem]" ariaLabel={tl("views.traderAria")} />
          )}
        </header>
        {view === "overlay" ? <OverlayView trader={isCurator ? labTrader : ""} /> : <ExitsView trader={isCurator ? labTrader : ""} />}
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[var(--page-max)] flex-col gap-2 lg:-mb-[2.25rem] lg:h-[calc(100svh-6.25rem)] lg:min-h-[520px]">
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="sr-only text-lg font-semibold tracking-tight sm:not-sr-only sm:mr-1">{tl("title.page")}</h1>
        {viewSwitch}
        <TradePicker
          label={label}
          onPick={openTrade}
          onTickerDay={(tk, d) => navigate(`/chart-lab?ticker=${encodeURIComponent(tk)}&date=${d}${tf !== "1m" ? `&tf=${tf}` : ""}`)}
        />
        {tradeId != null && current && !current.redacted && (
          // Back to where an own trade is reviewed: its row in «Сделки» and the report of that day.
          <span className="flex shrink-0 items-center">
            <Button variant="ghost" size="icon" className="h-9 w-9" asChild title={tl("openInTrades")}>
              <Link href={links.trade(tradeId)} aria-label={tl("openInTradesAria")}><ListChecks className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" asChild title={tl("dayReview")}>
              <Link href={links.dayReport(current.date.slice(0, 10), current.trader && current.trader !== user?.traderName ? current.trader : undefined)} aria-label={tl("dayReview")}><CalendarDays className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          </span>
        )}
        {tradeId != null && current && !viaDesk && (
          <AddToPlaybookButton payload={{ name: `${current.ticker} ${current.date.slice(0, 10)}`, ticker: current.ticker, sourceType: "trade", sourceId: tradeId }} className="h-9 shrink-0" />
        )}
        <OverlayChips overlay={current ? overlay : null} />
        <PlaybookSheetButton />
      </header>

      {tradeId == null && !adHoc ? (
        <StartState onPick={openTrade} />
      ) : tradeId != null && trade.isLoading ? (
        <Skeleton className="min-h-[420px] flex-1 rounded-2xl" />
      ) : tradeId != null && (trade.error || !trade.data) ? (
        <Panel><EmptyState
          icon={CandlestickChart}
          title={tl("unavailable", { id: tradeId })}
          description={trade.error?.message ?? tl("notFound")}
          action={(trade.error as { status?: number } | null)?.status === 404 ? undefined : (
            <Button variant="outline" size="sm" onClick={() => void trade.refetch()} disabled={trade.isFetching}>
              <RefreshCw className={trade.isFetching ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" /> {commonI18n.t("actions.retry")}
            </Button>
          )}
        /></Panel>
      ) : current ? (
        <WsChart
          key={`${current.id}`}
          className="lg:min-h-0 lg:flex-1"
          layout="workspace"
          trade={current}
          executions={adHoc ? [] : viaDesk ? trade.data?.executions : undefined}
          structure={viaDesk ? trade.data?.structure ?? null : undefined}
          mode={mode}
          onModeChange={(m) => setParams({ mode: m })}
          initialTimeframe={tf}
          onTimeframeChange={(t) => setParams({ tf: t })}
          showModes
          planLevels={overlay?.levels}
          replayExtra={tradeId != null ? (ctx) => <DecisionDrill ctx={ctx} /> : undefined}
        />
      ) : null}
    </div>
  );
}
