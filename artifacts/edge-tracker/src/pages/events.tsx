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
import { Pencil, Trash2, Plus, Tag, ImageIcon, Calendar, X } from "lucide-react";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";
import { AddToPlaybookButton } from "@/components/add-to-playbook";

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

function EventTypeBadge({ type }: { type: string }) {
  const colorClass = EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.other;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold border ${colorClass}`}>
      {type}
    </span>
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

export default function Events() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MarketEvent | null>(null);
  const [deleting, setDeleting] = useState<MarketEvent | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [filterType, setFilterType] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: events = [], isLoading } = useListEvents();
  const createMut = useCreateEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setOpen(false); setEditing(null); } } });
  const deleteMut = useDeleteEvent({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventsQueryKey() }); setDeleting(null); } } });

  const filtered = useMemo(() => {
    let result = filterType === "all" ? events : events.filter((e) => e.eventType === filterType);
    if (dateFilter) result = result.filter((e) => e.date.substring(0, 10) === dateFilter);
    return [...result].sort((a, b) => b.date.localeCompare(a.date));
  }, [events, filterType, dateFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, MarketEvent[]> = {};
    for (const e of filtered) {
      const day = e.date.substring(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(e);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(e: MarketEvent) { setForm(eventToForm(e)); setEditing(e); setOpen(true); }

  function handleSave() {
    const body = formToBody(form);
    if (!body.ticker || !body.headline) return;
    if (editing) updateMut.mutate({ id: editing.id, data: body as UpdateEventBody });
    else createMut.mutate({ data: body });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">События</h1>
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Calendar className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 pl-8 pr-7 bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            />
            {dateFilter && (
              <button onClick={() => setDateFilter("")} className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> Новое Событие
          </Button>
        </div>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {["all", ...EVENT_TYPES].map((t) => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
            {t === "all" ? "Все" : t}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-3 font-normal uppercase text-xs">Тикер</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Дата</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Тип</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Заголовок</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Реакция</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">% Изм.</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Объём</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped.map(([day, dayEvents]) => (
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
                  {dayEvents.map((e) => (
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
                    <td className={`px-3 py-3 text-right font-bold text-xs ${(e.percentMove ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {e.percentMove != null ? `${e.percentMove >= 0 ? "+" : ""}${e.percentMove.toFixed(1)}%` : "-"}
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                          {e.summary && (
                            <div className="md:col-span-2 bg-muted/30 border border-border/50 p-3">
                              <div className="text-muted-foreground uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full" />Описание
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{e.summary}</div>
                            </div>
                          )}
                          {e.screenshotUrl && (
                            <div className="md:col-span-2">
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
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">Нет событий</td></tr>
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
