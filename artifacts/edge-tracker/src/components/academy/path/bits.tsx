/** Shared visual pieces of «Путь трейдера» and «Экзамены». */
import * as React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleDashed, Lock, X } from "lucide-react";
import { Pill, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import {
  type ChallengeStatus, type CriterionResult, type EventKind, type RuleProgress, type RuleState, type StageKey, type StageMeta, type TimelineDay, type Trend,
  fmtDate, usd,
} from "./api";

// ─── ladder ─────────────────────────────────────────────────────────────────

/** Horizontal 4-step ladder: done / current / next / locked. Reads as an ordered list for screen readers. */
export function StageLadder({ stages, current, readyFor, counts }: {
  stages: StageMeta[];
  current: StageKey | null;
  /** Next stage key when every criterion passes (highlights the arrow). */
  readyFor?: StageKey | null;
  /** Optional people count per stage (staff funnel). */
  counts?: Partial<Record<StageKey, number>>;
}) {
  const idx = current ? stages.findIndex((s) => s.key === current) : -1;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Ступени пути трейдера">
      {stages.map((s, i) => {
        const state = idx < 0 ? "locked" : i < idx ? "done" : i === idx ? "current" : i === idx + 1 ? "next" : "locked";
        const Icon = state === "done" ? Check : state === "current" ? CircleDashed : state === "next" ? ArrowRight : Lock;
        return (
          <li
            key={s.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "relative flex min-w-0 flex-col gap-1 rounded-2xl border p-3",
              state === "current" && "border-primary/60 bg-primary/10",
              state === "done" && "border-up/30 bg-up/5",
              state === "next" && (readyFor === s.key ? "border-up/60 bg-up/10" : "border-[var(--field-border)] bg-[var(--glass-bg)]"),
              state === "locked" && "border-[var(--field-border)] opacity-70",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ступень {i + 1}</span>
              <Icon className={cn("h-4 w-4", state === "done" && "text-up", state === "current" && "text-primary", state === "next" && "text-muted-foreground", state === "locked" && "text-muted-foreground")} aria-hidden="true" />
            </div>
            <span className="truncate text-base font-semibold text-foreground">{s.name}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{s.description}</span>
            <span className="sr-only">
              {state === "done" ? "пройдена" : state === "current" ? "текущая ступень" : state === "next" ? (readyFor === s.key ? "следующая, критерии выполнены" : "следующая") : "закрыта"}
            </span>
            {counts && <span className="mt-1 text-xs tabular-nums text-muted-foreground">{counts[s.key] ?? 0} чел.</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ─── criteria ───────────────────────────────────────────────────────────────

export function TrendMark({ trend, prev, unitLabel }: { trend: Trend | null; prev: number | null; unitLabel?: string }) {
  if (!trend) return <span className="text-xs text-muted-foreground">—</span>;
  const Icon = trend === "better" ? ArrowUpRight : trend === "worse" ? ArrowDownRight : ArrowRight;
  const word = trend === "better" ? "лучше" : trend === "worse" ? "хуже" : "без изменений";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs", trend === "better" ? "text-up" : trend === "worse" ? "text-down" : "text-muted-foreground")}
      title={prev != null ? `Прошлое такое же окно: ${prev}${unitLabel ?? ""}` : undefined}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {word}
    </span>
  );
}

function Bar({ pct, tone, label }: { pct: number; tone: "up" | "down" | "warn" | "accent" | "muted"; label: string }) {
  const w = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
      <div
        className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none",
          tone === "up" && "bg-up", tone === "down" && "bg-down", tone === "warn" && "bg-[hsl(var(--chart-3))]", tone === "accent" && "bg-primary", tone === "muted" && "bg-muted-foreground/40")}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

export function CriterionRow({ c }: { c: CriterionResult }) {
  const pass = c.status === "pass", na = c.status === "na";
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", pass ? "bg-up/15 text-up" : na ? "bg-[var(--glass-bg)] text-muted-foreground" : "bg-down/15 text-down")}>
            {pass ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : na ? <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="sr-only">{pass ? "выполнено" : na ? "не учитывается" : "не выполнено"}</span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground" title={c.hint}>{c.label}</p>
            <p className="text-xs text-muted-foreground">{c.windowLabel}{c.note ? ` · ${c.note}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className={cn("font-semibold", pass ? "text-up" : na ? "text-muted-foreground" : "text-foreground")}>{c.display}</span>
          <span className="text-xs text-muted-foreground">цель {c.targetDisplay}</span>
          <TrendMark trend={c.trend} prev={c.prevValue} />
        </div>
      </div>
      {!na && <Bar pct={c.progress} tone={pass ? "up" : c.progress >= 0.8 ? "warn" : "down"} label={`${c.label}: ${Math.round(c.progress * 100)}% до цели`} />}
      {c.advice && <p className="rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-xs text-foreground/90"><span className="font-medium">Что улучшить: </span>{c.advice}</p>}
    </li>
  );
}

// ─── challenges ─────────────────────────────────────────────────────────────

export const CH_TONE: Record<ChallengeStatus, Tone> = { scheduled: "neutral", active: "accent", passed: "up", failed: "down", expired: "warn" };
export function ChallengeStatusPill({ status, label }: { status: ChallengeStatus; label: string }) {
  return <Pill tone={CH_TONE[status]} dot>{label}</Pill>;
}

const RULE_TONE: Record<RuleState, "up" | "down" | "warn" | "accent" | "muted"> = { ok: "up", met: "up", warn: "warn", breached: "down", pending: "accent", na: "muted" };
const RULE_WORD: Record<RuleState, string> = { ok: "в норме", met: "выполнено", warn: "внимание", breached: "нарушено", pending: "в процессе", na: "нет данных" };
const RULE_PILL: Record<RuleState, Tone> = { ok: "up", met: "up", warn: "warn", breached: "down", pending: "accent", na: "neutral" };

export function RuleBar({ p }: { p: RuleProgress }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{p.label}</span>
        <span className="flex items-center gap-2 tabular-nums">
          <span className="text-foreground">{p.display}</span>
          <Pill tone={RULE_PILL[p.state]}>{RULE_WORD[p.state]}</Pill>
        </span>
      </div>
      {p.pct != null && <Bar pct={p.pct} tone={RULE_TONE[p.state]} label={`${p.label}: ${Math.round(p.pct * 100)}%`} />}
      <p className="text-xs text-muted-foreground">{p.detail}</p>
    </li>
  );
}

const EVENT_TONE: Record<EventKind, Tone> = {
  daily_loss: "down", max_dd: "down", size: "down", window: "down", target: "up", passed: "up", warn_daily: "warn", warn_dd: "warn", warn_window: "warn",
};

/** Day-by-day timeline: a mini bar per day (net), cumulative P&L, floor room and events. */
export function ChallengeTimeline({ days, accountSize }: { days: TimelineDay[]; accountSize: number }) {
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  if (!days.length) return <p className="text-sm text-muted-foreground">Экзамен ещё не начался.</p>;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Хронология экзамена по дням</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">День</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Сделок</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">P&amp;L дня</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Итого</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Минимальный внутридневной результат">Мин. дня</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Запас до уровня просадки">Запас DD</th>
            <th scope="col" className="py-1.5 font-medium">События</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const bad = d.events.some((e) => EVENT_TONE[e.kind] === "down");
            return (
              <tr key={d.date} className={cn("border-t border-[var(--field-border)] align-top", bad && "bg-down/5")}>
                <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-medium text-foreground">{fmtDate(d.date)}</th>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{d.trades}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="relative h-2 w-20 overflow-hidden rounded-full bg-[var(--glass-bg)]" aria-hidden="true">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--field-border)]" />
                      <span
                        className={cn("absolute inset-y-0", d.net >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")}
                        style={{ width: `${(Math.abs(d.net) / maxAbs) * 50}%` }}
                      />
                    </span>
                    <span className={cn("tabular-nums", d.net > 0 ? "text-up" : d.net < 0 ? "text-down" : "text-muted-foreground")}>{usd(d.net)}</span>
                  </div>
                </td>
                <td className={cn("py-2 pr-3 text-right tabular-nums", d.cum > 0 ? "text-up" : d.cum < 0 ? "text-down" : "text-foreground")}>{usd(d.cum)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{usd(d.dayLow)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground" title={d.floor != null ? `Уровень ${usd(d.floor)} при счёте ${usd(accountSize)}` : undefined}>{d.ddRoom != null ? usd(d.ddRoom) : "—"}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {d.events.map((e, i) => (
                      <Pill key={i} tone={EVENT_TONE[e.kind]} title={e.label} className="max-w-[320px] truncate">
                        {e.time ? `${e.time} NY · ` : ""}{e.label}
                      </Pill>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const selectCls = "glass-field h-9 min-w-0 rounded-full px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
