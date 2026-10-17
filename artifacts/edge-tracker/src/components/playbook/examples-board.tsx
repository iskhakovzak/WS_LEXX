/**
 * «Эталоны» — example trades of a setup on a three-column tier board (T1 эталон / T2 хорошая / T3 ошибка).
 * Drag a card between columns (or onto a setup in the sidebar — see EXAMPLE_DND_TYPE); keyboard alternative on a
 * focused card: 1/2/3 — tier, Alt+↑/↓ — order, M — move menu, Enter — note, Delete — remove (undo in the toast).
 * Data: /api/playbook/:id/examples (routes/playbook-spaces.ts).
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowRightLeft, ExternalLink, ImagePlus, ListChecks, Loader2, MoreHorizontal, Plus, StickyNote, Trash2, Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { EmptyState, Pill, toneText } from "@/components/ds";
import { TradeSparkline } from "@/components/chart-engine";
import { deriveChecklistItems, type ChecklistItem } from "@/components/playbook-checklist-marks";
import { IconAction } from "@/components/playbook-sub/bits";
import { useToast } from "@/hooks/use-toast";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { invalidateExamples, notLiveMessage, pbRequest, useSetupExamples } from "./api";
import { imageFilesFrom, uploadPlaybookImage, usePlaybookMediaUrl } from "./media";
import {
  TIERS, ddmm, fmtR, fmtUsd, moneyTone, tierMeta, type PlaybookEntry, type SetupAccess, type SetupExample, type Tier,
} from "./model";
import { REDACTED_HINT, RedactedHint } from "./setup-bits";

/** dataTransfer type for dragging an example card (the page's sidebar accepts it to move between setups). */
export const EXAMPLE_DND_TYPE = "application/x-ws-playbook-example";
export type ExampleDragPayload = { exampleId: number; fromSetupId: number };

export function readExampleDrag(dt: DataTransfer | null): ExampleDragPayload | null {
  if (!dt) return null;
  try {
    const raw = dt.getData(EXAMPLE_DND_TYPE);
    if (!raw) return null;
    const p = JSON.parse(raw) as ExampleDragPayload;
    return Number.isInteger(p.exampleId) && Number.isInteger(p.fromSetupId) ? p : null;
  } catch {
    return null;
  }
}
export function hasExampleDrag(dt: DataTransfer | null) {
  return !!dt && Array.from(dt.types ?? []).includes(EXAMPLE_DND_TYPE);
}

/** PATCH an example (tier / note / marks / media / move to another setup). */
export function patchExample(setupId: number, exampleId: number, body: Record<string, unknown>) {
  return pbRequest<SetupExample & { merged?: boolean }>(`/api/playbook/${setupId}/examples/${exampleId}`, { method: "PATCH", json: body });
}

export function checklistOf(entry: Pick<PlaybookEntry, "checklistItems" | "checklist">): ChecklistItem[] {
  return deriveChecklistItems(entry.checklistItems, entry.checklist);
}

/* ───────────────────────── board ───────────────────────── */

export function ExamplesBoard({
  entry, access, viewerName, targets, onAddExamples,
}: {
  entry: PlaybookEntry;
  access: SetupAccess;
  viewerName: string | null;
  /** Setups an example can be moved to (readable + canAddExamples). */
  targets: PlaybookEntry[];
  onAddExamples: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useSetupExamples(entry.id);
  const key = ["playbook-examples", entry.id] as const;
  const items = q.data ?? [];
  const checklist = React.useMemo(() => checklistOf(entry), [entry]);
  const [dragOver, setDragOver] = React.useState<Tier | null>(null);
  const [announce, setAnnounce] = React.useState("");

  const canChange = React.useCallback(
    (ex: SetupExample) => access.canEdit || (!!viewerName && ex.addedBy === viewerName),
    [access.canEdit, viewerName],
  );

  const byTier = React.useMemo(() => {
    const m: Record<Tier, SetupExample[]> = { 1: [], 2: [], 3: [] };
    for (const ex of items) (m[(ex.tier as Tier) || 2] ?? m[2]).push(ex);
    for (const t of [1, 2, 3] as Tier[]) m[t].sort((a, b) => a.sortOrder - b.sortOrder || (b.closeDate ?? b.date).localeCompare(a.closeDate ?? a.date));
    return m;
  }, [items]);

  const setLocal = (fn: (list: SetupExample[]) => SetupExample[]) => {
    const prev = qc.getQueryData<SetupExample[]>(key);
    qc.setQueryData<SetupExample[]>(key, (old = []) => fn(old));
    return prev;
  };
  const fail = (e: unknown, prev: SetupExample[] | undefined, title = "Не удалось изменить эталон") => {
    if (prev) qc.setQueryData(key, prev);
    toast({ title, description: notLiveMessage(e) ?? (e as Error)?.message, variant: "destructive" });
  };

  const patch = useMutation({
    mutationFn: ({ ex, body }: { ex: SetupExample; body: Record<string, unknown> }) => patchExample(entry.id, ex.id, body),
    onMutate: ({ ex, body }) => {
      const prev = setLocal((list) =>
        body.playbookId && body.playbookId !== entry.id
          ? list.filter((x) => x.id !== ex.id)
          : list.map((x) => (x.id === ex.id ? ({ ...x, ...body } as SetupExample) : x)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => fail(e, ctx?.prev),
    onSettled: (_d, _e, v) => invalidateExamples(qc, entry.id, typeof v.body.playbookId === "number" ? v.body.playbookId : null),
  });

  const reorder = useMutation({
    mutationFn: ({ tier, ids }: { tier: Tier; ids: number[] }) => pbRequest(`/api/playbook/${entry.id}/examples/reorder`, { method: "POST", json: { tier, ids } }),
    onMutate: ({ tier, ids }) => {
      const prev = setLocal((list) => list.map((x) => (ids.includes(x.id) ? { ...x, tier, sortOrder: ids.indexOf(x.id) } : x)));
      return { prev };
    },
    onError: (e, _v, ctx) => fail(e, ctx?.prev),
    onSettled: () => invalidateExamples(qc, entry.id),
  });

  const restore = async (ex: SetupExample) => {
    try {
      await pbRequest(`/api/playbook/${entry.id}/examples`, {
        method: "POST",
        json: { tradeIds: [ex.tradeId], tier: ex.tier, note: ex.note, checklistMarks: ex.checklistMarks, link: false },
      });
      invalidateExamples(qc, entry.id);
    } catch (e) {
      toast({ title: "Не удалось вернуть эталон", description: (e as Error)?.message, variant: "destructive" });
    }
  };

  const remove = useMutation({
    mutationFn: (ex: SetupExample) => pbRequest(`/api/playbook/${entry.id}/examples/${ex.id}`, { method: "DELETE" }),
    onMutate: (ex) => ({ prev: setLocal((list) => list.filter((x) => x.id !== ex.id)) }),
    onError: (e, _v, ctx) => fail(e, ctx?.prev, "Не удалось убрать эталон"),
    onSuccess: (_d, ex) =>
      toast({
        title: `${ex.ticker} ${ddmm(ex.closeDate ?? ex.date)} убран из эталонов`,
        action: <ToastAction altText="Вернуть эталон" onClick={() => restore(ex)}>Вернуть</ToastAction>,
      }),
    onSettled: () => invalidateExamples(qc, entry.id),
  });

  const setTier = (ex: SetupExample, tier: Tier) => {
    if (ex.tier === tier || !canChange(ex)) return;
    const ids = [...byTier[tier].map((x) => x.id), ex.id];
    reorder.mutate({ tier, ids });
    setAnnounce(`${ex.ticker}: ${tierMeta(tier).label}`);
  };
  const moveWithin = (ex: SetupExample, delta: -1 | 1) => {
    const col = byTier[ex.tier];
    const i = col.findIndex((x) => x.id === ex.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= col.length) return;
    const ids = col.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ tier: ex.tier, ids });
    setAnnounce(`${ex.ticker}: позиция ${j + 1} из ${col.length}`);
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-example-card="${ex.id}"]`)?.focus(), 30);
  };
  const moveToSetup = (ex: SetupExample, target: PlaybookEntry) => {
    patch.mutate(
      { ex, body: { playbookId: target.id } },
      { onSuccess: (r) => toast({ title: r?.merged ? `Объединено с эталоном в «${target.name}»` : `Перенесено в «${target.name}»` }) },
    );
  };

  const onDropColumn = (tier: Tier, e: React.DragEvent) => {
    setDragOver(null);
    const p = readExampleDrag(e.dataTransfer);
    if (!p || p.fromSetupId !== entry.id) return;
    e.preventDefault();
    const ex = items.find((x) => x.id === p.exampleId);
    if (!ex || !canChange(ex)) return;
    // Insert before the card under the cursor, else at the end.
    const overCard = (e.target as HTMLElement).closest<HTMLElement>("[data-example-card]");
    const overId = overCard ? Number(overCard.dataset.exampleCard) : null;
    const ids = byTier[tier].map((x) => x.id).filter((id) => id !== ex.id);
    const at = overId != null ? ids.indexOf(overId) : -1;
    if (at >= 0) ids.splice(at, 0, ex.id); else ids.push(ex.id);
    reorder.mutate({ tier, ids });
  };

  if (q.isLoading) {
    return (
      <div className="grid min-h-[320px] gap-[var(--grid-gap)] lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" />)}
      </div>
    );
  }
  if (q.isError) {
    const live = notLiveMessage(q.error);
    return (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          icon={Trophy}
          title={live ? "Эталоны включатся после обновления сервера" : "Не удалось загрузить эталоны"}
          description={live ? "Новые таблицы уже готовы — нужен перезапуск API." : (q.error as Error)?.message}
          action={live ? undefined : <Button variant="outline" onClick={() => q.refetch()}>Повторить</Button>}
        />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="glass-panel rounded-2xl">
        <EmptyState
          icon={Trophy}
          title="Эталонов пока нет"
          description="Добавьте сделки, которые идеально отыграли сетап (Tier 1), хорошие с отклонениями (Tier 2) и ошибки (Tier 3). Их видно всем, кто видит сетап."
          action={access.canAddExamples ? <Button onClick={onAddExamples}><Plus className="h-4 w-4" aria-hidden="true" /> Добавить примеры</Button> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sr-only" aria-live="polite">{announce}</div>
      <div className="grid gap-[var(--grid-gap)] lg:grid-cols-3">
        {TIERS.map((t) => {
          const col = byTier[t.tier];
          return (
            <section
              key={t.tier}
              aria-label={`${t.label}: ${col.length}`}
              onDragOver={(e) => { if (hasExampleDrag(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(t.tier); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
              onDrop={(e) => onDropColumn(t.tier, e)}
              className={cn(
                "flex min-h-[220px] min-w-0 flex-col gap-2 rounded-2xl border border-transparent bg-[var(--glass-bg)] p-2 transition-colors duration-[var(--dur-1)]",
                dragOver === t.tier && "border-primary/50 bg-primary/5",
              )}
            >
              <header className="flex items-center gap-2 px-1.5 pt-1" title={t.hint}>
                <span className={cn("h-2 w-2 rounded-full bg-current", toneText(t.tone))} aria-hidden="true" />
                <h4 className="text-sm font-semibold text-foreground">{t.label}</h4>
                <span className="text-xs tabular-nums text-muted-foreground">{col.length}</span>
              </header>
              {col.length === 0 && (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  Перетащите сюда карточку или нажмите {t.tier} на выбранной
                </p>
              )}
              {col.map((ex) => (
                <ExampleCard
                  key={ex.id}
                  ex={ex}
                  setupId={entry.id}
                  checklist={checklist}
                  editable={canChange(ex)}
                  targets={targets.filter((x) => x.id !== entry.id)}
                  onTier={(tier) => setTier(ex, tier)}
                  onMove={(d) => moveWithin(ex, d)}
                  onMoveTo={(target) => moveToSetup(ex, target)}
                  onPatch={(body) => patch.mutate({ ex, body })}
                  onRemove={() => remove.mutate(ex)}
                />
              ))}
            </section>
          );
        })}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Перетаскивайте карточки между колонками или на сетап слева. С клавиатуры: 1/2/3 — тир, Alt+↑/↓ — порядок, M — перенести.
      </p>
      {items.some((x) => x.redacted) && <RedactedHint className="px-1" />}
    </div>
  );
}

/**
 * Headline figure of an example: net $ when the viewer may see it, otherwise R (the server nulls the $ of other
 * traders' trades for non-staff — see lib/playbookPrivacy.ts on the API).
 */
export function exampleFigure(ex: SetupExample): { text: string; tone: ReturnType<typeof moneyTone> } {
  if (!ex.redacted) return { text: fmtUsd(ex.netPnl), tone: moneyTone(ex.netPnl) };
  if (ex.signedR != null) return { text: fmtR(ex.signedR), tone: moneyTone(ex.signedR) };
  // Someone else's trade without a stop: no $ and no R — show the outcome word instead of «—».
  const r = (ex.result ?? "").toLowerCase();
  return r === "win" ? { text: "Плюс", tone: "up" } : r === "loss" ? { text: "Минус", tone: "down" } : r === "be" ? { text: "В ноль", tone: "neutral" } : { text: "—", tone: "neutral" };
}

/** Price path for the card. Another trader's trade: pass the known prices / fill times instead of loading it by id. */
function ExampleChart({ ex, compact }: { ex: SetupExample; compact?: boolean }) {
  const day = ex.closeDate ?? ex.date;
  const size = { width: compact ? 220 : 280, height: compact ? 64 : 88 };
  const trade = React.useMemo(
    () => (ex.redacted
      ? {
          // Negative id: own cache slot, and no executions request (those are the owner's / staff's).
          id: -ex.tradeId, ticker: ex.ticker, date: ex.date, exitDate: ex.closeDate, side: ex.side, entry: ex.entry, exit: ex.exit,
          horizon: ex.horizon, result: ex.result, entryTime: ex.entryTime ?? null, exitTime: ex.exitTime ?? null,
        }
      : undefined),
    [ex.redacted, ex.tradeId, ex.ticker, ex.date, ex.closeDate, ex.side, ex.entry, ex.exit, ex.horizon, ex.result, ex.entryTime, ex.exitTime],
  );
  return trade
    ? <TradeSparkline trade={trade} {...size} className="max-w-full" title={`${ex.ticker} ${ddmm(day)}`} />
    : <TradeSparkline tradeId={ex.tradeId} {...size} className="max-w-full" title={`${ex.ticker} ${ddmm(day)}`} />;
}

/* ───────────────────────── card ───────────────────────── */

export function ExampleCard({
  ex, setupId, checklist, editable, targets, onTier, onMove, onMoveTo, onPatch, onRemove, compact, header,
}: {
  ex: SetupExample;
  setupId: number;
  checklist: ChecklistItem[];
  editable: boolean;
  targets?: PlaybookEntry[];
  onTier?: (t: Tier) => void;
  onMove?: (d: -1 | 1) => void;
  onMoveTo?: (target: PlaybookEntry) => void;
  onPatch?: (body: Record<string, unknown>) => void;
  onRemove?: () => void;
  compact?: boolean;
  /** Extra line above the trade (gallery: setup name / trader). */
  header?: React.ReactNode;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editingNote, setEditingNote] = React.useState(false);
  const [note, setNote] = React.useState(ex.note ?? "");
  const [uploading, setUploading] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (!editingNote) setNote(ex.note ?? ""); }, [ex.note, editingNote]);

  const day = ex.closeDate ?? ex.date;
  const figure = exampleFigure(ex);
  const marks = ex.checklistMarks ?? {};
  const checked = checklist.filter((c) => marks[c.id]).length;

  async function attach(files: File[]) {
    const f = files[0];
    if (!f || !onPatch) return;
    setUploading(true);
    try {
      const up = await uploadPlaybookImage(f, setupId);
      onPatch({ mediaId: up.id });
    } catch (e) {
      toast({ title: "Не удалось загрузить скриншот", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const saveNote = () => {
    setEditingNote(false);
    if ((ex.note ?? "") !== note.trim()) onPatch?.({ note: note.trim() || null });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || !editable) return;
    if (e.key === "1" || e.key === "2" || e.key === "3") { e.preventDefault(); onTier?.(Number(e.key) as Tier); return; }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); onMove?.(e.key === "ArrowUp" ? -1 : 1); return; }
    if (e.key === "Enter") { e.preventDefault(); setEditingNote(true); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove?.(); return; }
    if (e.key === "m" || e.key === "M" || e.key === "ь") { e.preventDefault(); setMenuOpen(true); }
  };

  return (
    <article
      data-example-card={ex.id}
      tabIndex={0}
      draggable={editable && !editingNote}
      onDragStart={(e) => {
        e.dataTransfer.setData(EXAMPLE_DND_TYPE, JSON.stringify({ exampleId: ex.id, fromSetupId: setupId } satisfies ExampleDragPayload));
        e.dataTransfer.effectAllowed = "move";
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        if (!editable) return;
        const files = imageFilesFrom(e.clipboardData);
        if (files.length) { e.preventDefault(); attach(files); }
      }}
      aria-label={`${ex.ticker} ${ddmm(day)} · ${figure.text}${ex.redacted ? " (суммы скрыты)" : ""} · ${tierMeta(ex.tier).label}`}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-xl border border-border/60 bg-[hsl(var(--card))] p-3 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        editable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {header}
      <div className="flex items-center gap-2">
        <span className="font-semibold text-foreground">{ex.ticker}</span>
        {ex.side && <span className={cn("text-xs", ex.side.toLowerCase().startsWith("s") ? "text-down" : "text-up")}>{ex.side.toLowerCase().startsWith("s") ? "Шорт" : "Лонг"}</span>}
        <span className="text-xs tabular-nums text-muted-foreground">{ddmm(day)}</span>
        <span
          className={cn("ml-auto text-sm font-semibold tabular-nums", toneText(figure.tone))}
          title={ex.redacted ? REDACTED_HINT : "P&L нетто"}
        >
          {figure.text}
        </span>
        {(onTier || onRemove || onMoveTo) && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconAction aria-label="Действия с эталоном" className="-mr-1 h-7 w-7"><MoreHorizontal /></IconAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => navigate(links.trade(ex.tradeId))}><ExternalLink className="h-4 w-4" aria-hidden="true" /> Открыть сделку</DropdownMenuItem>
              {editable && onTier && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Тир</DropdownMenuLabel>
                  {TIERS.map((t) => (
                    <DropdownMenuItem key={t.tier} disabled={t.tier === ex.tier} onSelect={() => onTier(t.tier)}>
                      <span className={cn("h-2 w-2 rounded-full bg-current", toneText(t.tone))} aria-hidden="true" /> {t.label}
                      <span className="ml-auto text-xs text-muted-foreground">{t.tier}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {editable && onMoveTo && targets && targets.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> В другой сетап</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(60dvh,440px)] w-72 overflow-y-auto">
                    {targets.slice(0, 200).map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => onMoveTo(t)}>
                        <span className="truncate">{t.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {editable && onPatch && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setEditingNote(true)}><StickyNote className="h-4 w-4" aria-hidden="true" /> Заметка</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" aria-hidden="true" /> {ex.mediaId ? "Заменить скриншот" : "Скриншот"}</DropdownMenuItem>
                  {ex.mediaId && <DropdownMenuItem onSelect={() => onPatch({ mediaId: null })}>Убрать скриншот</DropdownMenuItem>}
                </>
              )}
              {editable && onRemove && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onRemove} className="text-down focus:text-down"><Trash2 className="h-4 w-4" aria-hidden="true" /> Убрать из эталонов</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* One media box height for chart and screenshot, so cards in a row line up. */}
      {ex.mediaId ? (
        <ExampleShot id={ex.mediaId} alt={`Скриншот ${ex.ticker} ${ddmm(day)}`} compact={compact} />
      ) : (
        <div className={cn("flex items-center justify-center overflow-hidden rounded-lg", compact ? "h-24" : "h-32")}>
          <ExampleChart ex={ex} compact={compact} />
        </div>
      )}
      {uploading && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Загружаем скриншот…</p>}

      {editingNote ? (
        <Textarea
          aria-label="Заметка к эталону"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { setEditingNote(false); setNote(ex.note ?? ""); }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); }
          }}
          rows={3}
          autoFocus
          placeholder="Почему это эталон / что было не так"
          className="resize-y text-sm"
        />
      ) : ex.note ? (
        <button
          type="button"
          disabled={!editable}
          onClick={() => setEditingNote(true)}
          className="whitespace-pre-wrap text-left text-sm leading-snug text-foreground disabled:cursor-default"
        >
          {ex.note}
        </button>
      ) : editable && !compact ? (
        <button type="button" onClick={() => setEditingNote(true)} className="text-left text-xs text-muted-foreground hover:text-foreground">
          + заметка
        </button>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {checklist.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="chip inline-flex min-h-6 items-center gap-1 px-2 text-xs" aria-label={`Чеклист: ${checked} из ${checklist.length}`}>
                <ListChecks className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{checked}/{checklist.length}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <p className="mb-2 text-xs text-muted-foreground">Что из чеклиста было выполнено в этой сделке</p>
              <ul className="flex flex-col gap-1.5">
                {checklist.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      id={`m-${ex.id}-${c.id}`}
                      checked={!!marks[c.id]}
                      disabled={!editable}
                      onCheckedChange={(v) => onPatch?.({ checklistMarks: { ...marks, [c.id]: v === true } })}
                    />
                    <label htmlFor={`m-${ex.id}-${c.id}`} className="leading-snug">{c.text}</label>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
        {ex.trader && <span className="text-xs text-muted-foreground">{ex.trader}</span>}
        {ex.addedBy && ex.addedBy !== ex.trader && <span className="text-xs text-muted-foreground">· добавил {ex.addedBy}</span>}
        {/* Redacted cards already show R as the headline figure. */}
        {ex.signedR != null && !ex.redacted && <Pill tone="neutral" className="ml-auto">{ex.signedR > 0 ? "+" : ""}{ex.signedR.toFixed(1)}R</Pill>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; attach(f); }}
      />
    </article>
  );
}

function ExampleShot({ id, alt, compact }: { id: number; alt: string; compact?: boolean }) {
  const url = usePlaybookMediaUrl(id);
  if (url === "error") return <div className={cn("grid place-items-center rounded-lg bg-[var(--glass-bg)] text-xs text-muted-foreground", compact ? "h-24" : "h-32")}>Скриншот недоступен</div>;
  if (!url) return <div className={cn("animate-pulse rounded-lg bg-[var(--glass-bg)] motion-reduce:animate-none", compact ? "h-24" : "h-32")} />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border/60" draggable={false}>
      <img src={url} alt={alt} className={cn("w-full object-cover", compact ? "h-24" : "h-32")} draggable={false} />
    </a>
  );
}
