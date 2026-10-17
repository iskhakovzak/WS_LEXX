import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, History, Loader2, Send, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { gpApi, gpKeys, type GamePlan, type GamePlanResponse } from "./types";
import { fmtDate } from "@/lib/format";
import { applyTemplate, docToDraft, draftToDoc, isDraftEmpty, sameDoc, validateDraft, type DraftErrors, type PlanDraft } from "./plan-draft";
import { PlanEditor, type SetDraft } from "./plan-editor";
import { TemplateMenu } from "./plan-templates";
import { shortDay } from "./plan-briefing";

/* Local draft autosave for the desk plan (publishing stays explicit — traders get the plan only on «Опубликовать»). */
type LocalDraft = { v: 1; draft: PlanDraft; savedAt: string; baseUpdatedAt: string | null };
const draftKey = (date: string) => `gp.draft.desk.${date}`;
function readLocal(date: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(date));
    if (!raw) return null;
    const v = JSON.parse(raw) as LocalDraft;
    return v && v.v === 1 && v.draft && Array.isArray(v.draft.inPlay) ? v : null;
  } catch {
    return null;
  }
}
function writeLocal(date: string, v: LocalDraft | null) {
  try {
    if (v) window.localStorage.setItem(draftKey(date), JSON.stringify(v));
    else window.localStorage.removeItem(draftKey(date));
  } catch {
    /* storage unavailable — autosave silently off */
  }
}

export function PlanEditorSheet({
  open,
  onOpenChange,
  date,
  plan,
  prevDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: string;
  plan: GamePlan | null;
  prevDate: string | null;
}) {
  const qc = useQueryClient();
  const [base, setBase] = useState<PlanDraft>(() => docToDraft(plan));
  const [draft, setDraftState] = useState<PlanDraft>(base);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [restore, setRestore] = useState<LocalDraft | null>(null);
  const [localSavedAt, setLocalSavedAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copying, setCopying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  // Fresh state each time the sheet opens (or the day changes while open); offer an unsaved local draft.
  useEffect(() => {
    if (!open) return;
    const b = docToDraft(plan);
    setBase(b);
    setDraftState(b);
    setErrors({});
    setLocalSavedAt(null);
    touched.current = false;
    const local = readLocal(date);
    setRestore(local && !sameDoc(local.draft, b) && !isDraftEmpty(local.draft) ? local : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  const setDraft: SetDraft = useCallback((fn) => {
    touched.current = true;
    setDraftState(fn);
  }, []);

  // Debounced local autosave.
  useEffect(() => {
    if (!open || !touched.current) return;
    const t = window.setTimeout(() => {
      if (sameDoc(draft, base)) {
        writeLocal(date, null);
        setLocalSavedAt(null);
        return;
      }
      const savedAt = new Date().toISOString();
      writeLocal(date, { v: 1, draft, savedAt, baseUpdatedAt: plan?.updatedAt ?? null });
      setLocalSavedAt(savedAt);
    }, 700);
    return () => window.clearTimeout(t);
  }, [draft, base, open, date, plan?.updatedAt]);

  // Clear stale field errors as the user fixes them.
  useEffect(() => {
    if (Object.keys(errors).length) setErrors(validateDraft(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const dirty = !sameDoc(draft, base);

  const save = useMutation({
    mutationFn: () => gpApi.save(date, draftToDoc(draft)),
    onSuccess: (saved) => {
      writeLocal(date, null);
      qc.setQueryData<GamePlanResponse>(gpKeys.day(date), (prev) => (prev ? { ...prev, plan: saved } : prev));
      qc.invalidateQueries({ queryKey: gpKeys.day(date) });
      qc.invalidateQueries({ queryKey: gpKeys.history });
      qc.invalidateQueries({ queryKey: gpKeys.reads(saved.id) });
      toast({ title: plan ? "План обновлён" : "План опубликован", description: shortDay(date) });
      onOpenChange(false);
    },
    onError: (err) => toast({ title: "Не удалось опубликовать", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: () => gpApi.remove(date),
    onSuccess: () => {
      writeLocal(date, null);
      qc.invalidateQueries({ queryKey: ["game-plan"] });
      toast({ title: "План снят с публикации" });
      onOpenChange(false);
    },
    onError: (err) => toast({ title: "Не удалось удалить", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  function publish() {
    if (save.isPending) return;
    const errs = validateDraft(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast({ title: "Проверьте поля", description: Object.values(errs)[0], variant: "destructive" });
      requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>("[aria-invalid=true], [role=alert]")?.scrollIntoView({ block: "center" }));
      return;
    }
    save.mutate();
  }

  async function copyPrev() {
    if (!prevDate) return;
    setCopying(true);
    try {
      const r = await gpApi.day(prevDate);
      if (!r.plan) throw new Error("План не найден");
      const prev = docToDraft(r.plan);
      setDraft(() => prev);
      toast({ title: "Скопировано", description: `План от ${shortDay(prevDate)} — проверьте уровни и катализаторы` });
    } catch (err) {
      toast({ title: "Не удалось скопировать", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setCopying(false);
    }
  }

  function close(next: boolean) {
    if (!next && dirty && !save.isPending) {
      // The draft is already in localStorage — closing never loses work.
      writeLocal(date, { v: 1, draft, savedAt: new Date().toISOString(), baseUpdatedAt: plan?.updatedAt ?? null });
      toast({ title: "Черновик сохранён", description: "Он останется на этом устройстве до публикации" });
    }
    onOpenChange(next);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={close}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              publish();
            }
          }}
        >
          <SheetHeader className="border-b border-border px-[var(--panel-p)] pb-3 pt-[var(--panel-p)] text-left">
            <SheetTitle className="pr-10">
              {plan ? "План деска" : "Новый план деска"} · {shortDay(date)}
            </SheetTitle>
            <SheetDescription>Ctrl+V — вставить скриншот в блок, где стоит курсор. Черновик сохраняется сам.</SheetDescription>
          </SheetHeader>

          {restore && (
            <div role="status" className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/8 px-[var(--panel-p)] py-2 text-sm">
              <History className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Несохранённый черновик от {fmtDate(restore.savedAt, "time")}
                {restore.baseUpdatedAt && plan && restore.baseUpdatedAt !== plan.updatedAt ? " — план с тех пор менялся" : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(() => restore.draft);
                  setRestore(null);
                }}
              >
                Восстановить
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  writeLocal(date, null);
                  setRestore(null);
                }}
              >
                Отбросить
              </Button>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-[var(--panel-p)] pb-[var(--panel-p)] pt-2">
            <PlanEditor
              mode="desk"
              date={date}
              draft={draft}
              setDraft={setDraft}
              errors={errors}
              navSlot={
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={copyPrev} disabled={!prevDate || copying} title={prevDate ? `Скопировать план от ${shortDay(prevDate)}` : "Нет прошлого плана"}>
                    {copying ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {prevDate ? `Как ${shortDay(prevDate)}` : "Копировать"}
                  </Button>
                  <TemplateMenu kind="desk" currentDoc={() => draftToDoc(draft)} onApply={(doc, name) => {
                    setDraft((d) => applyTemplate(d, doc));
                    toast({ title: `Шаблон «${name}»`, description: "Заполнены только пустые блоки" });
                  }} />
                </>
              }
            />
          </div>

          <div className="flex items-center gap-2 border-t border-border px-[var(--panel-p)] py-3">
            {plan && (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                Снять
              </Button>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {localSavedAt ? `Черновик · ${fmtDate(localSavedAt, "time")}` : dirty ? "" : plan ? "Без изменений" : ""}
            </span>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Закрыть
            </Button>
            <Button type="button" className="bg-primary-solid" onClick={publish} disabled={save.isPending || (!!plan && !dirty)} title="Ctrl+Enter">
              {save.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}
              {plan ? "Обновить" : "Опубликовать"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять план на {shortDay(date)}?</AlertDialogTitle>
            <AlertDialogDescription>Трейдеры перестанут видеть брифинг. Отметки о прочтении сохранятся в истории.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} disabled={remove.isPending}>
              Снять план
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
