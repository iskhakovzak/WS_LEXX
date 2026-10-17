import * as React from "react";
import { Link } from "wouter";
import {
  AlarmClock, ArrowRight, BookCheck, CalendarX, ClipboardList, Inbox, Layers, ListChecks, ShieldAlert, Sparkles, Users,
} from "lucide-react";
import { BentoGrid, EmptyState, LimitBar, Panel, Pill, StatCard, StatGrid, StatusDot, Tile } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TodayPayload } from "./api";
import { QUEUE_LABEL, QUEUE_TONE, actionTone, curatorLinks, profileHref, riskTone, shortDate, usd, waitLabel } from "./curator-math";
import { TemplateDialog } from "./template-dialog";

/** «Сегодня»: what needs the curator now — risk, discipline gaps, the review queue and next steps. */
export function TodayView({ data, onOpenTrader }: { data: TodayPayload; onOpenTrader: (trader: string, tab?: string) => void }) {
  const [templateFor, setTemplateFor] = React.useState<string[] | null>(null);
  const c = data.counts;
  const riskCount = c.halted + c.nearStop;

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
          hint={`за ${shortDate(data.prevDay)}`}
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
              {data.nextActions.slice(0, 10).map((a) => (
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
              {data.nextActions.length > 10 && <li className="px-1 text-xs text-muted-foreground">Ещё {data.nextActions.length - 10} — во вкладке «Мои трейдеры».</li>}
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
            {[...data.risk.halted, ...data.risk.nearStop].map((r) => (
              <Tile key={r.trader} onClick={() => onOpenTrader(r.trader, "risk")} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{r.trader}</span>
                  <Pill tone={riskTone(r.state)} dot>{r.label}</Pill>
                  <span className={cn("ml-auto text-sm tabular-nums", (r.pnlNet ?? 0) < 0 ? "text-down" : "text-foreground")}>{usd(r.pnlNet)}</span>
                </div>
                <LimitBar size="sm" used={r.dailyPct ?? 0} limit={100} warnAt={0.7} showValues={false} label="Дневной лимит" hint={r.dailyPct != null ? `${Math.round(r.dailyPct)}%` : undefined} />
                <p className="text-xs text-muted-foreground">{r.message}</p>
              </Tile>
            ))}
            {data.trading.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="micro-label">Торгуют</span>
                <ul className="flex flex-col">
                  {data.trading.map((t) => (
                    <li key={t.trader} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-b-0">
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-foreground hover:text-primary" onClick={() => onOpenTrader(t.trader)}>{t.trader}</button>
                      <span className="text-xs tabular-nums text-muted-foreground">{t.trades} сд.{t.openPositions ? ` · ${t.openPositions} откр.` : ""}</span>
                      <span className={cn("w-20 text-right tabular-nums", (t.pnlNet ?? 0) > 0 ? "text-up" : (t.pnlNet ?? 0) < 0 ? "text-down" : "text-foreground")}>{usd(t.pnlNet)}</span>
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
          description="Закрытые дни (SLA 24 ч), недельные отчёты (48 ч), задания Академии (72 ч) и нарушения (24 ч)"
          actions={<Button asChild size="sm" variant="ghost"><Link href={curatorLinks.journalQueue()}>Очередь дней <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
        >
          {data.queue.length === 0 ? (
            <EmptyState compact icon={BookCheck} title="Очередь пуста" description="Всё, что трейдеры сдали, уже разобрано." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.queue.slice(0, 12).map((q) => (
                <li key={q.id} className="tile flex min-w-0 items-center gap-3 px-3 py-2">
                  <Pill tone={QUEUE_TONE[q.kind]} className="w-24 justify-center">{QUEUE_LABEL[q.kind]}</Pill>
                  <span className="w-24 shrink-0 truncate text-sm font-medium text-foreground">{q.trader}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={q.title}>{q.title}</span>
                  <span className={cn("shrink-0 text-xs tabular-nums", q.overdue ? "text-down" : "text-muted-foreground")} title={`SLA ${q.slaHours} ч`}>
                    {waitLabel(q.hoursWaiting)}{q.overdue ? " · просрочено" : ""}
                  </span>
                  <Button asChild size="sm" variant="ghost" className="shrink-0"><Link href={q.href}>Разобрать</Link></Button>
                </li>
              ))}
              {data.queue.length > 12 && <li className="px-1 text-xs text-muted-foreground">Ещё {data.queue.length - 12} в очереди.</li>}
            </ul>
          )}
        </Panel>

        <Panel className="lg:col-span-5" fill title="Дисциплина" icon={ListChecks} description="Кому напомнить про план, закрытие дня и договорённости">
          <div className="flex flex-col gap-4">
            <GapList
              title={`Не закрыт день ${shortDate(data.prevDay)}`}
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
                  {data.overdueActions.slice(0, 6).map((a) => (
                    <li key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <button type="button" className="w-24 shrink-0 truncate text-left font-medium text-foreground hover:text-primary" onClick={() => onOpenTrader(a.trader, "academy")}>{a.trader}</button>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={a.title}>{a.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-down">−{a.daysOverdue} дн.</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </BentoGrid>

      <TemplateDialog open={!!templateFor} onOpenChange={(v) => { if (!v) setTemplateFor(null); }} traders={templateFor ?? []} />
    </div>
  );
}

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
