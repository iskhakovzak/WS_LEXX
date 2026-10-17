import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { http } from "@/lib/api/http";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, Segmented } from "@/components/ds";
import { pluralRu } from "@/lib/format";

type Draft = { text: string; on: boolean; dup: boolean };

function splitLines(s: string | null | undefined): string[] {
  return (s ?? "").split("\n").map((l) => l.replace(/^[\s\-*•]+/, "").replace(/^\d+[.)]\s+/, "").trim()).filter(Boolean);
}
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}%<>=]+/gu, " ").trim();

/**
 * AI checklist generator. Shows a preview where items can be edited / deselected, then either
 * merges them into the current checklist (default when one exists) or replaces it.
 */
export function PlaybookGenerateChecklistButton({
  playbookId,
  onGenerated,
  conditions,
  notes,
  currentChecklist,
}: {
  playbookId: number | null;
  onGenerated: (checklist: string) => void;
  conditions?: string;
  notes?: string;
  /** Current checklist text in the form. Enables "add to current" merge mode. */
  currentChecklist?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [current, setCurrent] = useState<string[]>([]);

  function readCurrent(): string[] {
    if (currentChecklist !== undefined) return splitLines(currentChecklist);
    // Fallback for callers that don't pass currentChecklist yet: read the form's checklist textarea (read-only).
    try {
      const el = document.getElementById("pb-checklist") as HTMLTextAreaElement | null;
      return splitLines(el?.value);
    } catch {
      return [];
    }
  }

  const mut = useMutation({
    mutationFn: async () => {
      if (!playbookId) throw new Error("Сначала сохраните сетап");
      return http.post<{ checklist: string }>(`/api/playbook/${playbookId}/generate-checklist`, { conditions: conditions || null, notes: notes || null });
    },
    onSuccess: (d) => {
      const cur = readCurrent();
      const curKeys = new Set(cur.map(key));
      const seen = new Set<string>();
      const items: Draft[] = [];
      for (const t of splitLines(d?.checklist)) {
        const k = key(t);
        if (seen.has(k)) continue;
        seen.add(k);
        const dup = curKeys.has(k);
        items.push({ text: t, on: !dup, dup });
      }
      if (items.length === 0) {
        toast({ title: "AI не вернул пунктов", description: "Заполните условия входа подробнее и попробуйте ещё раз.", variant: "destructive" });
        return;
      }
      setCurrent(cur);
      setDrafts(items);
      setMode(cur.length > 0 ? "merge" : "replace");
      setOpen(true);
    },
    onError: (e: any) => toast({ title: "Не удалось сгенерировать", description: humanizeApiError(e, "Ошибка генерации"), variant: "destructive" }),
  });

  const selected = drafts.filter((d) => d.on && d.text.trim());
  const result = mode === "merge"
    ? [...current, ...selected.filter((d) => !d.dup).map((d) => d.text.trim())]
    : selected.map((d) => d.text.trim());

  function apply() {
    if (result.length === 0) return;
    onGenerated(result.join("\n"));
    setOpen(false);
    toast({
      title: mode === "merge" ? "Пункты добавлены в чек-лист" : "Чек-лист заменён",
      description: "Изменения попадут в сетап после сохранения формы.",
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !playbookId}
        title={playbookId ? "Сгенерировать чек-лист из условий входа и заметок" : "Доступно после сохранения сетапа"}
        className="min-h-8 px-3"
      >
        <Sparkles className={cn("text-[hsl(var(--chart-5))]", mut.isPending && "motion-safe:animate-pulse")} aria-hidden="true" />
        {mut.isPending ? "Генерирую…" : "AI чек-лист"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[85vh] max-w-xl flex-col gap-4 p-4 sm:p-6"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } }}
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-[hsl(var(--chart-5))]" aria-hidden="true" /> Предпросмотр AI чек-листа
            </DialogTitle>
            <DialogDescription className="text-xs">
              Отметьте нужные пункты и при необходимости поправьте формулировку. Ничего не изменится, пока вы не нажмёте «Применить».
            </DialogDescription>
          </DialogHeader>

          {current.length > 0 && (
            <Segmented
              ariaLabel="Как применить"
              size="sm"
              value={mode}
              onChange={(v) => setMode(v as "merge" | "replace")}
              options={[
                { value: "merge", label: `Добавить к текущим (${current.length})` },
                { value: "replace", label: "Заменить чек-лист" },
              ]}
            />
          )}

          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" aria-label="Сгенерированные пункты">
            {drafts.map((d, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors",
                  d.on ? "border-[var(--glass-border)] bg-[var(--glass-bg)]" : "border-transparent opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={d.on}
                  onChange={(e) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                  aria-label={`Включить пункт ${i + 1}`}
                  className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                />
                <input
                  type="text"
                  value={d.text}
                  onChange={(e) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  aria-label={`Текст пункта ${i + 1}`}
                  className="min-h-8 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {d.dup && <Pill tone="neutral" className="shrink-0">уже есть</Pill>}
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            {mode === "merge" && current.length > 0
              ? <>Итог: {current.length} текущих + {selected.filter((d) => !d.dup).length} новых = <span className="font-medium text-foreground tabular-nums">{result.length}</span> {pluralRu(result.length, "пункт", "пункта", "пунктов")}</>
              : <>Итог: <span className="font-medium text-foreground tabular-nums">{result.length}</span> {pluralRu(result.length, "пункт", "пункта", "пунктов")}{current.length > 0 && <span className="text-down"> · текущие {current.length} будут удалены</span>}</>}
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending} className="sm:mr-auto">
              <RefreshCw className={cn(mut.isPending && "motion-safe:animate-spin")} aria-hidden="true" /> Сгенерировать заново
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="button" size="sm" onClick={apply} disabled={result.length === 0} title="Ctrl+Enter">
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
