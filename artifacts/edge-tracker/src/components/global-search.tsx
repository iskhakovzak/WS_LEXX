/**
 * Command palette (Ctrl/⌘K): search trades, tickers, setups, ideas, feed, research, events and pages;
 * run actions (Новая сделка, Новая идея…); jump anywhere ("Перейти к…", or G then a letter); recent items.
 * Built on cmdk with our own filtering (corpora can be large), loaded lazily on first open.
 */
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { useLocation } from "wouter";
import {
  useListEvents, useListResearch, useListDailyFeed,
  getListEventsQueryKey, getListResearchQueryKey, getListDailyFeedQueryKey,
} from "@workspace/api-client-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchTradesPage, TRADES_PAGE_KEY } from "@/hooks/use-trades-page";
import {
  Search, X, CandlestickChart, CalendarClock, BookOpen, Newspaper, BookMarked, Lightbulb, StickyNote,
  Plus, CornerDownLeft, History, Hash, Eye, MessageSquare, SunMoon, ArrowRight, Loader2,
} from "lucide-react";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ds";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { ALL_NAV_ITEMS, GO_KEYS, type NavItem } from "@/components/shell/nav";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const HOTKEY_LABEL = IS_MAC ? "⌘K" : "Ctrl+K";
const OPEN_EVENT = "ws-open-palette";
const RECENT_KEY = "ws_lexx_palette_recent";

/** Open the command palette from anywhere (e.g. a mobile button or an empty state). */
export function openCommandPalette(query?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { query } }));
}

type Section = "Сделки" | "Идеи" | "Плейбук" | "Лента" | "Исследования" | "События";

type ResultItem = {
  id: string;
  section: Section;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: "up" | "down" | "warn" | "neutral" | "accent";
  meta?: string;
  path: string;
  /** Fires the in-page `ws-search-navigate` event for pages already mounted. */
  highlight?: number;
};

type RecentItem = { id: string; title: string; subtitle?: string; path: string; kind: string; highlight?: number };

const SECTION_ICON: Record<Section, React.ElementType> = {
  "Сделки": CandlestickChart,
  "Идеи": Lightbulb,
  "Плейбук": BookMarked,
  "Лента": Newspaper,
  "Исследования": BookOpen,
  "События": CalendarClock,
};

const BADGE_TONE: Record<NonNullable<ResultItem["badgeTone"]>, string> = {
  up: "bg-up/15 text-up",
  down: "bg-down/15 text-down",
  warn: "bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]",
  accent: "bg-primary/15 text-primary",
  neutral: "bg-[var(--glass-bg)] text-muted-foreground",
};

async function fetchList(url: string): Promise<any[]> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const has = (v: unknown, q: string) => typeof v === "string" && v.toLowerCase().includes(q);
const clip = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

function loadRecent(): RecentItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.path === "string" && typeof r.title === "string").slice(0, 7) : [];
  } catch {
    return [];
  }
}
function saveRecent(item: RecentItem) {
  try {
    const next = [item, ...loadRecent().filter((r) => r.id !== item.id)].slice(0, 7);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function tradeResult(t: any): Pick<ResultItem, "badge" | "badgeTone"> {
  const pnl = typeof t.pnl === "number" ? t.pnl - (typeof t.fees === "number" ? t.fees : 0) : null;
  if (pnl != null && Number.isFinite(pnl) && pnl !== 0) {
    const s = `${pnl > 0 ? "+" : "−"}$${Math.abs(pnl).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`;
    return { badge: s, badgeTone: pnl > 0 ? "up" : "down" };
  }
  if (t.result === "win") return { badge: "Плюс", badgeTone: "up" };
  if (t.result === "loss") return { badge: "Минус", badgeTone: "down" };
  if (t.result) return { badge: "В ноль", badgeTone: "neutral" };
  return {};
}

const IDEA_STATUS: Record<string, { label: string; tone: ResultItem["badgeTone"] }> = {
  approved: { label: "Одобрена", tone: "up" },
  published: { label: "Опубликована", tone: "warn" },
  draft: { label: "Черновик", tone: "neutral" },
  rejected: { label: "Отклонена", tone: "down" },
};

function Item({
  value,
  onSelect,
  icon: Icon,
  title,
  subtitle,
  right,
  className,
}: {
  value: string;
  onSelect: () => void;
  icon?: React.ElementType;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "group flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 text-sm outline-none",
        "data-[selected=true]:bg-primary/12 data-[selected=true]:text-foreground",
        className,
      )}
    >
      {Icon && (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted-foreground group-data-[selected=true]:text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      {right}
      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100" aria-hidden="true" />
    </CommandPrimitive.Item>
  );
}

const groupCls =
  "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notesOnly, setNotesOnly] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>(() => loadRecent());
  const [, navigate] = useLocation();
  const { canEdit, isCurator } = useAuth();
  const { cycleTheme, themeLabel } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Trades are searched server-side (P1-5): GET /api/trades/page?q=&limit=20 per (deferred) query instead of
  // loading the whole book into the palette. Other corpora load after the first open (then stay cached).
  const tradeQ = useDeferredValue(query).trim().replace(/^\$/, "").slice(0, 120);
  const { data: tradesRaw, isLoading: l1 } = useQuery<any[]>({
    queryKey: [TRADES_PAGE_KEY, "search", tradeQ.toLowerCase()],
    queryFn: async ({ signal }) => (await fetchTradesPage(new URLSearchParams({ q: tradeQ, limit: "20" }), signal)).items ?? [],
    enabled: open && tradeQ.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const { data: eventsRaw, isLoading: l2 } = useListEvents(undefined, { query: { queryKey: getListEventsQueryKey(), enabled: open } });
  const { data: researchRaw, isLoading: l3 } = useListResearch({ query: { queryKey: getListResearchQueryKey(), enabled: open } });
  const { data: feedsRaw, isLoading: l4 } = useListDailyFeed({ query: { queryKey: getListDailyFeedQueryKey(), enabled: open } });
  const { data: playbookRaw, isLoading: l5 } = useQuery<any[]>({
    queryKey: ["playbook"],
    queryFn: () => fetchList(`${BASE}/api/playbook`),
    enabled: open,
    staleTime: 30_000,
  });
  const { data: tradeIdeasRaw, isLoading: l6 } = useQuery<any[]>({
    queryKey: ["trade-ideas-search"],
    queryFn: () => fetchList(`${BASE}/api/trade-ideas`),
    enabled: open,
    staleTime: 30_000,
  });
  const trades = asArray<any>(tradesRaw);
  const events = asArray<any>(eventsRaw);
  const research = asArray<any>(researchRaw);
  const feeds = asArray<any>(feedsRaw);
  const playbook = asArray<any>(playbookRaw);
  const tradeIdeas = asArray<any>(tradeIdeasRaw);
  const loading = open && ((tradeQ.length > 0 && l1) || l2 || l3 || l4 || l5 || l6);

  // ── Global keys: Ctrl/⌘K toggles; "G then letter" jumps to a section (outside text fields). ──
  useEffect(() => {
    let gAt = 0;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog']")) return;
      const k = e.key.toLowerCase();
      if (k === "g" || k === "п") { gAt = Date.now(); return; }
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const LAYOUT: Record<string, string> = { в: "d", з: "p", к: "r", е: "t", о: "j", с: "c", ф: "a", ы: "s", и: "b", ц: "w", у: "e", ш: "i" };
        const href = GO_KEYS[k] ?? GO_KEYS[LAYOUT[k] ?? ""];
        if (href) { e.preventDefault(); navigate(href); }
      }
    }
    function onOpen(e: Event) {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (typeof q === "string") setQuery(q);
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [navigate]);

  useEffect(() => {
    if (open) setRecent(loadRecent());
    else { setQuery(""); setNotesOnly(false); }
  }, [open]);

  const deferredQuery = useDeferredValue(query);
  const raw = deferredQuery.trim();
  const q = raw.toLowerCase().replace(/^\$/, "");
  const isStale = query !== deferredQuery;

  // ── Data results ──
  const results: ResultItem[] = useMemo(() => {
    if (!q) return [];
    const items: ResultItem[] = [];
    const tradeItem = (t: any): ResultItem => ({
      id: `trade-${t.id}`,
      section: "Сделки",
      title: t.ticker ?? "—",
      subtitle: notesOnly ? clip(t.notes) : [t.setup, t.side === "short" ? "шорт" : t.side === "long" ? "лонг" : null, t.horizon && t.horizon !== "intraday" ? (t.horizon === "swing" ? "свинг" : "овернайт") : null].filter(Boolean).join(" · ") || undefined,
      ...tradeResult(t),
      meta: t.date?.substring(0, 10),
      path: "/trades",
      highlight: t.id,
    });
    const ideaItem = (i: any): ResultItem => ({
      id: `idea-${i.id}`,
      section: "Идеи",
      title: i.ticker ?? "—",
      subtitle: notesOnly ? clip(i.notes || i.description) : [i.setup, i.trader].filter(Boolean).join(" · ") || undefined,
      badge: IDEA_STATUS[i.status]?.label ?? i.status,
      badgeTone: IDEA_STATUS[i.status]?.tone ?? "neutral",
      meta: i.createdAt?.substring?.(0, 10),
      path: `/trade-ideas?idea=${i.id}`,
    });
    const pbItem = (e: any): ResultItem => ({
      id: `playbook-${e.id}`,
      section: "Плейбук",
      title: e.name ?? "Сетап",
      subtitle: notesOnly ? clip(e.notes || e.conditions) : (e.parentId ? "вариация сетапа" : e.folder || clip(e.conditions, 60)),
      badge: e.confidenceLevel != null ? `${e.confidenceLevel}%` : undefined,
      badgeTone: e.confidenceLevel >= 85 ? "up" : e.confidenceLevel >= 70 ? "accent" : "warn",
      path: "/playbook",
      highlight: e.id,
    });
    const feedItem = (f: any): ResultItem => ({
      id: `feed-${f.id}`,
      section: "Лента",
      title: f.date?.substring(0, 10) ?? "Запись",
      subtitle: clip(notesOnly ? f.notes || f.whatWorksNow : f.marketTheme || f.notes, 70),
      path: "/dailyfeed",
      highlight: f.id,
    });
    const resItem = (r: any): ResultItem => ({
      id: `research-${r.id}`,
      section: "Исследования",
      title: r.patternName ?? "Исследование",
      subtitle: notesOnly ? clip(r.description || r.context) : r.ticker || clip(r.description, 60),
      badge: r.confidenceLevel != null ? `${r.confidenceLevel}%` : undefined,
      badgeTone: r.confidenceLevel >= 70 ? "up" : "neutral",
      path: "/research",
    });
    const evItem = (e: any): ResultItem => ({
      id: `event-${e.id}`,
      section: "События",
      title: e.ticker ?? "Событие",
      subtitle: clip(notesOnly ? e.summary : e.headline || e.summary),
      meta: e.date?.substring(0, 10),
      path: `/events?id=${e.id}`,
    });

    if (notesOnly) {
      tradeIdeas.filter((i) => has(i.notes, q) || has(i.description, q)).slice(0, 4).forEach((i) => items.push(ideaItem(i)));
      trades.filter((t) => has(t.notes, q)).slice(0, 6).forEach((t) => items.push(tradeItem(t)));
      playbook.filter((e) => has(e.notes, q) || has(e.conditions, q) || has(e.checklist, q)).slice(0, 5).forEach((e) => items.push(pbItem(e)));
      feeds.filter((f) => has(f.notes, q) || has(f.whatWorksNow, q) || has(f.whatDoesntWork, q)).slice(0, 4).forEach((f) => items.push(feedItem(f)));
      research.filter((r) => has(r.description, q) || has(r.context, q) || has(r.whatWorked, q)).slice(0, 3).forEach((r) => items.push(resItem(r)));
      events.filter((e) => has(e.summary, q)).slice(0, 3).forEach((e) => items.push(evItem(e)));
      return items;
    }
    // Exact ticker hits first, then partial matches.
    const tickerFirst = <T,>(arr: T[], get: (x: T) => unknown) =>
      [...arr].sort((a, b) => Number(String(get(b) ?? "").toLowerCase() === q) - Number(String(get(a) ?? "").toLowerCase() === q));
    tickerFirst(trades.filter((t) => has(t.ticker, q) || has(t.setup, q) || has(t.notes, q) || has(t.tags, q) || has(t.trader, q)), (t: any) => t.ticker)
      .slice(0, 5).forEach((t) => items.push(tradeItem(t)));
    tickerFirst(tradeIdeas.filter((i) => has(i.ticker, q) || has(i.setup, q) || has(i.trader, q) || has(i.tags, q) || has(i.notes, q) || has(i.description, q)), (i: any) => i.ticker)
      .slice(0, 5).forEach((i) => items.push(ideaItem(i)));
    playbook.filter((e) => has(e.name, q) || has(e.conditions, q) || has(e.notes, q) || has(e.tags, q) || has(e.folder, q) || has(e.checklist, q))
      .slice(0, 4).forEach((e) => items.push(pbItem(e)));
    feeds.filter((f) => has(f.marketTheme, q) || has(f.notes, q) || has(f.tags, q) || has(f.bestTickers, q) || has(f.whatWorksNow, q) || has(f.whatDoesntWork, q) || (typeof f.date === "string" && f.date.includes(q)))
      .slice(0, 4).forEach((f) => items.push(feedItem(f)));
    research.filter((r) => has(r.patternName, q) || has(r.description, q) || has(r.ticker, q) || has(r.context, q) || has(r.whatWorked, q))
      .slice(0, 3).forEach((r) => items.push(resItem(r)));
    events.filter((e) => has(e.ticker, q) || has(e.headline, q) || has(e.summary, q))
      .slice(0, 3).forEach((e) => items.push(evItem(e)));
    return items;
  }, [q, notesOnly, trades, playbook, feeds, research, events, tradeIdeas]);

  const sections = useMemo(() => {
    const map = new Map<Section, ResultItem[]>();
    for (const item of results) {
      const arr = map.get(item.section);
      if (arr) arr.push(item); else map.set(item.section, [item]);
    }
    return map;
  }, [results]);

  // ── Tickers known to the desk (trades + ideas), with counts ──
  const tickerIndex = useMemo(() => {
    const m = new Map<string, { trades: number; ideas: number }>();
    for (const t of trades) {
      const k = String(t.ticker ?? "").toUpperCase();
      if (!k) continue;
      const e = m.get(k) ?? { trades: 0, ideas: 0 };
      e.trades++; m.set(k, e);
    }
    for (const i of tradeIdeas) {
      const k = String(i.ticker ?? "").toUpperCase();
      if (!k) continue;
      const e = m.get(k) ?? { trades: 0, ideas: 0 };
      e.ideas++; m.set(k, e);
    }
    return m;
  }, [trades, tradeIdeas]);

  const looksLikeTicker = !notesOnly && /^\$?[a-zA-Z][a-zA-Z.]{0,5}$/.test(raw);
  const ticker = looksLikeTicker ? raw.replace(/^\$/, "").toUpperCase() : "";
  const otherTickers = useMemo(() => {
    if (!q || notesOnly || q.length > 6) return [];
    const up = q.toUpperCase();
    return [...tickerIndex.entries()]
      .filter(([k]) => k.startsWith(up) && k !== up)
      .sort((a, b) => b[1].trades + b[1].ideas - (a[1].trades + a[1].ideas))
      .slice(0, 5);
  }, [q, notesOnly, tickerIndex]);

  // ── Pages ──
  const pages = useMemo(() => {
    const visible = ALL_NAV_ITEMS.filter((i) => !i.staff || isCurator);
    if (!q) return visible.filter((i) => !i.hidden);
    return visible.filter((i) => i.name.toLowerCase().includes(q) || (i.keywords ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [q, isCurator]);

  const go = useCallback(
    (path: string, rec?: Omit<RecentItem, "path">, highlight?: number) => {
      setOpen(false);
      if (rec) saveRecent({ ...rec, path, highlight });
      navigate(path);
      if (highlight != null) {
        const base = path.split("?")[0];
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("ws-search-navigate", { detail: { path: base, highlightId: highlight } }));
        }, 0);
      }
    },
    [navigate],
  );

  const goResult = (item: ResultItem) => {
    const path = item.highlight != null && !item.path.includes("?") ? `${item.path}?highlight=${item.highlight}` : item.path;
    go(path, { id: item.id, title: item.title, subtitle: item.subtitle, kind: item.section }, item.highlight);
  };
  const goPage = (p: NavItem) => go(p.href, { id: `page-${p.href}`, title: p.name, kind: "Раздел" });

  type Action = { id: string; label: string; hint?: string; icon: React.ElementType; run: () => void; keywords: string; when?: boolean };
  const actions: Action[] = [
    { id: "new-trade", label: "Новая сделка", icon: Plus, run: () => go("/trades?new=1"), keywords: "new trade добавить сделку записать", when: isCurator },
    { id: "new-idea", label: "Новая идея", icon: Lightbulb, run: () => go("/trade-ideas?new=1"), keywords: "new idea добавить идею", when: canEdit },
    { id: "new-event", label: "Новое событие", icon: CalendarClock, run: () => go("/events?new=1"), keywords: "new event катализатор отчёт", when: canEdit },
    { id: "theme", label: "Сменить тему", hint: `сейчас: ${themeLabel}`, icon: SunMoon, run: () => cycleTheme(), keywords: "theme тема dark light тёмная светлая" },
  ].filter((a) => a.when !== false);
  const visibleActions = q ? actions.filter((a) => a.label.toLowerCase().includes(q) || a.keywords.toLowerCase().includes(q)) : actions;

  const tickerActions = ticker
    ? [
        { id: "t-ideas", label: `Идеи по ${ticker}`, icon: Lightbulb, path: `/trade-ideas?ticker=${encodeURIComponent(ticker)}` },
        { id: "t-watch", label: `${ticker} в вотчлисте`, icon: Eye, path: `/watchlist?ticker=${encodeURIComponent(ticker)}` },
        { id: "t-events", label: `Катализаторы ${ticker}`, icon: CalendarClock, path: `/events?ticker=${encodeURIComponent(ticker)}` },
        { id: "t-disc", label: `Обсуждения ${ticker}`, icon: MessageSquare, path: `/discussions?ticker=${encodeURIComponent(ticker)}` },
      ]
    : [];
  const tickerStats = ticker ? tickerIndex.get(ticker) : undefined;

  const nothing =
    !!q && !loading && !isStale && results.length === 0 && pages.length === 0 && visibleActions.length === 0 && !ticker && otherTickers.length === 0;

  const trigger = (
    <DialogPrimitive.Trigger asChild>
      <button
        type="button"
        // Fixed width + short label: never clipped to «Поиск или к…» next to the logo and the market clock.
        className="glass-field flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:w-44 sm:min-w-0 sm:shrink sm:justify-start sm:pl-3.5 sm:pr-1.5 2xl:w-56"
        title={`Поиск и команды (${HOTKEY_LABEL})`}
        aria-label={`Поиск и команды (${HOTKEY_LABEL})`}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden min-w-0 flex-1 truncate text-left sm:inline">Поиск…</span>
        <Kbd keys={[MOD, "K"]} className="hidden min-[1360px]:inline-flex" />
      </button>
    </DialogPrimitive.Trigger>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-[var(--overlay)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className="glass-thick fixed left-1/2 top-[max(10vh,calc(env(safe-area-inset-top)+0.75rem))] z-modal flex max-h-[min(640px,80dvh)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-popover/80 text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">Поиск и команды</DialogPrimitive.Title>
          <CommandPrimitive shouldFilter={false} loop label="Поиск и команды" className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4">
              {loading || isStale ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <CommandPrimitive.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder={notesOnly ? "Искать в заметках…" : "Тикер, сетап, идея, раздел или команда…"}
                aria-label="Поисковый запрос"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
              <button
                type="button"
                onClick={() => { setNotesOnly((v) => !v); inputRef.current?.focus(); }}
                aria-pressed={notesOnly}
                title="Искать только в заметках и описаниях"
                className="chip inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium"
              >
                <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Заметки</span>
              </button>
              {query && (
                <button type="button" aria-label="Очистить запрос" onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="chip grid h-8 w-8 shrink-0 place-items-center">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <DialogPrimitive.Close className="chip hidden h-8 shrink-0 items-center px-2.5 text-2xs font-medium sm:inline-flex" aria-label="Закрыть">
                Esc
              </DialogPrimitive.Close>
            </div>

            <CommandPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {nothing && (
                <div role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Ничего не найдено по запросу «{raw}»{notesOnly ? " в заметках" : ""}
                </div>
              )}

              {!q && recent.length > 0 && (
                <CommandPrimitive.Group heading="Недавнее" className={groupCls}>
                  {recent.map((r) => (
                    <Item
                      key={r.id}
                      value={`recent-${r.id}`}
                      icon={History}
                      title={r.title}
                      subtitle={[r.kind, r.subtitle].filter(Boolean).join(" · ")}
                      onSelect={() => go(r.path, { id: r.id, title: r.title, subtitle: r.subtitle, kind: r.kind }, r.highlight)}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}

              {ticker && (
                <CommandPrimitive.Group heading={`Тикер ${ticker}${tickerStats ? ` · ${tickerStats.trades} сд. · ${tickerStats.ideas} ид.` : ""}`} className={groupCls}>
                  {tickerActions.map((a) => (
                    <Item key={a.id} value={a.id} icon={a.icon} title={a.label} onSelect={() => go(a.path, { id: a.id, title: a.label, kind: "Тикер" })} />
                  ))}
                </CommandPrimitive.Group>
              )}

              {otherTickers.length > 0 && (
                <CommandPrimitive.Group heading="Тикеры" className={groupCls}>
                  {otherTickers.map(([k, c]) => (
                    <Item
                      key={k}
                      value={`ticker-${k}`}
                      icon={Hash}
                      title={k}
                      subtitle={`${c.trades} сделок · ${c.ideas} идей`}
                      right={<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                      onSelect={() => { setQuery(k); inputRef.current?.focus(); }}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}

              {visibleActions.length > 0 && (
                <CommandPrimitive.Group heading="Действия" className={groupCls}>
                  {visibleActions.map((a) => (
                    <Item
                      key={a.id}
                      value={`action-${a.id}`}
                      icon={a.icon}
                      title={a.label}
                      subtitle={a.hint}
                      onSelect={a.run}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}

              {[...sections.entries()].map(([name, items]) => (
                <CommandPrimitive.Group key={name} heading={name} className={groupCls}>
                  {items.map((item) => (
                    <Item
                      key={item.id}
                      value={item.id}
                      icon={SECTION_ICON[item.section]}
                      title={item.title}
                      subtitle={item.subtitle}
                      onSelect={() => goResult(item)}
                      right={
                        <span className="flex shrink-0 items-center gap-2">
                          {item.badge && (
                            <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums", BADGE_TONE[item.badgeTone ?? "neutral"])}>{item.badge}</span>
                          )}
                          {item.meta && <span className="hidden text-2xs tabular-nums text-muted-foreground sm:inline">{item.meta}</span>}
                        </span>
                      }
                    />
                  ))}
                </CommandPrimitive.Group>
              ))}

              {pages.length > 0 && (
                <CommandPrimitive.Group heading="Перейти к…" className={groupCls}>
                  {pages.map((p) => (
                    <Item
                      key={p.href}
                      value={`page-${p.href}`}
                      icon={p.icon}
                      title={p.name}
                      onSelect={() => goPage(p)}
                      right={p.goKey ? <Kbd keys={["G", p.goKey.toUpperCase()]} className="hidden sm:inline-flex" /> : undefined}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}
            </CommandPrimitive.List>

            <div aria-hidden="true" className="hidden items-center gap-4 border-t border-[var(--glass-border)] px-4 py-2 text-2xs text-muted-foreground sm:flex">
              <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> выбор</span>
              <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> открыть</span>
              <span className="inline-flex items-center gap-1"><Kbd>$</Kbd> тикер</span>
              <span className="ml-auto inline-flex items-center gap-1"><Kbd>G</Kbd> затем буква — быстрый переход</span>
            </div>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
