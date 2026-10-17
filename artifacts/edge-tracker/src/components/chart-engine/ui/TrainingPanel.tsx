/**
 * Training side panels: the order ticket (buy / sell / half / flat with a size, a stop and a target, bar by bar with
 * the future hidden), the outcome after the reveal (vs the best possible move, vs the real trade, and the log of the
 * trainee's own decisions) and the local history — this session or all attempts.
 */
import * as React from "react";
import { ArrowRight, Eye, Flame, RotateCcw, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kbd, Pill, ProgressRing, Segmented } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPrice, fmtR } from "../lib/format";
import { fmtPerShare } from "../lib/trade-summary";
import {
  historyStats, plannedRR, sessionSlice, simFillLabel, simLiveR, simMark, trainingVerdict,
  type SimAction, type SimFillReason, type SimState, type TrainingOutcome, type TrainingRecord,
} from "../lib/training-sim";
import { AsideCard } from "./TradePanels";

const tone = (n: number | null | undefined) => (n == null || !Number.isFinite(n) || Math.abs(n) < 1e-12 ? "text-foreground" : n > 0 ? "text-up" : "text-down");
const pluralRu = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const QTY_CHIPS = [100, 500, 1000] as const;
const RR_CHIPS = [1, 2, 3] as const;

/** Ticket inputs. `targetRR` — target for a NEW position at N × the stop distance (0 = none). */
export type TicketState = { qty: number; autoStop: boolean; stopText: string; targetRR: number; targetText: string };

const parsePrice = (text: string): number | null => {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <label htmlFor={htmlFor} className="w-12 shrink-0 text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function TrainingTicket({
  price, sim, ticket, onTicket, suggestLong, suggestShort, onOrder, onApplyStop, onBreakeven, canBE, onApplyTarget, onTargetRR, onClearTarget,
  onReveal, atLimit, started,
}: {
  price: number | null;
  sim: SimState;
  ticket: TicketState;
  onTicket: (patch: Partial<TicketState>) => void;
  suggestLong: number | null;
  suggestShort: number | null;
  onOrder: (a: SimAction) => void;
  onApplyStop: () => void;
  onBreakeven: () => void;
  canBE: boolean;
  onApplyTarget: () => void;
  /** Open position: target at N R from the average price and the current stop. */
  onTargetRR: (rr: number) => void;
  onClearTarget: () => void;
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
  const liveR = simLiveR(sim, price);
  const rr = open ? plannedRR(sim.avg, sim.stop, sim.target) : null;
  const manualStop = parsePrice(ticket.stopText);
  const manualTarget = parsePrice(ticket.targetText);
  const hasStopForNew = ticket.autoStop || manualStop != null;
  const noPrice = price == null || atLimit;
  return (
    <AsideCard title="Твоя сделка" action={<span className="text-sm tabular-nums text-muted-foreground">цена <b className="text-foreground">{fmtPrice(price)}</b></span>}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button className="h-10 justify-between bg-up px-3 text-white hover:bg-up/90" onClick={() => onOrder("buy")} disabled={noPrice} title="Купить по закрытию текущего бара (B)">
          Купить <Kbd className="border-white/30 bg-white/15 text-white max-sm:hidden">B</Kbd>
        </Button>
        <Button className="h-10 justify-between bg-down px-3 text-white hover:bg-down/90" onClick={() => onOrder("sell")} disabled={noPrice} title="Продать / шорт по закрытию текущего бара (S)">
          Продать <Kbd className="border-white/30 bg-white/15 text-white max-sm:hidden">S</Kbd>
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => onOrder("half")} disabled={!open || atLimit} title="Закрыть половину позиции (H)">
          ½ <Kbd className="max-sm:hidden">H</Kbd>
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={onBreakeven} disabled={!canBE || atLimit} title={open ? (canBE ? "Стоп в безубыток — на среднюю цену (E)" : "Б/У можно, когда цена ушла за среднюю в плюс") : "Нет позиции"}>
          Б/У <Kbd className="max-sm:hidden">E</Kbd>
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => onOrder("flat")} disabled={!open || atLimit} title="Закрыть всю позицию (C)">
          В ноль <Kbd className="max-sm:hidden">C</Kbd>
        </Button>
      </div>

      <Field label="Размер" htmlFor={`${uid}-qty`}>
        <Input
          id={`${uid}-qty`} inputMode="numeric" className="h-8 w-[4.5rem] tabular-nums" value={String(ticket.qty)}
          onChange={(e) => { const n = Math.floor(Number(e.target.value.replace(/\D/g, ""))); onTicket({ qty: Number.isFinite(n) ? Math.min(1_000_000, n) : 0 }); }}
        />
        <div className="flex min-w-0 gap-0.5">
          {QTY_CHIPS.map((q) => (
            <button key={q} type="button" onClick={() => onTicket({ qty: q })} aria-pressed={ticket.qty === q} className={cn("h-7 rounded-full px-2 text-xs tabular-nums", ticket.qty === q ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-[var(--glass-hover-bg)]")}>{q}</button>
          ))}
        </div>
      </Field>

      <Field label="Стоп" htmlFor={`${uid}-stop`}>
        {ticket.autoStop && !open ? (
          <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground" title={`Авто: за экстремумом последних 5 баров — для лонга ${fmtPrice(suggestLong)}, для шорта ${fmtPrice(suggestShort)}`}>
            <span className="text-up">↑</span>{fmtPrice(suggestLong)} <span className="text-down">↓</span>{fmtPrice(suggestShort)}
          </span>
        ) : (
          <Input
            id={`${uid}-stop`} aria-label="Цена стопа" inputMode="decimal" className="h-8 min-w-0 flex-1 tabular-nums" placeholder={open ? fmtPrice(sim.stop) : "цена"}
            value={ticket.stopText} onChange={(e) => onTicket({ stopText: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && open) onApplyStop(); }}
          />
        )}
        {open ? (
          <Button size="sm" variant="outline" className="h-8 shrink-0 px-2.5" disabled={manualStop == null} onClick={onApplyStop}>Перенести</Button>
        ) : (
          <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={ticket.autoStop} onCheckedChange={(v) => onTicket({ autoStop: v })} aria-label="Автостоп" />авто</label>
        )}
      </Field>

      <Field label="Цель" htmlFor={open ? `${uid}-target` : undefined}>
        {open ? (
          <>
            <Input
              id={`${uid}-target`} aria-label="Цена цели" inputMode="decimal" className="h-8 min-w-0 flex-1 tabular-nums" placeholder={sim.target != null ? fmtPrice(sim.target) : "цена"}
              value={ticket.targetText} onChange={(e) => onTicket({ targetText: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onApplyTarget(); }}
            />
            {manualTarget != null ? (
              <Button size="sm" variant="outline" className="h-8 shrink-0 px-2.5" onClick={onApplyTarget}>Поставить</Button>
            ) : (
              <div className="flex shrink-0 gap-0.5">
                {RR_CHIPS.map((n) => (
                  <button key={n} type="button" disabled={sim.stop == null} onClick={() => onTargetRR(n)} title={sim.stop == null ? "Нужен стоп" : `Цель на ${n}R от средней`} className="h-7 rounded-full px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-[var(--glass-hover-bg)] disabled:opacity-40">{n}R</button>
                ))}
                {sim.target != null && (
                  <button type="button" onClick={onClearTarget} aria-label="Убрать цель" title="Убрать цель" className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)]"><X className="h-3.5 w-3.5" /></button>
                )}
              </div>
            )}
          </>
        ) : (
          <Segmented
            size="sm" ariaLabel="Цель для новой позиции" value={String(ticket.targetRR)} onChange={(v) => onTicket({ targetRR: Number(v) })} className="min-w-0"
            options={[{ value: "0", label: "нет" }, ...RR_CHIPS.map((n) => ({ value: String(n), label: `${n}R`, disabled: !hasStopForNew, title: hasStopForNew ? `Цель на ${n} × расстояние до стопа` : "Цель в R считается от стопа — включи автостоп или впиши стоп" }))]}
          />
        )}
      </Field>

      <div className="rounded-xl bg-[hsl(var(--muted-foreground)/0.08)] px-2.5 py-2 text-sm tabular-nums">
        {open ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{sim.pos > 0 ? "Лонг" : "Шорт"} {Math.abs(sim.pos)} @ {fmtPrice(sim.avg)}</span>
              <b className={tone(mark?.total)}>{fmtMoney(mark?.total)}</b>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted-foreground">
              <span>стоп {sim.stop != null ? fmtPrice(sim.stop) : "—"} · цель {sim.target != null ? fmtPrice(sim.target) : "—"}{rr != null && <> · R:R 1:{rr.toFixed(1)}</>}</span>
              <span className="flex gap-2">
                <b className={tone(perShare)}>{fmtPerShare(perShare)}</b>
                <b className={tone(liveR)} title="Весь результат попытки в R первого стопа">{liveR != null ? fmtR(liveR) : "— R"}</b>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{sim.fills.length ? "Без позиции" : "Сделок ещё нет"}</span>
            {sim.fills.length > 0 && <span className="flex gap-2"><b className={tone(sim.realized)}>{fmtMoney(sim.realized)}</b>{liveR != null && <b className={tone(liveR)}>{fmtR(liveR)}</b>}</span>}
          </div>
        )}
      </div>

      {atLimit && <p className="text-xs font-medium text-[hsl(var(--chart-3))]" role="status">Сессия закончилась — дальше баров нет.</p>}
      <Button variant={atLimit ? "default" : "secondary"} className="h-9 w-full justify-center gap-1.5" onClick={onReveal} disabled={!started} title="Закончить и посмотреть, как было (Enter)">
        <Eye className="h-4 w-4 shrink-0" /> <span className="truncate">Показать, как было</span> <Kbd className="ml-auto max-sm:hidden">Enter</Kbd>
      </Button>
      <p className="text-2xs leading-snug text-muted-foreground">Ордер — по закрытию текущего бара, стоп и цель — на следующих (если бар задел оба, считается стоп). Назад нельзя.</p>
    </AsideCard>
  );
}

export type DecisionRow = { idx: number; time: string; price: number; qty: number; reason: SimFillReason };

const REASON_TONE: Record<SimFillReason, string> = { buy: "text-up", sell: "text-down", half: "text-muted-foreground", flat: "text-muted-foreground", stop: "text-down", target: "text-up" };

export function TrainingOutcomeCard({
  o, decisions, traderName, onJump, onRestart, onNext,
}: {
  o: TrainingOutcome;
  /** The trainee's own fills, oldest first. */
  decisions: readonly DecisionRow[];
  /** Whose trade it was (shown only after the reveal); null for a ticker-day task (no real trade to compare with). */
  traderName?: string | null;
  onJump?: (idx: number) => void;
  onRestart: () => void;
  onNext?: () => void;
}) {
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
        <dd className="flex flex-wrap justify-end gap-x-1.5 text-right">{o.trades ? <><b className={tone(o.r ?? o.perShare)}>{o.r != null ? fmtR(o.r) : fmtPerShare(o.perShare)}</b>{o.r != null && <span className={tone(o.perShare)}>{fmtPerShare(o.perShare)}</span>}<span className="text-muted-foreground">{fmtMoney(o.pnlUsd)}</span></> : "без сделок"}</dd>
        <dt className="text-muted-foreground">Было можно</dt>
        <dd className="text-right">{o.idealPerShare != null ? <><b className="text-up">{fmtPerShare(o.idealPerShare)}</b> <span className="text-muted-foreground">{o.idealSide === "short" ? "в шорт" : "в лонг"}</span></> : "—"}</dd>
        {traderName !== null && (
          <>
            <dt className="truncate text-muted-foreground">{traderName ? `Сделка: ${traderName}` : "Реальная сделка"}</dt>
            <dd className="text-right">{o.realPerShare != null ? <><b className={tone(o.realPerShare)}>{fmtPerShare(o.realPerShare)}</b>{o.realR != null && <b className={cn("ml-1.5", tone(o.realR))}>{fmtR(o.realR)}</b>}</> : "—"}</dd>
          </>
        )}
      </dl>
      {o.vsRealPerShare != null && (
        <p className={cn("text-sm", tone(o.vsRealPerShare))}>{o.vsRealPerShare >= 0 ? "Лучше реальной сделки" : "Хуже реальной сделки"} на {fmtPerShare(Math.abs(o.vsRealPerShare)).replace("+", "")} на акцию</p>
      )}

      {decisions.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Твои действия</h4>
          <ol className="flex max-h-40 flex-col overflow-y-auto text-xs tabular-nums">
            {decisions.map((d, i) => (
              <li key={`${d.idx}-${i}`}>
                <button type="button" disabled={!onJump} onClick={() => onJump?.(d.idx)} className="grid w-full grid-cols-[3rem_4.5rem_1fr_auto] items-baseline gap-2 rounded-md px-1 py-0.5 text-left hover:bg-[var(--glass-hover-bg)] disabled:hover:bg-transparent" title="Показать на графике">
                  <span className="text-muted-foreground">{d.time}</span>
                  <span className={cn("font-medium", REASON_TONE[d.reason])}>{simFillLabel(d)}</span>
                  <span className="text-right">{fmtPrice(d.price)}</span>
                  <span className="w-12 text-right text-muted-foreground">{d.qty > 0 ? "+" : "−"}{Math.abs(d.qty)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="text-2xs leading-snug text-muted-foreground">На графике: {traderName !== null ? "реальные исполнения (стрелки), " : ""}твои (кружки B/S, ✓ — цель, × — стоп) и идеальный ход (жёлтый пунктир).</p>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="h-8 flex-1 gap-1" onClick={onRestart}><RotateCcw className="h-3.5 w-3.5" /> Ещё раз</Button>
        {onNext && <Button size="sm" className="h-8 flex-[1.4] gap-1" onClick={onNext}><Shuffle className="h-3.5 w-3.5" /> Следующая <ArrowRight className="h-3.5 w-3.5" /></Button>}
      </div>
    </AsideCard>
  );
}

const SESSION_KEY = "ws-chart:training-session:v1";
function loadSessionStart(): number {
  try {
    const n = Number(localStorage.getItem(SESSION_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

function Stat({ value, label, className, title }: { value: React.ReactNode; label: string; className?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className={cn("truncate text-base font-semibold tabular-nums", className)}>{value}</div>
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function TrainingHistoryCard({ list }: { list: readonly TrainingRecord[] }) {
  const [scope, setScope] = React.useState<"session" | "all">("session");
  const [since, setSince] = React.useState<number>(loadSessionStart);
  const newSession = () => {
    const now = Date.now();
    try { localStorage.setItem(SESSION_KEY, String(now)); } catch { /* storage unavailable */ }
    setSince(now);
    setScope("session");
  };
  const shown = scope === "session" ? sessionSlice(list, since) : list;
  const st = historyStats(shown);
  if (!list.length) {
    return (
      <AsideCard title="Твоя статистика">
        <p className="text-sm text-muted-foreground">Пока пусто. Каждая попытка сохраняется в этом браузере: оценка, R, серия плюсовых попыток и сравнение с реальными сделками.</p>
      </AsideCard>
    );
  }
  return (
    <AsideCard
      title="Твоя статистика"
      action={<Segmented size="sm" ariaLabel="Период статистики" value={scope} onChange={setScope} options={[{ value: "session", label: "Сессия" }, { value: "all", label: "Всё" }]} />}
    >
      {st.count === 0 ? (
        <p className="text-sm text-muted-foreground">В этой сессии попыток ещё нет.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-2 gap-y-2 text-center">
            <Stat value={st.count} label={pluralRu(st.count, "попытка", "попытки", "попыток")} />
            <Stat value={st.avgScore ?? "—"} label="ср. оценка" />
            <Stat value={st.plusShare != null ? `${Math.round(st.plusShare * 100)}%` : "—"} label="в плюс" />
            <Stat value={st.avgR != null ? fmtR(st.avgR) : "—"} label="ср. R" className={tone(st.avgR)} title={st.sumR != null ? `Всего ${fmtR(st.sumR)}` : "R считается для попыток со стопом"} />
            <Stat value={st.avgRealR != null ? fmtR(st.avgRealR) : "—"} label="R трейдеров" className={tone(st.avgRealR)} title="Средний R реальных сделок в этих задачах (где был стоп)" />
            <Stat value={st.comparable ? `${st.beatReal}/${st.comparable}` : "—"} label="лучше сделки" title="Попыток лучше реальной сделки на акцию" />
          </div>
          {st.streak > 0 && <p className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--chart-3))]"><Flame className="h-3.5 w-3.5" aria-hidden="true" />серия в плюс: {st.streak}</p>}
          <ul className="flex flex-col divide-y divide-[var(--glass-border)] text-xs tabular-nums">
            {shown.slice(0, 5).map((x) => (
              <li key={x.at} className="flex items-center gap-2 py-1">
                <span className="w-7 font-semibold">{x.score ?? "—"}</span>
                <span className="font-medium">{x.ticker}</span>
                <span className="text-muted-foreground">{x.day.slice(5)}</span>
                <span className={cn("ml-auto", tone(x.trades ? x.pnlUsd : null))}>{x.trades ? (x.r != null ? fmtR(x.r) : fmtPerShare(x.perShare)) : "без сделок"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button variant="ghost" size="sm" className="h-7 self-start px-2 text-xs text-muted-foreground" onClick={newSession} title="Начать новую сессию: счётчики «Сессия» с нуля (история не удаляется)">
        <RotateCcw className="mr-1 h-3 w-3" /> Новая сессия
      </Button>
    </AsideCard>
  );
}
