import * as React from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock, Archive, ArrowRight, BookCheck, CalendarX, ClipboardList, History, Inbox, Layers, ListChecks, ShieldAlert, Sparkles, Users,
} from "lucide-react";
import { BentoGrid, EmptyState, FilterChip, LimitBar, Panel, Pill, StatCard, StatGrid, StatusDot, Tile, usePersistentState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { UndoToast } from "@/components/undo-toast";
import { curatorApi, curatorKeys, type QueueKind, type Scope, type TodayPayload } from "./api";
import { useCuratorEodReview, type EodTarget } from "./eod-review";
import { QUEUE_LABEL, QUEUE_TONE, actionTone, curatorLinks, profileHref, riskTone, waitLabel } from "./curator-math";
import { fmtDate, fmtUsd } from "@/lib/format";
import { TemplateDialog } from "./template-dialog";

/** Which limit the risk tile should show: the one that triggered the state (drawdown / week), otherwise the daily one. */
function riskBar(r: TodayPayload["risk"]["halted"][number]): { label: string; pct: number | null } {
  if (r.state === "drawdown") return { label: "Просадка от пика", pct: r.drawdownPct };
  if (r.state === "weekly") return { label: "Недельный лимит", pct: r.weeklyPct };
  const worst = [
    { label: "Дневной лимит", pct: r.dailyPct },
    { label: "Недельный лимит", pct: r.weeklyPct },
    { label: "Просадка от пика", pct: r.drawdownPct },
  ].reduce((m, x) => ((x.pct ?? -1) > (m.pct ?? -1) ? x : m));
  return worst.pct != null ? worst : { label: "Дневной лимит", pct: r.dailyPct };
}

/** «Сегодня»: what needs the curator now — risk, discipline gaps, the review queue and next steps. */
export function TodayView({ data, scope = "auto", onOpenTrader }: { data: TodayPayload; scope?: Scope | "auto"; onOpenTrader: (trader: string, tab?: string) => void }) {
  const [templateFor, setTemplateFor] = React.useState<string[] | null>(null);
  const [showOld, setShowOld] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const win = data.queueWindow;
  const oldQ = useQuery({ queryKey: curatorKeys.todayOld(scope), queryFn: () => curatorApi.today(scope, true), enabled: showOld, staleTime: 30_000 });
  const fullQueue = showOld && oldQ.data ? oldQ.data.queue : data.queue;
  // Тип элементов очереди — фильтр запоминается (куратор обычно разбирает «сначала все дни» или «сначала нарушения»).
  const [kindFilter, setKindFilter] = usePersistentState<QueueKind | "all">("curator.queueKind", "all");
  const kindCounts = React.useMemo(() => {
    const m: Record<QueueKind, number> = { breach: 0, eod: 0, weekly: 0, academy: 0 };
    for (const q of fullQueue) m[q.kind] += 1;
    return m;
  }, [fullQueue]);
  const activeKind = kindFilter !== "all" && kindCounts[kindFilter] > 0 ? kindFilter : "all";
  const queue = activeKind === "all" ? fullQueue : fullQueue.filter((q) => q.kind === activeKind);
  // Закрытые дни разбираются прямо здесь, в шторке; «Сохранить и следующий» идёт по этой же очереди.
  const eodTargets = React.useMemo<EodTarget[]>(
    () => queue.flatMap((q) => (q.kind === "eod" && q.eodId && q.date ? [{ eodId: q.eodId, trader: q.trader, date: q.date, closedAt: q.since, hoursWaiting: q.hoursWaiting }] : [])),
    [queue],
  );
  const review = useCuratorEodReview(eodTargets);
  const [undo, setUndo] = React.useState<{ ids: string[]; n: number } | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const archiveOld = useMutation({
    mutationFn: () => curatorApi.archiveOldQueue(scope, win?.days),
    onSuccess: (r) => {
      setShowOld(false);
      if (r.archived && r.ids?.length) setUndo({ ids: r.ids, n: r.archived });
      else toast({ title: r.archived ? `В архиве: ${r.archived}` : "Старых элементов нет" });
      void qc.invalidateQueries({ queryKey: curatorKeys.all });
    },
    onError: (e) => toast({ title: "Не удалось архивировать", description: (e as Error).message, variant: "destructive" }),
  });
  const restore = async () => {
    if (!undo) return;
    setRestoring(true);
    try {
      const r = await curatorApi.restoreQueue(undo.ids);
      toast({ title: `Возвращено в очередь: ${r.restored}` });
    } catch (e) {
      toast({ title: "Не удалось вернуть", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRestoring(false);
      setUndo(null);
      void qc.invalidateQueries({ queryKey: curatorKeys.all });
    }
  };
  const [showAll, setShowAll] = React.useState<{ next?: boolean; queue?: boolean; overdue?: boolean; risk?: boolean }>({});
  const expand = (k: keyof typeof showAll) => setShowAll((s) => ({ ...s, [k]: !s[k] }));
  const c = data.counts;
  const riskCount = c.halted + c.nearStop;
  const riskRows = [...data.risk.halted, ...data.risk.nearStop];

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <StatGrid cols={6}>
        <StatCard label="Торгуют сегодня" value={`${c.trading} из ${c.traders}`} icon={Users} hint={data.phase === "weekend" ? "выходной" : undefined} />
        <StatCard
          label="Стоп / у стопа"
          value={`${c.halted} / ${c.nearStop}`}
          tone={c.halted ? "down" : c.nearStop ? "warn" : "neutral"}
          icon={ShieldAlert}
          hint={c.noLimits ? `${c.noLimits} без лимитов` : "все с лимитами"}
        />
        <StatCard
          label="Разборы"
          value={c.queue}
          tone={c.queueOverdue ? "down" : c.queue ? "accent" : "neutral"}
          icon={Inbox}
          hint={c.queueOverdue ? `${c.queueOverdue} просрочено по SLA` : "в пределах SLA"}
        />
        <StatCard
          label="Не закрыт день"
          value={c.missingEod}
          tone={c.missingEod ? "warn" : "neutral"}
          icon={CalendarX}
          hint={`за ${fmtDate(data.prevDay, "dayMonth")}`}
        />
        <StatCard
          label="Нет плана"
          value={data.plansAvailable ? c.missingPlan : "—"}
          tone={data.plansAvailable && c.missingPlan ? "warn" : "neutral"}
          icon={ClipboardList}
          hint={data.plansAvailable ? (data.phase === "weekend" ? "выходной" : "готовый план к открытию") : "нет данных"}
        />
        <StatCard
          label="Просрочки 1:1"
          value={c.overdueActions}
          tone={c.overdueActions ? "warn" : "neutral"}
          icon={AlarmClock}
          hint={c.overdueActions ? "договорённости" : "без просрочек"}
        />
      </StatGrid>

      <BentoGrid>
        <Panel
          className="lg:col-span-7"
          fill
          title="Следующие шаги"
          icon={Sparkles}
          description="По одному самому важному действию на трейдера — сверху срочное"
          actions={data.nextActions.length ? <Pill tone="neutral">{data.nextActions.length}</Pill> : undefined}
        >
          {data.nextActions.length === 0 ? (
            <EmptyState compact icon={Sparkles} title="Всё под контролем" description="Нет нарушений без разбора, очередь пуста, у всех есть лимиты." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(showAll.next ? data.nextActions : data.nextActions.slice(0, 10)).map((a) => (
                <li key={a.trader} className="tile flex min-w-0 items-center gap-3 px-3 py-2">
                  <button type="button" onClick={() => onOpenTrader(a.trader)} className="w-28 shrink-0 truncate text-left text-sm font-medium text-foreground hover:text-primary">
                    {a.trader}
                  </button>
                  <StatusDot tone={actionTone(a.kind)} className="min-w-0 flex-1"><span className="text-sm text-foreground">{a.label}</span></StatusDot>
                  {a.kind === "no_limits" ? (
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setTemplateFor([a.trader])}>
                      <Layers className="h-3.5 w-3.5" /> Шаблон
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost" className="shrink-0">
                      <Link href={a.href}>Открыть <ArrowRight className="h-3.5 w-3.5" /></Link>
                    </Button>
                  )}
                </li>
              ))}
              {data.nextActions.length > 10 && <li><ShowMore open={!!showAll.next} rest={data.nextActions.length - 10} onClick={() => expand("next")} /></li>}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-5"
          fill
          title="Риск сейчас"
          icon={ShieldAlert}
          description="Стоп при 100% лимита, предупреждение при 70%"
          actions={<Button asChild size="sm" variant="ghost"><Link href="/risk">Риск-деск <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
        >
          <div className="flex flex-col gap-3">
            {riskCount === 0 && <p className="text-sm text-muted-foreground">Никто не на стопе и не близко к нему.</p>}
            {(showAll.risk ? riskRows : riskRows.slice(0, RISK_VISIBLE)).map((r) => {
              const bar = riskBar(r);
              return (
                <Tile key={r.trader} onClick={() => onOpenTrader(r.trader, "risk")} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{r.trader}</span>
                    <Pill tone={riskTone(r.state)} dot>{r.label}</Pill>
                    <span className={cn("ml-auto text-sm tabular-nums", (r.pnlNet ?? 0) < 0 ? "text-down" : "text-muted-foreground")} title="P&L сегодня">
                      {r.pnlNet == null ? "сегодня без сделок" : fmtUsd(r.pnlNet, { signed: true, decimals: 0 })}
                    </span>
                  </div>
                  <LimitBar size="sm" used={Math.min(bar.pct ?? 0, 100)} limit={100} warnAt={0.7} showValues={false} label={bar.label} hint={bar.pct != null ? `${Math.round(bar.pct)}%` : undefined} />
                  <p className="text-xs text-muted-foreground">{r.message}</p>
                </Tile>
              );
            })}
            {riskRows.length > RISK_VISIBLE && <ShowMore open={!!showAll.risk} rest={riskRows.length - RISK_VISIBLE} onClick={() => expand("risk")} />}
            {data.trading.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="micro-label">Торгуют</span>
                <ul className="flex flex-col">
                  {data.trading.map((t) => (
                    <li key={t.trader} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-b-0">
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-foreground hover:text-primary" onClick={() => onOpenTrader(t.trader)}>{t.trader}</button>
                      <span className="text-xs tabular-nums text-muted-foreground">{t.trades} сд.{t.openPositions ? ` · ${t.openPositions} откр.` : ""}</span>
                      <span className={cn("w-20 text-right tabular-nums", (t.pnlNet ?? 0) > 0 ? "text-up" : (t.pnlNet ?? 0) < 0 ? "text-down" : "text-foreground")}>{fmtUsd(t.pnlNet, { signed: true, decimals: 0 })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.risk.noLimits.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-warn">Без лимитов: {data.risk.noLimits.length}</span>
                  <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setTemplateFor(data.risk.noLimits)}>
                    <Layers className="h-3.5 w-3.5" /> Применить шаблон
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{data.risk.noLimits.join(", ")} — стоп не сработает, пока лимиты не заданы.</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          className="lg:col-span-7"
          fill
          title="Очередь разборов"
          icon={Inbox}
          description={`Сначала нарушения, затем дни, недели и задания${win && !showOld ? ` · последние ${win.days} дн.` : ""} · красным — дольше SLA`}
          actions={<Button asChild size="sm" variant="ghost"><Link href={curatorLinks.journalQueue()}>Очередь дней <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
        >
          {win && win.old > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                {showOld
                  ? `Показаны и старые: ${win.old} старше ${win.days} дн.`
                  : `Скрыто старых: ${win.old} (старше ${win.days} дн.${win.oldOverdue ? (win.oldOverdue === win.old ? ", все просрочены" : `, ${win.oldOverdue} просрочено`) : ""})`}
              </span>
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setShowOld((v) => !v)} disabled={showOld && oldQ.isFetching}>
                {showOld ? (oldQ.isFetching ? "Загрузка…" : "Только свежие") : "Показать старые"}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setConfirmArchive(true)} disabled={archiveOld.isPending}>
                <Archive className="h-3.5 w-3.5" /> Архивировать старые
              </Button>
            </div>
          )}
          {fullQueue.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Тип разбора">
              <FilterChip size="sm" active={activeKind === "all"} onClick={() => setKindFilter("all")} count={fullQueue.length}>Все</FilterChip>
              {QUEUE_KIND_ORDER.filter((k) => kindCounts[k] > 0).map((k) => (
                <FilterChip key={k} size="sm" active={activeKind === k} onClick={() => setKindFilter(activeKind === k ? "all" : k)} count={kindCounts[k]}>
                  {QUEUE_FILTER_LABEL[k]}
                </FilterChip>
              ))}
              {activeKind === "eod" && eodTargets.length > 1 && (
                <Button type="button" size="sm" className="ml-auto h-8" onClick={() => review.open(eodTargets[0])}>
                  <BookCheck className="h-3.5 w-3.5" /> Разбирать по очереди
                </Button>
              )}
            </div>
          )}
          {queue.length === 0 ? (
            <EmptyState
              compact
              icon={BookCheck}
              title="Очередь пуста"
              description={win?.old ? "За последние дни всё разобрано. Старые элементы скрыты." : "Всё, что трейдеры сдали, уже разобрано."}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(showAll.queue ? queue : queue.slice(0, 12)).map((q) => (
                <li key={q.id} className="tile grid min-w-0 grid-cols-[5.5rem_minmax(0,8rem)_minmax(0,1fr)_4.5rem_auto] items-center gap-x-3 px-3 py-1.5">
                  <Pill tone={QUEUE_TONE[q.kind]} className="w-full justify-center">{QUEUE_LABEL[q.kind]}</Pill>
                  <span className="truncate text-sm font-medium text-foreground" title={q.trader}>{q.trader}</span>
                  <span className="truncate text-sm text-muted-foreground" title={q.title}>{q.title.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d, "dayMonth"))}</span>
                  <span
                    className={cn("text-right text-xs tabular-nums", q.overdue ? "font-medium text-down" : "text-muted-foreground")}
                    title={q.overdue ? `Просрочено: ждёт дольше SLA ${q.slaHours} ч` : `Ждёт · SLA ${q.slaHours} ч`}
                  >
                    {waitLabel(q.hoursWaiting)}{q.overdue && <span className="sr-only"> · просрочено</span>}
                  </span>
                  {q.kind === "eod" && q.eodId && q.date ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      title="Открыть день и оставить отзыв, не уходя из кабинета"
                      onClick={() => review.open({ eodId: q.eodId!, trader: q.trader, date: q.date!, closedAt: q.since, hoursWaiting: q.hoursWaiting })}
                    >
                      Разобрать
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="ghost" className="shrink-0"><Link href={q.href}>Разобрать</Link></Button>
                  )}
                </li>
              ))}
              {queue.length > 12 && <li><ShowMore open={!!showAll.queue} rest={queue.length - 12} onClick={() => expand("queue")} /></li>}
            </ul>
          )}
          <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Архивировать старые разборы?</AlertDialogTitle>
                <AlertDialogDescription>
                  {win ? `Из очереди уйдут ${win.old} шт. старше ${win.days} дн. ` : ""}
                  Дни, отчёты и задания не удаляются и не помечаются разобранными — они просто перестанут висеть в очереди.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={() => archiveOld.mutate()}>Архивировать</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Panel>

        <Panel className="lg:col-span-5" fill title="Дисциплина" icon={ListChecks} description="Кому напомнить про план, закрытие дня и договорённости">
          <div className="flex flex-col gap-4">
            <GapList
              title={`Не закрыт день ${fmtDate(data.prevDay, "dayMonth")}`}
              empty="Все, кто торговал, закрыли день."
              items={data.missingEod.map((m) => ({ key: m.trader, label: m.trader, href: curatorLinks.journalDay(m.trader, m.date) }))}
            />
            {data.openToday.length > 0 && (
              <GapList title="Сегодня ещё не закрыли" items={data.openToday.map((m) => ({ key: m.trader, label: m.trader, href: curatorLinks.journalDay(m.trader, m.date) }))} />
            )}
            {data.plansAvailable && data.phase !== "weekend" && (
              <GapList
                title="Нет готового плана на сегодня"
                empty="У всех готов план."
                items={data.missingPlan.map((m) => ({ key: m.trader, label: m.trader, meta: m.status === "draft" ? "черновик" : undefined }))}
                onOpen={(t) => onOpenTrader(t, "journal")}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <span className="micro-label">Просроченные договорённости 1:1</span>
              {data.overdueActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Просрочек нет.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {(showAll.overdue ? data.overdueActions : data.overdueActions.slice(0, 6)).map((a) => (
                    <li key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <button type="button" title={a.trader} className="w-24 shrink-0 truncate text-left font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(a.trader, "academy")}>{a.trader}</button>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={a.title}>{a.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-down">просрочка {a.daysOverdue} дн.</span>
                    </li>
                  ))}
                  {data.overdueActions.length > 6 && <li><ShowMore open={!!showAll.overdue} rest={data.overdueActions.length - 6} onClick={() => expand("overdue")} /></li>}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </BentoGrid>

      <TemplateDialog open={!!templateFor} onOpenChange={(v) => { if (!v) setTemplateFor(null); }} traders={templateFor ?? []} />
      {review.sheet}
      {undo && (
        <UndoToast
          label={`${undo.n} шт.`}
          actionText="убрано из очереди в архив"
          restoring={restoring}
          onUndo={() => void restore()}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
}

const RISK_VISIBLE = 4;
const QUEUE_KIND_ORDER: QueueKind[] = ["breach", "eod", "weekly", "academy"];
const QUEUE_FILTER_LABEL: Record<QueueKind, string> = { breach: "Нарушения", eod: "Дни", weekly: "Недели", academy: "Академия" };

function GapList({ title, items, empty, onOpen }: {
  title: string;
  items: { key: string; label: string; href?: string; meta?: string }[];
  empty?: string;
  onOpen?: (trader: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="micro-label">{title}{items.length ? ` · ${items.length}` : ""}</span>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => {
            const body = <>{i.label}{i.meta && <span className="text-muted-foreground"> · {i.meta}</span>}</>;
            if (i.href) return <Link key={i.key} href={i.href} className="chip inline-flex min-h-7 items-center px-2.5 text-xs font-medium">{body}</Link>;
            return (
              <button key={i.key} type="button" onClick={() => onOpen?.(i.key)} className="chip inline-flex min-h-7 items-center px-2.5 text-xs font-medium">
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { profileHref };

function ShowMore({ open, rest, onClick }: { open: boolean; rest: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-1 text-xs text-primary hover:underline">
      {open ? "Свернуть" : `Показать ещё ${rest}`}
    </button>
  );
}
