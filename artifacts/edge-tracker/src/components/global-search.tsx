import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useListTrades, useListEvents, useListResearch, useListDailyFeed } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, TrendingUp, Activity, BookOpen, Calendar, Library, ArrowRight, StickyNote } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type ResultItem = {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  meta?: string;
  path: string;
  highlight?: number;
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Трейды":       <TrendingUp className="h-3 w-3" />,
  "Плейбук":      <Library className="h-3 w-3" />,
  "Дневная лента":<Calendar className="h-3 w-3" />,
  "Исследования": <BookOpen className="h-3 w-3" />,
  "События":      <Activity className="h-3 w-3" />,
};

const SECTION_COLORS: Record<string, string> = {
  "Трейды":        "text-primary",
  "Плейбук":       "text-purple-400",
  "Дневная лента": "text-cyan-400",
  "Исследования":  "text-amber-400",
  "События":       "text-blue-400",
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [notesOnly, setNotesOnly] = useState(false);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: trades = [] } = useListTrades();
  const { data: events = [] } = useListEvents();
  const { data: research = [] } = useListResearch();
  const { data: feeds = [] } = useListDailyFeed();
  const { data: playbook = [] } = useQuery<any[]>({
    queryKey: ["playbook"],
    queryFn: () => fetch(`${BASE}/api/playbook`).then((r) => r.json()),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 10); }
    else { setQuery(""); setCursor(0); }
  }, [open]);

  const q = query.toLowerCase().trim();

  const results: ResultItem[] = useMemo(() => {
    if (!q) return [];
    const items: ResultItem[] = [];

    if (notesOnly) {
      trades
        .filter((t) => t.notes?.toLowerCase().includes(q))
        .slice(0, 6)
        .forEach((t) => items.push({
          id: `trade-${t.id}`,
          section: "Трейды",
          title: t.ticker,
          subtitle: t.notes?.substring(0, 80) || undefined,
          badge: t.result === "win" ? "WIN" : t.result === "loss" ? "LOSS" : "BE",
          badgeColor: t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground",
          meta: t.date?.substring(0, 10),
          path: "/trades",
          highlight: t.id,
        }));

      playbook
        .filter((e: any) =>
          e.notes?.toLowerCase().includes(q) ||
          e.conditions?.toLowerCase().includes(q) ||
          e.checklist?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((e: any) => items.push({
          id: `playbook-${e.id}`,
          section: "Плейбук",
          title: e.name,
          subtitle: (e.notes || e.conditions || "")?.substring(0, 80) || undefined,
          badge: e.confidenceLevel != null ? `${e.confidenceLevel}%` : undefined,
          badgeColor: e.confidenceLevel >= 85 ? "text-emerald-400" : e.confidenceLevel >= 70 ? "text-primary" : "text-amber-400",
          path: "/playbook",
          highlight: e.id,
        }));

      feeds
        .filter((f: any) =>
          f.notes?.toLowerCase().includes(q) ||
          f.whatWorksNow?.toLowerCase().includes(q) ||
          f.whatDoesntWork?.toLowerCase().includes(q)
        )
        .slice(0, 4)
        .forEach((f: any) => items.push({
          id: `feed-${f.id}`,
          section: "Дневная лента",
          title: f.date?.substring(0, 10),
          subtitle: (f.notes || f.whatWorksNow || "")?.substring(0, 80) || undefined,
          path: "/dailyfeed",
        }));

      research
        .filter((r: any) =>
          r.description?.toLowerCase().includes(q) ||
          r.context?.toLowerCase().includes(q) ||
          r.whatWorked?.toLowerCase().includes(q)
        )
        .slice(0, 3)
        .forEach((r: any) => items.push({
          id: `research-${r.id}`,
          section: "Исследования",
          title: r.patternName,
          subtitle: (r.description || r.context || "")?.substring(0, 80) || undefined,
          badge: r.confidenceLevel != null ? `${r.confidenceLevel}%` : undefined,
          badgeColor: r.confidenceLevel >= 70 ? "text-emerald-400" : "text-muted-foreground",
          path: "/research",
        }));

      events
        .filter((e: any) => e.summary?.toLowerCase().includes(q))
        .slice(0, 3)
        .forEach((e: any) => items.push({
          id: `event-${e.id}`,
          section: "События",
          title: e.ticker,
          subtitle: e.summary?.substring(0, 80) || undefined,
          meta: e.date?.substring(0, 10),
          path: "/events",
        }));

    } else {
      trades
        .filter((t) =>
          t.ticker.toLowerCase().includes(q) ||
          t.setup?.toLowerCase().includes(q) ||
          t.notes?.toLowerCase().includes(q) ||
          t.tags?.toLowerCase().includes(q) ||
          t.trader?.toLowerCase().includes(q) ||
          (t as any).side?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((t) => items.push({
          id: `trade-${t.id}`,
          section: "Трейды",
          title: t.ticker,
          subtitle: t.setup || undefined,
          badge: t.result === "win" ? "WIN" : t.result === "loss" ? "LOSS" : "BE",
          badgeColor: t.result === "win" ? "text-emerald-400" : t.result === "loss" ? "text-red-400" : "text-muted-foreground",
          meta: t.date?.substring(0, 10),
          path: "/trades",
          highlight: t.id,
        }));

      playbook
        .filter((e: any) =>
          e.name?.toLowerCase().includes(q) ||
          e.conditions?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q) ||
          e.tags?.toLowerCase().includes(q) ||
          e.folder?.toLowerCase().includes(q) ||
          e.checklist?.toLowerCase().includes(q)
        )
        .slice(0, 4)
        .forEach((e: any) => items.push({
          id: `playbook-${e.id}`,
          section: "Плейбук",
          title: e.name,
          subtitle: e.parentId ? `↳ дочерний` : (e.folder || undefined),
          badge: e.confidenceLevel != null ? `${e.confidenceLevel}%` : undefined,
          badgeColor: e.confidenceLevel >= 85 ? "text-emerald-400" : e.confidenceLevel >= 70 ? "text-primary" : "text-amber-400",
          path: "/playbook",
          highlight: e.id,
        }));

      feeds
        .filter((f: any) =>
          f.marketTheme?.toLowerCase().includes(q) ||
          f.notes?.toLowerCase().includes(q) ||
          f.tags?.toLowerCase().includes(q) ||
          f.bestTickers?.toLowerCase().includes(q) ||
          f.whatWorksNow?.toLowerCase().includes(q) ||
          f.whatDoesntWork?.toLowerCase().includes(q) ||
          f.date?.includes(q)
        )
        .slice(0, 4)
        .forEach((f: any) => items.push({
          id: `feed-${f.id}`,
          section: "Дневная лента",
          title: f.date?.substring(0, 10),
          subtitle: f.marketTheme || f.notes?.slice(0, 60) || undefined,
          path: "/dailyfeed",
        }));

      research
        .filter((r: any) =>
          r.patternName?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.ticker?.toLowerCase().includes(q) ||
          r.context?.toLowerCase().includes(q) ||
          r.whatWorked?.toLowerCase().includes(q)
        )
        .slice(0, 3)
        .forEach((r: any) => items.push({
          id: `research-${r.id}`,
          section: "Исследования",
          title: r.patternName,
          subtitle: r.ticker || undefined,
          badge: r.confidenceLevel != null ? `${r.confidenceLevel}%` : undefined,
          badgeColor: r.confidenceLevel >= 70 ? "text-emerald-400" : "text-muted-foreground",
          path: "/research",
        }));

      events
        .filter((e: any) =>
          e.ticker?.toLowerCase().includes(q) ||
          e.headline?.toLowerCase().includes(q) ||
          e.summary?.toLowerCase().includes(q)
        )
        .slice(0, 3)
        .forEach((e: any) => items.push({
          id: `event-${e.id}`,
          section: "События",
          title: e.ticker,
          subtitle: e.headline,
          meta: e.date?.substring(0, 10),
          path: "/events",
        }));
    }

    return items;
  }, [q, notesOnly, trades, playbook, feeds, research, events]);

  useEffect(() => { setCursor(0); }, [results]);

  function goTo(item: ResultItem) {
    setOpen(false);
    setQuery("");
    if (item.highlight) {
      navigate(`${item.path}?highlight=${item.highlight}`);
    } else {
      navigate(item.path);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      goTo(results[cursor]);
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelectorAll("[data-result]")[cursor] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const sections = useMemo(() => {
    const map = new Map<string, ResultItem[]>();
    for (const item of results) {
      if (!map.has(item.section)) map.set(item.section, []);
      map.get(item.section)!.push(item);
    }
    return map;
  }, [results]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-none border border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-mono transition-colors"
        title="Поиск (Cmd+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Поиск...</span>
        <kbd className="hidden sm:inline text-[10px] bg-background border border-border px-1 py-0.5 rounded-sm">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl mx-4 bg-card border border-border shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground mr-3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={notesOnly ? "Поиск в заметках..." : "Трейды, плейбук, дневная лента, события..."}
            className="flex-1 bg-transparent py-4 text-sm font-mono outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => setNotesOnly((v) => !v)}
            title={notesOnly ? "Поиск в заметках (вкл)" : "Поиск в заметках (выкл)"}
            className={`flex items-center gap-1 px-2 py-1 mr-2 text-[10px] font-mono border transition-colors shrink-0 ${
              notesOnly
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:border-foreground/30"
            }`}
          >
            <StickyNote className="h-3 w-3" />
            Заметки
          </button>
          {query && (
            <button onClick={() => setQuery("")} className="p-1 text-muted-foreground hover:text-foreground mr-1">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!q && (
          <div className="px-4 py-8 text-center space-y-3">
            <div className="text-xs text-muted-foreground font-mono">
              {notesOnly ? "Поиск только в заметках, условиях и описаниях" : "Введите тикер, дату, ключевое слово"}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {["Трейды", "Плейбук", "Дневная лента", "Исследования", "События"].map((s) => (
                <span key={s} className={`flex items-center gap-1 text-[10px] font-mono px-2 py-1 bg-muted border border-border/50 ${SECTION_COLORS[s]}`}>
                  {SECTION_ICONS[s]} {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {q && results.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground font-mono">
            Ничего не найдено по запросу «{query}»{notesOnly ? " в заметках" : ""}
          </div>
        )}

        {results.length > 0 && (
          <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
            {[...sections.entries()].map(([sectionName, items]) => (
              <div key={sectionName}>
                <div className={`px-4 py-1.5 text-[10px] font-mono uppercase bg-muted/40 flex items-center gap-1.5 border-b border-border/30 ${SECTION_COLORS[sectionName]}`}>
                  {SECTION_ICONS[sectionName]}
                  {sectionName}
                  <span className="ml-auto text-muted-foreground normal-case">{items.length}</span>
                </div>
                {items.map((item) => {
                  const idx = results.indexOf(item);
                  const isActive = idx === cursor;
                  return (
                    <button
                      key={item.id}
                      data-result
                      onClick={() => goTo(item)}
                      onMouseEnter={() => setCursor(idx)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left border-b border-border/30 last:border-b-0 transition-colors group ${
                        isActive ? "bg-primary/10" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm font-mono text-foreground">{item.title}</span>
                          {item.badge && (
                            <span className={`text-[10px] font-mono font-bold ${item.badgeColor}`}>{item.badge}</span>
                          )}
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{item.subtitle}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {item.meta && <span className="text-[11px] text-muted-foreground font-mono">{item.meta}</span>}
                        <ArrowRight className={`h-3 w-3 transition-opacity ${isActive ? "opacity-100 text-primary" : "opacity-0"}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border px-4 py-2 flex gap-4 text-[10px] font-mono text-muted-foreground">
          <span>↑↓ навигация</span>
          <span>↵ перейти</span>
          <span>ESC закрыть</span>
          <span className="ml-auto">⌘K открыть</span>
        </div>
      </div>
    </div>
  );
}
