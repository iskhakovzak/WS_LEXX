import * as React from "react";
import { CheckCircle2, Circle, ClipboardCheck, Plus, ShieldAlert, X } from "lucide-react";
import { EmptyState, Panel, Pill, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { nyDate } from "@/lib/trading-date";
import { curatorApi, useCuratorMutation, type Breach, type BreachAction } from "./api";
import { fmtDate, fmtUsd } from "@/lib/format";

// Mirrors lib/curatorLogic.ts (server validates the keys).
export const BREACH_REASONS = [
  { key: "revenge", label: "Отыгрыш после убытка" },
  { key: "size", label: "Размер позиции больше плана" },
  { key: "no_stop", label: "Стоп не выставлен или сдвинут" },
  { key: "overtrading", label: "Овертрейдинг" },
  { key: "news", label: "Новости / гэп против позиции" },
  { key: "overnight", label: "Позиция на ночь без разрешения" },
  { key: "tilt", label: "Эмоции / тильт" },
  { key: "technical", label: "Техническая проблема" },
  { key: "other", label: "Другое" },
] as const;
export const BREACH_CONSEQUENCES = [
  { key: "none", label: "Без последствий" },
  { key: "warning", label: "Предупреждение" },
  { key: "reduced", label: "Лимиты урезаны" },
  { key: "pause", label: "Пауза" },
  { key: "demote", label: "Понижение тира" },
] as const;

const reasonLabel = (k: string) => BREACH_REASONS.find((r) => r.key === k)?.label ?? k;
const consequenceLabel = (k: string) => BREACH_CONSEQUENCES.find((r) => r.key === k)?.label ?? k;

type Draft = { reason: string; comment: string; actions: { id?: string; title: string; dueOn: string; status?: BreachAction["status"] }[]; consequence: string };

function draftOf(b: Breach): Draft {
  const r = b.review;
  return r
    ? { reason: r.reason, comment: r.comment ?? "", actions: r.actions.map((a) => ({ id: a.id, title: a.title, dueOn: a.dueOn ?? "", status: a.status })), consequence: r.consequence }
    : { reason: "", comment: "", actions: [{ title: "", dueOn: "" }], consequence: "none" };
}

/** «Разбор нарушения»: list of breaches with the agreed reason, actions and consequence; editable by staff. */
export function BreachReviewPanel({
  breaches, canReview, title = "Нарушения и разборы", description, showTrader = false,
}: { breaches: Breach[]; canReview: boolean; title?: string; description?: string; showTrader?: boolean }) {
  const unreviewed = breaches.filter((b) => !b.review).length;
  return (
    <Panel
      title={title}
      icon={ShieldAlert}
      description={description ?? "Стоп, недельный лимит и просадка за 90 дней. Запишите причину и договорённости — трейдер получит уведомление."}
      actions={unreviewed > 0 ? <Pill tone="down" dot>{unreviewed} без разбора</Pill> : breaches.length ? <Pill tone="up">Все разобраны</Pill> : undefined}
    >
      {breaches.length === 0 ? (
        <EmptyState compact icon={ShieldAlert} title="Нарушений не было" description="Лимиты за этот период не пробивались." />
      ) : (
        <ul className="flex flex-col gap-3">
          {breaches.map((b) => <BreachItem key={b.id} breach={b} canReview={canReview} showTrader={showTrader} />)}
        </ul>
      )}
    </Panel>
  );
}

function BreachItem({ breach, canReview, showTrader }: { breach: Breach; canReview: boolean; showTrader: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const r = breach.review;
  return (
    <li className={cn("tile flex flex-col gap-3 p-3", !r && "ring-1 ring-down/30")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="down">{breach.kindLabel}</Pill>
        {showTrader && breach.trader && <span className="text-sm font-semibold text-foreground">{breach.trader}</span>}
        <span className="text-sm font-medium tabular-nums text-foreground">{fmtDate(breach.date, "dayMonth")}</span>
        {breach.used != null && breach.limit != null && (
          <span className="text-xs tabular-nums text-muted-foreground">{fmtUsd(-Math.abs(breach.used), { signed: true, decimals: 0 })} при лимите {fmtUsd(breach.limit, { decimals: 0 })}</span>
        )}
        {breach.repeat && <Pill tone="warn" title="Второе и более нарушение за 7 дней — уведомлён руководитель деска">Повторное за неделю</Pill>}
        <span className="ml-auto">
          {r ? <Pill tone="up">Разобрано</Pill> : <Pill tone="down" dot>Нужен разбор</Pill>}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{breach.message}</p>

      {r && !editing && <ReviewSummary breach={breach} canReview={canReview} onEdit={() => setEditing(true)} />}
      {(!r || editing) && canReview && <ReviewForm breach={breach} onDone={() => setEditing(false)} onCancel={r ? () => setEditing(false) : undefined} />}
      {!r && !canReview && <p className="text-xs text-muted-foreground">Разбор ещё не записан.</p>}
    </li>
  );
}

function ReviewSummary({ breach, canReview, onEdit }: { breach: Breach; canReview: boolean; onEdit: () => void }) {
  const r = breach.review!;
  const { toast } = useToast();
  const setStatus = useCuratorMutation((v: { actionId: string; status: BreachAction["status"] }) => curatorApi.setActionStatus(r.id, v.actionId, v.status));
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Причина:</span>
        <span className="font-medium text-foreground">{reasonLabel(r.reason)}</span>
        <span className="text-muted-foreground">· Решение:</span>
        <Pill tone={r.consequence === "none" ? "neutral" : r.consequence === "warning" ? "warn" : "down"}>{consequenceLabel(r.consequence)}</Pill>
      </div>
      {r.comment && <p className="whitespace-pre-wrap text-sm text-foreground">{r.comment}</p>}
      {r.actions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {r.actions.map((a) => {
            const done = a.status === "done";
            return (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  disabled={!canReview || setStatus.isPending}
                  onClick={() => setStatus.mutate({ actionId: a.id, status: done ? "open" : "done" }, { onError: (e) => toast({ title: "Не удалось", description: (e as Error).message, variant: "destructive" }) })}
                  className="press grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-up disabled:cursor-default"
                  aria-label={done ? "Отметить как невыполненное" : "Отметить выполненным"}
                  aria-pressed={done}
                >
                  {done ? <CheckCircle2 className="h-4 w-4 text-up" /> : <Circle className="h-4 w-4" />}
                </button>
                <span className={cn("min-w-0 flex-1", done && "text-muted-foreground line-through", a.status === "dropped" && "text-muted-foreground line-through")}>{a.title}</span>
                {a.dueOn && <span className={cn("shrink-0 text-xs tabular-nums", !done && a.dueOn < nyDate() ?"text-down" : "text-muted-foreground")}>до {fmtDate(a.dueOn, "dayMonth")}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{r.createdBy}, {fmtDate(r.createdAt, "dateTime")}{r.updatedBy && r.updatedAt !== r.createdAt ? ` · изм. ${r.updatedBy}` : ""}</span>
        {canReview && <Button type="button" variant="ghost" size="sm" className="ml-auto h-7" onClick={onEdit}>Изменить</Button>}
      </div>
    </div>
  );
}

function ReviewForm({ breach, onDone, onCancel }: { breach: Breach; onDone: () => void; onCancel?: () => void }) {
  const { toast } = useToast();
  const [d, setD] = React.useState<Draft>(() => draftOf(breach));
  const save = useCuratorMutation((v: Draft) => curatorApi.review(breach.id, {
    reason: v.reason,
    comment: v.comment.trim() || null,
    actions: v.actions.filter((a) => a.title.trim()).map((a) => ({ id: a.id, title: a.title.trim(), dueOn: a.dueOn || null, status: a.status })),
    consequence: v.consequence,
  }));
  const setAction = (i: number, patch: Partial<Draft["actions"][number]>) =>
    setD((x) => ({ ...x, actions: x.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const submit = () => {
    if (!d.reason || save.isPending) return;
    save.mutate(d, {
      onSuccess: () => { toast({ title: "Разбор сохранён", description: breach.review ? undefined : "Трейдер получил уведомление" }); onDone(); },
      onError: (e) => toast({ title: "Не удалось сохранить", description: (e as Error).message, variant: "destructive" }),
    });
  };

  return (
    <form className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Причина <span className="text-down">*</span></legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Причина нарушения">
          {BREACH_REASONS.map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={d.reason === r.key}
              onClick={() => setD((x) => ({ ...x, reason: r.key }))}
              className="chip inline-flex min-h-7 items-center px-2.5 text-xs font-medium"
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Textarea
        value={d.comment}
        onChange={(e) => setD((x) => ({ ...x, comment: e.target.value }))}
        placeholder="Что произошло, как трейдер это видит, что решили"
        rows={2}
        maxLength={4000}
        aria-label="Комментарий к разбору"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Договорённости</span>
        {d.actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={a.title}
              onChange={(e) => setAction(i, { title: e.target.value })}
              placeholder="Например: стоп в платформе на каждой сделке"
              maxLength={300}
              aria-label={`Договорённость ${i + 1}`}
              className="h-8 min-w-0 flex-1 text-sm"
            />
            <Input
              type="date"
              value={a.dueOn}
              onChange={(e) => setAction(i, { dueOn: e.target.value })}
              aria-label={`Срок договорённости ${i + 1}`}
              className="h-8 w-[9.5rem] shrink-0 text-sm tabular-nums"
            />
            <Button
              type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0"
              aria-label="Убрать договорённость"
              onClick={() => setD((x) => ({ ...x, actions: x.actions.filter((_, j) => j !== i) }))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {d.actions.length < 10 && (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setD((x) => ({ ...x, actions: [...x.actions, { title: "", dueOn: "" }] }))}>
            <Plus className="h-3.5 w-3.5" /> Добавить
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          ariaLabel="Решение"
          value={d.consequence}
          onChange={(v) => setD((x) => ({ ...x, consequence: v }))}
          options={BREACH_CONSEQUENCES.map((c) => ({ value: c.key, label: c.label }))}
        />
        <div className="flex items-center gap-2">
          {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Отмена</Button>}
          <Button type="submit" size="sm" disabled={!d.reason || save.isPending}>
            <ClipboardCheck className="h-3.5 w-3.5" /> {save.isPending ? "Сохраняю…" : "Сохранить разбор"}
          </Button>
        </div>
      </div>
    </form>
  );
}
