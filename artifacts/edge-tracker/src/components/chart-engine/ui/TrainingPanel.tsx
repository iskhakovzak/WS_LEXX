/**
 * Training side panels: the order ticket (buy / sell / flat with a size and a stop, bar by bar with the future hidden),
 * the outcome after the reveal (vs the best possible move and vs the real trade) and the local history with the streak.
 */
import * as React from "react";
import { ArrowRight, Eye, Flame, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kbd, Pill, ProgressRing } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPrice, fmtR } from "../lib/format";
import { fmtPerShare } from "../lib/trade-summary";
import { historyStats, simMark, trainingVerdict, type SimAction, type SimState, type TrainingOutcome, type TrainingRecord } from "../lib/training-sim";
import { AsideCard } from "./TradePanels";

const tone = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-12 ? "text-foreground" : n > 0 ? "text-up" : "text-down");
const QTY_CHIPS = [100, 500, 1000] as const;

export type TicketState = { qty: number; autoStop: boolean; stopText: string };

export function TrainingTicket({
  price, sim, ticket, onTicket, suggestLong, suggestShort, onOrder, onApplyStop, onReveal, atLimit, started,
}: {
  price: number | null;
  sim: SimState;
  ticket: TicketState;
  onTicket: (patch: Partial<TicketState>) => void;
  suggestLong: number | null;
  suggestShort: number | null;
  onOrder: (a: SimAction) => void;
  onApplyStop: () => void;
  onReveal: () => void;
  atLimit: boolean;
  /** At least one bar was played (nothing to score before that). */
  started: boolean;
}) {
  const uid = React.useId();
  const open = sim.pos !== 0 && sim.avg != null;
  const mark = price != null ? simMark(sim, price) : null;
  const dir = sim.pos > 0 ? 1 : -1;
  const perShare = open && price != null ? dir * (price - (sim.avg as number)) : null;
  const r = sim.firstRiskUsd && mark ? mark.total / sim.firstRiskUsd : null;
  const stopNum = Number(ticket.stopText.replace(",", "."));
  const manualStopOk = ticket.stopText.trim() !== "" && Number.isFinite(stopNum) && stopNum > 0;
  return (
    <AsideCard title="Твоя сделка" action={<span className="text-sm tabular-nums text-muted-foreground">цена <b className="text-foreground">{fmtPrice(price)}</b></span>}>
      <div className="grid grid-cols-3 gap-1.5">
        <Button className="h-10 bg-up text-white hover:bg-up/90" onClick={() => onOrder("buy")} disabled={price == null || atLimit} title="Купить по закрытию текущего бара — B">
          Купить <Kbd className="ml-1 border-white/30 bg-white/15 text-white">B</Kbd>
        </Button>
        <Button className="h-10 bg-down text-white hover:bg-down/90" onClick={() => onOrder("sell")} disabled={price == null || atLimit} title="Продать / шорт по закрытию текущего бара — S">
          Продать <Kbd className="ml-1 border-white/30 bg-white/15 text-white">S</Kbd>
        </Button>
        <Button variant="outline" className="h-10" onClick={() => onOrder("flat")} disabled={!open || atLimit} title="Закрыть позицию — C">
          В ноль <Kbd className="ml-1">C</Kbd>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`${uid}-qty`} className="w-14 shrink-0 text-xs text-muted-foreground">Размер</label>
        <Input id={`${uid}-qty`} inputMode="numeric" className="h-8 w-20 tabular-nums" value={String(ticket.qty)} onChange={(e) => { const n = Math.floor(Number(e.target.value.replace(/\D/g, ""))); onTicket({ qty: Number.isFinite(n) ? Math.min(1_000_000, n) : 0 }); }} />
        <div className="flex gap-1">
          {QTY_CHIPS.map((q) => (
            <button key={q} type="button" onClick={() => onTicket({ qty: q })} className={cn("h-7 rounded-full px-2 text-xs tabular-nums", ticket.qty === q ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)]")}>{q}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-muted-foreground">Стоп</span>
        {ticket.autoStop && !open ? (
          <span className="flex-1 text-xs tabular-nums text-muted-foreground" title="За экстремумом последних 5 баров">
            авто: лонг {fmtPrice(suggestLong)} · шорт {fmtPrice(suggestShort)}
          </span>
        ) : (
          <Input aria-label="Цена стопа" inputMode="decimal" className="h-8 flex-1 tabular-nums" placeholder={open ? fmtPrice(sim.stop) : "цена"} value={ticket.stopText} onChange={(e) => onTicket({ stopText: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && open) onApplyStop(); }} />
        )}
        {open ? (
          <Button size="sm" variant="outline" className="h-8" disabled={!manualStopOk} onClick={onApplyStop}>Перенести</Button>
        ) : (
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={ticket.autoStop} onCheckedChange={(v) => onTicket({ autoStop: v })} aria-label="Автостоп" />авто</label>
        )}
      </div>

      <div className="rounded-xl bg-[hsl(var(--muted-foreground)/0.08)] px-2.5 py-2 text-sm">
        {open ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 tabular-nums">
            <span>{sim.pos > 0 ? "Лонг" : "Шорт"} {Math.abs(sim.pos)} @ {fmtPrice(sim.avg)}{sim.stop != null && <span className="text-muted-foreground"> · стоп {fmtPrice(sim.stop)}</span>}</span>
            <span className="flex gap-2">
              <b className={tone(perShare)}>{fmtPerShare(perShare)}</b>
              {r != null && <b className={tone(r)}>{fmtR(r)}</b>}
              <b className={tone(mark?.total)}>{fmtMoney(mark?.total)}</b>
            </span>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-2 tabular-nums">
            <span className="text-muted-foreground">{sim.fills.length ? "Без позиции" : "Сделок ещё нет"}</span>
            {sim.fills.length > 0 && <b className={tone(sim.realized)}>{fmtMoney(sim.realized)}</b>}
          </div>
        )}
      </div>

      <Button variant={atLimit ? "default" : "secondary"} className="h-9 gap-1.5" onClick={onReveal} disabled={!started} title="Закончить и сравнить с реальной сделкой — Enter">
        <Eye className="h-4 w-4" /> {atLimit ? "Сессия закончилась — показать, как было" : "Показать, как было"} <Kbd className="ml-1">Enter</Kbd>
      </Button>
      <p className="text-xs text-muted-foreground">Ордер исполняется по закрытию текущего бара, стоп — на следующих. Будущее скрыто, назад нельзя.</p>
    </AsideCard>
  );
}

export function TrainingOutcomeCard({ o, onRestart, onNext }: { o: TrainingOutcome; onRestart: () => void; onNext?: () => void }) {
  const v = trainingVerdict(o);
  return (
    <AsideCard title="Результат тренировки">
      <div className="flex items-center gap-3">
        <ProgressRing value={o.score ?? 0} size={64} stroke={6} tone={v.tone === "down" ? "down" : v.tone === "warn" ? "warn" : v.tone === "up" ? "up" : "neutral"} label={o.score != null ? String(o.score) : "—"} ariaLabel="Оценка из 100" />
        <div className="flex min-w-0 flex-col gap-1">
          <Pill tone={v.tone === "neutral" ? "neutral" : v.tone}>{v.label}</Pill>
          <span className="text-xs text-muted-foreground">{o.score != null ? "Доля лучшего возможного хода за просмотренные бары" : "Оценки нет: сделок не было"}</span>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">Ты</dt>
        <dd className="flex flex-wrap justify-end gap-x-1.5 text-right">{o.trades ? <><b className={tone(o.r ?? o.perShare)}>{o.r != null ? fmtR(o.r) : fmtPerShare(o.perShare)}</b>{o.r != null && <span className={tone(o.perShare)}>{fmtPerShare(o.perShare)}</span>}<span className={cn("text-muted-foreground")}>{fmtMoney(o.pnlUsd)}</span></> : "без сделок"}</dd>
        <dt className="text-muted-foreground">Было можно</dt>
        <dd className="text-right">{o.idealPerShare != null ? <><b className="text-up">{fmtPerShare(o.idealPerShare)}</b> <span className="text-muted-foreground">{o.idealSide === "short" ? "в шорт" : "в лонг"}</span></> : "—"}</dd>
        <dt className="text-muted-foreground">Реальная сделка</dt>
        <dd className="text-right">{o.realPerShare != null ? <><b className={tone(o.realPerShare)}>{fmtPerShare(o.realPerShare)}</b>{o.realR != null && <b className={cn("ml-1.5", tone(o.realR))}>{fmtR(o.realR)}</b>}</> : "—"}</dd>
      </dl>
      {o.vsRealPerShare != null && (
        <p className={cn("text-sm", tone(o.vsRealPerShare))}>{o.vsRealPerShare >= 0 ? "Лучше реальной сделки" : "Хуже реальной сделки"} на {fmtPerShare(Math.abs(o.vsRealPerShare)).replace("+", "")} на акцию</p>
      )}
      <p className="text-xs text-muted-foreground">На графике: реальные исполнения (стрелки), твои (кружки B/S) и идеальный ход (жёлтый пунктир).</p>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="h-8 flex-1 gap-1" onClick={onRestart}><RotateCcw className="h-3.5 w-3.5" /> Ещё раз</Button>
        {onNext && <Button size="sm" className="h-8 flex-1 gap-1" onClick={onNext}><Shuffle className="h-3.5 w-3.5" /> Следующая задача <ArrowRight className="h-3.5 w-3.5" /></Button>}
      </div>
    </AsideCard>
  );
}

export function TrainingHistoryCard({ list }: { list: readonly TrainingRecord[] }) {
  const st = historyStats(list);
  if (!st.count) {
    return (
      <AsideCard title="Твоя статистика">
        <p className="text-sm text-muted-foreground">Пока пусто. Каждая попытка сохраняется в этом браузере: оценка, серия плюсовых попыток, сравнение с реальными сделками.</p>
      </AsideCard>
    );
  }
  return (
    <AsideCard title="Твоя статистика" action={st.streak > 0 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--chart-3))]"><Flame className="h-3.5 w-3.5" aria-hidden="true" />серия {st.streak}</span> : undefined}>
      <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
        <div><div className="text-lg font-semibold">{st.count}</div><div className="text-2xs text-muted-foreground">попыток</div></div>
        <div><div className="text-lg font-semibold">{st.avgScore ?? "—"}</div><div className="text-2xs text-muted-foreground">ср. оценка</div></div>
        <div><div className="text-lg font-semibold">{st.plusShare != null ? `${Math.round(st.plusShare * 100)}%` : "—"}</div><div className="text-2xs text-muted-foreground">в плюс</div></div>
      </div>
      <ul className="flex flex-col divide-y divide-[var(--glass-border)] text-xs tabular-nums">
        {list.slice(0, 5).map((x) => (
          <li key={x.at} className="flex items-center gap-2 py-1">
            <span className="w-8 font-semibold">{x.score ?? "—"}</span>
            <span className="font-medium">{x.ticker}</span>
            <span className="text-muted-foreground">{x.day.slice(5)}</span>
            <span className={cn("ml-auto", tone(x.trades ? x.pnlUsd : null))}>{x.trades ? (x.r != null ? fmtR(x.r) : fmtPerShare(x.perShare)) : "без сделок"}</span>
          </li>
        ))}
      </ul>
    </AsideCard>
  );
}
