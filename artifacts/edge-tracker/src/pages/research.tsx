import React, { useState, useMemo } from "react";
import { WriteOnly } from "@/contexts/auth-context";
import {
  useListResearch, useCreateResearch, useUpdateResearch, useDeleteResearch, getListResearchQueryKey,
} from "@workspace/api-client-react";
import type { Research, CreateResearchBody, UpdateResearchBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Plus, Tag, Calendar, X } from "lucide-react";
import { AddToPlaybookButton, type PlaybookPayload } from "@/components/add-to-playbook";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls, screenshotNotesToString, stringToScreenshotNotes } from "@/components/screenshot-fields";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type FormData = { patternName: string; ticker: string; context: string; marketCondition: string; whatWorked: string; whatFailed: string; repeatCount: string; confidenceLevel: string; screenshotUrls: string[]; screenshotNotes: string[]; tags: string; };

const blank = (): FormData => ({ patternName: "", ticker: "", context: "", marketCondition: "", whatWorked: "", whatFailed: "", repeatCount: "1", confidenceLevel: "50", screenshotUrls: [""], screenshotNotes: [""], tags: "" });

function toForm(r: Research): FormData {
  const urls = stringToScreenshotUrls(r.screenshotUrl);
  return { patternName: r.patternName, ticker: r.ticker ?? "", context: r.context ?? "", marketCondition: r.marketCondition ?? "", whatWorked: r.whatWorked ?? "", whatFailed: r.whatFailed ?? "", repeatCount: String(r.repeatCount ?? 1), confidenceLevel: String(r.confidenceLevel ?? 50), screenshotUrls: urls, screenshotNotes: stringToScreenshotNotes(r.screenshotNotes, urls.length), tags: r.tags ?? "" };
}

function formToBody(f: FormData): CreateResearchBody & { tags?: string | null; screenshotNotes?: string | null } {
  return { patternName: f.patternName, ticker: f.ticker || null, context: f.context || null, marketCondition: f.marketCondition || null, whatWorked: f.whatWorked || null, whatFailed: f.whatFailed || null, repeatCount: f.repeatCount ? Number(f.repeatCount) : null, confidenceLevel: f.confidenceLevel ? Number(f.confidenceLevel) : null, screenshotUrl: screenshotUrlsToString(f.screenshotUrls) || null, screenshotNotes: screenshotNotesToString(f.screenshotNotes) || null, tags: f.tags || null };
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

export default function Research() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Research | null>(null);
  const [deleting, setDeleting] = useState<Research | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dateFilter, setDateFilter] = useState("");

  const { data: rawItems = [], isLoading } = useListResearch();

  const items = useMemo(() => {
    const sorted = [...rawItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!dateFilter) return sorted;
    return sorted.filter((r) => r.createdAt.substring(0, 10) === dateFilter);
  }, [rawItems, dateFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, Research[]> = {};
    for (const r of items) {
      const day = r.createdAt.substring(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(r);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);
  const createMut = useCreateResearch({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListResearchQueryKey() }); setOpen(false); } } });
  const updateMut = useUpdateResearch({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListResearchQueryKey() }); setOpen(false); setEditing(null); } } });
  const deleteMut = useDeleteResearch({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListResearchQueryKey() }); setDeleting(null); } } });

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(r: Research) { setForm(toForm(r)); setEditing(r); setOpen(true); }

  function handleSave() {
    const body = formToBody(form);
    if (!body.patternName) return;
    if (editing) updateMut.mutate({ id: editing.id, data: body as UpdateResearchBody });
    else createMut.mutate({ data: body });
  }

  const conf = (v: number | null | undefined) => v ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Исследования</h1>
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative flex items-center">
            <Calendar className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 pl-8 pr-2 bg-card border border-border text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            />
            {dateFilter && (
              <button onClick={() => setDateFilter("")} className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <WriteOnly>
            <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
              <Plus className="h-3 w-3" /> Новое Исследование
            </Button>
          </WriteOnly>
        </div>
      </div>

      <div className="bg-card border border-border rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-3 font-normal uppercase text-xs">Паттерн</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Тикер</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Условия рынка</th>
                <th className="px-3 py-3 font-normal uppercase text-xs">Что работало</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-center">Повтор.</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Уверенность</th>
                <th className="px-3 py-3 font-normal uppercase text-xs text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped.map(([day, dayItems]) => (
                <React.Fragment key={day}>
                  <tr className="bg-muted/60 border-y border-border">
                    <td colSpan={7} className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-primary/70" />
                        <span className="text-[10px] font-mono font-bold uppercase text-primary/80 tracking-widest">{formatDay(day)}</span>
                        <span className="text-[10px] text-muted-foreground ml-1">· {dayItems.length} зап.</span>
                      </div>
                    </td>
                  </tr>
                  {dayItems.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className={`transition-colors cursor-pointer border-l-[3px] ${
                    (r.confidenceLevel ?? 0) >= 70 ? "border-l-emerald-500/50 hover:bg-emerald-500/5" :
                    (r.confidenceLevel ?? 0) >= 40 ? "border-l-amber-500/50 hover:bg-amber-500/5" :
                    "border-l-muted hover:bg-muted/40"
                  }`} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-3 py-3">
                      <div className="font-bold text-primary text-xs">{r.patternName}</div>
                      <TagChips tags={r.tags} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.ticker || "-"}</td>
                    <td className="px-3 py-3 text-xs max-w-[160px] truncate text-muted-foreground">{r.marketCondition || "-"}</td>
                    <td className="px-3 py-3 text-xs max-w-[200px] truncate">{r.whatWorked || "-"}</td>
                    <td className="px-3 py-3 text-center text-xs font-bold">{r.repeatCount ?? 0}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted overflow-hidden">
                          <div className={`h-full transition-all ${conf(r.confidenceLevel) >= 70 ? "bg-emerald-500" : conf(r.confidenceLevel) >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${conf(r.confidenceLevel)}%` }} />
                        </div>
                        <span className="text-xs w-8 text-right">{conf(r.confidenceLevel)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <WriteOnly>
                        <div className="flex gap-1 justify-end items-center" onClick={(ev) => ev.stopPropagation()}>
                          <AddToPlaybookButton payload={{
                            name: `${r.patternName} ${r.ticker ? `(${r.ticker})` : ""}`.trim(),
                            conditions: r.whatWorked || undefined,
                            notes: [r.context, r.whatFailed ? `Что не работало: ${r.whatFailed}` : ""].filter(Boolean).join("\n") || undefined,
                            screenshotUrl: r.screenshotUrl || undefined,
                            screenshotNotes: r.screenshotNotes || undefined,
                            tags: r.tags || undefined,
                            sourceType: "research",
                            sourceId: r.id,
                          }} size="icon" />
                          <button onClick={() => openEdit(r)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleting(r)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </WriteOnly>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-muted/10">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                          {r.context && (
                            <div className="md:col-span-2 bg-muted/30 border border-border/50 p-3">
                              <div className="text-muted-foreground uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full" />Контекст
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{r.context}</div>
                            </div>
                          )}
                          {r.whatFailed && (
                            <div className="bg-red-500/5 border border-red-500/20 p-3">
                              <div className="text-red-400 uppercase mb-2 flex items-center gap-1.5 text-[10px]">
                                <div className="w-1.5 h-1.5 bg-red-400 rounded-full" />Что не работало
                              </div>
                              <div className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{r.whatFailed}</div>
                            </div>
                          )}
                          {r.screenshotUrl && (
                            <div className="md:col-span-2">
                              <ScreenshotDisplay
                                urls={r.screenshotUrl}
                                notes={r.screenshotNotes}
                                onNotesChange={async (newNotes) => {
                                  try {
                                    await fetch(`${BASE}/api/research/${r.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ screenshotNotes: newNotes }),
                                    });
                                    qc.invalidateQueries({ queryKey: getListResearchQueryKey() });
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
              {rawItems.length === 0 && !isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-xs">Нет исследований</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader><DialogTitle className="uppercase text-sm tracking-tight">{editing ? "Редактировать исследование" : "Новое исследование"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Название паттерна *</Label>
              <Input value={form.patternName} onChange={(e) => set("patternName", e.target.value)} placeholder="Earnings Gap Up Continuation" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тикер</Label>
              <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="NVDA, META" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Повторений</Label>
              <Input type="number" min="1" value={form.repeatCount} onChange={(e) => set("repeatCount", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Уверенность: {form.confidenceLevel}%</Label>
              <input type="range" min="0" max="100" value={form.confidenceLevel} onChange={(e) => set("confidenceLevel", e.target.value)} className="w-full accent-primary" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Контекст</Label>
              <Textarea value={form.context} onChange={(e) => set("context", e.target.value)} rows={2} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 md:col-span-4 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Условия рынка</Label>
              <Input value={form.marketCondition} onChange={(e) => set("marketCondition", e.target.value)} className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что работало</Label>
              <Textarea value={form.whatWorked} onChange={(e) => set("whatWorked", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Что не работало</Label>
              <Textarea value={form.whatFailed} onChange={(e) => set("whatFailed", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
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
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !form.patternName} className="font-mono uppercase text-xs">
              {createMut.isPending || updateMut.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить исследование?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">{deleting?.patternName}. Это нельзя отменить.</AlertDialogDescription>
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
