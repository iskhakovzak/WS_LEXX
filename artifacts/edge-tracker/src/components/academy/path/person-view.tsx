/** One trader's path: ladder, readiness report, promotion request, mentor decision, direct stage assignment, history. */
import * as React from "react";
import { History, Send, ShieldCheck, Target, Undo2, UserCog } from "lucide-react";
import { EmptyState, Panel, Pill, ProgressRing, StatCard, StatGrid } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type PathConfig, type PromotionRequest, type StageKey, STAGE_KEYS,
  fmtInstant, stageName, usePathMutation, useReport,
} from "./api";
import { fmtDate, fmtUsd } from "@/lib/format";
import { http } from "@/lib/api/http";
import { CriterionRow, Field, StageLadder, selectCls } from "./bits";

const ACTION_LABEL: Record<string, string> = { promote: "Повышение", demote: "Понижение", assign: "Назначение", approve: "Перевод по заявке" };

export function PersonView({ user, config, isStaff, me }: { user: string | null; config: PathConfig | undefined; isStaff: boolean; me: string | null }) {
  const q = useReport(user);
  const stages = config?.stages ?? [];
  const data = q.data;
  const r = data?.report ?? null;

  if (q.isLoading) return <div className="flex flex-col gap-3"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (q.isError) return <Panel><EmptyState icon={Target} title="Не удалось загрузить отчёт" description={(q.error as Error).message} /></Panel>;
  if (!r) return <Panel><EmptyState icon={Target} title="Путь трейдера доступен после входа" description="Гостевой режим не показывает личные отчёты." /></Panel>;

  const isSelf = !!me && r.user === me;
  const pct = r.total ? (r.passed / r.total) * 100 : 0;
  const s = r.summary;

  return (
    <div className="flex flex-col gap-4">
      <StageLadder stages={stages} current={r.stage?.key ?? null} readyFor={r.ready ? r.nextStage?.key : null} />

      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing value={pct} size={72} stroke={6} tone={r.ready ? "up" : pct >= 70 ? "warn" : "accent"} label={<span className="text-sm font-semibold tabular-nums">{r.passed}/{r.total}</span>} ariaLabel={`Выполнено ${r.passed} из ${r.total} критериев`} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-lg font-semibold", r.ready ? "text-up" : "text-foreground")} role="status">{r.headline}</p>
            <p className="text-sm text-muted-foreground">
              {r.user} · ступень «{r.stage?.name ?? "не назначена"}»{r.stageSince ? ` с ${fmtDate(r.stageSince)}` : ""}
              {r.nextStage ? ` → следующая «${r.nextStage.name}»` : ""} · расчёт на {fmtDate(r.today)}
            </p>
          </div>
          {data?.pendingRequest
            ? <Pill tone="accent" dot>Заявка на рассмотрении</Pill>
            : r.nextStage && r.stage && (isSelf || isStaff) && <RequestButton user={r.user} ready={r.ready} />}
        </div>
      </Panel>

      <StatGrid>
        <StatCard label={`P&L нетто, ${s.windowDays} дн.`} value={fmtUsd(s.net, { decimals: 0 })} tone={s.net == null ? "neutral" : s.net >= 0 ? "up" : "down"} hint={`${s.tradingDays} торг. дн. · ${s.trades ?? 0} сделок`} />
        <StatCard label="Win rate / PF" value={`${s.winRate == null ? "—" : `${Math.round(s.winRate)}%`} · ${s.profitFactor == null ? "—" : `${s.profitFactor.toFixed(2)}×`}`} hint="WR = W/(W+L); PF без убытков не определён" />
        <StatCard label="Макс. просадка" value={fmtUsd(s.maxDd, { decimals: 0 })} tone={s.maxDd ? "down" : "neutral"} hint={`Лучший день ${s.consistency == null ? "—" : `${Math.round(s.consistency)}%`} прибыли`} />
        <StatCard label="Комиссии / дисциплина" value={`${s.feeShare == null ? "—" : `${Math.round(s.feeShare)}%`} · ${s.disciplineIndex == null ? "—" : Math.round(s.disciplineIndex)}`} hint="Доля комиссий в брутто · индекс дисциплины 0–100" />
      </StatGrid>

      {data?.pendingRequest && <PendingRequest req={data.pendingRequest} canDecide={data.canDecide} isSelf={isSelf} stages={stages} />}

      <Panel title={r.nextStage ? `Критерии перевода «${r.stage?.name}» → «${r.nextStage.name}»` : "Критерии"} icon={Target}
        description="Статус, значение, цель, динамика к прошлому такому же окну и что улучшить">
        {r.criteria.length ? <ul className="divide-y divide-[var(--field-border)]">{r.criteria.map((c) => <CriterionRow key={c.id} c={c} />)}</ul>
          : <p className="text-sm text-muted-foreground">{r.stage ? "Для этой ступени критерии не настроены." : "Ступень не назначена — наставник назначит её ниже."}</p>}
        {r.skipped.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--field-border)] p-3">
            <p className="text-xs font-medium text-muted-foreground">Не учитываются (источник данных не подключён):</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{r.skipped.map((c) => <li key={c.id}>{c.label} — {c.note}</li>)}</ul>
          </div>
        )}
      </Panel>

      {isStaff && !isSelf && <AssignStage user={r.user} current={r.stage?.key ?? null} config={config} />}

      <Panel title="История ступеней" icon={History}>
        {data?.history.length ? (
          <ol className="flex flex-col gap-2">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="tabular-nums text-xs text-muted-foreground">{fmtInstant(h.createdAt)}</span>
                <span className="font-medium text-foreground">{ACTION_LABEL[h.action] ?? h.action}: {stageName(stages, h.fromStage)} → {stageName(stages, h.toStage)}</span>
                <span className="text-xs text-muted-foreground">({h.actor})</span>
                {h.comment && <span className="w-full text-xs text-muted-foreground">«{h.comment}»</span>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">Переводов пока не было.</p>}
      </Panel>
    </div>
  );
}

function RequestButton({ user, ready }: { user: string; ready: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const m = usePathMutation((v: { user: string; comment?: string }) => http.post<{ request: PromotionRequest }>("/api/academy/path/requests", v));
  if (!open) return <Button size="sm" variant={ready ? "default" : "outline"} onClick={() => setOpen(true)}><Send className="mr-1.5 h-4 w-4" aria-hidden="true" />Подать на перевод</Button>;
  return (
    <form
      className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[320px]"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ user, comment: comment.trim() || undefined }, {
          onSuccess: () => { toast({ title: "Заявка отправлена наставнику" }); setOpen(false); setComment(""); },
          onError: (err) => toast({ title: "Заявка не отправлена", description: (err as Error).message, variant: "destructive" }),
        });
      }}
    >
      {!ready && <p className="text-xs text-[hsl(var(--chart-3))]">Выполнены не все критерии — наставник увидит отчёт и решит сам.</p>}
      <Textarea aria-label="Комментарий к заявке" placeholder="Комментарий для наставника (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={m.isPending}>Отправить</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </form>
  );
}

export function PendingRequest({ req, canDecide, isSelf, stages }: { req: PromotionRequest; canDecide: boolean; isSelf: boolean; stages: PathConfig["stages"] }) {
  const { toast } = useToast();
  const [comment, setComment] = React.useState("");
  const decide = usePathMutation((v: { action: "approve" | "reject" | "withdraw"; comment?: string }) =>
    http.post(`/api/academy/path/requests/${req.id}/${v.action}`, v.action === "withdraw" ? {} : { comment: v.comment }));
  const run = (action: "approve" | "reject" | "withdraw") =>
    decide.mutate({ action, comment: comment.trim() || undefined }, {
      onSuccess: () => toast({ title: action === "approve" ? "Перевод одобрен" : action === "reject" ? "Заявка отклонена" : "Заявка отозвана" }),
      onError: (err) => toast({ title: "Не получилось", description: (err as Error).message, variant: "destructive" }),
    });
  return (
    <Panel title={`Заявка: ${stageName(stages, req.fromStage)} → ${stageName(stages, req.toStage)}`} icon={ShieldCheck}
      description={`${req.requestedBy} · ${fmtInstant(req.createdAt)} · на момент подачи ${req.passed} из ${req.total} критериев`}>
      {req.comment && <p className="mb-3 text-sm text-foreground">«{req.comment}»</p>}
      {canDecide ? (
        <div className="flex flex-col gap-2">
          <Field label={req.ready ? "Комментарий (необязателен при одобрении, обязателен при отказе)" : "Обоснование решения — обязательно: выполнены не все критерии"} htmlFor={`dec-${req.id}`}>
            <Textarea id={`dec-${req.id}`} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder="Что получилось, что улучшить, на что обратить внимание на новой ступени" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("approve")} disabled={decide.isPending || (!req.ready && !comment.trim())}>Одобрить перевод</Button>
            <Button size="sm" variant="destructive" onClick={() => run("reject")} disabled={decide.isPending || !comment.trim()}>Отклонить</Button>
          </div>
        </div>
      ) : isSelf ? (
        <Button size="sm" variant="ghost" onClick={() => run("withdraw")} disabled={decide.isPending}><Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Отозвать заявку</Button>
      ) : <p className="text-sm text-muted-foreground">Ожидает решения наставника.</p>}
    </Panel>
  );
}

function AssignStage({ user, current, config }: { user: string; current: StageKey | null; config: PathConfig | undefined }) {
  const { toast } = useToast();
  const [stage, setStage] = React.useState<StageKey>(current ?? "trainee");
  const [comment, setComment] = React.useState("");
  const m = usePathMutation((v: { user: string; stage: StageKey; comment: string }) => http.post("/api/academy/path/assign", v));
  return (
    <Panel title="Назначить ступень напрямую" icon={UserCog} description="Для первичного назначения и исключений. Пишется в историю и журнал, ученик получает уведомление.">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate({ user, stage, comment: comment.trim() }, {
            onSuccess: () => { toast({ title: `Ступень «${stageName(config?.stages, stage)}» назначена` }); setComment(""); },
            onError: (err) => toast({ title: "Не удалось назначить", description: (err as Error).message, variant: "destructive" }),
          });
        }}
      >
        <Field label="Ступень" htmlFor="assign-stage">
          <select id="assign-stage" className={selectCls} value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
            {STAGE_KEYS.map((k) => <option key={k} value={k}>{stageName(config?.stages, k)}{k === current ? " (сейчас)" : ""}</option>)}
          </select>
        </Field>
        <div className="flex-1">
          <Field label="Причина (обязательно)" htmlFor="assign-comment">
            <input id="assign-comment" className={cn(selectCls, "w-full")} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Например: стартовая ступень нового трейдера" />
          </Field>
        </div>
        <Button type="submit" size="sm" disabled={m.isPending || stage === current || comment.trim().length < 3}>Назначить</Button>
      </form>
    </Panel>
  );
}
