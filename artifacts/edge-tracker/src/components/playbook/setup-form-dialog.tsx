/**
 * One form for create / edit / new variant (child) / duplicate.
 * Autosaves a local draft (except duplicates); unchanged form → no draft.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus, History } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/ds";
import { IconAction } from "@/components/playbook-sub/bits";
import { ScreenshotFields } from "@/components/screenshot-fields";
import { TickerFundamentalsBar } from "@/components/ticker-fundamentals-bar";
import { PlaybookGenerateChecklistButton } from "@/components/playbook-generate-checklist";
import type { TickerFundamentals } from "@/lib/market-intel";
import { suggestTagsFromFundamentals } from "@/lib/tags";
import { useToast } from "@/hooks/use-toast";
import { invalidatePlaybook, pbRequest } from "./api";
import { blankForm, draftKey, entryToForm, formToBody, spaceOf, splitTags, type FormData, type PlaybookEntry, type Space } from "./model";
import { SetupTypeSelect } from "./setup-type-select";
import { TagChipEditor } from "./tag-chip-editor";
import { confidenceTone } from "./setup-bits";

const LazyVoiceRecorder = React.lazy(() => import("@/components/voice-recorder").then((m) => ({ default: m.VoiceRecorder })));

export type FormMode =
  | { kind: "create"; folder?: string | null; space?: Space }
  | { kind: "edit"; entry: PlaybookEntry }
  | { kind: "child"; parent: PlaybookEntry }
  | { kind: "duplicate"; source: PlaybookEntry; space?: Space };

/** Space for a new setup: explicit for create/duplicate, the parent's for a variant (API defaults otherwise). */
function spaceFor(mode: FormMode): Space | null {
  if (mode.kind === "create" || mode.kind === "duplicate") return mode.space ?? null;
  if (mode.kind === "child") return spaceOf(mode.parent);
  return null;
}

function storageKey(mode: FormMode): string | null {
  switch (mode.kind) {
    case "edit": return draftKey(mode.entry.id);
    case "child": return draftKey(null, mode.parent.id);
    case "create": return draftKey(null);
    default: return null;
  }
}

function baseline(mode: FormMode): FormData {
  switch (mode.kind) {
    case "edit": return entryToForm(mode.entry);
    case "child": return { ...blankForm(), folder: mode.parent.folder ?? "" };
    case "duplicate": { const f = entryToForm(mode.source); return { ...f, name: `${f.name} (копия)` }; }
    default: return { ...blankForm(), folder: mode.folder ?? "" };
  }
}

function readDraft(key: string | null): FormData | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? { ...blankForm(), ...parsed } : null;
  } catch { return null; }
}
function writeDraft(key: string | null, value: FormData | null) {
  if (!key) return;
  try { if (value) window.localStorage.setItem(key, JSON.stringify(value)); else window.localStorage.removeItem(key); } catch { /* ignore */ }
}

export function SetupFormDialog({
  mode, onClose, folders, onSaved,
}: {
  mode: FormMode | null;
  onClose: () => void;
  folders: string[];
  onSaved?: (id: number | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const trader = user?.traderName ?? "system";
  const [form, setForm] = useState<FormData>(blankForm);
  const [isDraft, setIsDraft] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const baseRef = useRef("");
  const key = mode ? storageKey(mode) : null;

  // (Re)initialise on open.
  useEffect(() => {
    if (!mode) return;
    const base = baseline(mode);
    baseRef.current = JSON.stringify(base);
    const draft = readDraft(storageKey(mode));
    setForm(draft ?? base);
    setIsDraft(!!draft);
    setNewFolder(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Debounced draft autosave.
  useEffect(() => {
    if (!mode || !key) return;
    const t = window.setTimeout(() => {
      const json = JSON.stringify(form);
      if (json === baseRef.current) { writeDraft(key, null); setIsDraft(false); return; }
      writeDraft(key, form);
      setIsDraft(true);
    }, 800);
    return () => window.clearTimeout(t);
  }, [form, key, mode]);

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => setForm((f) => ({ ...f, [k]: v }));
  const append = (k: "conditions" | "checklist" | "notes") => (text: string) => setForm((f) => ({ ...f, [k]: f[k] ? `${f[k]}\n${text}` : text }));

  function onFundamentals(d: TickerFundamentals) {
    setForm((prev) => ({
      ...prev,
      marketCap: prev.marketCap || (d.marketCap ?? ""), float: prev.float || (d.float ?? ""), adv: prev.adv || (d.averageDailyVolume ?? ""),
      atr: prev.atr || (d.atr != null ? String(d.atr) : ""), relativeVolume: prev.relativeVolume || (d.relativeVolume != null ? String(d.relativeVolume) : ""),
      beta: prev.beta || (d.beta != null ? String(d.beta) : ""), shortInterest: prev.shortInterest || (d.shortInterest != null ? String(d.shortInterest) : ""),
      sector: prev.sector || (d.sector ?? ""), longName: prev.longName || (d.longName ?? ""),
      tags: Array.from(new Set([...splitTags(prev.tags), ...suggestTagsFromFundamentals(d)])).join(", "),
    }));
  }

  function discardDraft() {
    if (!mode) return;
    writeDraft(key, null);
    const base = baseline(mode);
    baseRef.current = JSON.stringify(base);
    setForm(base);
    setIsDraft(false);
  }

  async function save() {
    if (!mode || saving || !form.name.trim()) return;
    if (newFolder !== null && !newFolder.trim()) { toast({ title: "Введите название новой папки", variant: "destructive" }); return; }
    const folder = newFolder !== null ? newFolder.trim() : form.folder;
    const body = formToBody(form, folder, trader);
    setSaving(true);
    try {
      let id: number | null = null;
      if (mode.kind === "edit") {
        await pbRequest(`/api/playbook/${mode.entry.id}`, { method: "PATCH", json: body });
        id = mode.entry.id;
      } else {
        const parentId = mode.kind === "child" ? mode.parent.id : mode.kind === "duplicate" ? mode.source.parentId : null;
        const space = spaceFor(mode);
        const row = await pbRequest<{ id?: number }>("/api/playbook", { method: "POST", json: { ...body, parentId, ...(space ? { space } : {}) } });
        id = typeof row?.id === "number" ? row.id : null;
      }
      writeDraft(key, null);
      setIsDraft(false);
      invalidatePlaybook(qc, id ?? undefined);
      toast({ title: mode.kind === "edit" ? "Сохранено" : mode.kind === "child" ? "Вариант создан" : mode.kind === "duplicate" ? "Копия создана" : "Добавлено в плейбук" });
      onSaved?.(id);
      onClose();
    } catch (e: any) {
      toast({ title: "Не удалось сохранить", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const title = !mode ? "" : mode.kind === "edit" ? "Редактировать сетап" : mode.kind === "child" ? "Новый вариант" : mode.kind === "duplicate" ? "Копия сетапа" : mode.space === "office" ? "Новый сетап в Офис" : mode.space === "personal" ? "Новый сетап в «Мой»" : "Новый сетап";
  const subtitle = !mode ? "" : mode.kind === "child" ? `Дочерний для «${mode.parent.name}»` : mode.kind === "edit" ? mode.entry.name : "Опишите, когда и как вы торгуете этот сетап";
  const folderOptions = useMemo(() => {
    const set = new Set(folders);
    if (form.folder) set.add(form.folder);
    return [...set];
  }, [folders, form.folder]);
  const conf = Number(form.confidenceLevel);
  const confValid = form.confidenceLevel !== "" && Number.isFinite(conf);
  const editId = mode?.kind === "edit" ? mode.entry.id : null;

  return (
    <Dialog open={!!mode} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            {isDraft && (
              <>
                <Pill tone="warn"><History className="h-3 w-3" aria-hidden="true" /> Черновик</Pill>
                <button type="button" onClick={discardDraft} className="text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  сбросить
                </button>
              </>
            )}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <form
          id="pb-form"
          className="space-y-5"
          onSubmit={(e) => { e.preventDefault(); save(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
        >
          {/* Basics */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="pb-name" className="text-xs text-muted-foreground">Название *</Label>
              <Input id="pb-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Earnings Gap Up" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-ticker" className="text-xs text-muted-foreground">Тикер-пример</Label>
              <Input id="pb-ticker" value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="NVDA" />
            </div>
          </div>
          {form.ticker.length >= 1 && <TickerFundamentalsBar ticker={form.ticker} onLoaded={onFundamentals} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pb-folder" className="text-xs text-muted-foreground">Папка</Label>
              {newFolder === null ? (
                <div className="flex gap-2">
                  <Select value={form.folder || "__none"} onValueChange={(v) => set("folder", v === "__none" ? "" : v)}>
                    <SelectTrigger id="pb-folder" className="min-w-0 flex-1"><SelectValue placeholder="Без папки" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Без папки</SelectItem>
                      {folderOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <IconAction aria-label="Новая папка" title="Новая папка" onClick={() => setNewFolder("")} className="h-10 w-10"><FolderPlus /></IconAction>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input id="pb-folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Новая папка" autoFocus className="min-w-0 flex-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNewFolder(null)}>Отмена</Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-setup-type" className="text-xs text-muted-foreground">Тип сетапа</Label>
              <SetupTypeSelect id="pb-setup-type" value={form.setupType} onChange={(v) => set("setupType", v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-confidence" className="flex items-center justify-between text-xs text-muted-foreground">
                Уверенность
                <span className={confValid ? `font-semibold tabular-nums ${confidenceTone(conf) === "up" ? "text-up" : confidenceTone(conf) === "down" ? "text-down" : "text-foreground"}` : "text-muted-foreground"}>
                  {confValid ? `${conf}%` : "—"}
                </span>
              </Label>
              <input
                id="pb-confidence"
                type="range"
                min={0}
                max={100}
                step={5}
                value={confValid ? conf : 70}
                onChange={(e) => set("confidenceLevel", e.target.value)}
                className="h-10 w-full accent-[hsl(var(--primary))]"
              />
            </div>
          </div>

          {/* Thesis */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <Label htmlFor="pb-conditions" className="text-xs text-muted-foreground">Условия входа</Label>
                <React.Suspense fallback={null}><LazyVoiceRecorder onTranscript={append("conditions")} /></React.Suspense>
              </div>
              <Textarea id="pb-conditions" value={form.conditions} onChange={(e) => set("conditions", e.target.value)} rows={5} placeholder={"Контекст рынка, катализатор, уровень, триггер входа.\nИнвалидация: …\nЦели: …"} className="resize-y text-sm" />
            </div>
            <div className="space-y-1.5">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <Label htmlFor="pb-checklist" className="text-xs text-muted-foreground">Чеклист — пункт на строку</Label>
                <div className="flex items-center gap-1">
                  <PlaybookGenerateChecklistButton
                    playbookId={editId}
                    onGenerated={(c) => set("checklist", c)}
                    conditions={form.conditions}
                    notes={form.notes}
                    currentChecklist={form.checklist}
                  />
                  <React.Suspense fallback={null}><LazyVoiceRecorder onTranscript={append("checklist")} /></React.Suspense>
                </div>
              </div>
              <Textarea id="pb-checklist" value={form.checklist} onChange={(e) => set("checklist", e.target.value)} rows={5} placeholder={"- Гэп > 5%\n- Объём > 500k в премаркете\n- Чистый катализатор\n- Вход на первом откате"} className="resize-y text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex min-h-8 items-center justify-between gap-2">
              <Label htmlFor="pb-notes" className="text-xs text-muted-foreground">Заметки — управление позицией, ошибки, нюансы</Label>
              <React.Suspense fallback={null}><LazyVoiceRecorder onTranscript={append("notes")} /></React.Suspense>
            </div>
            <Textarea id="pb-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="resize-y text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pb-tags" className="text-xs text-muted-foreground">Теги <span className="text-muted-foreground">· перетащите, чтобы изменить порядок</span></Label>
            <TagChipEditor id="pb-tags" value={form.tags} onChange={(v) => set("tags", v)} />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Скриншоты</div>
            <ScreenshotFields
              urls={form.screenshotUrls}
              onChange={(urls) => setForm((f) => ({ ...f, screenshotUrls: urls }))}
              notes={form.screenshotNotes}
              onNotesChange={(notes) => setForm((f) => ({ ...f, screenshotNotes: notes }))}
            />
          </div>
        </form>

        <DialogFooter className="gap-2 sm:items-center">
          <span className="mr-auto hidden text-xs text-muted-foreground sm:inline"><kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">Enter</kbd> — сохранить</span>
          <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" form="pb-form" disabled={!form.name.trim() || saving}>{saving ? "Сохраняем…" : "Сохранить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
