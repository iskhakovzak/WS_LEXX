// /research — archive of the former «Исследования» notes. The section was merged away (Wave I):
// earnings and price reactions live in «Катализаторы» (/events), repeatable patterns in the Playbook.
// Old notes stay readable and can be moved to the Playbook with «В плейбук»; nothing new is written here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListResearch, useUpdateResearch, useDeleteResearch, getListResearchQueryKey,
  type Research, type UpdateResearchBody,
} from "@workspace/api-client-react";
import { AlertTriangle, Archive, ArrowRight, BookMarked, CalendarClock, RefreshCw, Search, X } from "lucide-react";
import { EmptyState, Page, PageHeader, Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useUndoDelete } from "@/hooks/use-undo-delete";
import { UndoToast } from "@/components/undo-toast";
import { BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ResearchFormDialog, formToResearchBody, type ResearchFormData } from "@/components/research/research-form-dialog";
import { ResearchPreview, type UpcomingByTicker } from "@/components/research/research-preview";
import { ResearchRow } from "@/components/research/research-row";
import {
  highlightTerms, isEmptyQuery, matchResearch, parseQuery, splitTags, splitTickers, type ResearchNote, type SearchHit,
} from "@/components/research/research-utils";

const NO_UPCOMING: UpcomingByTicker = new Map();

function readUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    const id = Number(p.get("id"));
    const ticker = (p.get("ticker") ?? "").trim().toUpperCase();
    const q = (p.get("q") ?? "").trim();
    const tag = (p.get("tag") ?? "").trim();
    return {
      id: Number.isInteger(id) && id > 0 ? id : null,
      q: q || (/^[A-Z][A-Z0-9.\-]{0,10}$/.test(ticker) ? `$${ticker}` : tag ? `#${tag}` : ""),
    };
  } catch {
    return { id: null, q: "" };
  }
}

function useIsDesktop() {
  const q = "(min-width: 1024px)";
  const [is, setIs] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setIs(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return is;
}

export default function ResearchArchivePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = useAuth();
  const isDesktop = useIsDesktop();

  const { data: raw = [], isLoading, isError, error, refetch, isFetching } = useListResearch();
  const items = raw as ResearchNote[];

  const [query, setQuery] = useState(() => readUrlParams().q);
  const [selectedId, setSelectedId] = useState<number | null>(() => readUrlParams().id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editing, setEditing] = useState<Research | null>(null);

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: getListResearchQueryKey() }), [qc]);
  const undo = useUndoDelete(invalidate);
  const itemsRef = useRef<ResearchNote[]>([]);
  itemsRef.current = items;
  const onMutErr = (e: unknown) =>
    toast({ title: "Ошибка", description: (e as { data?: { error?: string } })?.data?.error ?? (e as Error)?.message ?? String(e), variant: "destructive" });

  const updateMut = useUpdateResearch({
    mutation: { onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Заметка обновлена" }); }, onError: onMutErr },
  });
  const deleteMut = useDeleteResearch({
    mutation: {
      onSuccess: (_d, vars) => {
        const r = itemsRef.current.find((x) => x.id === vars.id);
        invalidate();
        setSelectedId((cur) => (cur === vars.id ? null : cur));
        setMobileOpen(false);
        undo.scheduleUndo(vars.id, "research", r?.patternName ? `«${r.patternName}»` : `Заметка #${vars.id}`);
      },
      onError: onMutErr,
    },
  });

  const togglePin = useCallback(async (id: number) => {
    if (!canEdit) return;
    const next = !itemsRef.current.find((x) => x.id === id)?.pinned;
    qc.setQueriesData<ResearchNote[]>({ queryKey: getListResearchQueryKey() }, (old) => old?.map((x) => (x.id === id ? { ...x, pinned: next } : x)));
    try {
      const res = await fetch(`${BASE}/api/research/${id}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: next }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      invalidate();
      toast({ title: "Не удалось изменить закрепление", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [canEdit, qc, invalidate, toast]);

  async function saveScreenshotNotes(r: Research, notes: string) {
    try {
      const res = await fetch(`${BASE}/api/research/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screenshotNotes: notes }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidate();
    } catch (err) {
      toast({ title: "Ошибка сохранения", description: String(err), variant: "destructive" });
    }
  }

  const parsed = useMemo(() => parseQuery(query), [query]);
  const searching = !isEmptyQuery(parsed);
  const terms = useMemo(() => highlightTerms(parsed), [parsed]);

  const { list, hits } = useMemo(() => {
    const hits = new Map<number, SearchHit>();
    let list = [...items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt));
    if (searching) {
      list = list.filter((r) => { const h = matchResearch(r, parsed); if (h) hits.set(r.id, h); return !!h; });
      list.sort((a, b) => (hits.get(b.id)?.score ?? 0) - (hits.get(a.id)?.score ?? 0));
    }
    return { list, hits };
  }, [items, searching, parsed]);

  const selected = useMemo(() => items.find((r) => r.id === selectedId) ?? null, [items, selectedId]);
  useEffect(() => {
    if (!isDesktop || isLoading) return;
    if (selectedId != null && list.some((r) => r.id === selectedId)) return;
    setSelectedId(list[0]?.id ?? null);
  }, [isDesktop, isLoading, list, selectedId]);

  const related = useMemo(() => {
    if (!selected) return [];
    const ts = splitTickers(selected.ticker);
    const tags = splitTags(selected.tags);
    return items
      .filter((r) => r.id !== selected.id)
      .map((r) => ({ r, s: splitTickers(r.ticker).filter((t) => ts.includes(t)).length * 3 + splitTags(r.tags).filter((t) => tags.includes(t)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  }, [selected, items]);

  const select = useCallback((id: number) => {
    setSelectedId(id);
    if (!window.matchMedia("(min-width: 1024px)").matches) setMobileOpen(true);
  }, []);

  function handleSubmit(f: ResearchFormData) {
    const body = formToResearchBody(f);
    if (!body.patternName || !editing) return;
    updateMut.mutate({ id: editing.id, data: body as UpdateResearchBody });
  }

  const previewProps = selected
    ? {
        r: selected,
        terms,
        pinned: !!selected.pinned,
        related,
        upcoming: NO_UPCOMING,
        onTogglePin: () => togglePin(selected.id),
        onEdit: () => (canEdit ? setEditing(selected) : undefined),
        onDelete: () => deleteMut.mutate({ id: selected.id }),
        onSelect: select,
        onSaveScreenshotNotes: (n: string) => saveScreenshotNotes(selected, n),
      }
    : null;

  return (
    <Page>
      <PageHeader
        icon={Archive}
        title="Архив исследований"
        description="Старые заметки остаются здесь для чтения. Новое пишется в Плейбуке, отчёты и реакции — в Катализаторах."
      />

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm text-foreground">
            Раздел объединён. <span className="text-muted-foreground">Если заметка описывает повторяемый сетап — перенесите её кнопкой «В плейбук» в карточке справа.</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/events"><CalendarClock className="h-4 w-4" /> Катализаторы <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/playbook"><BookMarked className="h-4 w-4" /> Плейбук <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-[var(--grid-gap)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel padded={false} title="Заметки" description={isLoading ? "Загрузка…" : searching ? `Найдено ${list.length} из ${items.length}` : `${items.length} в архиве`}>
          {items.length > 3 && (
            <div className="relative px-[var(--panel-p)] pt-3">
              <Search className="pointer-events-none absolute left-[calc(var(--panel-p)+0.875rem)] top-1/2 mt-1.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: слова, #тег, $TICKER" aria-label="Поиск по архиву" className="pl-10 pr-10" />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск" className="absolute right-[calc(var(--panel-p)+0.375rem)] top-1/2 mt-1.5 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <div className="flex min-h-[200px] flex-col gap-0.5 px-2 pb-3 pt-3 lg:max-h-[calc(100vh-16rem)] lg:overflow-y-auto">
            {isLoading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 px-2 py-2">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-3 w-full rounded-full" />
              </div>
            ))}
            {isError && !isLoading && (
              <EmptyState
                icon={AlertTriangle}
                title="Не удалось загрузить архив"
                description={(error as { message?: string } | null)?.message ?? ""}
                action={<Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Повторить</Button>}
              />
            )}
            {!isLoading && !isError && list.length === 0 && (
              items.length ? (
                <EmptyState compact icon={Search} title="Ничего не найдено" description="Попробуйте другие слова." />
              ) : (
                <EmptyState icon={Archive} title="Архив пуст" description="Паттерны записывайте в Плейбук, отчёты и реакции смотрите в Катализаторах." />
              )
            )}
            {list.map((r) => (
              <ResearchRow
                key={r.id}
                r={r}
                selected={isDesktop && r.id === selectedId}
                pinned={!!r.pinned}
                terms={terms}
                hit={hits.get(r.id)}
                upcoming={NO_UPCOMING}
                showDate
                onSelect={select}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        </Panel>

        {isDesktop && (
          <Panel className="sticky-top hidden lg:block" bodyClassName="lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            {previewProps ? (
              <ResearchPreview key={previewProps.r.id} {...previewProps} />
            ) : isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-2/3 rounded-full" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            ) : (
              <EmptyState icon={Archive} title="Выберите заметку" description="Здесь появится полный текст и кнопка «В плейбук»." />
            )}
          </Panel>
        )}
      </div>

      {!isDesktop && (
        <Sheet open={mobileOpen && !!previewProps} onOpenChange={setMobileOpen}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl px-4 pb-8 pt-10">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected?.patternName ?? "Заметка"}</SheetTitle>
              <SheetDescription>Просмотр заметки</SheetDescription>
            </SheetHeader>
            {previewProps && <ResearchPreview key={previewProps.r.id} {...previewProps} />}
          </SheetContent>
        </Sheet>
      )}

      <ResearchFormDialog
        open={!!editing}
        editing={editing}
        initial={null}
        saving={updateMut.isPending}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSubmit={handleSubmit}
      />

      {undo.pending && (
        <UndoToast key={undo.pending.id} label={undo.pending.label} onUndo={undo.restore} onDismiss={undo.dismiss} restoring={undo.restoring} actionText="удалена" />
      )}
    </Page>
  );
}
