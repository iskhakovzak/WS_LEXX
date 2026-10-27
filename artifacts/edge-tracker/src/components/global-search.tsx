/**
 * Command palette (Ctrl/⌘K, the header search): the hub of the app.
 * - Open with nothing typed: «Recent» (last 8 opened, per user) → «Quick actions» valid for the viewer now → sections.
 * - Typing: a ticker hub (its trades, chart, own stats), a trade by `#id`, people, commands, trades / ideas / playbook
 *   setups / feed / research / events, pages and settings — grouped, ranked, matched characters highlighted.
 * - Keys: ↑↓ move, Enter opens, Tab / Shift+Tab jump between groups, Esc closes (or leaves the language list).
 * Texts: shell `palette.*`. Built on cmdk with our own ranking (components/palette/rank.ts); data and the quick actions
 * live in global-search-hub.tsx. This module is a lazy chunk: the header button and the global keys are in
 * shell/palette-launcher.tsx.
 */
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { useLocation } from "wouter";
import type { Trade } from "@workspace/api-client-react";
import {
  ArrowLeft, ArrowRight, BookMarked, BookOpen, CalendarClock, CandlestickChart, Check, Eye, Hash, History, Languages,
  LineChart, Lightbulb, Loader2, MessageSquare, Newspaper, Search, StickyNote, UserRound, UsersRound, X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { LANGS, LANG_META, personName, useLang } from "@/i18n";
import { shellI18n } from "@/i18n/ns/shell";
import { commonI18n } from "@/i18n/ns/common";
import { fmtDate, fmtRate, fmtUsd } from "@/lib/format";
import { links } from "@/lib/links";
import { ALL_NAV_ITEMS, groupOf, parentOf, type NavItem } from "@/components/shell/nav";
import { useVisibleNav } from "@/components/shell/use-nav-model";
import { navItemOpen } from "@/components/shell/nav-model";
import { usePeopleDirectory, type DirectoryPerson, type SearchHit } from "@/components/people/search";
import { openSetupSheet } from "@/components/shared/playbook-sheet";
import { Group, Hl, Item, PaletteFooter, RowMeta } from "@/components/palette/parts";
import { orderGroups, parseQuery, rankItems, titleRanges, SCORE, type Hit } from "@/components/palette/rank";
import { readRecents, rememberRecent, type RecentItem, type RecentKind } from "@/components/palette/recent";
import { buildResults, bySection, tradeResult, type ResultItem, type Section } from "@/components/palette/results";
import { personActions, personSubtitle, useGroupSizes, usePeopleHits } from "@/components/palette/people";
import { MOVE_KEYS, useGroupTab, usePinFirst } from "@/components/palette/keyboard";
import {
  ShareCardHost, chartDay, switchLang, useDebounced, useHubActions, usePaletteCorpora, useTickerStats, useTradeById, type HubAction,
} from "@/components/global-search-hub";

const SECTION_ICON: Record<Section, React.ElementType> = {
  trades: CandlestickChart, ideas: Lightbulb, playbook: BookMarked, feed: Newspaper, research: BookOpen, events: CalendarClock,
};
const SECTION_PRIORITY: Record<Section, number> = { trades: 5, playbook: 6, ideas: 7, events: 8, research: 9, feed: 10 };
const PEOPLE_TIER = { exact: SCORE.exact, prefix: SCORE.prefix, substring: SCORE.substring, fuzzy: 150 } as const;

function kindLabel(kind: RecentKind): string {
  if (kind === "people") return shellI18n.t("palette.people.heading");
  return shellI18n.t(`palette.sections.${kind}`);
}
/** Pages and people follow the UI language (the stored title is from the language at save time). */
function recentTitle(r: RecentItem): string {
  if (r.person) return personName(r.person);
  return r.kind === "page" ? (ALL_NAV_ITEMS.find((i) => `page-${i.href}` === r.id)?.name ?? r.title) : r.title;
}
const goKeys = (p: NavItem) => (p.goKey ? ["G", p.goKey.toUpperCase()] : undefined);
const recentKeys = (r: RecentItem) => {
  const page = r.kind === "page" ? ALL_NAV_ITEMS.find((i) => `page-${i.href}` === r.id) : undefined;
  return page ? goKeys(page) : undefined;
};
function pagePath(p: NavItem) {
  return [groupOf(p)?.label, parentOf(p)?.name].filter(Boolean).join(" · ") || undefined;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open requests from `openCommandPalette(query)`: a string prefills the input. */
  request: { query?: string; n: number };
  /** The header button: focus returns there on close (it is not a Radix Trigger, the palette is a lazy chunk). */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

type Rendered = { id: string; best: number; priority: number; node: React.ReactNode };

export default function GlobalSearch({ open, onOpenChange: setOpen, request, triggerRef }: Props) {
  const [query, setQuery] = useState("");
  const [notesOnly, setNotesOnly] = useState(false);
  const [mode, setMode] = useState<"root" | "lang">("root");
  const [value, setValue] = useState("");
  const [shareTrade, setShareTrade] = useState<Trade | null>(null);
  const [, navigate] = useLocation();
  const { user, isCurator, permissions } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const [recent, setRecent] = useState<RecentItem[]>(() => readRecents(me));
  const { t: ts } = shellI18n.useT();
  const { t: tc } = commonI18n.useT();
  const lang = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onTab = useGroupTab(listRef, setValue);

  const debounced = useDebounced(query, 200);
  const { corpora, loading } = usePaletteCorpora(open, debounced, query);
  const { people: directory } = usePeopleDirectory(open);
  const groupSize = useGroupSizes(directory);

  useEffect(() => { if (typeof request.query === "string") { setMode("root"); setQuery(request.query); } }, [request]);
  useEffect(() => {
    if (open) setRecent(readRecents(me));
    else { setQuery(""); setNotesOnly(false); setMode("root"); setValue(""); }
  }, [open, me]);

  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  const pq = useMemo(() => parseQuery(deferredQuery), [deferredQuery]);
  const { raw, q } = pq;
  const settled = parseQuery(debounced);
  const ticker = notesOnly ? null : pq.ticker;
  const tickerStats = useTickerStats(open, notesOnly ? null : settled.ticker, me);
  const byId = useTradeById(open, notesOnly ? null : settled.tradeId);

  const go = useCallback((path: string, rec?: RecentItem, highlight?: number) => {
    setOpen(false);
    if (rec) setRecent(rememberRecent(me, rec));
    navigate(path);
    if (highlight != null) {
      const base = path.split("?")[0];
      setTimeout(() => window.dispatchEvent(new CustomEvent("ws-search-navigate", { detail: { path: base, highlightId: highlight } })), 0);
    }
  }, [navigate, setOpen, me]);
  const openRecent = (r: RecentItem) => {
    if (r.kind === "ticker") { setQuery(r.title); inputRef.current?.focus(); setRecent(rememberRecent(me, r)); return; }
    if (r.sheetId != null) { setOpen(false); setRecent(rememberRecent(me, r)); openSetupSheet({ setupId: r.sheetId }); return; }
    go(r.path, r, r.highlight);
  };
  const goResult = (it: ResultItem) => {
    const rec: RecentItem = { id: it.id, kind: it.section, title: it.title, subtitle: it.subtitle, path: it.path, highlight: it.highlight, sheetId: it.sheetId };
    if (it.sheetId != null) { setOpen(false); setRecent(rememberRecent(me, rec)); openSetupSheet({ setupId: it.sheetId }); return; }
    const path = it.highlight != null && !it.path.includes("?") ? `${it.path}?highlight=${it.highlight}` : it.path;
    go(path, { ...rec, path }, it.highlight);
  };
  const goPage = (p: NavItem) => go(p.to ?? p.href, { id: `page-${p.href}`, kind: "page", title: p.name, path: p.to ?? p.href });

  const actions = useHubActions({
    open, raw, go: (path) => go(path), close: () => setOpen(false), openShare: setShareTrade,
    openLanguages: () => { setMode("lang"); setQuery(""); inputRef.current?.focus(); },
  });

  // ── Search results ──
  const results = useMemo(() => buildResults(pq.tradeId ? "" : raw, notesOnly, corpora), [pq.tradeId, raw, notesOnly, corpora]);
  const sections = useMemo(() => bySection(results), [results]);
  const peopleHits = usePeopleHits(directory, raw, !notesOnly && !pq.tradeId);
  const navPrefs = permissions.nav;
  const pages = useMemo(() => {
    if (!q || notesOnly || pq.tradeId) return [];
    const visible = ALL_NAV_ITEMS.filter((i) => navItemOpen(i, isCurator, navPrefs));
    // Current-language name, the Russian name and RU/EN keywords: a section is found whatever language you type in.
    return rankItems(visible, q, (i) => [i.name, { text: i.ruName, weight: 0.9 }, { text: i.keywords, weight: 0.6, fuzzy: false }], 8);
  }, [q, notesOnly, pq.tradeId, isCurator, navPrefs]);
  const actionHits = useMemo<Hit<HubAction>[]>(() => {
    if (notesOnly || pq.tradeId) return [];
    if (!q) return actions.filter((a) => a.quick).map((item) => ({ item, score: 0, field: -1, ranges: [] }));
    return rankItems(actions.filter((a) => a.id !== "language"), q, (a) => [a.label, ...a.terms.map((text) => ({ text, weight: 0.6, fuzzy: false }))], 6);
  }, [actions, q, notesOnly, pq.tradeId]);
  const markMoved = usePinFirst(listRef, value, setValue, `${open}|${mode}|${notesOnly}|${deferredQuery}`, open);

  // Tickers the desk knows (from the trades / ideas found), with counts.
  const tickerIndex = useMemo(() => {
    const m = new Map<string, { trades: number; ideas: number }>();
    const add = (k: unknown, f: "trades" | "ideas") => {
      const key = String(k ?? "").toUpperCase();
      if (!key) return;
      const e = m.get(key) ?? { trades: 0, ideas: 0 };
      e[f]++; m.set(key, e);
    };
    for (const tr of corpora.trades) add((tr as { ticker?: string }).ticker, "trades");
    for (const i of corpora.ideas) add((i as { ticker?: string }).ticker, "ideas");
    return m;
  }, [corpora.trades, corpora.ideas]);
  const otherTickers = useMemo(() => {
    if (!q || notesOnly || q.length > 6) return [];
    const up = q.toUpperCase();
    return [...tickerIndex.entries()].filter(([k]) => k.startsWith(up) && k !== up).sort((a, b) => b[1].trades + b[1].ideas - (a[1].trades + a[1].ideas)).slice(0, 5);
  }, [q, notesOnly, tickerIndex]);

  const hasAny = results.length + pages.length + actionHits.length + peopleHits.length + otherTickers.length > 0 || !!ticker || !!pq.tradeId;
  const nothing = !!q && mode === "root" && !loading && !isStale && !hasAny;

  // ── Groups (search mode), ordered by their best hit ──
  const groups: Rendered[] = [];
  if (q && mode === "root") {
    if (pq.tradeId) groups.push({ id: "trade-id", priority: 0, best: 2000, node: <TradeByIdGroup id={pq.tradeId} query={byId} onOpen={goResult} /> });
    if (ticker) {
      const known = tickerIndex.has(ticker);
      groups.push({
        id: "ticker", priority: 1, best: pq.tickerStrong ? 1500 : known ? 900 : 300,
        node: <TickerGroup ticker={ticker} counts={tickerIndex.get(ticker)} stats={tickerStats} me={me} onGo={(path, label) => go(path, { id: `ticker-${ticker}`, kind: "ticker", title: ticker, subtitle: label, path })} />,
      });
    }
    if (peopleHits.length) groups.push({ id: "people", priority: 2, best: PEOPLE_TIER[peopleHits[0].tier], node: <PeopleGroups hits={peopleHits} ctx={{ isCurator, me, groupSize }} go={go} setQuery={setQuery} /> });
    if (actionHits.length) groups.push({ id: "actions", priority: 3, best: actionHits[0].score, node: <ActionsGroup heading={ts("palette.actions")} hits={actionHits} /> });
    for (const [name, items] of sections) {
      groups.push({
        id: `section-${name}`, priority: SECTION_PRIORITY[name], best: Math.max(...items.map((i) => i.score)),
        node: (
          <Group key={name} heading={ts(`palette.sections.${name}`)}>
            {items.map((it) => (
              <Item key={it.id} value={it.id} icon={SECTION_ICON[it.section]} title={<Hl text={it.title} ranges={it.ranges} />} subtitle={it.subtitle}
                onSelect={() => goResult(it)} right={<RowMeta badge={it.badge} tone={it.badgeTone} meta={it.meta} />} />
            ))}
          </Group>
        ),
      });
    }
    if (pages.length) {
      groups.push({
        id: "pages", priority: 11, best: pages[0].score,
        node: (
          <Group heading={ts("palette.goTo")}>
            {pages.map((h) => (
              <Item key={h.item.href} value={`page-${h.item.href}`} icon={h.item.icon} title={<Hl text={h.item.name} ranges={titleRanges(h)} />}
                subtitle={pagePath(h.item)} onSelect={() => goPage(h.item)} hint={goKeys(h.item)} />
            ))}
          </Group>
        ),
      });
    }
    if (otherTickers.length) {
      groups.push({
        id: "tickers", priority: 12, best: 0,
        node: (
          <Group heading={ts("palette.tickers")}>
            {otherTickers.map(([k, c]) => (
              <Item key={k} value={`ticker-${k}`} icon={Hash} title={<Hl text={k} ranges={[[0, q.length]]} />}
                subtitle={ts("palette.tickerCounts", { trades: tc("units.trades", { count: c.trades }), ideas: tc("units.ideas", { count: c.ideas }) })}
                right={<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />} onSelect={() => { setQuery(k); inputRef.current?.focus(); }} />
            ))}
          </Group>
        ),
      });
    }
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-[var(--overlay)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
            onCloseAutoFocus={(e) => { e.preventDefault(); if (!shareTrade) triggerRef.current?.focus({ preventScroll: true }); }}
            onEscapeKeyDown={(e) => { if (mode !== "root") { e.preventDefault(); setMode("root"); setQuery(""); } }}
            className="glass-thick glass-solid fixed left-1/2 top-[max(10vh,calc(env(safe-area-inset-top)+0.75rem))] z-modal flex max-h-[min(640px,80dvh)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]"
          >
            <DialogPrimitive.Title className="sr-only">{ts("palette.title")}</DialogPrimitive.Title>
            <CommandPrimitive
              shouldFilter={false} loop label={ts("palette.title")} value={value} onValueChange={setValue}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && mode !== "root" && !query) { e.preventDefault(); setMode("root"); return; }
                if (MOVE_KEYS.has(e.key)) markMoved();
                onTab(e);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4">
                {mode === "lang" ? (
                  <button type="button" onClick={() => { setMode("root"); inputRef.current?.focus(); }} aria-label={ts("palette.back")} title={ts("palette.back")} className="chip grid h-8 w-8 shrink-0 place-items-center">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : loading || isStale ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <CommandPrimitive.Input
                  ref={inputRef} value={query} onValueChange={setQuery}
                  placeholder={mode === "lang" ? ts("palette.languageHeading") : notesOnly ? ts("palette.placeholderNotes") : ts("palette.placeholder")}
                  aria-label={ts("palette.inputAria")} autoComplete="off" spellCheck={false} enterKeyHint="go"
                  className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
                />
                {mode === "root" && (
                  <button type="button" onClick={() => { setNotesOnly((v) => !v); inputRef.current?.focus(); }} aria-pressed={notesOnly} title={ts("palette.notesToggleTitle")} className="chip inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium">
                    <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{ts("palette.notesToggle")}</span>
                  </button>
                )}
                {query && (
                  <button type="button" aria-label={ts("palette.clearAria")} onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="chip grid h-8 w-8 shrink-0 place-items-center">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {/* Phones have no Esc key: a visible «Cancel» closes the palette (the overlay is not an obvious target). */}
                <DialogPrimitive.Close className="chip inline-flex h-8 shrink-0 items-center px-2.5 text-xs font-medium sm:text-2xs" aria-label={ts("palette.closeAria")}>
                  <span className="sm:hidden">{tc("actions.cancel")}</span>
                  <span className="hidden sm:inline">Esc</span>
                </DialogPrimitive.Close>
              </div>

              <CommandPrimitive.List ref={listRef} onPointerMove={markMoved} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {nothing && (
                  <div role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {notesOnly ? ts("palette.nothingInNotes", { query: raw }) : ts("palette.nothing", { query: raw })}
                  </div>
                )}
                {mode === "lang" && <LanguageGroup current={lang} query={q} close={() => setOpen(false)} />}
                {mode === "root" && !q && (
                  <>
                    {recent.length > 0 && (
                      <Group heading={ts("palette.recent")}>
                        {recent.map((r) => (
                          <Item key={r.id} value={`recent-${r.id}`} icon={r.kind === "ticker" ? Hash : r.kind === "people" ? UserRound : History}
                            title={recentTitle(r)} subtitle={[kindLabel(r.kind), r.subtitle].filter(Boolean).join(" · ")} onSelect={() => openRecent(r)}
                            hint={recentKeys(r)} />
                        ))}
                      </Group>
                    )}
                    {actionHits.length > 0 && <ActionsGroup heading={ts("palette.quick")} hits={actionHits} />}
                    <NavGroups onPick={goPage} />
                  </>
                )}
                {orderGroups(groups).map((g) => <React.Fragment key={g.id}>{g.node}</React.Fragment>)}
              </CommandPrimitive.List>
              <PaletteFooter />
            </CommandPrimitive>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <ShareCardHost trade={shareTrade} onClose={() => setShareTrade(null)} />
    </>
  );
}

function ActionsGroup({ heading, hits }: { heading: string; hits: Hit<HubAction>[] }) {
  return (
    <Group heading={heading}>
      {hits.map((h) => (
        <Item key={h.item.id} value={`action-${h.item.id}`} icon={h.item.icon} title={<Hl text={h.item.label} ranges={titleRanges(h)} />}
          subtitle={h.item.subtitle} hint={h.item.keys} onSelect={h.item.run} />
      ))}
    </Group>
  );
}

/** Empty query: the sidebar rows under the sidebar's own group headings (same IA). */
function NavGroups({ onPick }: { onPick: (p: NavItem) => void }) {
  const navGroups = useVisibleNav();
  return (
    <>
      {navGroups.map((g) => (
        <Group key={g.id} heading={g.label}>
          {g.rows.map((row) => (
            <Item key={row.href} value={`page-${row.href}`} icon={row.icon} title={row.name}
              subtitle={(row.children ?? []).map((c) => c.name).join(" · ") || undefined} onSelect={() => onPick(row)} hint={goKeys(row)} />
          ))}
        </Group>
      ))}
    </>
  );
}

function LanguageGroup({ current, query, close }: { current: string; query: string; close: () => void }) {
  const { t } = shellI18n.useT();
  const langs = LANGS.filter((l) => !query || `${LANG_META[l].native} ${LANG_META[l].code} ${t(`palette.langNames.${l}`)}`.toLowerCase().includes(query));
  return (
    <Group heading={t("palette.languageHeading")}>
      {langs.map((l) => (
        <Item key={l} value={`lang-${l}`} icon={Languages} title={LANG_META[l].native} subtitle={t(`palette.langNames.${l}`)}
          right={l === current ? <Check className="h-4 w-4 text-primary" aria-label={t("palette.languageCurrentMark")} /> : undefined}
          onSelect={() => (l === current ? close() : switchLang(l, close))} />
      ))}
    </Group>
  );
}

type TickerStatsQuery = { data?: { total: number; winRate?: number | null; net?: number | null; lastDate?: string | null } | null; isLoading: boolean; isError: boolean };

/** Typed «NVDA»: the ticker's trades, its chart, the viewer's own numbers on it, then ideas / watchlist / events / talk. */
function TickerGroup({ ticker, counts, stats, me, onGo }: {
  ticker: string; counts?: { trades: number; ideas: number }; stats: TickerStatsQuery; me: string | null; onGo: (path: string, label: string) => void;
}) {
  const { t } = shellI18n.useT();
  const s = stats.data;
  const statsLine = !me ? undefined
    : stats.isLoading ? t("palette.ticker.statsLoading")
    : !s || !s.total ? t("palette.ticker.statsNone", { ticker })
    : t("palette.ticker.statsLine", {
      trades: commonI18n.t("units.trades", { count: s.total }),
      winRate: s.winRate != null ? fmtRate(s.winRate) : "—",
      net: s.net != null ? fmtUsd(s.net, { signed: true, decimals: 0 }) : "—",
    });
  const day = chartDay(s?.lastDate);
  const rows: { id: string; label: string; sub?: string; icon: React.ElementType; path: string }[] = [
    { id: "trades", label: t("palette.ticker.trades", { ticker }), icon: CandlestickChart, path: links.trades({ ticker }) },
    { id: "chart", label: t("palette.ticker.chart", { ticker }), sub: t("palette.ticker.chartHint", { date: fmtDate(day, "dayMonth") }), icon: LineChart, path: `/chart-lab?ticker=${encodeURIComponent(ticker)}&date=${day}` },
    ...(me ? [{ id: "stats", label: t("palette.ticker.stats", { ticker }), sub: statsLine, icon: Hash, path: links.trades({ ticker, trader: me }) }] : []),
    { id: "ideas", label: t("palette.tickerAction.ideas", { ticker }), icon: Lightbulb, path: `/trade-ideas?ticker=${encodeURIComponent(ticker)}` },
    { id: "watch", label: t("palette.tickerAction.watch", { ticker }), icon: Eye, path: links.watchlist(ticker) },
    { id: "events", label: t("palette.tickerAction.events", { ticker }), icon: CalendarClock, path: links.events(ticker) },
    { id: "disc", label: t("palette.tickerAction.discussions", { ticker }), icon: MessageSquare, path: `/discussions?ticker=${encodeURIComponent(ticker)}` },
  ];
  const heading = counts ? t("palette.tickerHeadingStats", { ticker, trades: counts.trades, ideas: counts.ideas }) : t("palette.tickerHeading", { ticker });
  return (
    <Group heading={heading}>
      {rows.map((r) => <Item key={r.id} value={`t-${r.id}`} icon={r.icon} title={r.label} subtitle={r.sub} onSelect={() => onGo(r.path, r.label)} />)}
    </Group>
  );
}

function TradeByIdGroup({ id, query, onOpen }: { id: number; query: { data?: Trade | null; isLoading: boolean; isFetching: boolean }; onOpen: (it: ResultItem) => void }) {
  const { t } = shellI18n.useT();
  const tr = query.data;
  const pending = query.isLoading || (query.isFetching && !tr);
  const hit = tr && tr.id === id ? tradeResult(tr) : null;
  return (
    <Group heading={t("palette.trade.heading", { id })}>
      {hit ? (
        <Item value={`trade-id-${id}`} icon={CandlestickChart} title={hit.title} subtitle={hit.subtitle} onSelect={() => onOpen(hit)} right={<RowMeta badge={hit.badge} tone={hit.badgeTone} meta={hit.meta} />} />
      ) : (
        // Unknown yet / not found: Enter still opens the trades page, which looks the id up and explains a miss.
        <Item value={`trade-id-${id}`} icon={pending ? Loader2 : CandlestickChart} title={pending ? t("palette.trade.loading", { id }) : t("palette.trade.notFound", { id })}
          onSelect={() => onOpen({ id: `trade-${id}`, section: "trades", title: `#${id}`, path: "/trades", highlight: id, score: 0 })} />
      )}
    </Group>
  );
}

function PeopleGroups({ hits, ctx, go, setQuery }: {
  hits: SearchHit<DirectoryPerson>[];
  ctx: Parameters<typeof personActions>[1];
  go: (path: string, rec?: RecentItem) => void;
  setQuery: (q: string) => void;
}) {
  const { t } = shellI18n.useT();
  const top = hits[0]?.item ?? null;
  const topActions = top ? personActions(top, ctx).slice(1) : [];
  const rec = (p: DirectoryPerson, label: string, path: string, suffix = ""): RecentItem => ({ id: `person-${p.id}${suffix}`, kind: "people", title: p.name, subtitle: label, path, person: p.name });
  return (
    <>
      <Group heading={t("palette.people.heading")}>
        {hits.map((h) => {
          const main = personActions(h.item, ctx)[0];
          return (
            <Item key={`person-${h.item.id}`} value={`person-${h.item.id}`} icon={h.item.role === "trader" ? UserRound : UsersRound}
              title={h.field === 0 ? <Hl text={personName(h.item.name)} ranges={h.ranges} /> : personName(h.item.name)} subtitle={personSubtitle(h.item)}
              right={main ? <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">{main.label}</span> : undefined}
              onSelect={() => (main ? go(main.path, rec(h.item, main.label, main.path)) : setQuery(personName(h.item.name)))} />
          );
        })}
      </Group>
      {top && topActions.length > 0 && (
        <Group heading={t("palette.people.actionsFor", { name: personName(top.name) })}>
          {topActions.map((a) => (
            <Item key={a.id} value={`person-act-${a.id}`} icon={a.icon} title={a.label} subtitle={personName(top.name)} onSelect={() => go(a.path, rec(top, a.label, a.path, `-${a.id}`))} />
          ))}
        </Group>
      )}
    </>
  );
}
