import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { History, RotateCcw, AlertTriangle } from "lucide-react";
import { BASE } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EmptyState, Pill, Segmented } from "@/components/ds";
import { IconAction, plural } from "@/components/playbook-sub/bits";

type Revision = {
  id: number;
  playbookId: number;
  trader: string | null;
  snapshot: Record<string, any>;
  createdAt: string;
};

const FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: "name", label: "Название" },
  { key: "folder", label: "Папка" },
  { key: "setupType", label: "Тип" },
  { key: "confidenceLevel", label: "Уверенность" },
  { key: "tags", label: "Теги" },
  { key: "conditions", label: "Условия входа", multiline: true },
  { key: "checklist", label: "Чек-лист", multiline: true },
  { key: "notes", label: "Заметки", multiline: true },
];

function norm(v: any): string {
  if (v == null) return "";
  return String(v).replace(/\r\n/g, "\n").trim();
}

function changedFields(a: Record<string, any> | undefined, b: Record<string, any> | undefined) {
  return FIELDS.filter((f) => norm(a?.[f.key]) !== norm(b?.[f.key]));
}

type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line-level LCS diff (inputs are short playbook texts). */
function diffLines(a: string, b: string): DiffLine[] {
  const A = a ? a.split("\n") : [];
  const B = b ? b.split("\n") : [];
  if (A.length * B.length > 160000) {
    return [...A.map((t) => ({ kind: "del" as const, text: t })), ...B.map((t) => ({ kind: "add" as const, text: t }))];
  }
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ kind: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: A[i] }); i++; }
    else { out.push({ kind: "add", text: B[j] }); j++; }
  }
  while (i < A.length) out.push({ kind: "del", text: A[i++] });
  while (j < B.length) out.push({ kind: "add", text: B[j++] });
  return out;
}

function FieldDiff({ label, before, after, multiline }: { label: string; before: string; after: string; multiline?: boolean }) {
  const changed = before !== after;
  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {changed ? <Pill tone="warn">изменено</Pill> : <span className="text-xs text-muted-foreground">без изменений</span>}
      </div>
      {!changed ? (
        <div className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{before || "—"}</div>
      ) : multiline ? (
        <div className="overflow-hidden rounded-lg text-sm">
          {diffLines(before, after).map((l, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 whitespace-pre-wrap break-words px-2 py-0.5",
                l.kind === "add" && "bg-up/10 text-up",
                l.kind === "del" && "bg-down/10 text-down line-through decoration-down/40",
                l.kind === "same" && "text-muted-foreground",
              )}
            >
              <span className="w-3 shrink-0 select-none text-center" aria-hidden="true">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
              <span className="sr-only">{l.kind === "add" ? "добавлено: " : l.kind === "del" ? "удалено: " : ""}</span>
              <span className="min-w-0 flex-1">{l.text || " "}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-down/10 px-1.5 py-0.5 text-down line-through decoration-down/40">{before || "—"}</span>
          <span className="text-muted-foreground" aria-hidden="true">→</span>
          <span className="rounded-md bg-up/10 px-1.5 py-0.5 text-up">{after || "—"}</span>
        </div>
      )}
    </div>
  );
}

function fmtAbs(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
function fmtRel(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ru }); } catch { return ""; }
}

/** Build the PATCH body that brings a setup back to `snap`. Keeps the current owner (`trader`) intact. */
function restoreBody(snap: Record<string, any>, current?: Record<string, any>) {
  const body: Record<string, unknown> = {
    name: snap.name ?? current?.name,
    folder: snap.folder ?? null,
    setupType: snap.setupType ?? null,
    conditions: snap.conditions ?? null,
    notes: snap.notes ?? null,
    confidenceLevel: snap.confidenceLevel ?? null,
    tags: snap.tags ?? null,
  };
  if (Array.isArray(snap.checklistItems) && snap.checklistItems.length > 0) body.checklistItems = snap.checklistItems;
  else body.checklist = snap.checklist ?? null;
  const owner = current?.trader ?? snap.trader;
  if (owner) body.trader = owner;
  return body;
}

export function PlaybookRevisionsButton({
  playbookId,
  currentSnapshot,
  onRestored,
}: {
  playbookId: number;
  currentSnapshot?: Record<string, any>;
  /** Called after a successful restore (the component already invalidates playbook queries). */
  onRestored?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"edit" | "current">("edit");
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: revisions = [], isLoading, isError, refetch } = useQuery<Revision[]>({
    queryKey: ["playbook-revisions", playbookId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/playbook/${playbookId}/revisions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return Array.isArray(j) ? j : [];
    },
    enabled: open,
  });

  // Each revision snapshot = state BEFORE the edit at createdAt. State after = next newer snapshot or current.
  const timeline = useMemo(() => revisions.map((r, idx) => {
    const after = idx === 0 ? currentSnapshot : revisions[idx - 1]?.snapshot;
    return { rev: r, after, changes: changedFields(r.snapshot, after) };
  }), [revisions, currentSnapshot]);

  useEffect(() => {
    if (open && selectedId == null && timeline.length > 0) setSelectedId(timeline[0].rev.id);
  }, [open, timeline, selectedId]);

  const selIdx = timeline.findIndex((t) => t.rev.id === selectedId);
  const sel = selIdx >= 0 ? timeline[selIdx] : null;
  const compareTo = mode === "edit" ? sel?.after : currentSnapshot;
  const fieldsToShow = sel ? (showAll ? FIELDS : changedFields(sel.rev.snapshot, compareTo)) : [];
  const sameAsCurrent = sel ? changedFields(sel.rev.snapshot, currentSnapshot).length === 0 : true;

  const restore = useMutation({
    mutationFn: async (snap: Record<string, any>) => {
      const r = await fetch(`${BASE}/api/playbook/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody(snap, currentSnapshot)),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playbook"] });
      qc.invalidateQueries({ queryKey: ["playbook-children"] });
      qc.invalidateQueries({ queryKey: ["playbook-revisions", playbookId] });
      qc.invalidateQueries({ queryKey: ["playbook-health"] });
      toast({ title: "Версия восстановлена", description: "Предыдущее состояние сохранено в истории — можно откатить обратно." });
      setConfirm(false);
      setSelectedId(null);
      onRestored?.();
    },
    onError: (e: any) => toast({ title: "Не удалось восстановить", description: String(e?.message ?? "").slice(0, 200) || undefined, variant: "destructive" }),
  });

  function onListKey(e: React.KeyboardEvent) {
    if (!timeline.length) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(timeline.length - 1, (selIdx < 0 ? 0 : selIdx) + (e.key === "ArrowDown" ? 1 : -1)));
    setSelectedId(timeline[next].rev.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-rev="${timeline[next].rev.id}"]`)?.focus();
  }

  return (
    <>
      <IconAction
        aria-label="История изменений"
        title="История изменений"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <History aria-hidden="true" />
      </IconAction>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setSelectedId(null); setMode("edit"); setShowAll(false); } }}>
        <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-4 p-4 sm:p-6">
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <History className="h-4 w-4 text-primary" aria-hidden="true" /> История изменений
              {revisions.length > 0 && (
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {revisions.length} {plural(revisions.length, "правка", "правки", "правок")}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Каждая правка показывает, что изменилось. Любое прежнее состояние можно вернуть — текущее при этом тоже попадёт в историю.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-[240px_1fr]">
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
              <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            </div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Не удалось загрузить историю"
              action={<Button variant="outline" size="sm" onClick={() => refetch()}>Повторить</Button>}
            />
          ) : timeline.length === 0 ? (
            <EmptyState icon={History} title="Правок пока не было" description="После первого редактирования сетапа здесь появится история изменений." />
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,160px)_minmax(0,1fr)] gap-3 sm:grid-cols-[240px_minmax(0,1fr)] sm:grid-rows-1">
              {/* Timeline */}
              <div
                ref={listRef}
                role="listbox"
                aria-label="Правки"
                aria-activedescendant={sel ? `rev-${sel.rev.id}` : undefined}
                onKeyDown={onListKey}
                className="relative min-h-0 overflow-y-auto pr-1"
              >
                <span className="absolute bottom-3 left-[13px] top-3 w-px bg-[var(--glass-border)]" aria-hidden="true" />
                <ol className="relative space-y-1">
                  {timeline.map(({ rev, changes }, idx) => {
                    const active = rev.id === selectedId;
                    return (
                      <li key={rev.id}>
                        <button
                          id={`rev-${rev.id}`}
                          data-rev={rev.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          tabIndex={active || (selIdx < 0 && idx === 0) ? 0 : -1}
                          onClick={() => setSelectedId(rev.id)}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-xl px-1.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "bg-primary/10" : "hover:bg-[var(--glass-hover-bg)]",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1 h-3 w-3 shrink-0 rounded-full border-2",
                              active ? "border-primary bg-primary" : "border-[var(--field-border)] bg-background",
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">{fmtRel(rev.createdAt) || fmtAbs(rev.createdAt)}</span>
                            <span className="block truncate text-xs text-muted-foreground">{fmtAbs(rev.createdAt)} · {rev.trader ?? "система"}</span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {changes.length === 0
                                ? <span className="text-xs text-muted-foreground">без видимых изменений</span>
                                : changes.slice(0, 3).map((c) => <Pill key={c.key} tone="neutral" className="text-xs">{c.label}</Pill>)}
                              {changes.length > 3 && <span className="text-xs text-muted-foreground">+{changes.length - 3}</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* Diff */}
              <div className="flex min-h-0 flex-col gap-3">
                {sel && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Segmented
                        ariaLabel="Режим сравнения"
                        size="sm"
                        value={mode}
                        onChange={(v) => setMode(v as "edit" | "current")}
                        options={[
                          { value: "edit", label: "Что изменила правка" },
                          { value: "current", label: "До правки ↔ сейчас" },
                        ]}
                      />
                      <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                        Все поля
                      </label>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {fieldsToShow.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          {mode === "current" ? "Это состояние совпадает с текущим." : "В отслеживаемых полях изменений нет."}
                        </p>
                      ) : fieldsToShow.map((f) => (
                        <FieldDiff
                          key={f.key}
                          label={f.label}
                          multiline={f.multiline}
                          before={norm(sel.rev.snapshot?.[f.key])}
                          after={norm(compareTo?.[f.key])}
                        />
                      ))}
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--glass-border)] pt-3">
                        <span className="mr-auto text-xs text-muted-foreground">
                          Вернуть состояние до правки от {fmtAbs(sel.rev.createdAt)}
                        </span>
                        <Button size="sm" onClick={() => setConfirm(true)} disabled={sameAsCurrent || restore.isPending}>
                          <RotateCcw aria-hidden="true" /> Восстановить
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={(o) => !restore.isPending && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Восстановить эту версию?</AlertDialogTitle>
            <AlertDialogDescription>
              Название, папка, тип, уверенность, теги, условия, чек-лист и заметки вернутся к состоянию до правки от {sel ? fmtAbs(sel.rev.createdAt) : ""}.
              Текущая версия сохранится в истории. Скриншоты и привязанные сделки не изменятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending || !sel}
              onClick={(e) => { e.preventDefault(); if (sel) restore.mutate(sel.rev.snapshot); }}
            >
              {restore.isPending ? "Восстанавливаю…" : "Восстановить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
