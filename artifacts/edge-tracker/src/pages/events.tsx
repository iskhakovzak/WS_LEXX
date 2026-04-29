import React, { useState, useMemo } from "react";
import {
  useListEvents, useCreateEvent, useUpdateEvent, useDeleteEvent, getListEventsQueryKey,
} from "@workspace/api-client-react";
import type { MarketEvent, CreateEventBody, UpdateEventBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Tag, Calendar, X, Search, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, Hash, TrendingUp, Zap } from "lucide-react";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

function InlineScreenshots({ urls }: { urls?: string | null }) {
  if (!urls) return null;
  const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="flex gap-1 mt-1">
      {list.slice(0, 3).map((url, i) => (
        <img key={i} src={url} alt="" className="h-8 w-12 object-cover border border-border/50 opacity-70 hover:opacity-100 transition-opacity" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ))}
      {list.length > 3 && <span className="text-[9px] text-muted-foreground self-end">+{list.length - 3}</span>}
    </div>
  );
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
const EVENT_TYPES = ["earnings", "momentum", "news", "ipo", "fed", "macro", "short_squeeze", "upg", "dwg", "other"];
const REACTIONS = ["gap_up", "gap_down", "grind_up", "grind_down", "flat", "reversal"];

const EVENT_TYPE_COLORS: Record<string, string> = {
  earnings: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  momentum: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  news: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ipo: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  fed: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  macro: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  short_squeeze: "bg-red-500/15 text-red-400 border-red-500/30",
  upg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  dwg: "bg-red-500/15 text-red-400 border-red-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

const EVENT_TYPE_BAR_COLORS: Record<string, string> = {
  earnings: "#34d399",
  momentum: "#22d3ee",
  news: "#fbbf24",
  ipo: "#a78bfa",
  fed: "#60a5fa",
  macro: "#60a5fa",
  short_squeeze: "#f87171",
  upg: "#34d399",
  dwg: "#f87171",
  other: "#94a3b8",
};

function EventTypeBadge({ type }: { type: string }) {
  const colorClass = EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.other;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold border ${colorClass}`}>
      {type}
    </span>
  );
}

function MoveStrengthBar({ percent }: { percent: number | null | undefined }) {
  if (percent == null) return <span className="text-muted-foreground">-</span>;
  const abs = Math.abs(percent);
  const maxWidth = 60;
  const width = Math.min(abs * 3, maxWidth);
  const isPositive = percent >= 0;
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className={`font-bold text-xs font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
        {isPositive ? "+" : ""}{percent.toFixed(1)}%
      </span>
      <div className="w-[60px] h-1.5 bg-muted/40 overflow-hidden">
        <div
          className={`h-full transition-all ${isPositive ? "bg-emerald-500/60" : "bg-red-500/60"}`}
          style={{ width: `${(width / maxWidth) * 100}%` }}
        />
      </div>
    </div>
  );
}

type FormData = { ticker: string; date: string; eventType: string; headline: string; reaction: string; percentMove: string; volume: string; summary: string; screenshotUrls: string[]; screenshotNotes: string[]; tags: string; };

const blank = (): FormData => ({ ticker: "", date: new Date().toISOString().split("T")[0], eventType: "earnings", headline: "", reaction: "", percentMove: "", volume: "", summary: "", screenshotUrls: [""], screenshotNotes: [""], tags: "" });

function eventToForm(e: MarketEvent): FormData {
  const urls = stringToScreenshotUrls(e.screenshotUrl);
  return { ticker: e.ticker, date: e.date.substring(0, 10), eventType: e.eventType, headline: e.headline, reaction: e.reaction ?? "", percentMove: e.percentMove != null ? String(e.percentMove) : "", volume: e.volume ?? "", summary: e.summary ?? "", screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(e.screenshotNotes, urls.length), tags: e.tags ?? "" };
}

function formToBody(f: FormData): CreateEventBody & { tags?: string | null; screenshotNotes?: string | null } {
  return { ticker: f.ticker.toUpperCase(), date: f.date, eventType: f.eventType, headline: f.headline, reaction: f.reaction || null, percentMove: f.percentMove ? Number(f.percentMove) : null, volume: f.volume || null, summary: f.summary || null, screenshotUrl: screenshotUrlsToString(f.screenshotUrls) || null, screenshotNotes: screenshotNotesToString(f.screenshotNotes) || null, tags: f.tags || null };
}

function TagChips({ tags }: { tags?: string | null }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {chips.map((tag, i) => (
        <span key={i} className="px-1.5 py-0 text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 leading-4">{tag}</span>
      ))}
    </div>
  );
}

function formatDay(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("ru-RU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch { return dateStr; }
}

type SortKey = "date" | "percentMove" | "ticker";
type SortDir = "asc" | "desc";

const TOOLTIP_STYLE = { backgroundColor: "#0f1117", borderColor: "#1e293b", borderRadius: 0, fontFamily: "monospace", fontSize: 11 };

export default function Events() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MarketEvent | null>(null);
  const [deleting, setDeleting] = useState<MarketEvent | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: events = [], isLoading } = useListEvents();
  const createMut = useCreateEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setOpen(false); setEditing(null); } } });
  const deleteMut = useDeleteEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setDeleting(null); } } });

  const filtered = useMemo(() => {
    let result = [...events];
    if (filterTypes.length > 0) result = result.filter((e) => filterTypes.includes(e.eventType));
    if (dateFrom) result = result.filter((e) => e.date.substring(0, 10) >= dateFrom);
    if (dateTo) result = result.filter((e) => e.date.substring(0, 10) <= dateTo);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) =>
        e.ticker.toLowerCase().includes(q) ||
        e.headline.toLowerCase().includes(q) ||
        (e.summary ?? "").toLowerCase().includes(q)
      );
    }
    if (filterTags.length > 0) {
      result = result.filter((e) => {
        const eTags = (e.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        return filterTags.some((ft) => eTags.includes(ft));
      });
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "percentMove") cmp = (a.percentMove ?? 0) - (b.percentMove ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [events, filterTypes, filterTags, dateFrom, dateTo, searchQuery, sortKey, sortDir]);

  const grouped = useMemo(() => {
    if (sortKey !== "date") return null;
    const map: Record<string, MarketEvent[]> = {};
    for (const e of filtered) {
      const day = e.date.substring(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(e);
    }
    return Object.entries(map).sort((a, b) => sortDir === "desc" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
  }, [filtered, sortKey, sortDir]);

  const analytics = useMemo(() => {
    if (events.length === 0) return null;
    const movesWithPercent = events.filter((e) => e.percentMove != null);
    const avgMove = movesWithPercent.length > 0
      ? movesWithPercent.reduce((s, e) => s + Math.abs(e.percentMove!), 0) / movesWithPercent.length
      : 0;

    const avgByType: Record<string, { sum: number; total: number; withMove: number }> = {};
    events.forEach((e) => {
      if (!avgByType[e.eventType]) avgByType[e.eventType] = { sum: 0, total: 0, withMove: 0 };
      avgByType[e.eventType].total++;
      if (e.percentMove != null) {
        avgByType[e.eventType].sum += Math.abs(e.percentMove);
        avgByType[e.eventType].withMove++;
      }
    });

    const typeDistribution = EVENT_TYPES.map((t) => ({
      type: t,
      count: avgByType[t]?.total || 0,
      avgMove: avgByType[t] && avgByType[t].withMove > 0
        ? (avgByType[t].sum / avgByType[t].withMove).toFixed(1)
        : "0",
    })).filter((d) => d.count > 0);

    const tickerCounts: Record<string, number> = {};
    events.forEach((e) => { tickerCounts[e.ticker] = (tickerCounts[e.ticker] || 0) + 1; });
    const topTicker = Object.entries(tickerCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      total: events.length,
      avgMove: avgMove.toFixed(1),
      topTicker: topTicker ? { name: topTicker[0], count: topTicker[1] } : null,
      typeDistribution,
    };
  }, [events]);

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(e: MarketEvent) { setForm(eventToForm(e)); setEditing(e); setOpen(true); }

  function handleSave() {
    const body = formToBody(form);
    if (!body.ticker || !body.headline) return;
    if (editing) updateMut.mutate({ id: editing.id, data: body as UpdateEventBody });
    else createMut.mutate({ data: body });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleType(type: string) {
    setFilterTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  function toggleTag(tag: string) {
    setFilterTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    events.forEach((e) => {
      (e.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => tagSet.add(t));
    });
    return Array.from(tagSet).sort();
  }, [events]);

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />;
  }

  const hasFilters = searchQuery || dateFrom || dateTo || filterTypes.length > 0 || filterTags.length > 0;

  function clearFilters() {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
    setFilterTypes([]);
    setFilterTags([]);
  }

  function renderEventRows(dayEvents: MarketEvent[]) {
    return dayEvents.map((e) => (
      <React.Fragment key={e.id}>
        <tr className={`transition-colors cursor-pointer border-l-[3px] ${
          (e.percentMove ?? 0) > 0 ? "border-l-emerald-500/50 hover:bg-emerald-500/5" :
          (e.percentMove ?? 0) < 0 ? "border-l-red-500/50 hover:bg-red-500/5" :
          "border-l-muted hover:bg-muted/40"
        }`} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
          <td className="px-3 py-3">
            <div className="font-bold text-foreground">{e.ticker}</div>
            <TagChips tags={e.tags} />
            <InlineScreenshots urls={e.screenshotUrl} />
          </td>
          <td className="px-3 py-3 text-muted-foreground">{e.date.substring(0, 10)}</td>
          <td className="px-3 py-3"><EventTypeBadge type={e.eventType} /></td>
          <td className="px-3 py-3 text-xs max-w-xs truncate">{e.headline}</td>
          <td className="px-3 py-3 text-xs text-muted-foreground">{e.reaction || "-"}</td>
          <td className="px-3 py-3 text-right">
            <MoveStrengthBar percent={e.percentMove} />
          </td>
          <td className="px-3 py-3 text-right text-xs text-muted-foreground">{e.volume || "-"}</td>
          <td className="px-3 py-3 text-right">
            <div className="flex gap-1 justify-end items-center" onClick={(ev) => ev.stopPropagation()}>
              <AddToPlaybookButton payload={{
                name: `${e.ticker} ${e.eventType} (${e.date.substring(0, 10)})`,
                setupType: e.eventType === "earnings" ? "Earnings Gap Up" : e.eventType === "momentum" ? "Intraday Momentum" : e.eventType === "ipo" ? "IPO Day Trade" : undefined,
                conditions: e.headline || undefined,
                notes: [e.summary, e.reaction ? `Реакция: ${e.reaction}` : "", e.percentMove != null ? `Движение: ${e.percentMove >= 0 ? "+" : ""}${e.percentMove}%` : "", e.volume ? `Объём: ${e.volume}` : ""].filter(Boolean).join("\n") || undefined,
                screenshotUrl: e.screenshotUrl || undefined,
                screenshotNotes: e.screenshotNotes || undefined,
                tags: e.tags || undefined,
                sourceType: "event",
                sourceId: e.id,
              }} size="icon" />
              <button onClick={() => openEdit(e)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => setDeleting(e)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </td>
        </tr>
        {expanded === e.id && (
          <tr className="bg-muted/10">
            <td colSpan={8} className="px-6 py-4">
              <div className="bg-card border border-border p-4 space-y-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Тикер</div>
                    <div className="text-lg font-bold font-mono text-foreground">{e.ticker}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Тип</div>
                    <EventTypeBadge type={e.eventType} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">Дата</div>
                    <div className="text-sm font-mono text-foreground">{e.date.substring(0, 10)}</div>
                  </div>
                  {e.reaction && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Реакция</div>
                      <div className="text-sm font-mono text-foreground">{e.reaction}</div>
                    </div>
                  )}
                  {e.percentMove != null && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Движение</div>
                      <div className={`text-lg font-bold font-mono ${e.percentMove >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {e.percentMove >= 0 ? "+" : ""}{e.percentMove.toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {e.volume && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">Объём</div>
                      <div className="text-sm font-mono text-foreground">{e.volume}</div>
                    </div>
                  )}
                </div>

                <div className="text-sm font-mono font-bold text-foreground border-b border-border pb-2">{e.headline}</div>

                {e.summary && (
                  <div className="bg-muted/30 border border-border/50 p-3 text-xs font-mono">
                    <div className="text-muted-foreground uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full" />Описание
                    </div>
                    <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{e.summary}</div>
                  </div>
                )}

                <TagChips tags={e.tags} />

                {e.screenshotUrl && (
                  <ScreenshotDisplay
                    urls={e.screenshotUrl}
                    notes={e.screenshotNotes}
                    onNotesChange={async (newNotes) => {
                      try {
                        await fetch(`${BASE}/api/events/${e.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ screenshotNotes: newNotes }),
                        });
                        qc.invalidateQueries({ queryKey: getListEventsQueryKey() });
                      } catch {}
                    }}
                  />
                )}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">События</h1>
        <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
          <Plus className="h-3 w-3" /> Новое Событие
        </Button>
      </div>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-primary/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><Zap className="h-3 w-3" />Всего событий</div>
            <div className="text-2xl font-bold font-mono text-foreground">{analytics.total}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{filtered.length !== analytics.total && `Показано: ${filtered.length}`}</div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-amber-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><TrendingUp className="h-3 w-3 text-amber-500" />Средний % движения</div>
            <div className="text-2xl font-bold font-mono text-foreground">{analytics.avgMove}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">по абс. значению</div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-cyan-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><Hash className="h-3 w-3 text-cyan-500" />Самый активный</div>
            <div className="text-2xl font-bold font-mono text-foreground">{analytics.topTicker?.name ?? "—"}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{analytics.topTicker ? `${analytics.topTicker.count} событий` : ""}</div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-emerald-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><BarChart3 className="h-3 w-3 text-emerald-500" />По типам</div>
            <div className="h-[60px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.typeDistribution} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="type" tick={{ fontSize: 8, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number, name: string, props: { payload: { type: string; avgMove: string } }) => [`${value} (avg ${props.payload.avgMove}%)`, props.payload.type]}
                    labelFormatter={() => ""}
                  />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {analytics.typeDistribution.map((entry) => (
                      <Cell key={entry.type} fill={EVENT_TYPE_BAR_COLORS[entry.type] || "#94a3b8"} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по тикеру, заголовку, описанию..."
              className="pl-8 h-8 font-mono text-xs bg-card"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <div className="relative flex items-center">
              <Calendar className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 pl-7 pr-2 w-[130px] bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <span className="text-muted-foreground text-xs">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 px-2 w-[130px] bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {hasFilters && (
            <button onClick={clearFilters} className="px-2 py-1 text-[10px] font-mono text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 transition-colors">
              Сбросить
            </button>
          )}
        </div>

        <div className="flex gap-0 border border-border overflow-x-auto">
          {EVENT_TYPES.map((t) => (
            <button key={t} onClick={() => toggleType(t)}
              className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${filterTypes.includes(t) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              {t}
            </button>
          ))}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[10px] font-mono text-muted-foreground uppercase mr-1">Теги:</span>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                  filterTags.includes(tag)
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-3 font-normal uppercase text-xs cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("ticker")}>
                  <div className="flex items-center gap-1">Тикер <SortIcon column="ticker" /></div>
                </th>
                <th className="px-3 py-3 font-normal uppercase text-xs cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("date")}>
                  <div className="flex items-center gap-1">Дата <SortIcon column="date" /></div>
                </th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Тип</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Заголовок</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Реакция</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort("percentMove")}>
                  <div className="flex items-center gap-1 justify-end">% Изм. <SortIcon column="percentMove" /></div>
                </th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Объём</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped ? (
                grouped.map(([day, dayEvents]) => (
                  <React.Fragment key={day}>
                    <tr className="bg-muted/60 border-y border-border">
                      <td colSpan={8} className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-primary/70" />
                          <span className="text-[10px] font-mono font-bold uppercase text-primary/80 tracking-widest">{formatDay(day)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">· {dayEvents.length} событий</span>
                        </div>
                      </td>
                    </tr>
                    {renderEventRows(dayEvents)}
                  </React.Fragment>
                ))
              ) : (
                renderEventRows(filtered)
              )}
              {filtered.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-0">
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <Zap className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <div className="text-muted-foreground font-mono text-sm mb-1">
                        {hasFilters ? "Нет событий по заданным фильтрам" : "Нет событий"}
                      </div>
                      <div className="text-muted-foreground/60 font-mono text-xs mb-4">
                        {hasFilters ? "Попробуйте изменить параметры поиска" : "Создайте первое событие для отслеживания рыночных катализаторов"}
                      </div>
                      {hasFilters ? (
                        <Button variant="outline" onClick={clearFilters} className="font-mono uppercase text-xs gap-1">
                          <X className="h-3 w-3" /> Сбросить фильтры
                        </Button>
                      ) : (
                        <Button onClick={openCreate} className="font-mono uppercase text-xs gap-1">
                          <Plus className="h-3 w-3" /> Создать событие
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader><DialogTitle className="uppercase text-sm tracking-tight">{editing ? "Редактировать событие" : "Новое событие"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тикер *</Label>
              <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="NVDA" className="font-mono bg-background h-8 text-xs uppercase" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Дата *</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тип события *</Label>
              <Select value={form.eventType} onValueChange={(v) => set("eventType", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_TYPES.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Реакция</Label>
              <Select value={form.reaction} onValueChange={(v) => set("reaction", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                <SelectContent>{REACTIONS.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">% Изменение</Label>
              <Input type="number" step="0.1" value={form.percentMove} onChange={(e) => set("percentMove", e.target.value)} placeholder="+16.4" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Объём</Label>
              <Input value={form.volume} onChange={(e) => set("volume", e.target.value)} placeholder="320M акций" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Заголовок *</Label>
              <Input value={form.headline} onChange={(e) => set("headline", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Краткое описание</Label>
              <Textarea value={form.summary} onChange={(e) => set("summary", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги</Label>
              <TagSelector
                selectedTags={form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => set("tags", tags.join(", "))}
              />
            </div>
            <div className="col-span-2 md:col-span-4">
              <ScreenshotFields
                urls={form.screenshotUrls}
                onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
                notes={form.screenshotNotes}
                onNotesChange={(notes) => setForm((f) => ({ ...f, screenshotNotes: notes }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !form.ticker || !form.headline} className="font-mono uppercase text-xs">
              {createMut.isPending || updateMut.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить событие?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">{deleting?.ticker} — {deleting?.headline}. Это нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate({ id: deleting.id })} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
