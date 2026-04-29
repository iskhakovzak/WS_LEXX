import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WriteOnly } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Eye, CheckCircle, XCircle, TrendingUp, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TagSelector } from "@/components/tag-selector";
import { ScreenshotFields, ScreenshotDisplay, screenshotUrlsToString, stringToScreenshotUrls } from "@/components/screenshot-fields";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
const STATUSES = ["watching", "passed", "traded"];
const STATUS_LABELS: Record<string, string> = { watching: "Слежу", passed: "Пропустил", traded: "Торговал" };

type WatchlistItem = {
  id: number; ticker: string; catalyst: string | null; targetPrice: string | null;
  stopPrice: string | null; status: string; notes: string | null; sector: string | null;
  tags: string | null; createdAt: string;
};
type FormData = { ticker: string; catalyst: string; targetPrice: string; stopPrice: string; status: string; notes: string; sector: string; tags: string; screenshotUrls: string[] };

const blank = (): FormData => ({ ticker: "", catalyst: "", targetPrice: "", stopPrice: "", status: "watching", notes: "", sector: "", tags: "", screenshotUrls: [""] });
function itemToForm(i: WatchlistItem): FormData {
  return { ticker: i.ticker, catalyst: i.catalyst ?? "", targetPrice: i.targetPrice ?? "", stopPrice: i.stopPrice ?? "", status: i.status, notes: i.notes ?? "", sector: i.sector ?? "", tags: i.tags ?? "", screenshotUrls: stringToScreenshotUrls((i as any).screenshotUrl) };
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { watching: "bg-primary/15 text-primary", passed: "bg-muted text-muted-foreground", traded: "bg-emerald-500/15 text-emerald-400" };
  const icons: Record<string, React.ReactNode> = { watching: <Eye className="h-2.5 w-2.5" />, passed: <XCircle className="h-2.5 w-2.5" />, traded: <CheckCircle className="h-2.5 w-2.5" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {icons[status]} {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function Watchlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [deleting, setDeleting] = useState<WatchlistItem | null>(null);
  const [form, setForm] = useState<FormData>(blank());
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: items = [], isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist"],
    queryFn: () => fetch(`${BASE}/api/watchlist`).then((r) => r.json()),
  });

  const createMut = useMutation({
    mutationFn: (data: FormData) => fetch(`${BASE}/api/watchlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlist"] }); setOpen(false); toast({ title: "Добавлено в вотчлист" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormData }) => fetch(`${BASE}/api/watchlist/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlist"] }); setOpen(false); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/watchlist/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["watchlist"] }); setDeleting(null); },
  });

  const filtered = items.filter((i) => statusFilter === "all" || i.status === statusFilter);

  function set(k: keyof FormData, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function openCreate() { setForm(blank()); setEditing(null); setOpen(true); }
  function openEdit(i: WatchlistItem) { setForm(itemToForm(i)); setEditing(i); setOpen(true); }

  function handleSave() {
    if (!form.ticker) return;
    const payload = { ...form, screenshotUrl: screenshotUrlsToString(form.screenshotUrls) || null };
    const { screenshotUrls: _su, ...rest } = payload as any;
    if (editing) updateMut.mutate({ id: editing.id, data: rest });
    else createMut.mutate(rest);
  }

  const watchingCount = items.filter((i) => i.status === "watching").length;
  const tradedCount = items.filter((i) => i.status === "traded").length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Вотчлист</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{watchingCount} слежу · {tradedCount} торговал</p>
        </div>
        <WriteOnly>
          <Button onClick={openCreate} className="font-mono uppercase tracking-tight text-xs gap-1">
            <Plus className="h-3 w-3" /> Добавить тикер
          </Button>
        </WriteOnly>
      </div>

      <div className="flex gap-0 border border-border overflow-x-auto">
        {["all", "watching", "passed", "traded"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-xs font-mono uppercase whitespace-nowrap border-r border-border last:border-r-0 transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
            {s === "all" ? "Все" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3 font-normal uppercase text-xs">Тикер</th>
                <th className="px-4 py-3 font-normal uppercase text-xs">Сектор</th>
                <th className="px-4 py-3 font-normal uppercase text-xs">Катализатор</th>
                <th className="px-4 py-3 font-normal uppercase text-xs text-right">Цель</th>
                <th className="px-4 py-3 font-normal uppercase text-xs text-right">Стоп</th>
                <th className="px-4 py-3 font-normal uppercase text-xs">Статус</th>
                <th className="px-4 py-3 font-normal uppercase text-xs">Заметки</th>
                <th className="px-4 py-3 font-normal uppercase text-xs text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <React.Fragment key={item.id}>
                  <tr className={`transition-colors cursor-pointer border-l-[3px] ${
                    item.status === "watching" ? "border-l-primary/50 hover:bg-primary/5" :
                    item.status === "traded" ? "border-l-emerald-500/50 hover:bg-emerald-500/5" :
                    "border-l-muted hover:bg-muted/40"
                  }`} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-foreground flex items-center gap-1.5">
                        <TrendingUp className="h-3 w-3 text-primary/50" /> {item.ticker}
                      </div>
                      <TagChips tags={item.tags} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.sector || "-"}</td>
                    <td className="px-4 py-3 text-xs max-w-[180px] truncate">{item.catalyst || "-"}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{item.targetPrice ? `$${Number(item.targetPrice).toFixed(2)}` : "-"}</td>
                    <td className="px-4 py-3 text-right text-red-400">{item.stopPrice ? `$${Number(item.stopPrice).toFixed(2)}` : "-"}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">{item.notes || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <WriteOnly>
                        <div className="flex gap-1 justify-end" onClick={(ev) => ev.stopPropagation()}>
                          <button onClick={() => openEdit(item)} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleting(item)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </WriteOnly>
                    </td>
                  </tr>
                  {expanded === item.id && (item as any).screenshotUrl && (
                    <tr className="bg-muted/20">
                      <td colSpan={8} className="px-6 py-4">
                        <ScreenshotDisplay urls={(item as any).screenshotUrl} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs font-mono">Вотчлист пуст</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="uppercase text-sm tracking-tight">{editing ? "Редактировать" : "Добавить тикер"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Тикер *</Label>
              <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="NVDA" className="font-mono bg-background h-8 text-xs uppercase" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Сектор</Label>
              <Input value={form.sector} onChange={(e) => set("sector", e.target.value)} placeholder="Tech / Energy..." className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Целевая цена</Label>
              <Input type="number" step="any" value={form.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} placeholder="150.00" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Стоп-лосс</Label>
              <Input type="number" step="any" value={form.stopPrice} onChange={(e) => set("stopPrice", e.target.value)} placeholder="120.00" className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Статус</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="font-mono bg-background h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs font-mono">{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Катализатор</Label>
              <Input value={form.catalyst} onChange={(e) => set("catalyst", e.target.value)} placeholder="Earnings, FDA, momentum..." className="font-mono bg-background h-8 text-xs" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs">Заметки</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-muted-foreground uppercase text-xs flex items-center gap-1.5"><Tag className="h-3 w-3" />Теги</Label>
              <TagSelector
                selectedTags={form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => set("tags", tags.join(", "))}
              />
            </div>
            <div className="col-span-2">
              <ScreenshotFields
                urls={form.screenshotUrls}
                onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="font-mono uppercase text-xs">Отмена</Button>
            <Button onClick={handleSave} disabled={!form.ticker || createMut.isPending || updateMut.isPending} className="font-mono uppercase text-xs">
              {createMut.isPending || updateMut.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent className="bg-card border-border font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm uppercase">Удалить {deleting?.ticker}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">Это действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs uppercase">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate(deleting.id)} className="font-mono text-xs uppercase bg-red-600 hover:bg-red-700">Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
