import * as React from "react";
import { Link } from "wouter";
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarCheck, GraduationCap, Layers, LayoutDashboard, NotebookPen, ShieldAlert, Target, TrendingUp, UserRound,
} from "lucide-react";
import {
  BentoGrid, DataTable, EmptyState, LimitBar, Panel, Pill, QueryState, SectionTabs, SortableTh, Sparkline, StatCard, StatGrid, StatusDot, toneText, useTableSort,
} from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCuratorProfile, type ProfilePayload } from "./api";
import { BreachReviewPanel } from "./breach-review";
import { actionTone, curatorLinks, dateTime, disciplineTone, riskTone, shortDate, usd } from "./curator-math";
import { GoalDialog } from "./goal-dialog";
import { NotesPanel } from "./notes-panel";
import { TemplateDialog } from "./template-dialog";

export type ProfileTab = "overview" | "risk" | "journal" | "weekly" | "academy" | "notes";
export const PROFILE_TABS: ProfileTab[] = ["overview", "risk", "journal", "weekly", "academy", "notes"];

const WEEK_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "up" | "warn" }> = {
  draft: { label: "Черновик", tone: "neutral" },
  submitted: { label: "Сдан, ждёт разбора", tone: "accent" },
  reviewed: { label: "Разобран", tone: "up" },
};
const ACTION_STATUS: Record<string, string> = { open: "Открыто", done: "Выполнено", dropped: "Снято" };
const GOAL_STATUS: Record<string, { label: string; tone: "accent" | "up" | "down" | "neutral" }> = {
  active: { label: "Активна", tone: "accent" },
  achieved: { label: "Достигнута", tone: "up" },
  missed: { label: "Не достигнута", tone: "down" },
  cancelled: { label: "Отменена", tone: "neutral" },
};
const MEETING_FORMAT: Record<string, string> = { call: "Звонок", video: "Видео", offline: "Встреча", chat: "Чат" };

type EodDay = ProfilePayload["eodDays"][number];
type WeekRow = ProfilePayload["weeks"][number];
/** 0 — ждёт разбора (наверх), 1 — не закрыт, 2 — разобран. */
const EOD_ACCESSORS = {
  date: (d: EodDay) => d.date,
  status: (d: EodDay) => (d.reviewedAt ? 2 : d.closedAt ? 0 : 1),
  discipline: (d: EodDay) => d.discipline,
  score: (d: EodDay) => d.curatorScore,
};
const WEEK_ORDER: Record<string, number> = { submitted: 0, draft: 1, reviewed: 2 };
const WEEK_ACCESSORS = {
  week: (w: WeekRow) => w.weekStart,
  status: (w: WeekRow) => WEEK_ORDER[w.status] ?? 3,
  submitted: (w: WeekRow) => (w.submittedAt ? Date.parse(w.submittedAt) : null),
  reviewed: (w: WeekRow) => (w.reviewedAt ? Date.parse(w.reviewedAt) : null),
  score: (w: WeekRow) => w.score,
};

/** Trader profile inside the cabinet: header with actions + tabs overview / risk / journal / weekly / academy / notes. */
export function TraderProfile({ trader, tab, onTab, onBack }: { trader: string; tab: ProfileTab; onTab: (t: ProfileTab) => void; onBack: () => void }) {
  const q = useCuratorProfile(trader);
  const [goalOpen, setGoalOpen] = React.useState(false);
  const [tplOpen, setTplOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <QueryState query={q} skeleton={<div className="glass-panel h-40 rounded-2xl" aria-hidden="true" />} errorTitle={`Профиль ${trader} не загрузился`}>
        {(p) => (
          <>
            <ProfileHeader p={p} onBack={onBack} onGoal={() => setGoalOpen(true)} onTemplate={() => setTplOpen(true)} />
            <SectionTabs
              ariaLabel="Разделы профиля"
              value={tab}
              onChange={onTab}
              tabs={[
                { value: "overview", label: "Обзор", icon: LayoutDashboard },
                { value: "risk", label: "Риск", icon: ShieldAlert, count: p.breaches.filter((b) => !b.review).length || undefined },
                { value: "journal", label: "Дневник", icon: BookOpen, count: p.signal.eod.pending || undefined },
                { value: "weekly", label: "Неделя", icon: CalendarCheck },
                { value: "academy", label: "Академия", icon: GraduationCap, count: p.signal.academy.overdueActions || undefined },
                { value: "notes", label: "Заметки", icon: NotebookPen, count: p.notes.length || undefined },
              ]}
            />
            {tab === "overview" && <OverviewTab p={p} onTab={onTab} onGoal={() => setGoalOpen(true)} />}
            {tab === "risk" && <RiskTab p={p} onTemplate={() => setTplOpen(true)} />}
            {tab === "journal" && <JournalTab p={p} />}
            {tab === "weekly" && <WeeklyTab p={p} />}
            {tab === "academy" && <AcademyTab p={p} onGoal={() => setGoalOpen(true)} />}
            {tab === "notes" && <NotesPanel trader={p.trader} notes={p.notes} />}
            <GoalDialog open={goalOpen} onOpenChange={setGoalOpen} trader={p.trader} />
            <TemplateDialog open={tplOpen} onOpenChange={setTplOpen} traders={[p.trader]} defaultTier={p.signal.tier ?? p.signal.stage.key} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function ProfileHeader({ p, onBack, onGoal, onTemplate }: { p: ProfilePayload; onBack: () => void; onGoal: () => void; onTemplate: () => void }) {
  const s = p.signal;
  const people = [
    p.assigned.curator && `куратор ${p.assigned.curator}`,
    p.assigned.mentor && `ментор ${p.assigned.mentor}`,
    p.assigned.riskManager && `риск ${p.assigned.riskManager}`,
  ].filter(Boolean).join(" · ");
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} aria-label="Назад к списку трейдеров">
          <ArrowLeft className="h-4 w-4" /> Все трейдеры
        </Button>
        <span className="tile grid h-10 w-10 shrink-0 place-items-center rounded-xl text-primary"><UserRound className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">{p.trader}</h2>
            {s.stage.label && <Pill tone="purple">{s.stage.label}</Pill>}
            {s.tierName && <Pill tone="neutral">тир {s.tierName}</Pill>}
            <Pill tone={riskTone(s.risk.state)} dot>{s.risk.hasLimits ? s.risk.label : "Без лимитов"}</Pill>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{people || "куратор не закреплён"}{s.lastTradeDate ? ` · посл. сделка ${shortDate(s.lastTradeDate)}` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {p.canEditLimits && <Button type="button" size="sm" variant="outline" onClick={onTemplate}><Layers className="h-3.5 w-3.5" /> Шаблон лимитов</Button>}
          <Button type="button" size="sm" onClick={onGoal}><Target className="h-3.5 w-3.5" /> Назначить цель</Button>
        </div>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-[var(--glass-border)] pt-3">
        <span className="micro-label shrink-0">Следующий шаг</span>
        <StatusDot tone={actionTone(s.nextAction.kind)} className="min-w-0 flex-1"><span className="text-sm text-foreground">{s.nextAction.label}</span></StatusDot>
        {s.nextAction.kind !== "none" && !s.nextAction.href.startsWith(`/curator?`) && (
          <Button asChild size="sm" variant="ghost"><Link href={s.nextAction.href}>Перейти <ArrowRight className="h-3.5 w-3.5" /></Link></Button>
        )}
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--glass-border)]" aria-hidden="true" />
        <nav aria-label="Разделы по трейдеру" className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm" variant="ghost"><Link href={curatorLinks.risk(p.trader)}>Риск-деск</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link href={curatorLinks.journalQueue()}>Очередь дней</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link href={curatorLinks.weeklyCurator(p.trader)}>Неделя</Link></Button>
        </nav>
      </div>
    </Panel>
  );
}

function OverviewTab({ p, onTab, onGoal }: { p: ProfilePayload; onTab: (t: ProfileTab) => void; onGoal: () => void }) {
  const s = p.signal;
  const fourWeekNet = s.trend.reduce((a, w) => a + (w.net ?? 0), 0);
  const unreviewed = p.breaches.filter((b) => !b.review);
  const activeGoals = p.goals.filter((g) => g.status === "active");
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <StatGrid cols={4}>
        <StatCard label="Сегодня, нетто" value={s.risk.todayTrades ? usd(s.risk.todayPnl) : "—"} tone={(s.risk.todayPnl ?? 0) > 0 ? "up" : (s.risk.todayPnl ?? 0) < 0 ? "down" : "neutral"} hint={`${s.risk.todayTrades} сделок`} term="net" />
        <StatCard label="Неделя, нетто" value={usd(s.risk.weekPnl)} tone={(s.risk.weekPnl ?? 0) > 0 ? "up" : (s.risk.weekPnl ?? 0) < 0 ? "down" : "neutral"} hint={p.metrics?.week.limitUsedPct != null ? `${Math.round(p.metrics.week.limitUsedPct)}% недельного лимита` : undefined} />
        <StatCard label="4 недели" value={usd(fourWeekNet)} tone={fourWeekNet > 0 ? "up" : fourWeekNet < 0 ? "down" : "neutral"} spark={s.trend.map((w) => w.net)} hint={s.trend.map((w) => w.trades).reduce((a, b) => a + b, 0) + " сделок"} />
        <StatCard
          label="Дисциплина, 0–10"
          value={s.discipline.value != null ? s.discipline.value.toFixed(1) : "—"}
          tone={disciplineTone(s.discipline.value)}
          hint={[s.discipline.eodAvg != null && `дни ${s.discipline.eodAvg.toFixed(1)}/5`, s.discipline.ratingAvg != null && `рейтинг ${s.discipline.ratingAvg.toFixed(1)}/10`].filter(Boolean).join(" · ") || "нет оценок"}
        />
      </StatGrid>
      <BentoGrid>
        <div className="flex flex-col gap-[var(--grid-gap)] lg:col-span-7">
          {unreviewed.length > 0 ? (
            <BreachReviewPanel breaches={unreviewed} canReview title="Нарушения без разбора" />
          ) : (
            <Panel title="Риск" icon={ShieldAlert} actions={<Button type="button" size="sm" variant="ghost" onClick={() => onTab("risk")}>Подробнее <ArrowRight className="h-3.5 w-3.5" /></Button>}>
              <RiskBars p={p} />
              <p className="mt-3 text-xs text-muted-foreground">
                {p.breaches.length ? `Нарушений за 90 дней: ${p.breaches.length}, все разобраны.` : "Нарушений за 90 дней не было."}
              </p>
            </Panel>
          )}
          <Panel
            title="Цели развития"
            icon={Target}
            actions={<Button type="button" size="sm" variant="ghost" onClick={onGoal}>Назначить</Button>}
          >
            <GoalsList goals={activeGoals.length ? activeGoals : p.goals.slice(0, 3)} />
          </Panel>
        </div>
        <div className="flex flex-col gap-[var(--grid-gap)] lg:col-span-5">
          <Panel title="Последние отчёты" icon={BookOpen}>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Последний закрытый день</dt>
              <dd className="text-right tabular-nums text-foreground">{shortDate(s.eod.lastClosed)}</dd>
              <dt className="text-muted-foreground">Ждут разбора дней</dt>
              <dd className={cn("text-right tabular-nums", s.eod.pending ? "text-primary" : "text-foreground")}>{s.eod.pending}</dd>
              <dt className="text-muted-foreground">Последний разбор дня</dt>
              <dd className="text-right tabular-nums text-foreground">{s.eod.lastReviewedAt ? shortDate(s.eod.lastReviewedAt.slice(0, 10)) : "не было"}{s.eod.lastScore != null ? ` · ${s.eod.lastScore}/5` : ""}</dd>
              <dt className="text-muted-foreground">Недельный отчёт</dt>
              <dd className="text-right text-foreground">{s.weekly.currentStatus ? WEEK_STATUS[s.weekly.currentStatus]?.label ?? s.weekly.currentStatus : "не начат"}</dd>
              <dt className="text-muted-foreground">1:1</dt>
              <dd className={cn("text-right tabular-nums", (s.academy.daysSinceOneOnOne ?? 99) > 14 ? "text-warn" : "text-foreground")}>
                {s.academy.lastOneOnOne ? `${shortDate(s.academy.lastOneOnOne.slice(0, 10))} (${s.academy.daysSinceOneOnOne} дн.)` : "не было"}
              </dd>
            </dl>
          </Panel>
          <NotesPanel trader={p.trader} notes={p.notes} compact />
        </div>
      </BentoGrid>
    </div>
  );
}

function RiskBars({ p }: { p: ProfilePayload }) {
  const m = p.metrics;
  const l = p.limits;
  if (!l) return <p className="text-sm text-warn">Лимиты не заданы — стоп по дневному убытку не сработает. Примените шаблон тира.</p>;
  return (
    <div className="flex flex-col gap-3">
      <LimitBar label="Дневной убыток" used={m ? Math.min(0, m.today.pnlNet ?? 0) : 0} limit={l.dailyLossLimit} warnAt={0.7} format={(n) => usd(n, false)} />
      <LimitBar label="Недельный убыток" used={m ? Math.min(0, m.week.pnlNet ?? 0) : 0} limit={l.weeklyLossLimit} warnAt={0.7} format={(n) => usd(n, false)} />
      <LimitBar label="Просадка от пика" used={m?.drawdown.currentUsd ?? 0} limit={l.maxDrawdown} warnAt={0.7} format={(n) => usd(n, false)} hint={m?.drawdown.redDayStreak ? `красных дней подряд: ${m.drawdown.redDayStreak}` : undefined} />
    </div>
  );
}

function RiskTab({ p, onTemplate }: { p: ProfilePayload; onTemplate: () => void }) {
  const l = p.limits;
  const drift = p.signal.risk.templateDrift;
  const rows: [string, React.ReactNode][] = l ? [
    ["Дневной лимит", usd(l.dailyLossLimit, false)],
    ["Недельный лимит", usd(l.weeklyLossLimit, false)],
    ["Макс. просадка", usd(l.maxDrawdown, false)],
    ["Риск на сделку", usd(l.maxRiskPerTrade, false)],
    ["Макс. позиция", usd(l.maxPositionUsd, false)],
    ["Открытых позиций", l.maxOpenPositions ?? "—"],
    ["Овернайт", l.allowOvernight ? `да, до ${usd(l.maxOvernightExposure, false)}` : "нет"],
    ["Свинг", l.allowSwing ? "да" : "нет"],
  ] : [];
  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      <BentoGrid>
        <Panel className="lg:col-span-7" fill title="Использование лимитов сегодня" icon={ShieldAlert} description="70% — предупреждение трейдеру, 100% — стоп и уведомление куратору">
          <RiskBars p={p} />
          {p.metrics && p.metrics.alerts.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {p.metrics.alerts.map((a) => (
                <li key={a.kind} className="flex items-center gap-2 text-sm">
                  <Pill tone={a.level === "breach" ? "down" : "warn"} dot>{a.label}</Pill>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{a.detail ?? ""}</span>
                  <span className="text-xs tabular-nums text-foreground">{a.pct != null ? `${Math.round(a.pct)}%` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          className="lg:col-span-5"
          fill
          title="Лимиты"
          icon={Layers}
          description={p.signal.tierName ? `Тир «${p.signal.tierName}»` : "Тир не назначен"}
          actions={p.canEditLimits ? <Button type="button" size="sm" variant="outline" onClick={onTemplate}>Шаблон тира</Button> : undefined}
        >
          {l ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              {rows.map(([k, v]) => (
                <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums text-foreground">{v}</dd></React.Fragment>
              ))}
            </dl>
          ) : (
            <EmptyState compact icon={Layers} title="Лимитов нет" description="Примените шаблон тира — лимиты, журнал и уведомление трейдеру одним действием." />
          )}
          {drift.length > 0 && (
            <p className="mt-3 rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs text-warn">Отличается от шаблона тира: {drift.join(", ")}</p>
          )}
          {p.limitEvents.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <span className="micro-label">Последние изменения</span>
              {p.limitEvents.map((e) => (
                <p key={e.id} className="break-words text-xs text-muted-foreground">
                  <span className="tabular-nums">{dateTime(e.changedAt)}</span> · {e.changedBy ?? "—"}{e.reason ? ` · ${e.reason}` : ""}
                </p>
              ))}
            </div>
          )}
          <Button asChild size="sm" variant="ghost" className="mt-3 self-start"><Link href={curatorLinks.riskLimits(p.trader)}>Изменить вручную в риск-деске <ArrowRight className="h-3.5 w-3.5" /></Link></Button>
        </Panel>
      </BentoGrid>
      <BreachReviewPanel breaches={p.breaches} canReview />
    </div>
  );
}

function JournalTab({ p }: { p: ProfilePayload }) {
  const { rows, thProps } = useTableSort(p.eodDays, EOD_ACCESSORS, "date");
  return (
    <Panel
      title="Закрытые дни"
      icon={BookOpen}
      description="Последние 15 дней дневника: самооценка дисциплины (1–5) и разбор куратора (1–5)"
      actions={<Button asChild size="sm" variant="ghost"><Link href={curatorLinks.journalQueue()}>Очередь разборов <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
    >
      {p.eodDays.length === 0 ? (
        <EmptyState compact icon={BookOpen} title="Дней в дневнике нет" description="Трейдер ещё не закрывал день." />
      ) : (
        <DataTable ariaLabel="Дни дневника">
          <table>
            <thead>
              <tr>
                <SortableTh {...thProps("date")}>Дата</SortableTh>
                <SortableTh {...thProps("status")}>Статус</SortableTh>
                <SortableTh {...thProps("discipline")} align="right">Дисциплина</SortableTh>
                <SortableTh {...thProps("score")} align="right">Оценка куратора</SortableTh>
                <th>Комментарий</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">{shortDate(d.date)}</td>
                  <td>
                    {d.reviewedAt ? <Pill tone="up">Разобран · {d.reviewedBy}</Pill> : d.closedAt ? <Pill tone="accent" dot>Ждёт разбора</Pill> : <Pill tone="neutral">Не закрыт</Pill>}
                  </td>
                  <td className={cn("text-right", d.discipline != null && toneText(d.discipline >= 4 ? "up" : d.discipline >= 3 ? "warn" : "down"))}>{d.discipline != null ? `${d.discipline}/5` : "—"}</td>
                  <td className="text-right">{d.curatorScore != null ? `${d.curatorScore}/5` : "—"}</td>
                  <td className="min-w-[14rem] max-w-[36rem] whitespace-pre-line break-words text-muted-foreground">{d.curatorComment ?? ""}</td>
                  <td className="text-right"><Link href={curatorLinks.journalDay(p.trader, d.date)} className="text-xs text-primary hover:underline">Открыть</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

function WeeklyTab({ p }: { p: ProfilePayload }) {
  const scores = [...p.weeks].reverse().map((w) => w.score);
  const { rows, thProps } = useTableSort(p.weeks, WEEK_ACCESSORS, "week");
  return (
    <Panel
      title="Недельные отчёты"
      icon={CalendarCheck}
      description="Последние 8 недель: статус и оценка куратора (1–10)"
      actions={
        <div className="flex items-center gap-2">
          {scores.filter((v) => v != null).length > 1 && <Sparkline data={scores} width={96} height={24} ariaLabel="Оценки недель" />}
          <Button asChild size="sm" variant="ghost"><Link href={curatorLinks.weeklyCurator(p.trader)}>Разбор недели <ArrowRight className="h-3.5 w-3.5" /></Link></Button>
        </div>
      }
    >
      {p.weeks.length === 0 ? (
        <EmptyState compact icon={CalendarCheck} title="Отчётов нет" description="Трейдер ещё не начинал недельный отчёт." />
      ) : (
        <DataTable ariaLabel="Недельные отчёты">
          <table>
            <thead>
              <tr>
                <SortableTh {...thProps("week")}>Неделя</SortableTh>
                <SortableTh {...thProps("status")}>Статус</SortableTh>
                <SortableTh {...thProps("submitted")}>Сдан</SortableTh>
                <SortableTh {...thProps("reviewed")}>Разобран</SortableTh>
                <SortableTh {...thProps("score")} align="right">Оценка</SortableTh>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const st = WEEK_STATUS[w.status] ?? { label: w.status, tone: "neutral" as const };
                return (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap">с {shortDate(w.weekStart)}</td>
                    <td><Pill tone={st.tone} dot={w.status === "submitted"}>{st.label}</Pill></td>
                    <td className="text-muted-foreground">{dateTime(w.submittedAt)}</td>
                    <td className="text-muted-foreground">{dateTime(w.reviewedAt)}</td>
                    <td className={cn("text-right", w.score != null && toneText(disciplineTone(w.score)))}>{w.score != null ? `${w.score}/10` : "—"}</td>
                    <td className="text-right"><Link href={curatorLinks.weeklyCurator(p.trader, w.week)} className="text-xs text-primary hover:underline">Открыть</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}
    </Panel>
  );
}

function GoalsList({ goals }: { goals: ProfilePayload["goals"] }) {
  if (!goals.length) return <EmptyState compact icon={Target} title="Целей нет" description="Назначьте цель — прогресс посчитается по сделкам и дневнику." />;
  return (
    <ul className="flex flex-col gap-2">
      {goals.map((g) => {
        const st = GOAL_STATUS[g.status] ?? { label: g.status, tone: "neutral" as const };
        const pctDone = g.lastProgress != null ? Math.round(g.lastProgress * 100) : null;
        return (
          <li key={g.id} className="tile flex flex-col gap-1.5 p-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium text-foreground" title={g.title}>{g.title}</span>
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
            <LimitBar size="sm" used={pctDone ?? 0} limit={100} warnAt={0} tone="ok" showValues={false} hint={`${pctDone != null ? `${pctDone}%` : "ещё не считалось"}${g.dueOn ? ` · срок ${shortDate(g.dueOn)}` : ""}`} />
          </li>
        );
      })}
    </ul>
  );
}

function AcademyTab({ p, onGoal }: { p: ProfilePayload; onGoal: () => void }) {
  const s = p.signal;
  const open = p.actions.filter((a) => a.status === "open");
  const closed = p.actions.filter((a) => a.status !== "open").slice(0, 5);
  return (
    <BentoGrid>
      <div className="flex flex-col gap-[var(--grid-gap)] lg:col-span-7">
        <Panel title="Договорённости 1:1" icon={CalendarCheck} description="Что трейдер и ментор договорились сделать" actions={<Button asChild size="sm" variant="ghost"><Link href={curatorLinks.academyMentor()}>Кабинет ментора <ArrowRight className="h-3.5 w-3.5" /></Link></Button>}>
          {p.actions.length === 0 ? (
            <EmptyState compact icon={CalendarCheck} title="Договорённостей нет" description="Они появятся после 1:1 в Академии." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...open, ...closed].map((a) => (
                <li key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
                  <StatusDot tone={a.status !== "open" ? "up" : a.overdue ? "down" : "accent"}><span className="sr-only">{ACTION_STATUS[a.status] ?? a.status}</span></StatusDot>
                  <span className={cn("line-clamp-2 min-w-0 flex-1 break-words", a.status !== "open" ? "text-muted-foreground line-through" : "text-foreground")} title={a.title}>{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.owner === p.trader ? "трейдер" : a.owner}</span>
                  <span className={cn("w-16 shrink-0 text-right text-xs tabular-nums", a.overdue ? "text-down" : "text-muted-foreground")}>{a.dueOn ? shortDate(a.dueOn) : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Цели развития" icon={Target} actions={<Button type="button" size="sm" onClick={onGoal}><Target className="h-3.5 w-3.5" /> Назначить цель</Button>}>
          <GoalsList goals={p.goals} />
        </Panel>
      </div>
      <div className="flex flex-col gap-[var(--grid-gap)] lg:col-span-5">
        <Panel title="Этап" icon={TrendingUp}>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Ступень</dt>
            <dd className="text-right text-foreground">{s.stage.label ?? "не задана"}</dd>
            <dt className="text-muted-foreground">С</dt>
            <dd className="text-right tabular-nums text-foreground">{s.stage.since ? shortDate(s.stage.since.slice(0, 10)) : "—"}</dd>
            <dt className="text-muted-foreground">Тир лимитов</dt>
            <dd className="text-right text-foreground">{s.tierName ?? "не назначен"}</dd>
            <dt className="text-muted-foreground">Задания на проверке</dt>
            <dd className={cn("text-right tabular-nums", s.academy.pendingSubmissions ? "text-primary" : "text-foreground")}>{s.academy.pendingSubmissions}</dd>
          </dl>
          <Button asChild size="sm" variant="ghost" className="mt-3"><Link href={curatorLinks.scaling(p.trader)}>Скейлинг и тиры <ArrowRight className="h-3.5 w-3.5" /></Link></Button>
        </Panel>
        <Panel title="Встречи 1:1" icon={UserRound} description="Личные заметки ментора здесь не показываются">
          {p.meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Встреч ещё не было.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {p.meetings.map((m) => (
                <li key={m.id} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center gap-2"><span className="tabular-nums text-foreground">{dateTime(m.metAt)}</span><span className="text-xs text-muted-foreground">{MEETING_FORMAT[m.format] ?? m.format} · {m.mentor}</span></span>
                  {m.agenda && <span className="line-clamp-2 text-xs text-muted-foreground">{m.agenda}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </BentoGrid>
  );
}
