/** «Экзамены»: list cards, detail (rules progress + day-by-day timeline), create-from-template dialog. */
import * as React from "react";
import { Archive, CalendarRange, Flag, ListChecks, Plus } from "lucide-react";
import { EmptyState, Panel, StatCard, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type ChallengeListItem, type ChallengeRules, type ChallengeTemplate, type StageKey,
  fmtDate, fmtWindow, sendJson, stageName, suggestedTemplate, usd, useChallenge, useFunnel, usePathMutation,
} from "./api";
import { ChallengeStatusPill, ChallengeTimeline, Field, RuleBar, selectCls } from "./bits";

export function rulesSummary(r: ChallengeRules): string {
  const parts = [
    `счёт ${usd(r.accountSize)}`,
    r.profitTarget != null ? `цель +${usd(r.profitTarget)}` : null,
    r.dailyLossLimit != null ? `дневной −${usd(r.dailyLossLimit)}` : null,
    r.maxDrawdown != null ? `DD ${usd(r.maxDrawdown)} ${r.drawdownMode === "static" ? "стат." : r.drawdownMode === "trailing_eod" ? "трейл. EOD" : "трейл."}` : null,
    r.consistencyPct != null ? `лучший день ≤ ${r.consistencyPct}%` : null,
    r.minTradingDays != null ? `мин. ${r.minTradingDays} дн.` : null,
    r.maxPositionUsd != null ? `позиция ≤ ${usd(r.maxPositionUsd)}` : null,
    r.tradingWindow ? `окно ${fmtWindow(r.tradingWindow)} NY${r.tradingWindowStrict ? "" : " (мягко)"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function ChallengeCard({ c, active, onOpen, showUser }: { c: ChallengeListItem; active: boolean; onOpen: () => void; showUser: boolean }) {
  const r = c.result;
  const target = r.progress.find((p) => p.key === "profit_target");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      className={cn("glass-panel flex w-full flex-col gap-2 rounded-2xl p-3 text-left transition-colors hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary/60")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
          <p className="text-xs text-muted-foreground">{showUser ? `${c.user} · ` : ""}{fmtDate(c.startsOn)} – {fmtDate(c.endsOn)}</p>
        </div>
        <ChallengeStatusPill status={r.status} label={r.statusLabel} />
      </div>
      {target && target.pct != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" role="progressbar" aria-label={`Цель: ${Math.round(target.pct * 100)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(target.pct * 100)}>
          <div className={cn("h-full rounded-full", r.status === "failed" ? "bg-down" : r.status === "passed" ? "bg-up" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(1, target.pct)) * 100}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className={cn("font-semibold", r.stats.net > 0 ? "text-up" : r.stats.net < 0 ? "text-down" : "text-foreground")}>{usd(r.stats.net)}</span>
        <span className="text-muted-foreground">{r.stats.tradingDays} торг. дн. · осталось {r.tradingDaysLeft}</span>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{r.reason}</p>
    </button>
  );
}

export function ChallengeDetailView({ id, onArchived }: { id: number; onArchived: () => void }) {
  const q = useChallenge(id);
  const { toast } = useToast();
  const archive = usePathMutation(() => sendJson(`/academy/challenges/${id}/archive`, "POST"));
  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <Panel><EmptyState icon={Flag} title="Экзамен не найден" description={(q.error as Error | null)?.message} /></Panel>;
  const { challenge: c, result: r, canManage } = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={c.name}
        description={`${c.user} · ${fmtDate(c.startsOn)} – ${fmtDate(c.endsOn)} · назначил ${c.createdBy}`}
        icon={Flag}
        actions={
          <>
            <ChallengeStatusPill status={r.status} label={r.statusLabel} />
            {canManage && !c.archivedAt && (
              <Button size="sm" variant="ghost" disabled={archive.isPending}
                onClick={() => archive.mutate(undefined, {
                  onSuccess: () => { toast({ title: "Экзамен перенесён в архив" }); onArchived(); },
                  onError: (e) => toast({ title: "Не удалось", description: (e as Error).message, variant: "destructive" }),
                })}>
                <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />В архив
              </Button>
            )}
          </>
        }
      >
        <p className={cn("text-sm", r.status === "failed" ? "text-down" : r.status === "passed" ? "text-up" : "text-foreground")} role="status">{r.reason}</p>
        {r.failure && (
          <p className="mt-1 text-xs text-muted-foreground">
            Правило «{r.failure.label}» нарушено {fmtDate(r.failure.date)}{r.failure.time ? ` в ${r.failure.time} NY` : ""}{r.failure.tradeId ? ` (сделка #${r.failure.tradeId})` : ""}.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{rulesSummary(c.rules)}</p>
        {c.comment && <p className="mt-2 text-sm text-foreground/90">«{c.comment}»</p>}
      </Panel>

      <StatGrid>
        <StatCard label="P&L нетто" value={usd(r.stats.net)} tone={r.stats.net > 0 ? "up" : r.stats.net < 0 ? "down" : "neutral"} hint={`Баланс ${usd(r.stats.balance)}`} />
        <StatCard label="Торговых дней" value={`${r.stats.tradingDays}`} hint={`Прошло ${r.tradingDaysElapsed} из ${r.tradingDaysTotal}, осталось ${r.tradingDaysLeft}`} />
        <StatCard label="Лучший / худший день" value={`${usd(r.stats.bestDay)} / ${usd(r.stats.worstDay)}`} hint={r.stats.consistencyPct != null ? `Лучший день = ${Math.round(r.stats.consistencyPct)}% прибыли` : "Прибыли пока нет"} />
        <StatCard label="Макс. просадка" value={usd(r.stats.maxDdUsed)} tone={r.stats.maxDdUsed > 0 ? "down" : "neutral"} hint={`Худший внутридневной ${usd(r.stats.worstDayLow)}`} />
      </StatGrid>

      <Panel title="Правила" icon={ListChecks} description="Прогресс к цели и использование лимитов">
        <ul className="grid gap-4 md:grid-cols-2">{r.progress.map((p) => <RuleBar key={p.key} p={p} />)}</ul>
        {(r.stats.tradesWithoutPnl > 0 || r.stats.tradesWithoutTime > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {r.stats.tradesWithoutPnl > 0 && `${r.stats.tradesWithoutPnl} сделок без P&L не учтены. `}
            {r.stats.tradesWithoutTime > 0 && `${r.stats.tradesWithoutTime} сделок без времени входа не проверены по окну.`}
          </p>
        )}
      </Panel>

      <Panel title="По дням" icon={CalendarRange} description="Время — Нью-Йорк (ET). Расчёт останавливается в день провала или сдачи.">
        <ChallengeTimeline days={r.timeline} accountSize={c.rules.accountSize} />
      </Panel>
    </div>
  );
}

function nyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function CreateChallengeDialog({ open, onOpenChange, templates, people, defaultUser, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; templates: ChallengeTemplate[]; people: string[]; defaultUser: string | null; onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [user, setUser] = React.useState(defaultUser ?? people[0] ?? "");
  const [tplKey, setTplKey] = React.useState(templates[0]?.key ?? "");
  const [startsOn, setStartsOn] = React.useState(nyToday());
  const [endsOn, setEndsOn] = React.useState("");
  const [comment, setComment] = React.useState("");
  React.useEffect(() => { if (open) { setUser(defaultUser ?? people[0] ?? ""); setTplKey((k) => k || templates[0]?.key || ""); } }, [open, defaultUser, people, templates]);
  // Stage of each person (staff funnel) → the capital exam suggested for the selected trader.
  const funnel = useFunnel(open);
  const stageOf = React.useMemo(() => {
    const m = new Map<string, StageKey>();
    for (const col of funnel.data?.columns ?? []) for (const p of col.people) if (p.stage) m.set(p.user, p.stage);
    return m;
  }, [funnel.data]);
  const userStage = stageOf.get(user) ?? null;
  const suggested = suggestedTemplate(templates, userStage);
  React.useEffect(() => { if (open && suggested) setTplKey(suggested.key); }, [open, user, suggested?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const capital = templates.filter((t) => t.toStage != null);
  const tests = templates.filter((t) => t.toStage == null);
  const tpl = templates.find((t) => t.key === tplKey);
  const create = usePathMutation((body: unknown) => sendJson<{ id: number }>("/academy/challenges", "POST", body));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Назначить экзамен</DialogTitle>
          <DialogDescription>Экзамен считается по реальным сделкам ученика за период. Ученик и его наставники получат уведомления о сдаче или провале.</DialogDescription>
        </DialogHeader>
        <form
          id="create-challenge"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!user || !tpl) return;
            create.mutate({ user, templateKey: tpl.key, startsOn, endsOn: endsOn || undefined, comment: comment.trim() || undefined }, {
              onSuccess: (out) => { toast({ title: "Экзамен назначен", description: `${tpl.name} — ${user}` }); onOpenChange(false); setComment(""); setEndsOn(""); onCreated(out.id); },
              onError: (err) => toast({ title: "Не удалось назначить", description: (err as Error).message, variant: "destructive" }),
            });
          }}
        >
          <Field label="Ученик" htmlFor="ch-user">
            <select id="ch-user" className={selectCls} value={user} onChange={(e) => setUser(e.target.value)} required>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Шаблон" htmlFor="ch-tpl"
            hint={userStage ? (suggested ? `Ступень ${user}: ${stageName(funnel.data?.stages, userStage)} — рекомендован «${suggested.name}»` : `Ступень ${user}: ${stageName(funnel.data?.stages, userStage)} — экзамена на перевод выше нет`) : undefined}>
            <select id="ch-tpl" className={selectCls} value={tplKey} onChange={(e) => setTplKey(e.target.value)}>
              {capital.length > 0 && (
                <optgroup label="Перевод на капитал">
                  {capital.map((t) => <option key={t.key} value={t.key}>{t.name}{t.key === suggested?.key ? " — рекомендован" : ""}</option>)}
                </optgroup>
              )}
              {tests.length > 0 && (
                <optgroup label="Тесты стажёра">
                  {tests.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </optgroup>
              )}
            </select>
          </Field>
          {tpl && <p className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs text-muted-foreground">{tpl.description}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Начало (NY)" htmlFor="ch-start">
              <input id="ch-start" type="date" className={selectCls} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
            </Field>
            <Field label="Конец (пусто — по шаблону)" htmlFor="ch-end">
              <input id="ch-end" type="date" className={selectCls} value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          <Field label="Комментарий" htmlFor="ch-comment">
            <Textarea id="ch-comment" rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Зачем экзамен и на что обратить внимание" />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" form="create-challenge" disabled={create.isPending || !user || !tpl}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Назначить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
