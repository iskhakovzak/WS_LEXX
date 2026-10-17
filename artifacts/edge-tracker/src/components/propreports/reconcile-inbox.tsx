/**
 * Reconciliation inbox: broker round trips that collide with a manual journal entry
 * (same trader + ticker + date + side, no external id). Curator merges or keeps separate; nothing merges silently.
 */
import * as React from "react";
import { GitMerge, Inbox, Loader2, Split, Trash2 } from "lucide-react";
import { EmptyState, Panel, Pill, StatRow } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { HORIZON_LABEL, fmtPrice, fmtSigned, fmtUsd, useDismissPending, useKeepSeparate, useMerge, type ManualCandidate, type PendingTrade } from "./api";
import { ExecutionsList, FeesBreakdown, resultTone } from "./preview-table";

function Side({ title, tone, children }: { title: React.ReactNode; tone: "accent" | "neutral"; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border p-3", tone === "accent" ? "border-primary/40 bg-primary/5" : "border-[var(--glass-border)]")}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function Candidate({ c, selected, onSelect }: { c: ManualCandidate; selected: boolean; onSelect: () => void }) {
  const net = c.pnl != null ? c.pnl - (c.fees ?? 0) : null;
  return (
    <button type="button" onClick={onSelect} className={cn("w-full rounded-lg border p-2 text-left text-xs transition-colors", selected ? "border-primary bg-primary/10" : "border-[var(--glass-border)] hover:bg-[var(--glass-bg)]")} aria-pressed={selected}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">#{c.id}</span>
        <span>{c.ticker} {c.side ?? ""}</span>
        <Pill tone={c.result === "win" ? "up" : c.result === "loss" ? "down" : "neutral"}>{c.result}</Pill>
        {c.setup && <span className="text-muted-foreground">{c.setup}</span>}
        {c.playbookId != null && <Pill tone="purple">плейбук #{c.playbookId}</Pill>}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-x-2 text-muted-foreground">
        <span>вход {fmtPrice(c.entry)}</span><span>выход {fmtPrice(c.exit)}</span><span>объём {c.qty ?? "—"}</span><span>net {fmtSigned(net)}</span>
      </div>
      {c.notes && <div className="mt-1 line-clamp-2 text-muted-foreground" title={c.notes}>{c.notes}</div>}
    </button>
  );
}

function PendingCard({ p, staff }: { p: PendingTrade; staff: boolean }) {
  const { toast } = useToast();
  const merge = useMerge();
  const keep = useKeepSeparate();
  const dismiss = useDismissPending();
  const [selected, setSelected] = React.useState<number | null>(p.candidates[0]?.id ?? null);
  const [showExec, setShowExec] = React.useState(false);
  const t = p.trip;
  const busy = merge.isPending || keep.isPending || dismiss.isPending;

  const run = async (fn: () => Promise<unknown>, okTitle: string) => {
    try { await fn(); toast({ title: okTitle }); }
    catch (e) { toast({ title: "Не получилось", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  return (
    <article className="rounded-2xl border border-[var(--glass-border)] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{p.ticker}</span>
          <span className={t.side === "Long" ? "text-up" : "text-down"}>{t.side === "Long" ? "Лонг" : "Шорт"}</span>
          <span className="text-muted-foreground">{p.date}{t.exitDate && t.exitDate !== p.date ? ` → ${t.exitDate}` : ""}</span>
          <Pill tone="neutral">{p.trader}</Pill>
          {p.account && <Pill tone="neutral">{p.account}</Pill>}
          <Pill tone={resultTone(t.result)}>{fmtSigned(t.netPnl)} net</Pill>
        </div>
        <span className="text-2xs text-muted-foreground">в очереди с {new Date(p.createdAt).toLocaleDateString("ru-RU")}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Side title="Из PropReports (брокер)" tone="accent">
          <StatRow label="Вход / выход" value={`${fmtPrice(t.avgEntry)} → ${fmtPrice(t.avgExit)}`} />
          <StatRow label="Объём (макс.)" value={`${t.qty} · ${t.fillCount} fills`} />
          <StatRow label="Gross / комиссии" value={<span>{fmtSigned(t.grossPnl)} / <FeesBreakdown fees={t.fees} total={t.totalFees} /></span>} />
          <StatRow label="Net" value={fmtSigned(t.netPnl)} tone={t.netPnl > 0 ? "up" : t.netPnl < 0 ? "down" : "neutral"} />
          <StatRow label="Горизонт / удержание" value={`${HORIZON_LABEL[t.horizon]} · ${t.holdTime ?? "—"}`} />
          <button type="button" className="mt-1 text-left text-xs text-primary hover:underline" onClick={() => setShowExec((v) => !v)}>{showExec ? "Скрыть исполнения" : "Показать исполнения"}</button>
          {showExec && <ExecutionsList trip={t} />}
        </Side>
        <Side title={`Ручная запись в журнале (${p.candidates.length})`} tone="neutral">
          {p.candidates.length ? p.candidates.map((c) => <Candidate key={c.id} c={c} selected={selected === c.id} onSelect={() => setSelected(c.id)} />) : <div className="text-xs text-muted-foreground">Ручная запись уже удалена или привязана — можно добавить брокерскую сделку отдельно.</div>}
          <p className="mt-1 text-2xs text-muted-foreground">При объединении числа брокера заменят вход/выход/объём/P&L/комиссии; сетап, заметки, теги, плейбук и скриншоты останутся.</p>
        </Side>
      </div>

      {staff && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || selected == null} onClick={() => run(() => merge.mutateAsync({ pendingId: p.id, tradeId: selected! }), `Объединено со сделкой #${selected}`)}>
            {merge.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitMerge className="mr-1.5 h-4 w-4" />}Объединить с #{selected ?? "—"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => keep.mutateAsync(p.id), "Добавлено как отдельная сделка")}>
            <Split className="mr-1.5 h-4 w-4" />Оставить отдельно
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => dismiss.mutateAsync(p.id), "Убрано из очереди")} aria-label="Убрать из очереди">
            <Trash2 className="mr-1.5 h-4 w-4" />Не импортировать
          </Button>
          <span className="text-2xs text-muted-foreground">{fmtUsd(t.totalFees)} комиссий учтено в net</span>
        </div>
      )}
    </article>
  );
}

export function ReconcileInbox({ pending, staff, loading }: { pending: PendingTrade[]; staff: boolean; loading: boolean }) {
  return (
    <Panel title="Входящие на сверку" description="Брокерская сделка совпала с ручной записью (трейдер + тикер + дата + сторона). Ничего не объединяется автоматически." icon={Inbox} actions={pending.length ? <Pill tone="warn" dot>{pending.length}</Pill> : undefined}>
      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Загрузка…</div>
      ) : !pending.length ? (
        <EmptyState icon={Inbox} title="Очередь пуста" description="Все брокерские сделки либо новые, либо уже привязаны к журналу." />
      ) : (
        <div className="grid gap-3">{pending.map((p) => <PendingCard key={p.id} p={p} staff={staff} />)}</div>
      )}
    </Panel>
  );
}
