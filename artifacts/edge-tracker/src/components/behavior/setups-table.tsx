/**
 * Таблица сделок с предложенным сетапом: уверенность, объяснение (какие признаки сработали),
 * кнопки «Принять» / «Отклонить» и «Принять всё с уверенностью ≥ X» (одним запросом, с подтверждением).
 * Недостающие предложения считает «Посчитать всё» (setups-compute.tsx) над таблицей.
 */
import * as React from "react";
import { Link } from "wouter";
import { Check, CheckCheck, ChevronDown, ChevronRight, RefreshCw, Sparkles, X } from "lucide-react";
import { DataTable, EmptyState, Pill, SortableTh, toneOf, toneText, useTableSort } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import {
  fmtClock, fmtDateShort, fmtMinutes, fmtUsdCompact, pluralTrades, useAcceptBulk, useAcceptSetup, useRecomputeSetup, useRejectSetup,
  type SetupItem, type SuggestionStatus,
} from "./api";

const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
const BULK_CHUNK = 500;

/** «Принять всё с уверенностью ≥ X». */
function BulkAccept({ items }: { items: SetupItem[] }) {
  const [min, setMin] = React.useState<number>(0.7);
  const [confirm, setConfirm] = React.useState(false);
  const bulk = useAcceptBulk();
  const eligible = React.useMemo(
    () => items.filter((i) => i.suggestion?.status === "suggested" && i.suggestion.confidence >= min),
    [items, min],
  );
  const bySetup = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const i of eligible) m.set(i.suggestion!.setup, (m.get(i.suggestion!.setup) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [eligible]);

  const run = async () => {
    const ids = eligible.map((i) => i.tradeId);
    let accepted = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const r = await bulk.mutateAsync({ tradeIds: ids.slice(i, i + BULK_CHUNK), minConfidence: min });
        accepted += r.accepted;
        skipped += Object.values(r.skipped).reduce((s, v) => s + v, 0);
      }
      toast({ title: `Принято ${pluralTrades(accepted)}`, description: skipped ? `Пропущено ${skipped}: устарели, уже решены или нет доступа.` : "Сетапы записаны в сделки." });
    } catch (e) {
      toast({ title: "Не удалось принять пачкой", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">Уверенность ≥</span>
      <Select value={String(min)} onValueChange={(v) => setMin(Number(v))}>
        <SelectTrigger className="h-8 w-20" aria-label="Порог уверенности"><SelectValue /></SelectTrigger>
        <SelectContent>
          {THRESHOLDS.map((t) => <SelectItem key={t} value={String(t)}>{Math.round(t * 100)}%</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={!eligible.length || bulk.isPending} aria-busy={bulk.isPending} onClick={() => setConfirm(true)}>
        <CheckCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {bulk.isPending ? "Принимаем…" : `Принять ${eligible.length}`}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Принять {pluralTrades(eligible.length)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Сетап запишется в сделки с уверенностью ≥ {Math.round(min * 100)}%:{" "}
              {bySetup.slice(0, 6).map(([s, n]) => `${s} — ${n}`).join(", ")}{bySetup.length > 6 ? "…" : ""}. Потом сетап можно поменять в карточке сделки.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Принять</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const STATUS_LABEL: Record<SuggestionStatus, string> = { suggested: "предложено", accepted: "принято", rejected: "отклонено", stale: "устарело" };
const STATUS_TONE: Record<SuggestionStatus, "neutral" | "up" | "down" | "warn" | "accent"> = { suggested: "accent", accepted: "up", rejected: "neutral", stale: "warn" };

const ACCESSORS = {
  date: (r: SetupItem) => `${r.date}#${String(r.tradeId).padStart(8, "0")}`,
  ticker: (r: SetupItem) => r.ticker,
  time: (r: SetupItem) => r.entryMin,
  hold: (r: SetupItem) => r.holdMin,
  net: (r: SetupItem) => r.net,
  setup: (r: SetupItem) => r.suggestion?.setup ?? null,
  confidence: (r: SetupItem) => r.suggestion?.confidence ?? null,
  status: (r: SetupItem) => r.suggestion?.status ?? null,
} as const;

function ConfidenceBar({ v }: { v: number }) {
  const tone = v >= 0.7 ? "hsl(var(--primary))" : v >= 0.45 ? "hsl(var(--primary) / 0.55)" : "hsl(var(--muted-foreground))";
  return (
    <span className="inline-flex items-center gap-2" title={`Уверенность ${Math.round(v * 100)}%`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted/40" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: tone }} />
      </span>
      <span className="tabular-nums text-xs">{Math.round(v * 100)}%</span>
    </span>
  );
}

export function SetupsTable({ items, canEdit }: { items: SetupItem[]; canEdit: boolean }) {
  const [filter, setFilter] = React.useState<"all" | "suggested" | "accepted" | "rejected" | "pending">("all");
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());
  const accept = useAcceptSetup();
  const reject = useRejectSetup();
  const recompute = useRecomputeSetup();

  const filtered = React.useMemo(() => {
    if (filter === "all") return items;
    if (filter === "pending") return items.filter((i) => !i.suggestion || i.suggestion.status === "stale");
    return items.filter((i) => i.suggestion?.status === filter);
  }, [items, filter]);
  const { rows, thProps } = useTableSort(filtered, ACCESSORS, "date");

  const counts = React.useMemo(() => ({
    all: items.length,
    suggested: items.filter((i) => i.suggestion?.status === "suggested").length,
    accepted: items.filter((i) => i.suggestion?.status === "accepted").length,
    rejected: items.filter((i) => i.suggestion?.status === "rejected").length,
    pending: items.filter((i) => !i.suggestion || i.suggestion.status === "stale").length,
  }), [items]);

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const doAccept = (r: SetupItem) => {
    if (!r.suggestion) return;
    accept.mutate({ tradeId: r.tradeId }, {
      onSuccess: () => toast({ title: `Сетап «${r.suggestion?.setup}» записан`, description: `${r.ticker} · ${fmtDateShort(r.date)}` }),
      onError: (e) => toast({ title: "Не удалось записать сетап", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };
  const doReject = (r: SetupItem) => {
    reject.mutate({ tradeId: r.tradeId }, {
      onError: (e) => toast({ title: "Не удалось отклонить", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
    });
  };

  if (!items.length) {
    return <EmptyState icon={Sparkles} title="Нет сделок за период" description="Выберите другой период или трейдера. Открытые сделки не классифицируются." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр по статусу">
          {(["all", "suggested", "accepted", "rejected", "pending"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={cn("rounded-full px-2.5 py-1 tabular-nums transition-colors", filter === k ? "bg-primary-solid text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground")}
            >
              {k === "all" ? "Все" : k === "pending" ? "Не посчитано" : STATUS_LABEL[k]} · {counts[k]}
            </button>
          ))}
        </div>
        {canEdit && counts.suggested > 0 && (
          <div className="ml-auto">
            <BulkAccept items={items} />
          </div>
        )}
      </div>

      <DataTable maxHeight="64vh" ariaLabel="Сделки с предложенным сетапом">
        <table>
          <thead>
            <tr>
              <SortableTh {...thProps("date")}>Дата</SortableTh>
              <SortableTh {...thProps("ticker")}>Тикер</SortableTh>
              <SortableTh {...thProps("time")}>Вход</SortableTh>
              <SortableTh {...thProps("hold")}>Удержание</SortableTh>
              <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
              <SortableTh {...thProps("setup")}>Сетап (авто)</SortableTh>
              <SortableTh {...thProps("confidence")}>Уверенность</SortableTh>
              <SortableTh {...thProps("status")}>Статус</SortableTh>
              <th scope="col" className="text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r.suggestion;
              const isOpen = open.has(r.tradeId);
              const busy = (accept.isPending && accept.variables?.tradeId === r.tradeId) || (reject.isPending && reject.variables?.tradeId === r.tradeId) || (recompute.isPending && recompute.variables?.tradeId === r.tradeId);
              return (
                <React.Fragment key={r.tradeId}>
                  <tr>
                    <td className="whitespace-nowrap">
                      <Link href={links.trade(r.tradeId)} className="underline-offset-2 hover:underline" aria-label={`Открыть сделку ${r.ticker} от ${r.date}`}>{fmtDateShort(r.date)}</Link>
                    </td>
                    <td className="whitespace-nowrap font-medium">
                      {r.ticker} <span className="text-xs text-muted-foreground">{r.side === "short" ? "S" : r.side === "long" ? "L" : ""}</span>
                    </td>
                    <td className="tabular-nums">{fmtClock(r.entryMin)}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtMinutes(r.holdMin)}</td>
                    <td className={cn("text-right tabular-nums", toneText(toneOf(r.net)))}>{fmtUsdCompact(r.net)}</td>
                    <td>
                      {s ? (
                        <button type="button" onClick={() => toggle(r.tradeId)} aria-expanded={isOpen} className="inline-flex items-center gap-1 text-left hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          <span className="font-medium">{s.setup}</span>
                          {!s.candlesAvailable && <Pill tone="warn" title="Свечей нет — только время и удержание">без свечей</Pill>}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">не посчитано</span>
                      )}
                      {r.currentSetup && <div className="text-xs text-muted-foreground">в сделке: {r.currentSetup}</div>}
                    </td>
                    <td>{s ? <ConfidenceBar v={s.confidence} /> : "—"}</td>
                    <td>{s ? <Pill tone={STATUS_TONE[s.status]} dot>{STATUS_LABEL[s.status]}</Pill> : <Pill tone="neutral">очередь</Pill>}</td>
                    <td className="whitespace-nowrap text-right">
                      {canEdit && s && s.status !== "accepted" && s.status !== "stale" && (
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="default" className="h-7 px-2" disabled={busy} onClick={() => doAccept(r)} aria-label={`Принять сетап ${s.setup} для ${r.ticker}`}>
                            <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Принять
                          </Button>
                          {s.status !== "rejected" && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => doReject(r)} aria-label={`Отклонить предложение для ${r.ticker}`}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      )}
                      {canEdit && s && s.status === "stale" && (
                        <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={() => recompute.mutate({ tradeId: r.tradeId })} aria-label={`Пересчитать предложение для ${r.ticker}`}>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Пересчитать
                        </Button>
                      )}
                    </td>
                  </tr>
                  {s && isOpen && (
                    <tr>
                      <td colSpan={9} className="bg-muted/10 text-xs">
                        <div className="flex flex-col gap-1.5 py-1">
                          <ul className="list-disc pl-5 text-muted-foreground" aria-label="Сработавшие признаки">
                            {s.reasons.map((x, i) => <li key={i}>{x}</li>)}
                          </ul>
                          {s.note && <p className="text-down">{s.note}</p>}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.alternatives.length > 0 && <span className="text-muted-foreground">альтернативы:</span>}
                            {s.alternatives.map((a) => (
                              canEdit && s.status !== "accepted"
                                ? <Button key={a.setup} size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={() => accept.mutate({ tradeId: r.tradeId, setup: a.setup })} aria-label={`Принять альтернативу ${a.setup}`}>{a.setup} · {Math.round(a.score * 100)}%</Button>
                                : <Pill key={a.setup} tone="neutral">{a.setup} · {Math.round(a.score * 100)}%</Pill>
                            ))}
                            {s.tags.map((t) => <Pill key={t} tone="accent">{t}</Pill>)}
                            <span className="ml-auto text-muted-foreground">
                              бары {s.interval ?? "—"} · правила v{s.version}
                              {s.decidedBy && ` · ${STATUS_LABEL[s.status]} ${s.decidedBy}`}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </DataTable>
      <p className="text-xs text-muted-foreground">
        {pluralTrades(filtered.length)} в таблице. Предложения считаются по правилам (без ИИ) из времени входа, удержания и свечей дня; в сделку сетап записывается только по кнопке «Принять».
      </p>
    </div>
  );
}
