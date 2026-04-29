import React, { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, FolderPlus, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export type PlaybookPayload = {
  name: string;
  setupType?: string;
  conditions?: string;
  notes?: string;
  screenshotUrl?: string;
  screenshotNotes?: string;
  tags?: string;
  sourceType: "trade" | "research" | "dailyfeed" | "event";
  sourceId: number;
};

export function AddToPlaybookButton({ payload, size = "sm" }: { payload: PlaybookPayload; size?: "sm" | "icon" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {size === "icon" ? (
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="p-1 text-muted-foreground hover:text-amber-400 transition-colors"
          title="В плейбук"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="font-mono text-xs gap-1 h-7">
          <BookOpen className="h-3 w-3" /> В плейбук
        </Button>
      )}
      <AddToPlaybookDialog open={open} onOpenChange={setOpen} payload={payload} />
    </>
  );
}

function AddToPlaybookDialog({ open, onOpenChange, payload }: { open: boolean; onOpenChange: (v: boolean) => void; payload: PlaybookPayload }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [folder, setFolder] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [name, setName] = useState(payload.name);
  const [notes, setNotes] = useState(payload.notes || "");

  useEffect(() => {
    if (open) {
      setName(payload.name);
      setNotes(payload.notes || "");
      setFolder("");
      setNewFolder("");
      setCreatingFolder(false);
    }
  }, [open, payload]);

  const { data: folders = [] } = useQuery<string[]>({
    queryKey: ["playbook-folders"],
    queryFn: () => fetch(`${BASE}/api/playbook/folders`).then(r => r.json()),
    enabled: open,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const targetFolder = creatingFolder ? newFolder.trim() : folder;
      const body = {
        name,
        folder: targetFolder || null,
        setupType: payload.setupType || null,
        conditions: payload.conditions || null,
        notes: notes || null,
        screenshotUrl: payload.screenshotUrl || null,
        screenshotNotes: payload.screenshotNotes || null,
        tags: payload.tags || null,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
      };
      const res = await fetch(`${BASE}/api/playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: ["playbook-folders"] });
      onOpenChange(false);
      toast({ title: "Добавлено в плейбук" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось добавить в плейбук", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border font-mono" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="uppercase text-sm tracking-tight flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Добавить в плейбук
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <Label className="text-muted-foreground uppercase text-xs">Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="font-mono bg-background h-8 text-xs" />
          </div>

          <div className="space-y-1">
            <Label className="text-muted-foreground uppercase text-xs">Папка</Label>
            {!creatingFolder ? (
              <div className="flex gap-2">
                <Select value={folder || "__none"} onValueChange={(v) => setFolder(v === "__none" ? "" : v)}>
                  <SelectTrigger className="font-mono bg-background h-8 text-xs flex-1">
                    <SelectValue placeholder="Без папки" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none" className="text-xs font-mono">Без папки</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f} value={f} className="text-xs font-mono">{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => setCreatingFolder(true)} className="h-8 px-2" title="Новая папка">
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  placeholder="Название новой папки"
                  className="font-mono bg-background h-8 text-xs flex-1"
                  autoFocus
                />
                <Button variant="outline" size="sm" onClick={() => setCreatingFolder(false)} className="h-8 px-2 text-xs font-mono">
                  Назад
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-muted-foreground uppercase text-xs">Заметки</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="font-mono bg-background text-xs resize-none" />
          </div>

          {payload.screenshotUrl && (
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase flex items-center gap-1">
                <span>📎</span> Скриншот будет перенесён
              </div>
              <img
                src={payload.screenshotUrl.split("\n")[0].trim()}
                alt="Screenshot preview"
                className="max-h-40 w-full object-contain border border-emerald-500/20 bg-muted/20"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          {payload.sourceType && (
            <div className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-1.5 border border-border">
              Источник: {payload.sourceType === "trade" ? "Трейд" : payload.sourceType === "research" ? "Ресёрч" : payload.sourceType === "event" ? "Событие" : "Дневная лента"} #{payload.sourceId}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono uppercase text-xs">Отмена</Button>
          <Button onClick={() => saveMut.mutate()} disabled={!name || saveMut.isPending} className="font-mono uppercase text-xs">
            {saveMut.isPending ? "Сохраняем..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
