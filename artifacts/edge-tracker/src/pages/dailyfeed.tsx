import React, { useState, useMemo } from "react";
import { WriteOnly } from "@/contexts/auth-context";
import {
  useListDailyFeed, useCreateDailyFeed, useUpdateDailyFeed, useDeleteDailyFeed, getListDailyFeedQueryKey,
} from "@workspace/api-client-react";
import type { DailyFeed, CreateDailyFeedBody, UpdateDailyFeedBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Trash2, Plus, TrendingUp, TrendingDown, Star, Layers, Tag, Search, Calendar, X, LayoutGrid, List, FileText, Hash, Flame } from "lucide-react";
import { AddToPlaybookButton, type PlaybookPayload } from "@/components/add-to-playbook";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function TagChips({ tags, onTagClick }: { tags?: string | null; onTagClick?: (tag: string) => void }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((tag, i) => (
        <span
          key={i}
          onClick={(e) => { if (onTagClick) { e.stopPropagation(); onTagClick(tag); } }}
          className={`px-1.5 py-0 text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 leading-4 ${onTagClick ? "cursor-pointer hover:bg-primary/20 transition-colors" : ""}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

type FormData = { date: string; whatWorksNow: string; whatDoesntWork: string; bestTickers: string; marketTheme: string; notes: string; tags: string; screenshotUrls: string[]; screenshotNotes: string[]; };
const blank = (): FormData => ({ date: new Date().toISOString().split("T")[0], whatWorksNow: "", whatDoesntWork: "", bestTickers: "", marketTheme: "", notes: "", tags: "", screenshotUrls: [""], screenshotNotes: [""] });
function toForm(f: DailyFeed): FormData { const urls = stringToScreenshotUrls(f.screenshotUrl); return { date: f.date.substring(0, 10), whatWorksNow: f.whatWorksNow ?? "", whatDoesntWork: f.whatDoesntWork ?? "", bestTickers: f.bestTickers ?? "", marketTheme: f.marketTheme ?? "", notes: f.notes ?? "", tags: f.tags ?? "", screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(f.screenshotNotes, urls.length) }; }
function formToBody(f: FormData): CreateDailyFeedBody & { tags?: string | null; screenshotUrl?: string | null; screenshotNotes?: string | null } { return { date: f.date, whatWorksNow: f.whatWorksNow || null, whatDoesntWork: f.whatDoesntWork || null, bestTickers: f.bestTickers || null, marketTheme: f.marketTheme || null, notes: f.notes || null, tags: f.tags || null, screenshotUrl: screenshotUrlsToString(f.screenshotUrls) || null, screenshotNotes: screenshotNotesToString(f.screenshotNotes) || null }; }

const DATE_PRESETS = [
  { label: "Сегодня", getValue: () => { const d = new Date().toISOString().split("T")[0]; return { from: d, to: d }; } },
  { label: "Эта неделя", getValue: () => { const now = new Date(); const day = now.getDay(); const diff = day === 0 ? 6 : day - 1; const mon = new Date(now); mon.setDate(now.getDate() - diff); return { from: mon.toISOString().split("T")[0], to: now.toISOString().split("T")[0] }; } },
  { label: "Этот месяц", getValue: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); return { from: first.toISOString().split("T")[0], to: now.toISOString().split("T")[0] }; } },
  { label: "30 дней", getValue: () => { const now = new Date(); const past = new Date(now); past.setDate(now.getDate() - 30); return { from: past.toISOString().split("T")[0], to: now.toISOString().split("T")[0] }; } },
];

function formatDay(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("ru-RU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch { return dateStr; }
}

export default function DailyFeedPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DailyFeed | null>(null);
  const [deleting, setDeleting] = useState<DailyFeed | null>(null);
  const [form, setForm] = useState<FormData>(blank());

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "timeline">("grid");
  const [showAllTags, setShowAllTags] = useState(false);

  const { data: feeds = [], isLoading } = useListDailyFeed();
  const createMut = useCreateDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setOpen(false); setEditing(null); } } });
  const deleteMut = useDeleteDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setDeleting(null); } } });

  const filtered = useMemo(() => {
    let result = [...feeds];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((f) =>
        (f.bestTickers ?? "").toLowerCase().includes(q) ||
        (f.marketTheme ?? "").toLowerCase().includes(q) ||
        (f.whatWorksNow ?? "").toLowerCase().includes(q) ||
        (f.whatDoesntWork ?? "").toLowerCase().includes(q) ||
        (f.notes ?? "").toLowerCase().includes(q) ||
        (f.tags ?? "").toLowerCase().includes(q)
      );
    }
    if (dateFrom) result = result.filter((f) => f.date.substring(0, 10) >= dateFrom);
    if (dateTo) result = result.filter((f) => f.date.substring(0, 10) <= dateTo);
    if (selectedTags.length > 0) {
      result = result.filter((f) => {
        const feedTags = (f.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        return selectedTags.some((st) => feedTags.includes(st));
      });
    }
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }, [feeds, searchQuery, dateFrom, dateTo, selectedTags]);

  const stats = useMemo(() => {
    const now = new Date();
    const d7 = new Date(now); d7.setDate(now.getDate() - 7);
    const d30 = new Date(now); d30.setDate(now.getDate() - 30);
    const d7str = d7.toISOString().split("T")[0];
    const d30str = d30.toISOString().split("T")[0];

    const tickerCount: Record<string, number> = {};
    const themeCount: Record<string, number> = {};
    const tickerCount7: Record<string, number> = {};
    const tickerCount30: Record<string, number> = {};

    for (const f of feeds) {
      const date = f.date.substring(0, 10);
      const tickers = (f.bestTickers ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const themes = (f.marketTheme ?? "").split(",").map((t) => t.trim()).filter(Boolean);

      tickers.forEach((t) => {
        tickerCount[t] = (tickerCount[t] || 0) + 1;
        if (date >= d7str) tickerCount7[t] = (tickerCount7[t] || 0) + 1;
        if (date >= d30str) tickerCount30[t] = (tickerCount30[t] || 0) + 1;
      });
      themes.forEach((t) => { themeCount[t] = (themeCount[t] || 0) + 1; });
    }

    const topTickers7 = Object.entries(tickerCount7).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topTickers30 = Object.entries(tickerCount30).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topThemes = Object.entries(themeCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { total: feeds.length, topTickers7, topTickers30, topThemes };
  }, [feeds]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    feeds.forEach((f) => {
      (f.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).forEach((t) => tagSet.add(t));
    });
    return Array.from(tagSet).sort();
  }, [feeds]);

  const timelineGroups = useMemo(() => {
    const map: Record<string, DailyFeed[]> = {};
    for (const f of filtered) {
      const day = f.date.substring(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(f);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(f: DailyFeed) { setForm(toForm(f)); setEditing(f); setOpen(true); }
  function handleSave() {
    const body = formToBody(form);
    if (!body.date) return;
    if (editing) updateMut.mutate({ id: editing.id, data: body as UpdateDailyFeedBody });
    else createMut.mutate({ data: body });
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  function applyPreset(preset: typeof DATE_PRESETS[0]) {
    const { from, to } = preset.getValue();
    setDateFrom(from);
    setDateTo(to);
  }

  function clearFilters() {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
    setSelectedTags([]);
  }

  const hasFilters = searchQuery || dateFrom || dateTo || selectedTags.length > 0;

  function buildPlaybookPayload(feed: DailyFeed): PlaybookPayload {
    const conditions: string[] = [];
    if (feed.whatWorksNow) conditions.push(feed.whatWorksNow);
    if (feed.marketTheme) conditions.push(`Рыночная тема: ${feed.marketTheme}`);
    const notes: string[] = [];
    if (feed.whatDoesntWork) notes.push(`Что не работает: ${feed.whatDoesntWork}`);
    if (feed.notes) notes.push(feed.notes);
    if (feed.bestTickers) notes.push(`Тикеры: ${feed.bestTickers}`);
    return {
      name: `${feed.marketTheme || "Стратегия"} (${feed.date.substring(0, 10)})`,
      conditions: conditions.join("\n") || undefined,
      notes: notes.join("\n") || undefined,
      screenshotUrl: feed.screenshotUrl || undefined,
      screenshotNotes: feed.screenshotNotes || undefined,
      tags: feed.tags || undefined,
      sourceType: "dailyfeed",
      sourceId: feed.id,
    };
  }

  function renderCard(feed: DailyFeed) {
    return (
      <TooltipProvider key={feed.id}>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <div className="group bg-card border border-border font-mono text-xs border-l-[3px] border-l-primary/40 hover:border-l-primary hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-200 bg-gradient-to-br from-card to-card/80">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-transparent to-primary/[0.02]">
                <span className="text-primary font-bold text-sm">{feed.date.substring(0, 10)}</span>
                <WriteOnly>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <AddToPlaybookButton payload={buildPlaybookPayload(feed)} size="icon" />
                    <button onClick={() => openEdit(feed)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setDeleting(feed)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </WriteOnly>
              </div>
              <div className="p-4 space-y-3">
                {feed.marketTheme && (
                  <div>
                    <div className="flex items-center gap-1.5 text-muted-foreground uppercase mb-1"><Layers className="h-3 w-3 group-hover:text-primary transition-colors" /><span>Рыночная тема</span></div>
                    <div className="text-foreground">{feed.marketTheme}</div>
                  </div>
                )}
                {feed.bestTickers && (
                  <div>
                    <div className="flex items-center gap-1.5 text-yellow-500 uppercase mb-1"><Star className="h-3 w-3 group-hover:animate-pulse" /><span>Лучшие тикеры</span></div>
                    <div className="text-foreground font-bold">{feed.bestTickers}</div>
                  </div>
                )}
                {feed.whatWorksNow && (
                  <div>
                    <div className="flex items-center gap-1.5 text-emerald-400 uppercase mb-1"><TrendingUp className="h-3 w-3 group-hover:translate-y-[-1px] transition-transform" /><span>Что работает</span></div>
                    <div className="text-foreground">{feed.whatWorksNow}</div>
                  </div>
                )}
                {feed.whatDoesntWork && (
                  <div>
                    <div className="flex items-center gap-1.5 text-red-400 uppercase mb-1"><TrendingDown className="h-3 w-3 group-hover:translate-y-[1px] transition-transform" /><span>Что не работает</span></div>
                    <div className="text-foreground">{feed.whatDoesntWork}</div>
                  </div>
                )}
                {feed.notes && (
                  <div className="bg-muted/20 border border-border/50 p-2">
                    <div className="text-muted-foreground uppercase mb-1 text-[10px]">Заметки</div>
                    <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap line-clamp-3">{feed.notes}</div>
                  </div>
                )}
                <TagChips tags={feed.tags} onTagClick={toggleTag} />
                {feed.screenshotUrl && (
                  <ScreenshotDisplay
                    urls={feed.screenshotUrl}
                    notes={feed.screenshotNotes}
                    onNotesChange={async (newNotes) => {
                      try {
                        await fetch(`${BASE}/api/dailyfeed/${feed.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ screenshotNotes: newNotes }),
                        });
                        qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() });
                      } catch {}
                    }}
                  />
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs bg-card border border-border text-foreground p-3 font-mono text-xs space-y-1.5">
            <div className="font-bold text-primary">{feed.date.substring(0, 10)}</div>
            {feed.marketTheme && <div><span className="text-muted-foreground">Тема:</span> {feed.marketTheme}</div>}
            {feed.bestTickers && <div><span className="text-yellow-500">Тикеры:</span> {feed.bestTickers}</div>}
            {feed.whatWorksNow && <div className="text-emerald-400 truncate">✓ {feed.whatWorksNow}</div>}
            {feed.whatDoesntWork && <div className="text-red-400 truncate">✗ {feed.whatDoesntWork}</div>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Дневная Лента</h1>
        <WriteOnly>
          <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> Новая Запись
          </Button>
        </WriteOnly>
      </div>

      {feeds.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-primary/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><FileText className="h-3 w-3" />Всего записей</div>
            <div className="text-2xl font-bold font-mono text-foreground">{stats.total}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{filtered.length !== stats.total && `Показано: ${filtered.length}`}</div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-yellow-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><Star className="h-3 w-3 text-yellow-500" />Топ тикеры (7д)</div>
            <div className="text-sm font-bold font-mono text-foreground">
              {stats.topTickers7.length > 0 ? stats.topTickers7.map(([t, c]) => `${t}`).join(", ") : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {stats.topTickers7.length > 0 && stats.topTickers7.map(([t, c]) => `${t}:${c}`).join(" · ")}
            </div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-cyan-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><Star className="h-3 w-3 text-cyan-500" />Топ тикеры (30д)</div>
            <div className="text-sm font-bold font-mono text-foreground">
              {stats.topTickers30.length > 0 ? stats.topTickers30.map(([t]) => `${t}`).join(", ") : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {stats.topTickers30.length > 0 && stats.topTickers30.map(([t, c]) => `${t}:${c}`).join(" · ")}
            </div>
          </div>
          <div className="bg-card border border-border p-3 border-l-[3px] border-l-emerald-500/50">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-mono uppercase mb-1"><Flame className="h-3 w-3 text-emerald-500" />Топ темы</div>
            <div className="text-sm font-mono text-foreground leading-relaxed">
              {stats.topThemes.length > 0 ? stats.topThemes.map(([t, c]) => (
                <div key={t} className="flex justify-between text-xs">
                  <span className="truncate">{t}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">{c}</span>
                </div>
              )) : <span className="text-muted-foreground">—</span>}
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
              placeholder="Поиск по тикерам, темам, заметкам..."
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
                placeholder="От"
              />
            </div>
            <span className="text-muted-foreground text-xs">—</span>
            <div className="relative flex items-center">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 px-2 w-[130px] bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="До"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center border border-border bg-card">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={`p-1.5 transition-colors ${viewMode === "timeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 items-center">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="px-2 py-1 text-[10px] font-mono bg-muted/50 text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
          <span className="text-border mx-1">|</span>
          {(showAllTags ? allTags : allTags.slice(0, 10)).map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                selectedTags.includes(tag)
                  ? "bg-primary/20 text-primary border-primary/40"
                  : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <Hash className="inline h-2.5 w-2.5 mr-0.5" />{tag}
            </button>
          ))}
          {allTags.length > 10 && (
            <button
              onClick={() => setShowAllTags((v) => !v)}
              className="px-2 py-0.5 text-[10px] font-mono text-primary/70 hover:text-primary transition-colors"
            >
              {showAllTags ? "Свернуть" : `+${allTags.length - 10} ещё`}
            </button>
          )}
          {hasFilters && (
            <button onClick={clearFilters} className="px-2 py-0.5 text-[10px] font-mono text-red-400 hover:text-red-300 transition-colors">
              Сбросить всё
            </button>
          )}
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((feed) => renderCard(feed))}
        </div>
      ) : (
        <div className="space-y-0">
          {timelineGroups.map(([day, dayFeeds]) => (
            <div key={day} className="relative">
              <div className="flex items-center gap-3 py-2">
                <div className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 shrink-0">
                  <Calendar className="h-3 w-3 text-primary/70" />
                  <span className="text-[10px] font-mono font-bold uppercase text-primary/80 tracking-widest">{formatDay(day)}</span>
                  <span className="text-[10px] text-muted-foreground">· {dayFeeds.length} записей</span>
                </div>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="relative pl-6 border-l-2 border-border ml-4 space-y-3 pb-4">
                {dayFeeds.map((feed) => (
                  <div key={feed.id} className="relative">
                    <div className="absolute -left-[calc(1.5rem+1px)] top-4 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary/60" />
                    <div className="ml-2">
                      {renderCard(feed)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <FileText className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <div className="text-muted-foreground font-mono text-sm mb-1">
            {hasFilters ? "Нет записей по заданным фильтрам" : "Нет записей в дневной ленте"}
          </div>
          <div className="text-muted-foreground/60 font-mono text-xs mb-4">
            {hasFilters ? "Попробуйте изменить параметры поиска" : "Создайте первую запись, чтобы начать отслеживать рыночные наблюдения"}
          </div>
          {hasFilters ? (
            <Button variant="outline" onClick={clearFilters} className="font-mono uppercase text-xs gap-1">
              <X className="h-3 w-3" /> Сбросить фильтры
            </Button>
          ) : (
            <WriteOnly>
              <Button onClick={openCreate} className="font-mono uppercase text-xs gap-1">
                <Plus className="h-3 w-3" /> Создать запись
              </Button>
            </WriteOnly>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader><DialogTitle className="uppercase text-sm tracking-tight">{editing ? "Редактировать запись" : "Новая запись"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Дата *</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Рыночная тема</Label>
              <Input value={form.marketTheme} onChange={(e) => set("marketTheme", e.target.value)} placeholder="AI доминирует, tech в силе..." className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Лучшие тикеры</Label>
              <Input value={form.bestTickers} onChange={(e) => set("bestTickers", e.target.value)} placeholder="NVDA, META, MSFT" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что работает сейчас</Label>
              <Textarea value={form.whatWorksNow} onChange={(e) => set("whatWorksNow", e.target.value)} rows={2} placeholder="Earnings gap plays, моментум на AI..." className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что не работает</Label>
              <Textarea value={form.whatDoesntWork} onChange={(e) => set("whatDoesntWork", e.target.value)} rows={2} placeholder="Шорты на сильном рынке..." className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Заметки</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги</Label>
              <TagSelector
                selectedTags={form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => set("tags", tags.join(", "))}
              />
            </div>
            <ScreenshotFields
              urls={form.screenshotUrls}
              onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
              notes={form.screenshotNotes}
              onNotesChange={(notes) => setForm((f) => ({ ...f, screenshotNotes: notes }))}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending} className="font-mono uppercase text-xs">
              {createMut.isPending || updateMut.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">{deleting?.date?.substring(0, 10)} — {deleting?.marketTheme || "Дневная запись"}. Это нельзя отменить.</AlertDialogDescription>
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
