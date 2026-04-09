import React, { useState } from "react";
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
import { Pencil, Trash2, Plus, TrendingUp, TrendingDown, Star, Layers, Tag } from "lucide-react";
import { AddToPlaybookButton, type PlaybookPayload } from "@/components/add-to-playbook";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

function TagChips({ tags }: { tags?: string | null }) {
  if (!tags) return null;
  const chips = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((tag, i) => (
        <span key={i} className="px-1.5 py-0 text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 leading-4">{tag}</span>
      ))}
    </div>
  );
}

type FormData = { date: string; whatWorksNow: string; whatDoesntWork: string; bestTickers: string; marketTheme: string; notes: string; tags: string; screenshotUrls: string[]; screenshotNotes: string[]; };
const blank = (): FormData => ({ date: new Date().toISOString().split("T")[0], whatWorksNow: "", whatDoesntWork: "", bestTickers: "", marketTheme: "", notes: "", tags: "", screenshotUrls: [""], screenshotNotes: [""] });
function toForm(f: DailyFeed): FormData { const urls = stringToScreenshotUrls(f.screenshotUrl); return { date: f.date.substring(0, 10), whatWorksNow: f.whatWorksNow ?? "", whatDoesntWork: f.whatDoesntWork ?? "", bestTickers: f.bestTickers ?? "", marketTheme: f.marketTheme ?? "", notes: f.notes ?? "", tags: f.tags ?? "", screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(f.screenshotNotes, urls.length) }; }
function formToBody(f: FormData): CreateDailyFeedBody & { tags?: string | null; screenshotUrl?: string | null; screenshotNotes?: string | null } { return { date: f.date, whatWorksNow: f.whatWorksNow || null, whatDoesntWork: f.whatDoesntWork || null, bestTickers: f.bestTickers || null, marketTheme: f.marketTheme || null, notes: f.notes || null, tags: f.tags || null, screenshotUrl: screenshotUrlsToString(f.screenshotUrls) || null, screenshotNotes: screenshotNotesToString(f.screenshotNotes) || null }; }

export default function DailyFeedPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DailyFeed | null>(null);
  const [deleting, setDeleting] = useState<DailyFeed | null>(null);
  const [form, setForm] = useState<FormData>(blank());

  const { data: feeds = [], isLoading } = useListDailyFeed();
  const createMut = useCreateDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setOpen(false); setEditing(null); } } });
  const deleteMut = useDeleteDailyFeed({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListDailyFeedQueryKey() }); setDeleting(null); } } });

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(f: DailyFeed) { setForm(toForm(f)); setEditing(f); setOpen(true); }
  function handleSave() {
    const body = formToBody(form);
    if (!body.date) return;
    if (editing) updateMut.mutate({ id: editing.id, data: body as UpdateDailyFeedBody });
    else createMut.mutate({ data: body });
  }

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {feeds.map((feed) => (
          <div key={feed.id} className="bg-card border border-border font-mono text-xs border-l-[3px] border-l-primary/40 hover:border-l-primary transition-colors">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-primary font-bold text-sm">{feed.date.substring(0, 10)}</span>
              <WriteOnly>
                <div className="flex gap-1">
                  <AddToPlaybookButton payload={buildPlaybookPayload(feed)} size="icon" />
                  <button onClick={() => openEdit(feed)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setDeleting(feed)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </WriteOnly>
            </div>
            <div className="p-4 space-y-3">
              {feed.marketTheme && (
                <div>
                  <div className="flex items-center gap-1.5 text-muted-foreground uppercase mb-1"><Layers className="h-3 w-3" /><span>Рыночная тема</span></div>
                  <div className="text-foreground">{feed.marketTheme}</div>
                </div>
              )}
              {feed.bestTickers && (
                <div>
                  <div className="flex items-center gap-1.5 text-yellow-500 uppercase mb-1"><Star className="h-3 w-3" /><span>Лучшие тикеры</span></div>
                  <div className="text-foreground font-bold">{feed.bestTickers}</div>
                </div>
              )}
              {feed.whatWorksNow && (
                <div>
                  <div className="flex items-center gap-1.5 text-emerald-400 uppercase mb-1"><TrendingUp className="h-3 w-3" /><span>Что работает</span></div>
                  <div className="text-foreground">{feed.whatWorksNow}</div>
                </div>
              )}
              {feed.whatDoesntWork && (
                <div>
                  <div className="flex items-center gap-1.5 text-red-400 uppercase mb-1"><TrendingDown className="h-3 w-3" /><span>Что не работает</span></div>
                  <div className="text-foreground">{feed.whatDoesntWork}</div>
                </div>
              )}
              {feed.notes && (
                <div className="bg-muted/20 border border-border/50 p-2">
                  <div className="text-muted-foreground uppercase mb-1 text-[10px]">Заметки</div>
                  <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{feed.notes}</div>
                </div>
              )}
              <TagChips tags={feed.tags} />
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
        ))}
        {feeds.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-muted-foreground font-mono text-xs">Нет записей в дневной ленте</div>
        )}
      </div>

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
