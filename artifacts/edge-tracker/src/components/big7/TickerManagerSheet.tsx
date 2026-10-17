import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateBig7Ticker, useDeleteBig7Ticker, useBulkCreateBig7Tickers, useUpdateBig7Ticker, getListBig7TickersQueryKey,
} from "@workspace/api-client-react";
import type { Big7Ticker } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, ClipboardPaste, Flame, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, Pill, Segmented } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { canModifyOwned, createdByOf } from "@/lib/ownership";
import { pluralRu } from "@/components/rules/constants";
import { DEFAULT_BIG7, big7Today, parseTickerSymbols } from "./lib";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SYM_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Seeds the default Big 7 through POST /big7/tickers (idempotent: existing rows are returned as-is). */
export function useSeedBig7() {
  const qc = useQueryClient();
  const createM = useCreateBig7Ticker();
  const { toast } = useToast();
  const [seeding, setSeeding] = useState(false);
  const seed = async (existing: string[] = []) => {
    if (seeding) return;
    setSeeding(true);
    const todo = DEFAULT_BIG7.map((t, i) => ({ ...t, position: i })).filter((t) => !existing.includes(t.symbol));
    let ok = 0;
    const failed: string[] = [];
    for (const t of todo) {
      try {
        await createM.mutateAsync({ data: { symbol: t.symbol, name: t.name, exchange: t.exchange, groupName: "core", position: t.position } });
        ok++;
      } catch {
        failed.push(t.symbol);
      }
    }
    await qc.invalidateQueries({ queryKey: getListBig7TickersQueryKey() });
    setSeeding(false);
    if (failed.length) toast({ title: `Добавлено ${ok}, ошибки: ${failed.join(", ")}`, variant: "destructive" });
    else toast({ title: ok ? `Big 7 загружены (${ok})` : "Все Big 7 уже на доске" });
  };
  return { seed, seeding };
}

export function TickerManagerSheet({
  open, onOpenChange, tickers, hotSymbols, onHotChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tickers: Big7Ticker[];
  hotSymbols: string[];
  onHotChange: (syms: string[]) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createM = useCreateBig7Ticker();
  const deleteM = useDeleteBig7Ticker();
  const { user, isCurator } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  // Reordering patches every row's position (other authors' rows too) → staff only; delete → author or staff.
  const bulkM = useBulkCreateBig7Tickers();
  const updateM = useUpdateBig7Ticker();
  const { seed, seeding } = useSeedBig7();
  const [group, setGroup] = useState<"core" | "hot">("core");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkDel, setBulkDel] = useState("");
  const [reordering, setReordering] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: getListBig7TickersQueryKey() });

  const core = useMemo(() => tickers.filter((t) => t.groupName === "core"), [tickers]);
  const coreSyms = core.map((t) => t.symbol);
  const missingDefaults = DEFAULT_BIG7.filter((d) => !coreSyms.includes(d.symbol));
  const preview = useMemo(() => parseTickerSymbols(bulkText), [bulkText]);
  const previewDel = useMemo(() => parseTickerSymbols(bulkDel), [bulkDel]);

  const addOne = async () => {
    const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
    if (!sym) return;
    if (!SYM_RE.test(sym)) { toast({ title: "Некорректный тикер", description: sym, variant: "destructive" }); return; }
    if (group === "hot") {
      if (!hotSymbols.includes(sym)) onHotChange([...hotSymbols, sym]);
      setSymbol("");
      return;
    }
    try {
      await createM.mutateAsync({ data: { symbol: sym, name: name.trim() || sym, groupName: "core", position: core.length } });
      await invalidate();
      setSymbol(""); setName("");
    } catch (e) {
      toast({ title: "Не удалось добавить тикер", description: errMsg(e), variant: "destructive" });
    }
  };

  const addBulk = async () => {
    if (!preview.length) { toast({ title: "Нет валидных тикеров", variant: "destructive" }); return; }
    if (group === "hot") {
      const add = preview.filter((s) => !hotSymbols.includes(s));
      onHotChange([...hotSymbols, ...add]);
      toast({ title: `Добавлено ${add.length}`, description: preview.length > add.length ? `Уже были: ${preview.filter((s) => hotSymbols.includes(s)).join(", ")}` : "В Hot" });
      setBulkText("");
      return;
    }
    try {
      const r = await bulkM.mutateAsync({ data: { symbols: preview, groupName: "core" } });
      await invalidate();
      toast({ title: `Добавлено ${r.added.length}`, description: r.skipped?.length ? `Уже были: ${r.skipped.join(", ")}` : "В Big 7" });
      setBulkText("");
    } catch (e) {
      toast({ title: "Ошибка пакетного добавления", description: errMsg(e), variant: "destructive" });
    }
  };

  const removeCore = async (t: Big7Ticker) => {
    if (!window.confirm(`Удалить ${t.symbol} из Big 7 для всей команды?`)) return;
    try {
      await deleteM.mutateAsync({ id: t.id });
      await invalidate();
    } catch (e) {
      toast({ title: "Не удалось удалить", description: errMsg(e), variant: "destructive" });
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= core.length || reordering) return;
    const order = [...core];
    [order[idx], order[j]] = [order[j], order[idx]];
    setReordering(true);
    try {
      await Promise.all(order.map((t, i) => (t.position !== i ? updateM.mutateAsync({ id: t.id, data: { position: i } }) : null)));
      await invalidate();
    } catch (e) {
      toast({ title: "Не удалось изменить порядок", description: errMsg(e), variant: "destructive" });
    } finally {
      setReordering(false);
    }
  };

  const bulkDelete = () => {
    const del = new Set(previewDel);
    const hit = hotSymbols.filter((s) => del.has(s));
    onHotChange(hotSymbols.filter((s) => !del.has(s)));
    toast({ title: `Удалено ${hit.length}`, description: hit.length ? hit.join(", ") : "Совпадений нет" });
    setBulkDel("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Тикеры доски</SheetTitle>
          <SheetDescription>Big 7 — общий список команды. Hot — ваши горячие тикеры на сегодня ({big7Today()}), сбрасываются каждый день.</SheetDescription>
        </SheetHeader>

        <Segmented
          ariaLabel="Группа"
          value={group}
          onChange={setGroup}
          options={[
            { value: "core", label: <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" aria-hidden="true" />Big 7</span>, count: core.length },
            { value: "hot", label: <span className="inline-flex items-center gap-1"><Flame className="h-3.5 w-3.5" aria-hidden="true" />Hot</span>, count: hotSymbols.length },
          ]}
        />

        {group === "core" && missingDefaults.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm">
            <span className="min-w-0">Нет в списке: {missingDefaults.map((d) => d.symbol).join(", ")}</span>
            <Button size="sm" variant="outline" disabled={seeding} onClick={() => seed(coreSyms)}>
              {seeding && <Loader2 className="animate-spin" />} Добавить
            </Button>
          </div>
        )}

        <ul className="space-y-1">
          {group === "core" && core.length === 0 && <EmptyState icon={Star} title="Список пуст" description="Добавьте тикеры ниже или загрузите стандартные Big 7." className="py-6" />}
          {group === "hot" && hotSymbols.length === 0 && <EmptyState icon={Flame} title="Hot пуст" description="Горячие имена дня: гэпы, новости, отчёты." className="py-6" />}
          {group === "core" && core.map((t, i) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[var(--glass-hover-bg)]">
              <span className="w-14 text-sm font-semibold">{t.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.name !== t.symbol ? t.name : ""} <span className="opacity-80">{t.exchange}</span></span>
              {isCurator && <button type="button" aria-label={`Выше: ${t.symbol}`} disabled={i === 0 || reordering} onClick={() => move(i, -1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></button>}
              {isCurator && <button type="button" aria-label={`Ниже: ${t.symbol}`} disabled={i === core.length - 1 || reordering} onClick={() => move(i, 1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></button>}
              {canModifyOwned(createdByOf(t), me, isCurator) && <button type="button" aria-label={`Удалить ${t.symbol}`} disabled={deleteM.isPending} onClick={() => removeCore(t)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-down/15 hover:text-down disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
            </li>
          ))}
          {group === "hot" && hotSymbols.map((s) => (
            <li key={s} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[var(--glass-hover-bg)]">
              <span className="w-14 text-sm font-semibold">{s}</span>
              <span className="flex-1 text-xs text-muted-foreground">сегодня</span>
              <button type="button" aria-label={`Удалить ${s}`} onClick={() => onHotChange(hotSymbols.filter((x) => x !== s))} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-down/15 hover:text-down"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addOne(); }}>
          <Input aria-label="Тикер" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="Тикер" className="w-28 uppercase" />
          {group === "core" && <Input aria-label="Название" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название (необязательно)" className="min-w-0 flex-1" />}
          <Button type="submit" variant="outline" disabled={!symbol.trim() || createM.isPending} className="shrink-0"><Plus /> Добавить</Button>
        </form>

        <Collapsible>
          <CollapsibleTrigger className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> Добавить пачкой
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <Textarea aria-label="Тикеры для добавления" value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={3} placeholder={"AAPL MSFT NVDA\nTSLA, AMD\n$PLTR"} />
            {preview.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {preview.slice(0, 30).map((s) => <Pill key={s} tone="accent">{s}</Pill>)}
                {preview.length > 30 && <Pill>+{preview.length - 30}</Pill>}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{preview.length ? `${preview.length} ${pluralRu(preview.length, "тикер", "тикера", "тикеров")}` : "Через пробел, запятую или перенос"}</span>
              <Button size="sm" onClick={addBulk} disabled={!preview.length || bulkM.isPending}>{bulkM.isPending ? "Добавляем…" : `Добавить ${preview.length}`}</Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {group === "hot" && hotSymbols.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-down">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить пачкой / очистить
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <Textarea aria-label="Тикеры для удаления" value={bulkDel} onChange={(e) => setBulkDel(e.target.value)} rows={2} placeholder="AAPL MSFT" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="ghost" className="text-down" onClick={() => { if (window.confirm(`Очистить Hot (${hotSymbols.length})?`)) { onHotChange([]); toast({ title: "Hot очищен" }); } }}>Очистить всё</Button>
                <Button size="sm" variant="destructive" disabled={!previewDel.length} onClick={bulkDelete}>
                  Удалить {previewDel.filter((s) => hotSymbols.includes(s)).length}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </SheetContent>
    </Sheet>
  );
}
