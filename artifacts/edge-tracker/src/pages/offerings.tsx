import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, BarChart3, CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Layers, RefreshCw, Sun, UserCheck,
} from "lucide-react";
import {
  EmptyState, Page, PageHeader, Panel, Pill, SectionTabs, Segmented, StatCard, StatGrid, TableSkeleton, TermTooltip, UpdatedAgo,
  usePersistentState, type SortDir,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/offerings/FilterBar";
import { HoldingsAlert } from "@/components/offerings/HoldingsAlert";
import { IpoLockupView, calendarToOffering } from "@/components/offerings/IpoCalendarStrip";
import { InsiderPanel } from "@/components/offerings/InsiderPanel";
import { MyStatsView } from "@/components/offerings/MyStatsView";
import { OfferingDetailSheet } from "@/components/offerings/OfferingDetailSheet";
import { OfferingsList, sortValue, SORT_LABEL, type SortKey } from "@/components/offerings/OfferingsList";
import {
  EMPTY_FILTERS, activeFilterCount, matchesFilters, normalizeFilters, type FilterPreset, type OfferingFilters,
} from "@/components/offerings/filters";
import { advMultiple, cleanUnderwriter, dealTypeOf, dilutionScore, discountOf, pctOfFloat } from "@/components/offerings/score";
import {
  fetchOfferingsFresh, useAddToPlan, useAddToWatchlist, useExposure, useOfferings, useOfferingsDays,
} from "@/components/offerings/use-offerings-data";
import {
  addBusinessDays, dayTitle, fmtDay, fmtM, fmtPct, offeringKey, pctOfMcap, todayNY,
  type Offering,
} from "@/components/offerings/types";

type Tab = "today" | "week" | "ipo" | "insiders" | "mine";
type When = "today" | "next" | "prev" | "all";
const TABS: Tab[] = ["today", "week", "ipo", "insiders", "mine"];

/** Last market day in New York (weekends roll back to Friday). */
function marketDay(): string {
  const t = todayNY();
  const dow = new Date(t + "T12:00:00Z").getUTCDay();
  return dow === 0 || dow === 6 ? addBusinessDays(t, -1) : t;
}

/** Which day's plan «В план дня» writes to: today until the close, then the next session. */
function planDay(): string {
  const t = todayNY();
  const dow = new Date(t + "T12:00:00Z").getUTCDay();
  if (dow === 0 || dow === 6) return addBusinessDays(t, 1);
  let hour = 0;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch { /* keep today */ }
  return hour >= 16 ? addBusinessDays(t, 1) : t;
}

/** The session the deal trades in (reaction date; older payloads: filing date). */
const tradeDay = (o: Offering) => o.reactionDate ?? o.date;
const isOverhang = (o: Offering) => { const t = dealTypeOf(o); return t === "shelf" || t === "s1"; };

function readUrl(): { day: string | null; ticker: string | null; tab: Tab | null } {
  try {
    const p = new URLSearchParams(window.location.search);
    const day = p.get("day");
    const ticker = p.get("ticker");
    const tab = p.get("tab") as Tab | null;
    return {
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
      ticker: ticker && /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(ticker) ? ticker.toUpperCase() : null,
      tab: tab && TABS.includes(tab) ? tab : null,
    };
  } catch {
    return { day: null, ticker: null, tab: null };
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const el = t;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "combobox";
}

function toCsv(rows: Offering[]): string {
  const head = ["ticker", "company", "type", "form", "trade_day", "accepted_et", "score", "deal_size_m", "pct_mcap", "pct_float", "adv_x", "discount_pct", "offer_price", "prev_close", "current_price", "gap_pct", "open_to_close_pct", "market_cap_m", "prior_offerings_12m", "runway_months", "underwriter", "sec_url"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((o) => [
    o.ticker, o.company, dealTypeOf(o), o.form ?? "", tradeDay(o), o.acceptedAt ?? "", dilutionScore(o).score,
    o.dealSizeM ?? "", pctOfMcap(o) ?? "", pctOfFloat(o) ?? "", advMultiple(o) ?? "", discountOf(o) ?? "",
    o.offerPrice ?? "", o.prevClose ?? "", o.currentPrice ?? "", o.reaction?.gapPct ?? "", o.reaction?.o2cPct ?? "",
    o.marketCapM != null ? o.marketCapM.toFixed(1) : "", o.priorOfferings12m ?? "", o.runwayMonths ?? "",
    cleanUnderwriter(o.underwriter) ?? "", o.filingUrl ?? "",
  ].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

/** Minimal offering for tickers opened from insiders / deep links without a filing that day. */
function stubOffering(ticker: string, day: string): Offering {
  return {
    ticker, company: ticker, type: "Other", date: day,
    offerPrice: null, currentPrice: null, priceChangePct: null, dealSizeM: null, sharesOffered: null,
    sharesOutstandingBefore: null, sharesOutstandingAfter: null, dilutionPct: null,
    sellerType: "unknown", insiderShares: null, companyShares: null, underwriter: null, lockupDays: null,
    volume: null, avgVolume: null, relVol: null, marketCapM: null, sector: null,
    rating: 50, ratingFactors: [], status: "filed", source: "edgar",
    kind: "424B", form: null, dealFlags: [], riskFactors: [], stub: true,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export default function OfferingsPage() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const initialUrl = useMemo(readUrl, []);
  const [day, setDay] = useState<string>(() => initialUrl.day ?? marketDay());
  const [tab, setTab] = useState<Tab>(() => initialUrl.tab ?? "today");
  const [when, setWhen] = useState<When>("today");
  const [rawFilters, setFilters] = usePersistentState<OfferingFilters>("offerings.filters.v1", EMPTY_FILTERS);
  const filters = useMemo(() => normalizeFilters(rawFilters), [rawFilters]);
  const [presets, setPresets] = usePersistentState<FilterPreset[]>("offerings.presets.v1", []);
  const [sort, setSort] = usePersistentState<{ key: SortKey; dir: SortDir }>("offerings.sort.v3", { key: "score", dir: "desc" });
  const sortKey: SortKey = sort.key in SORT_LABEL ? sort.key : "score";
  const [overhangOpen, setOverhangOpen] = usePersistentState("offerings.overhang.open", false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Offering | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingTicker = useRef<string | null>(initialUrl.ticker);

  const isList = tab === "today" || tab === "week";
  const { data, isLoading, error, refetch, isFetching } = useOfferings(day);
  const weekDays = useMemo(() => {
    const out = [day];
    for (let i = 0; i < 4; i++) out.unshift(addBusinessDays(out[0], -1));
    return out;
  }, [day]);
  const week = useOfferingsDays(weekDays, tab === "week");
  const { exposure, watchTickers } = useExposure();
  const addWatch = useAddToWatchlist();
  const addPlan = useAddToPlan();
  const todayMarket = marketDay();
  const isLatest = day >= todayMarket;

  // Keep ?day= / ?tab= in the URL so a link to a session can be shared in the desk chat.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (day === marketDay()) u.searchParams.delete("day"); else u.searchParams.set("day", day);
      if (tab === "today") u.searchParams.delete("tab"); else u.searchParams.set("tab", tab);
      u.searchParams.delete("ticker");
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  }, [day, tab]);

  const offerings = useMemo(() => data?.offerings ?? [], [data]);

  // Week: union of the five day payloads (each covers its day and the day before), deduped.
  const weekRows = useMemo(() => {
    if (tab !== "week") return [] as Offering[];
    const seen = new Map<string, Offering>();
    for (const q of week) for (const o of q.data?.offerings ?? []) {
      const k = offeringKey(o);
      const prev = seen.get(k);
      // Prefer the copy from the later payload (fresher price / reaction).
      if (!prev || (o.reaction && !prev.reaction)) seen.set(k, o);
      else if (!prev.reaction) seen.set(k, o);
    }
    return Array.from(seen.values()).filter((o) => tradeDay(o) >= weekDays[0]);
  }, [tab, week, weekDays]);
  const weekLoaded = week.filter((q) => q.data).length;

  const isMine = useCallback((t: string) => {
    const e = exposure.get(t.toUpperCase());
    return !!e && (e.held.length > 0 || e.watched);
  }, [exposure]);

  const source = tab === "week" ? weekRows : offerings;
  const whenCounts = useMemo(() => {
    const c = { today: 0, next: 0, prev: 0, all: 0 };
    for (const o of offerings) {
      if (isOverhang(o)) continue;
      c.all++;
      const td = tradeDay(o);
      if (td === day) c.today++; else if (td > day) c.next++; else c.prev++;
    }
    return c;
  }, [offerings, day]);
  // Default to «today»; when nothing trades today but something does tomorrow / did yesterday, switch once.
  const autoWhen = useRef(false);
  useEffect(() => {
    if (!data || autoWhen.current) return;
    autoWhen.current = true;
    if (whenCounts.today === 0) setWhen(whenCounts.next ? "next" : "all");
  }, [data, whenCounts]);
  useEffect(() => { autoWhen.current = false; }, [day]);

  const q = query.trim().toLowerCase();
  const passes = useCallback((o: Offering) => {
    if (!matchesFilters(o, filters, isMine)) return false;
    if (q && !(o.ticker.toLowerCase().includes(q) || o.company.toLowerCase().includes(q) || (o.underwriter ?? "").toLowerCase().includes(q))) return false;
    return true;
  }, [filters, isMine, q]);

  const sorted = useCallback((list: Offering[]) => {
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const ea = exposure.get(a.ticker.toUpperCase())?.held.length ? 1 : 0;
      const eb = exposure.get(b.ticker.toUpperCase())?.held.length ? 1 : 0;
      if (ea !== eb) return eb - ea; // positions first
      const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "ru", { numeric: true });
      return cmp * dir;
    });
  }, [exposure, sort.dir, sortKey]);

  const deals = useMemo(() => {
    let list = source.filter((o) => !isOverhang(o));
    if (tab === "today" && when !== "all") {
      list = list.filter((o) => { const td = tradeDay(o); return when === "today" ? td === day : when === "next" ? td > day : td < day; });
    }
    const out = sorted(list.filter(passes));
    if (tab === "week") out.sort((a, b) => tradeDay(b).localeCompare(tradeDay(a))); // stable: score order inside a day
    return out;
  }, [source, tab, when, day, passes, sorted]);
  const dealsTotal = useMemo(() => source.filter((o) => !isOverhang(o)).length, [source]);
  const overhang = useMemo(() => sorted(source.filter((o) => isOverhang(o) && passes(o))), [source, passes, sorted]);

  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, deals.length - 1))); }, [deals.length]);

  // Deep link: /offerings?ticker=XYZ opens the sheet once data is in.
  useEffect(() => {
    const t = pendingTicker.current;
    if (!t || isLoading) return;
    pendingTicker.current = null;
    const hit = offerings.find((o) => o.ticker === t);
    const cal = data?.ipoCalendar?.find((c) => c.ticker === t);
    setSelected(hit ?? (cal ? calendarToOffering(cal) : stubOffering(t, day)));
  }, [isLoading, offerings, data?.ipoCalendar, day]);

  // ── KPIs (deals trading on the selected session) ──
  const kpi = useMemo(() => {
    const live = (tab === "week" ? weekRows : offerings).filter((o) => !isOverhang(o) && o.status !== "withdrawn" && (tab === "week" || tradeDay(o) === day));
    const raised = live.reduce((s, o) => s + (o.dealSizeM ?? 0), 0);
    const strong = live.filter((o) => dilutionScore(o).score >= 65).length;
    const discs = live.map(discountOf).filter((d): d is number => d != null);
    const deep = discs.filter((d) => d <= -15).length;
    const reacted = live.filter((o) => o.reaction);
    const o2c = avg(reacted.map((o) => o.reaction!.o2cPct));
    const red = reacted.filter((o) => o.reaction!.o2cPct < 0).length;
    const anyLive = reacted.some((o) => o.reaction!.live);
    return { n: live.length, raised, strong, avgDisc: avg(discs), deep, o2c, red, reacted: reacted.length, anyLive };
  }, [offerings, weekRows, tab, day]);

  const myInsiderTickers = useMemo(() => {
    const held = Array.from(exposure.entries()).filter(([, e]) => e.held.length).map(([t]) => t);
    const watched = (watchTickers ?? []).map((w) => String(w.ticker).toUpperCase());
    return Array.from(new Set([...held, ...watched])).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, 8);
  }, [exposure, watchTickers]);
  const dayInsiderTickers = useMemo(
    () => Array.from(new Set(offerings.filter((o) => o.currentPrice != null && o.status !== "withdrawn" && !isOverhang(o))
      .sort((a, b) => dilutionScore(b).score - dilutionScore(a).score).map((o) => o.ticker))).slice(0, 8),
    [offerings],
  );
  const mineCount = useMemo(() => source.filter((o) => isMine(o.ticker)).length, [source, isMine]);

  // ── Actions ──
  const onSort = useCallback((k: SortKey) => setSort((p) => (p.key === k ? { key: k, dir: p.dir === "desc" ? "asc" : "desc" } : { key: k, dir: "desc" })), [setSort]);
  const goDay = useCallback((dir: 1 | -1) => {
    setDay((d) => { const n = addBusinessDays(d, dir); return n > marketDay() ? d : n; });
    setActive(0);
  }, []);
  const hardRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(["offerings", day], await fetchOfferingsFresh(day));
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [day, qc, refetch]);
  const onAddWatch = useCallback((o: Offering) => {
    if (exposure.get(o.ticker.toUpperCase())?.watched || addWatch.isPending) return;
    addWatch.mutate(o);
  }, [exposure, addWatch]);
  const onAddPlan = useCallback((o: Offering) => {
    if (addPlan.isPending) return;
    addPlan.mutate({ o, date: planDay() });
  }, [addPlan]);
  const openTicker = useCallback((t: string) => {
    setSelected(offerings.find((o) => o.ticker === t) ?? stubOffering(t, day));
  }, [offerings, day]);
  const openRow = useCallback((o: Offering) => setSelected(o), []);
  const rowActions = useMemo(() => ({
    onAddWatch, onAddPlan, planPending: addPlan.isPending,
    pendingTicker: addWatch.isPending ? addWatch.variables?.ticker ?? null : null,
  }), [onAddWatch, onAddPlan, addPlan.isPending, addWatch.isPending, addWatch.variables]);

  const exportCsv = () => {
    const blob = new Blob(["﻿" + toCsv([...deals, ...overhang])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offerings-${tab === "week" ? `week-${day}` : day}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── Keyboard: / search, j/k ↑/↓ move, Enter open, W watchlist, P plan, I idea, [ ] days, R refresh ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape" && e.target === searchRef.current) { setQuery(""); searchRef.current?.blur(); }
        return;
      }
      if (selected) return; // the sheet owns the keyboard (Esc closes it)
      if (!isList) return;
      const cur = deals[active];
      switch (e.key) {
        case "/": e.preventDefault(); searchRef.current?.focus(); break;
        case "j": case "ArrowDown":
          if (!deals.length) return;
          e.preventDefault(); setActive((i) => Math.min(deals.length - 1, i + 1)); break;
        case "k": case "ArrowUp":
          if (!deals.length) return;
          e.preventDefault(); setActive((i) => Math.max(0, i - 1)); break;
        case "Enter": if (cur) { e.preventDefault(); setSelected(cur); } break;
        case "w": case "W": if (cur) onAddWatch(cur); break;
        case "p": case "P": if (cur) onAddPlan(cur); break;
        case "i": case "I": if (cur) navigate(links.newIdea(cur.ticker)); break;
        case "[": goDay(-1); break;
        case "]": goDay(1); break;
        case "r": case "R": if (!refreshing) void hardRefresh(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deals, active, selected, isList, goDay, hardRefresh, onAddWatch, onAddPlan, refreshing, navigate]);

  useEffect(() => {
    if (!isList) return;
    document.querySelector<HTMLElement>(`tr[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, isList]);

  const sourcesDown = data?.sources
    ? (Object.entries(data.sources) as Array<[string, boolean]>).filter(([, ok]) => !ok).map(([k]) => ({ nasdaq: "NASDAQ", edgar: "SEC EDGAR", market: "котировки" } as Record<string, string>)[k] ?? k)
    : [];
  const busy = isFetching || refreshing;
  const enriching = data?.enrichment?.complete === false;
  const noData = !isLoading && !!data && offerings.length === 0;
  const listLoading = tab === "today" ? isLoading : weekLoaded === 0;

  return (
    <Page>
      <PageHeader
        title="Размещения"
        description={<>Короткий катализатор: SPO, <TermTooltip term="atm" />, direct, PIPE, <TermTooltip term="shelf">шелфы</TermTooltip>, IPO и окончания lock-up</>}
        icon={Layers}
        meta={
          <>
            {data?.fetchedAt ? <UpdatedAgo at={data.fetchedAt} prefix="данные" /> : <span>загружаем SEC и котировки…</span>}
            {enriching && <span title="Сервер дособирает время подачи, реакцию по свечам и фундаментал — таблица обновится сама">· дособираем реакцию и фундаментал</span>}
            {sourcesDown.length > 0 && <Pill tone="warn" className="text-2xs">недоступно: {sourcesDown.join(", ")}</Pill>}
          </>
        }
        actions={
          <>
            <div className="glass-field flex h-9 items-center gap-0.5 p-[3px]">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goDay(-1)} aria-label="Предыдущий торговый день ([)">
                <ChevronLeft aria-hidden="true" />
              </Button>
              <label className="relative">
                <span className="sr-only">Дата</span>
                <span className={cn("block min-w-[9.5rem] px-2 text-center text-sm font-medium tabular-nums", day === todayMarket ? "text-primary" : "text-foreground")}>{dayTitle(day)}</span>
                <input
                  type="date"
                  value={day}
                  max={todayMarket}
                  onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setDay(e.target.value > todayMarket ? todayMarket : e.target.value); setActive(0); } }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Выбрать дату"
                />
              </label>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goDay(1)} disabled={isLatest} aria-label="Следующий торговый день (])">
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            {!isLatest && <Button variant="outline" onClick={() => { setDay(todayMarket); setActive(0); }}>К последнему дню</Button>}
            <Button variant="ghost" size="icon" onClick={() => void hardRefresh()} disabled={busy} aria-busy={busy} aria-label="Обновить (R)" title="Обновить (R)">
              <RefreshCw className={cn(busy && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
          </>
        }
      >
        <SectionTabs<Tab>
          ariaLabel="Разделы размещений"
          value={tab}
          onChange={(t) => { setTab(t); setActive(0); }}
          tabs={[
            { value: "today", label: "Сегодня", icon: Sun, count: data ? whenCounts.today : undefined },
            { value: "week", label: "Неделя", icon: CalendarRange },
            { value: "ipo", label: "IPO и lock-up", icon: CalendarDays },
            { value: "insiders", label: "Инсайдеры", icon: UserCheck },
            { value: "mine", label: "Мои сделки", icon: BarChart3 },
          ]}
        />
      </PageHeader>

      {isList && data && <HoldingsAlert offerings={source} exposure={exposure} onOpen={setSelected} />}

      {error && !isLoading && isList && (
        <Panel>
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-down" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm text-foreground">
              Не удалось загрузить размещения{error instanceof Error && error.message ? ` — ${error.message}` : ""}
            </span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn(isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /> Повторить
            </Button>
          </div>
        </Panel>
      )}

      {isList && !noData && !error && (
        <StatGrid min="11rem">
          <StatCard loading={listLoading} label={tab === "week" ? "Сделок за 5 дней" : "Сделок в игре"} value={kpi.n}
            hint={kpi.raised > 0 ? `привлекают ${fmtM(kpi.raised)}` : tab === "week" ? `${weekLoaded}/5 дней загружено` : "торгуются в эту сессию"} />
          <StatCard loading={listLoading} label="Сильное давление" value={kpi.strong} tone={kpi.strong ? "down" : "neutral"}
            hint={filters.minScore === 65 ? "скор ≥ 65 · фильтр включён" : "скор ≥ 65 · нажмите — фильтр"}
            onClick={() => setFilters({ ...filters, minScore: filters.minScore === 65 ? null : 65 })} />
          <StatCard loading={listLoading} label="Средний дисконт" value={kpi.avgDisc != null ? `${kpi.avgDisc.toFixed(1)}%` : "—"}
            hint={kpi.deep ? `${kpi.deep} с дисконтом ≥ 15%` : "к закрытию до сделки"} />
          <StatCard loading={listLoading} label={kpi.anyLive ? "Открытие → сейчас, ср." : "Открытие → закрытие, ср."}
            value={kpi.o2c != null ? fmtPct(kpi.o2c) : "—"} tone={kpi.o2c == null ? "neutral" : kpi.o2c < 0 ? "down" : "up"}
            hint={kpi.reacted ? `ниже открытия ${kpi.red} из ${kpi.reacted}` : "реакция по дневным свечам"} />
        </StatGrid>
      )}

      {isList && data && !noData && (
        <FilterBar
          filters={filters}
          onChange={(f) => { setFilters(f); setActive(0); }}
          presets={presets}
          onSavePreset={(name) => setPresets((p) => [...p.filter((x) => x.name !== name), { id: `u${Date.now().toString(36)}`, name, filters }].slice(-8))}
          onDeletePreset={(id) => setPresets((p) => p.filter((x) => x.id !== id))}
          query={query}
          onQuery={(v) => { setQuery(v); setActive(0); }}
          searchRef={searchRef}
          mineCount={mineCount}
          onExport={exportCsv}
          canExport={deals.length + overhang.length > 0}
          shown={deals.length}
          total={tab === "today" && when !== "all" ? whenCounts[when] : dealsTotal}
        />
      )}

      {isList && (
        <Panel
          title={tab === "week" ? "Сделки за неделю" : "Сделки"}
          description={tab === "week"
            ? `${fmtDay(weekDays[0])} – ${fmtDay(day)} · по дате торгов, внутри дня — по сортировке`
            : "SEC 424B, ATM и IPO · время подачи по Нью-Йорку"}
          padded={false}
          bodyClassName="px-2 pb-2 pt-2 sm:px-3"
          className="min-w-0"
          actions={tab === "today" && data && !noData ? (
            <Segmented<When>
              ariaLabel="Когда торгуется"
              size="sm"
              value={when}
              onChange={(v) => { setWhen(v); setActive(0); }}
              options={[
                { value: "today", label: "В игре сегодня", count: whenCounts.today },
                { value: "next", label: "На завтра", count: whenCounts.next, disabled: !whenCounts.next },
                { value: "prev", label: "Вчера", count: whenCounts.prev, disabled: !whenCounts.prev },
                { value: "all", label: "Все", count: whenCounts.all },
              ]}
            />
          ) : (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex">
              <Kbd>J</Kbd><Kbd>K</Kbd> выбор <Kbd>↵</Kbd> карточка <Kbd>W</Kbd> вотчлист <Kbd>P</Kbd> план
            </span>
          )}
        >
          {listLoading ? (
            <div className="min-h-[420px]" aria-busy="true" aria-label="Загрузка размещений">
              <TableSkeleton rows={8} cols={8} />
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                {tab === "week" ? "Собираем пять торговых дней — каждый новый день до 10 секунд." : "Собираем SEC EDGAR, NASDAQ и котировки — первый запрос дня до 10 секунд."}
              </p>
            </div>
          ) : noData && tab === "today" ? (
            <EmptyState icon={Layers} title="За этот день заявок нет"
              description="Выходной или тихая сессия. Листайте дни клавишами [ и ] или откройте вкладку «Неделя»."
              action={<Button variant="outline" size="sm" onClick={() => setTab("week")}>Открыть неделю</Button>} />
          ) : deals.length === 0 ? (
            <EmptyState compact icon={Layers}
              title={activeFilterCount(filters) || q ? "Ничего не подходит под фильтры" : when === "today" && tab === "today" ? "Сегодня сделок нет" : "Сделок нет"}
              description={activeFilterCount(filters) || q ? "Снимите часть фильтров или выберите другой набор." : tab === "today" ? "Посмотрите «На завтра» / «Вчера» или вкладку «Неделя»." : undefined}
              action={activeFilterCount(filters) || q ? <Button variant="outline" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setQuery(""); }}>Сбросить фильтры</Button> : undefined} />
          ) : (
            <OfferingsList
              items={deals}
              day={tab === "today" ? day : undefined}
              exposure={exposure}
              activeIndex={active}
              query={query.trim()}
              sort={sortKey}
              sortDir={sort.dir}
              onSort={onSort}
              onOpen={openRow}
              onHover={setActive}
              actions={rowActions}
            />
          )}
        </Panel>
      )}

      {isList && overhang.length > 0 && (
        <Panel
          padded={false}
          className="min-w-0"
          bodyClassName={cn(overhangOpen && "px-2 pb-2 sm:px-3")}
          title={
            <button type="button" onClick={() => setOverhangOpen(!overhangOpen)} aria-expanded={overhangOpen}
              className="inline-flex items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", !overhangOpen && "-rotate-90")} aria-hidden="true" />
              Навес: шелфы и S-1 · {overhang.length}
            </button>
          }
          description={<>Денег ещё не привлекли, но могут в любой день: S-3 — <TermTooltip term="shelf">шелф</TermTooltip>, S-1 у торгуемой компании — часто токсичная структура</>}
        >
          {overhangOpen ? (
            <OfferingsList
              items={overhang}
              variant="overhang"
              day={tab === "today" ? day : undefined}
              exposure={exposure}
              activeIndex={-1}
              indexBase={10_000}
              query={query.trim()}
              sort={sortKey}
              sortDir={sort.dir}
              onSort={onSort}
              onOpen={openRow}
              onHover={() => undefined}
              actions={rowActions}
            />
          ) : <div className="pb-[var(--panel-p)]" />}
        </Panel>
      )}

      {tab === "ipo" && <IpoLockupView fallback={data?.ipoCalendar ?? []} onPick={setSelected} />}
      {tab === "insiders" && <InsiderPanel dayTickers={dayInsiderTickers} myTickers={myInsiderTickers} onOpenTicker={openTicker} />}
      {tab === "mine" && <MyStatsView onOpenTicker={openTicker} />}

      <OfferingDetailSheet
        offering={selected}
        exposure={selected ? exposure.get(selected.ticker.toUpperCase()) : undefined}
        onClose={() => setSelected(null)}
        onAddWatch={onAddWatch}
        watchPending={addWatch.isPending}
        onAddPlan={onAddPlan}
        planPending={addPlan.isPending}
        planDate={planDay()}
      />
    </Page>
  );
}
