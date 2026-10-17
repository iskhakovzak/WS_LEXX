import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, NotebookText, RefreshCw } from "lucide-react";
import { EmptyState, FilterChip, Panel, Pill, Segmented, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fmtCompact,
  fmtMoney,
  fmtPct,
  fmtShortDate,
  plural,
  relTime,
  useEarningsUpcoming,
  useEarningsWatch,
  type EarningsItem,
  type UpcomingItem,
} from "@/components/research/earnings-api";
import { CallTypePill, EarningsHistorySheet, type HistoryTarget } from "@/components/research/earnings-history";

type Tab = "bmo" | "amc" | "week";
type SortKey = "move" | "surprise" | "cap";

const LS_TAB = "earningsWatch.tab";
const LS_COLLAPSED = "earningsWatch.collapsed";
const LS_SORT = "earningsWatch.sort";
const CARD_LIMIT = 8;

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

/** The move that matters for this session: pre-market for today's BMO, after-hours for last night's AMC. */
function reactionOf(item: EarningsItem, tab: Tab) {
  return tab === "amc" ? item.pricePostMarket ?? item.priceMoveDay : item.priceMoveDay ?? item.pricePreMarket;
}

function MetricCell({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm font-medium tabular-nums", className)}>{value}</div>
    </div>
  );
}

function ReportCard({
  item,
  tab,
  hasNotes,
  onOpen,
}: {
  item: EarningsItem;
  tab: Tab;
  hasNotes: boolean;
  onOpen: () => void;
}) {
  const move = reactionOf(item, tab);
  const tone = toneOf(move);
  const beat = item.epsActual != null && item.epsEstimate != null ? item.epsActual >= item.epsEstimate : null;
  const extPct = tab === "amc" ? item.pricePostMarket : item.pricePreMarket;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${item.ticker}: история реакций на отчёты`}
      className="glass-panel lift group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl p-3.5 pl-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-3 left-0 w-0.5 rounded-full",
          tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-border",
        )}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-semibold tracking-tight">{item.ticker}</span>
            {item.callType !== "TNS" && <CallTypePill type={item.callType} />}
            {beat != null && <Pill tone={beat ? "up" : "down"}>{beat ? "Beat" : "Miss"}</Pill>}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.company}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-xl font-semibold tabular-nums tracking-tight", toneText(tone))}>{fmtPct(move)}</div>
          {item.price != null && <div className="text-xs tabular-nums text-muted-foreground">${item.price.toFixed(2)}</div>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-[var(--glass-bg)] px-2.5 py-2">
        <MetricCell label="EPS факт" value={fmtMoney(item.epsActual)} />
        <MetricCell label="Прогноз" value={fmtMoney(item.epsEstimate)} />
        <MetricCell
          label="Сюрприз"
          value={fmtPct(item.epsSurprisePct, 1)}
          className={toneText(toneOf(item.epsSurprisePct))}
        />
        <MetricCell
          label={tab === "amc" ? "После закр." : "Премаркет"}
          value={fmtPct(extPct, 1)}
          className={toneText(toneOf(extPct))}
        />
        <MetricCell
          label="RelVol"
          value={item.relVol != null ? `${item.relVol.toFixed(1)}×` : "—"}
          className={item.relVol != null && item.relVol >= 2 ? "text-[hsl(var(--chart-3))]" : undefined}
        />
        <MetricCell label="Кап." value={item.marketCapNum ? fmtCompact(item.marketCapNum) : "—"} />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {hasNotes ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <NotebookText className="h-3.5 w-3.5" aria-hidden="true" /> Есть заметки
          </span>
        ) : (
          <span>{item.fiscalQuarter ? `Квартал ${item.fiscalQuarter}` : ""}</span>
        )}
        <span className="inline-flex items-center gap-0.5 group-hover:text-foreground">
          История реакций <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
    </button>
  );
}

function UpcomingDay({
  date,
  total,
  items,
  isToday,
  noted,
  onOpen,
}: {
  date: string;
  total: number;
  items: UpcomingItem[];
  isToday: boolean;
  noted: Set<string>;
  onOpen: (t: HistoryTarget) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <div className={cn("glass-panel flex min-w-0 flex-col rounded-xl", isToday && "ring-1 ring-primary")}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold capitalize">{fmtShortDate(date, true)}</span>
          {isToday && <Pill tone="accent">Сегодня</Pill>}
        </div>
        <Pill tone="accent">
          {total} {plural(total, "отчёт", "отчёта", "отчётов")}
        </Pill>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Нет крупных отчётов</p>
      ) : (
        <ul className="flex flex-col p-1.5">
          {shown.map((it) => (
            <li key={it.ticker}>
              <button
                type="button"
                onClick={() => onOpen({ ticker: it.ticker, company: it.company, callType: it.callType, epsEstimate: it.epsEstimate, date })}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${it.ticker}, ${it.company}: история отчётов`}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-6 w-0.5 shrink-0 rounded-full",
                    it.callType === "BMO" ? "bg-[hsl(var(--chart-3))]" : it.callType === "AMC" ? "bg-[hsl(var(--chart-5))]" : "bg-border",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{it.ticker}</span>
                    {it.callType !== "TNS" && <CallTypePill type={it.callType} className="px-1.5 py-0 text-2xs" />}
                    {noted.has(it.ticker) && <NotebookText className="h-3.5 w-3.5 text-primary" aria-label="Есть заметки" />}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">{it.company}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums">{fmtMoney(it.epsEstimate)}</span>
                  <span className="block text-2xs tabular-nums text-muted-foreground">{it.marketCapNum ? fmtCompact(it.marketCapNum) : ""}</span>
                </span>
              </button>
            </li>
          ))}
          {items.length > 8 && (
            <li>
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-primary hover:bg-[var(--glass-hover-bg)]"
              >
                {all ? "Свернуть" : `Ещё ${items.length - 8}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Загружаем отчёты">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * Earnings radar: today's BMO, last night's AMC (with price reaction) and the next 5 sessions.
 * Click any company for its beat/miss streak and past gap / day-move history.
 * Props are optional so existing `<EarningsWatch />` usages keep working.
 */
export function EarningsWatch({
  onCreateNote,
  notedTickers,
  className,
}: {
  onCreateNote?: (t: HistoryTarget) => void;
  /** Tickers that already have research notes — marked on cards. */
  notedTickers?: Iterable<string>;
  className?: string;
} = {}) {
  const { toast } = useToast();
  const [tab, setTabState] = useState<Tab>(() => readLS(LS_TAB, ["bmo", "amc", "week"] as const, "bmo"));
  const [collapsed, setCollapsedState] = useState(() => readLS(LS_COLLAPSED, ["0", "1"] as const, "0") === "1");
  const [sort, setSortState] = useState<SortKey>(() => readLS(LS_SORT, ["move", "surprise", "cap"] as const, "move"));
  const [onlyNoted, setOnlyNoted] = useState(false);
  const [target, setTarget] = useState<HistoryTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [, setTick] = useState(0);

  const setTab = (t: Tab) => { setTabState(t); writeLS(LS_TAB, t); };
  const setCollapsed = (v: boolean) => { setCollapsedState(v); writeLS(LS_COLLAPSED, v ? "1" : "0"); };
  const setSort = (s: SortKey) => { setSortState(s); writeLS(LS_SORT, s); };

  const watch = useEarningsWatch(!collapsed);
  const upcoming = useEarningsUpcoming(!collapsed && tab === "week");
  const noted = useMemo(() => new Set(Array.from(notedTickers ?? [], (t) => t.toUpperCase())), [notedTickers]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const data = watch.data;
  const bmo = data?.bmo ?? [];
  const amc = data?.amc ?? [];

  const items = useMemo(() => {
    let list = tab === "amc" ? amc : tab === "bmo" ? bmo : [];
    if (onlyNoted) list = list.filter((i) => noted.has(i.ticker.toUpperCase()));
    const sorted = [...list];
    if (sort === "move") sorted.sort((a, b) => Math.abs(reactionOf(b, tab) ?? 0) - Math.abs(reactionOf(a, tab) ?? 0));
    else if (sort === "surprise") sorted.sort((a, b) => Math.abs(b.epsSurprisePct ?? -1) - Math.abs(a.epsSurprisePct ?? -1));
    else sorted.sort((a, b) => (b.marketCapNum ?? 0) - (a.marketCapNum ?? 0));
    return sorted;
  }, [tab, amc, bmo, sort, onlyNoted, noted]);

  const allInTab = tab === "amc" ? amc : bmo;
  const beats = allInTab.filter((i) => i.epsSurprisePct != null && i.epsSurprisePct >= 0).length;
  const misses = allInTab.filter((i) => i.epsSurprisePct != null && i.epsSurprisePct < 0).length;
  const notedInTab = allInTab.filter((i) => noted.has(i.ticker.toUpperCase())).length;
  const upcomingTotal = upcoming.data?.days.reduce((s, d) => s + d.total, 0);

  async function handleRefresh() {
    try {
      if (tab === "week") {
        await upcoming.refetch();
        return;
      }
      const r = await watch.refresh();
      if (r.throttled) {
        const sec = r.nextRefreshAt ? Math.max(1, Math.ceil((new Date(r.nextRefreshAt).getTime() - Date.now()) / 1000)) : 60;
        toast({ title: "Данные уже свежие", description: `Повторное обновление доступно через ${sec} с` });
      } else {
        toast({ title: "Отчёты обновлены" });
      }
    } catch (e) {
      toast({ title: "Не удалось обновить", description: (e as Error)?.message, variant: "destructive" });
    }
  }

  const busy = watch.refreshing || watch.isFetching || (tab === "week" && upcoming.isFetching);
  const sessionDate = tab === "bmo" ? data?.date : tab === "amc" ? data?.amcDate : undefined;

  return (
    <Panel
      icon={CalendarClock}
      className={className}
      title="Отчёты компаний"
      description={
        collapsed
          ? "Свернуто"
          : data?.fetchedAt
            ? `Обновлено ${relTime(data.fetchedAt)}${sessionDate ? ` · сессия ${fmtShortDate(sessionDate, true)}` : ""}`
            : "Сегодня до открытия, вчера после закрытия и ближайшая неделя"
      }
      actions={
        <>
          {!collapsed && (
            <Segmented<Tab>
              ariaLabel="Период отчётов"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: "bmo", label: "Сегодня", count: data ? bmo.length : undefined },
                { value: "amc", label: "Вчера AMC", count: data ? amc.length : undefined },
                { value: "week", label: "Неделя", count: upcomingTotal },
              ]}
            />
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={busy}
              aria-label="Обновить отчёты"
              title="Обновить (не чаще раза в минуту)"
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Развернуть отчёты" : "Свернуть отчёты"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", collapsed && "-rotate-90")} />
          </Button>
        </>
      }
      bodyClassName={collapsed ? "hidden" : undefined}
    >
      {!collapsed && tab !== "week" && (
        <>
          {watch.isLoading && <CardsSkeleton />}
          {watch.isError && !watch.isLoading && (
            <EmptyState
              icon={AlertTriangle}
              title="Не удалось загрузить отчёты"
              description={(watch.error as Error)?.message}
              action={
                <Button variant="outline" size="sm" onClick={() => watch.refetch()} disabled={watch.isFetching}>
                  <RefreshCw className={cn("h-3.5 w-3.5", watch.isFetching && "animate-spin")} /> Повторить
                </Button>
              }
            />
          )}
          {!watch.isLoading && !watch.isError && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {allInTab.length} {plural(allInTab.length, "компания", "компании", "компаний")}
                  </span>
                  {beats + misses > 0 && (
                    <>
                      <Pill tone="up">{beats} beat</Pill>
                      <Pill tone="down">{misses} miss</Pill>
                    </>
                  )}
                  {noted.size > 0 && notedInTab > 0 && (
                    <FilterChip active={onlyNoted} onClick={() => setOnlyNoted((v) => !v)} count={notedInTab} className="min-h-7 text-xs">
                      С заметками
                    </FilterChip>
                  )}
                </div>
                {allInTab.length > 1 && (
                  <Segmented<SortKey>
                    ariaLabel="Сортировка отчётов"
                    size="sm"
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "move", label: "Движение" },
                      { value: "surprise", label: "Сюрприз" },
                      { value: "cap", label: "Капитализация" },
                    ]}
                  />
                )}
              </div>
              {items.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title={tab === "bmo" ? "Сегодня нет отчётов до открытия" : "Нет отчётов после закрытия"}
                  description={
                    onlyNoted
                      ? "Среди отчётов нет тикеров с вашими заметками."
                      : "Загляните во вкладку «Неделя», чтобы подготовиться к ближайшим отчётам."
                  }
                  action={
                    <Button variant="outline" size="sm" onClick={() => (onlyNoted ? setOnlyNoted(false) : setTab("week"))}>
                      {onlyNoted ? "Показать все" : "Открыть неделю"}
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {(showAll ? items : items.slice(0, CARD_LIMIT)).map((item) => (
                    <ReportCard
                      key={item.ticker}
                      item={item}
                      tab={tab}
                      hasNotes={noted.has(item.ticker.toUpperCase())}
                      onOpen={() =>
                        setTarget({
                          ticker: item.ticker,
                          company: item.company,
                          callType: item.callType,
                          epsEstimate: item.epsEstimate,
                        })
                      }
                    />
                  ))}
                </div>
              )}
              {items.length > CARD_LIMIT && (
                <div className="mt-3 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                    {showAll ? "Свернуть" : `Показать все ${items.length}`}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {!collapsed && tab === "week" && (
        <>
          {upcoming.isLoading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-busy="true" aria-label="Загружаем календарь отчётов">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-xl" />
              ))}
            </div>
          )}
          {upcoming.isError && (
            <EmptyState
              icon={AlertTriangle}
              title="Не удалось загрузить календарь"
              description={(upcoming.error as Error)?.message}
              action={
                <Button variant="outline" size="sm" onClick={() => upcoming.refetch()}>
                  Повторить
                </Button>
              }
            />
          )}
          {upcoming.data && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {upcoming.data.days.map((d) => (
                <UpcomingDay
                  key={d.date}
                  date={d.date}
                  total={d.total}
                  items={d.items}
                  isToday={d.date === upcoming.data!.today}
                  noted={noted}
                  onOpen={setTarget}
                />
              ))}
            </div>
          )}
          <p className="mt-3 text-2xs text-muted-foreground">
            Крупнейшие компании по капитализации. Справа — прогноз EPS и капитализация. Нажмите на тикер, чтобы увидеть историю реакций.
          </p>
        </>
      )}

      <EarningsHistorySheet
        target={target}
        onOpenChange={(o) => !o && setTarget(null)}
        onCreateNote={
          onCreateNote
            ? (t) => {
                setTarget(null);
                onCreateNote(t);
              }
            : undefined
        }
      />
    </Panel>
  );
}

export type { HistoryTarget };
