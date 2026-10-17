/**
 * «Добавить примеры» — picks example trades for a setup from the trader's own (auto-imported) trades.
 * Filters: ticker, dates, result, «подходит по автоклассификации»; multi-select (Shift — range); one tier + note for
 * the batch. POST /api/playbook/:id/examples { tradeIds, tier, note } (re-adding updates tier/note).
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, FilterChip, Pill, Segmented, SortableTh, toneText, useTableSort } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { invalidateExamples, invalidateTradeLinks, notLiveMessage, pbRequest, useTradePicker } from "./api";
import { TIERS, ddmm, fmtR, fmtUsd, moneyTone, type PickerTrade, type PlaybookEntry, type Tier } from "./model";
import { REDACTED_HINT, RedactedHint } from "./setup-bits";
import { pluralRu } from "@/components/rules/constants";
import { PersonSelect } from "@/components/people/person-select";

type Period = "30" | "90" | "365" | "all";
type PickKey = "ticker" | "date" | "trader" | "auto" | "setup" | "net";
/** Net column: $ for own trades, R for someone else's (redacted) — sorted by what the cell shows. */
const PICK_ACCESSORS: Record<PickKey, (t: PickerTrade) => number | string | null | undefined> = {
  ticker: (t) => t.ticker,
  date: (t) => t.closeDate ?? t.date,
  trader: (t) => t.trader,
  auto: (t) => (t.autoSetup ? `${t.autoMatch ? 0 : 1}${t.autoSetup}` : null),
  setup: (t) => (t.inSetup ? "0" : t.linkedHere ? "1" : t.playbookName ?? null),
  net: (t) => (t.redacted ? t.signedR : t.netPnl),
};

export function TradePickerDialog({
  open, onOpenChange, entry,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: PlaybookEntry;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, isCurator, dbUsers } = useAuth();
  const [q, setQ] = React.useState("");
  const [debQ, setDebQ] = React.useState("");
  const [period, setPeriod] = React.useState<Period>("90");
  const [result, setResult] = React.useState<"" | "win" | "loss">("");
  const [match, setMatch] = React.useState(false);
  const [trader, setTrader] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [tier, setTier] = React.useState<Tier>(1);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const lastClicked = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setNote("");
    setTier(1);
    setTrader(isCurator ? "" : user?.traderName ?? "");
  }, [open, isCurator, user?.traderName]);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebQ(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const today = nyDate();
  const from = period === "all" ? undefined : addDays(today, -Number(period));
  const pick = useTradePicker({ setupId: entry.id, trader: trader || null, q: debQ, from, result, match }, open);
  const fetched = React.useMemo(() => pick.data?.trades ?? [], [pick.data]);
  const { rows: trades, thProps } = useTableSort<PickerTrade, PickKey>(fetched, PICK_ACCESSORS, "date", "desc", { ticker: "asc", trader: "asc", auto: "asc", setup: "asc" });
  const selectable = trades.filter((t) => !t.inSetup);
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));

  function toggle(t: PickerTrade, shift: boolean) {
    if (t.inSetup) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(t.id);
      if (shift && lastClicked.current != null) {
        const a = trades.findIndex((x) => x.id === lastClicked.current);
        const b = trades.findIndex((x) => x.id === t.id);
        if (a >= 0 && b >= 0) {
          for (const x of trades.slice(Math.min(a, b), Math.max(a, b) + 1)) if (!x.inSetup) on ? next.add(x.id) : next.delete(x.id);
          return next;
        }
      }
      on ? next.add(t.id) : next.delete(t.id);
      return next;
    });
    lastClicked.current = t.id;
  }

  async function save() {
    if (!selected.size || saving) return;
    setSaving(true);
    try {
      const r = await pbRequest<{ examples: unknown[]; skipped: unknown[]; linked: number }>(`/api/playbook/${entry.id}/examples`, {
        method: "POST",
        json: { tradeIds: [...selected], tier, note: note.trim() || null },
      });
      invalidateExamples(qc, entry.id);
      if (r.linked) invalidateTradeLinks(qc);
      const n = r.examples?.length ?? selected.size;
      toast({
        title: `${n} ${pluralRu(n, "сделка добавлена", "сделки добавлены", "сделок добавлено")} в эталоны`,
        description: [TIERS.find((t) => t.tier === tier)?.label, r.skipped?.length ? `пропущено ${r.skipped.length}` : ""].filter(Boolean).join(" · "),
      });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Не удалось добавить примеры", description: notLiveMessage(e) ?? (e as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const traders = React.useMemo(() => dbUsers.filter((u) => u.active !== false && !u.banned).map((u) => u.name), [dbUsers]);
  const liveError = pick.isError ? notLiveMessage(pick.error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85dvh] max-w-5xl flex-col gap-4"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
      >
        <DialogHeader>
          <DialogTitle>Добавить примеры · {entry.name}</DialogTitle>
          <DialogDescription>Выберите сделки, которые показывают сетап. Подходящие по автоклассификации отмечены значком.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="Тикер" aria-label="Фильтр по тикеру" className="h-9 pl-9" />
          </div>
          <Segmented<Period>
            ariaLabel="Период"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[{ value: "30", label: "30 дн" }, { value: "90", label: "90 дн" }, { value: "365", label: "Год" }, { value: "all", label: "Всё" }]}
          />
          <Segmented<"" | "win" | "loss">
            ariaLabel="Результат"
            size="sm"
            value={result}
            onChange={setResult}
            options={[{ value: "", label: "Все" }, { value: "win", label: "Плюс" }, { value: "loss", label: "Минус" }]}
          />
          <FilterChip active={match} onClick={() => setMatch((v) => !v)} className="min-h-8 px-3 text-xs">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Подходят по сетапу
          </FilterChip>
          {isCurator && (
            <PersonSelect value={trader || ""} onValueChange={setTrader} options={traders} allLabel="Все трейдеры" ariaLabel="Трейдер" className="h-9 w-44" />
          )}
        </div>

        <div className="min-h-[320px] flex-1 overflow-auto rounded-xl border border-border/60">
          {pick.isLoading ? (
            <div className="flex flex-col gap-1 p-2" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-[var(--glass-bg)] motion-reduce:animate-none" />)}
            </div>
          ) : pick.isError ? (
            <EmptyState icon={Search} title={liveError ?? "Не удалось загрузить сделки"} description={liveError ? "Подбор сделок появится после перезапуска API." : (pick.error as Error)?.message} />
          ) : trades.length === 0 ? (
            <EmptyState
              icon={Search}
              title={period === "all" ? "Сделок не найдено" : `За ${period === "365" ? "год" : `${period} дней`} сделок не найдено`}
              description={period === "all" ? "Измените тикер или снимите фильтр «Подходят по сетапу»." : "Сделки старше периода не показаны. Расширьте период, измените тикер или снимите фильтр «Подходят по сетапу»."}
              action={period !== "all" ? <Button variant="outline" onClick={() => setPeriod("all")}>Показать за всё время</Button> : undefined}
            />
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-raised bg-surface-solid text-xs text-muted-foreground [&_th]:font-medium">
                <tr className="border-b border-border/60">
                  <th className="w-10 px-3 py-2 text-left">
                    <Checkbox
                      aria-label={allSelected ? "Снять выбор" : "Выбрать все"}
                      checked={allSelected}
                      onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.id)))}
                    />
                  </th>
                  <SortableTh {...thProps("ticker")} className="px-2 py-2">Тикер</SortableTh>
                  <SortableTh {...thProps("date")} className="px-2 py-2">Дата</SortableTh>
                  {isCurator && <SortableTh {...thProps("trader")} className="px-2 py-2">Трейдер</SortableTh>}
                  <SortableTh {...thProps("auto")} className="px-2 py-2">Автоклассификация</SortableTh>
                  <SortableTh {...thProps("setup")} className="px-2 py-2">Сетап сейчас</SortableTh>
                  <SortableTh {...thProps("net")} align="right" className="px-3 py-2">Нетто</SortableTh>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const on = selected.has(t.id);
                  return (
                    <tr
                      key={t.id}
                      onClick={(e) => toggle(t, e.shiftKey)}
                      aria-disabled={t.inSetup || undefined}
                      className={cn(
                        "cursor-pointer border-b border-border/40 last:border-0 hover:bg-[var(--glass-hover-bg)]",
                        on && "bg-primary/5",
                        t.inSetup && "cursor-default opacity-60",
                      )}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`${t.ticker} ${ddmm(t.closeDate ?? t.date)}`}
                          checked={on || t.inSetup}
                          disabled={t.inSetup}
                          onCheckedChange={() => toggle(t, false)}
                        />
                      </td>
                      <td className="px-2 py-2 font-semibold text-foreground">
                        {t.ticker}
                        {t.side && <span className={cn("ml-1.5 text-xs font-normal", t.side.toLowerCase().startsWith("s") ? "text-down" : "text-up")}>{t.side.toLowerCase().startsWith("s") ? "S" : "L"}</span>}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground">{ddmm(t.closeDate ?? t.date)}</td>
                      {isCurator && <td className="px-2 py-2 text-muted-foreground">{t.trader ?? "—"}</td>}
                      <td className="px-2 py-2">
                        {t.autoSetup ? (
                          <span className={cn("inline-flex items-center gap-1 text-xs", t.autoMatch ? "text-primary" : "text-muted-foreground")}>
                            {t.autoMatch && <Sparkles className="h-3 w-3" aria-label="Совпадает с сетапом" />}
                            {t.autoSetup}
                            {t.autoConfidence != null && <span className="tabular-nums opacity-70">{Math.round(t.autoConfidence * (t.autoConfidence <= 1 ? 100 : 1))}%</span>}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-xs text-muted-foreground">
                        {t.inSetup ? <Pill tone="accent">уже в эталонах</Pill> : t.linkedHere ? "этот сетап" : t.playbookName ?? "—"}
                      </td>
                      {t.redacted ? (
                        <td className={cn("px-3 py-2 text-right font-medium tabular-nums", toneText(moneyTone(t.signedR)))} title={REDACTED_HINT}>{fmtR(t.signedR)}</td>
                      ) : (
                        <td className={cn("px-3 py-2 text-right font-medium tabular-nums", toneText(moneyTone(t.netPnl)))}>{fmtUsd(t.netPnl)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {pick.data?.truncated && <p className="px-3 py-2 text-xs text-muted-foreground">Показаны последние 300 сделок — сузьте период или тикер.</p>}
          {trades.some((t) => t.redacted) && <RedactedHint className="px-3 py-2" />}
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Тир для выбранных</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Тир">
              {TIERS.map((t) => (
                <button
                  key={t.tier}
                  type="button"
                  role="radio"
                  aria-checked={tier === t.tier}
                  onClick={() => setTier(t.tier)}
                  title={t.hint}
                  className="chip min-h-8 px-3 text-xs font-medium"
                  data-active={tier === t.tier}
                >
                  <span className={cn("h-2 w-2 rounded-full bg-current", toneText(t.tone))} aria-hidden="true" /> {t.label}
                </button>
              ))}
            </div>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Заметка ко всем выбранным (необязательно)"
            aria-label="Заметка"
            className="min-w-[240px] flex-1 resize-none text-sm"
          />
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm tabular-nums text-muted-foreground">
            Выбрано: {selected.size}
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="ml-2 inline-flex items-center gap-0.5 text-xs underline-offset-2 hover:underline">
                <X className="h-3 w-3" aria-hidden="true" /> сбросить
              </button>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={save} disabled={!selected.size || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Добавить {selected.size || ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
