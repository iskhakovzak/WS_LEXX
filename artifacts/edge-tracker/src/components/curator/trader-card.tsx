import * as React from "react";
import { Link } from "wouter";
import { ArrowRight, NotebookPen } from "lucide-react";
import { LimitBar, Pill, Sparkline, StatusDot, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { addDays, nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import { useBehaviorPatterns, type TraderSignal } from "./api";
import { actionTone, disciplineTone, riskTone, shortDate, usd, worstUsage } from "./curator-math";

const TREND_WORD = { up: "растёт", down: "падает", flat: "ровно", none: "нет данных" } as const;

/** One trader in «Мои трейдеры»: trend, discipline, risk usage, patterns, last review, stage and the next action. */
export function TraderCard({ s, onOpen, showPatterns }: { s: TraderSignal; onOpen: (tab?: string) => void; showPatterns: boolean }) {
  const usage = worstUsage(s);
  const weeks = s.trend.map((w) => w.net);
  const fourWeekNet = s.trend.reduce((a, w) => a + (w.net ?? 0), 0);
  const hasTrend = s.trend.some((w) => w.trades > 0);
  const lastReview = [s.eod.lastReviewedAt, s.weekly.lastReviewedAt].filter((v): v is string => !!v).sort().pop() ?? null;
  const tone = actionTone(s.nextAction.kind);

  return (
    <article
      className={cn(
        "glass-panel flex min-w-0 flex-col gap-3 rounded-2xl p-[var(--panel-p)]",
        tone === "down" && "ring-1 ring-down/30",
      )}
    >
      <header className="flex min-w-0 items-start gap-2">
        <button type="button" onClick={() => onOpen()} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-base font-semibold text-foreground hover:text-primary">{s.trader}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {s.stage.label ?? "этап не задан"}{s.tierName ? ` · тир ${s.tierName}` : ""}{s.lastTradeDate ? ` · посл. сделка ${shortDate(s.lastTradeDate)}` : ""}
          </span>
        </button>
        <Pill tone={riskTone(s.risk.state)} dot>{s.risk.hasLimits ? s.risk.label : "Без лимитов"}</Pill>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="4 недели" title="Нетто по неделям (пн–пт, NY)">
          <div className="flex items-end justify-between gap-1">
            <span className={cn("text-sm font-semibold tabular-nums", !hasTrend ? "text-muted-foreground" : fourWeekNet > 0 ? "text-up" : fourWeekNet < 0 ? "text-down" : "text-foreground")}>
              {hasTrend ? usd(fourWeekNet) : "—"}
            </span>
            <Sparkline data={weeks} width={56} height={20} baseline={0} ariaLabel={`Тренд за 4 недели: ${TREND_WORD[s.trendDir]}`} />
          </div>
        </Metric>
        <Metric label="Дисциплина" title="0–10: оценка дисциплины в закрытых днях (×2) и рейтинг куратора за 6 недель">
          <span className={cn("text-sm font-semibold tabular-nums", s.discipline.value == null ? "text-muted-foreground" : toneText(disciplineTone(s.discipline.value)))}>
            {s.discipline.value != null ? s.discipline.value.toFixed(1) : "—"}
          </span>
          <span className="text-2xs text-muted-foreground">{s.discipline.n ? `${s.discipline.n} оценок` : "нет оценок"}</span>
        </Metric>
        <Metric label="Сегодня" title="Нетто за сегодня и сделки">
          <span className={cn("text-sm font-semibold tabular-nums", (s.risk.todayPnl ?? 0) > 0 ? "text-up" : (s.risk.todayPnl ?? 0) < 0 ? "text-down" : "text-foreground")}>
            {s.risk.todayTrades ? usd(s.risk.todayPnl) : "—"}
          </span>
          <span className="text-2xs tabular-nums text-muted-foreground">{s.risk.todayTrades} сд.{s.risk.openPositions ? ` · ${s.risk.openPositions} откр.` : ""}</span>
        </Metric>
      </div>

      {s.risk.hasLimits ? (
        <LimitBar
          size="sm"
          used={usage ?? 0}
          limit={100}
          warnAt={0.7}
          showValues={false}
          label="Использование лимитов (худший из день / неделя / просадка)"
          hint={usage != null ? `макс. ${Math.round(usage)}% · день ${pctOr(s.risk.dailyPct)} · неделя ${pctOr(s.risk.weeklyPct)} · просадка ${pctOr(s.risk.drawdownPct)}` : "нет данных"}
        />
      ) : (
        <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs text-warn">Лимиты не заданы — стоп не сработает.</p>
      )}

      {showPatterns && <PatternsLine trader={s.trader} />}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Последний разбор</dt>
        <dd className="truncate text-right tabular-nums text-foreground">{lastReview ? shortDate(lastReview.slice(0, 10)) : "не было"}</dd>
        <dt className="text-muted-foreground">Очередь / нарушения</dt>
        <dd className="text-right tabular-nums text-foreground">
          {s.eod.pending + (s.weekly.submittedPending ? 1 : 0) + s.academy.pendingSubmissions} / {s.breaches.unreviewed ? <span className="text-down">{s.breaches.unreviewed} без разбора</span> : s.breaches.last30}
        </dd>
        <dt className="text-muted-foreground">1:1</dt>
        <dd className={cn("text-right tabular-nums", (s.academy.daysSinceOneOnOne ?? 99) > 14 ? "text-warn" : "text-foreground")}>
          {s.academy.lastOneOnOne ? `${s.academy.daysSinceOneOnOne} дн. назад` : "не было"}
          {s.academy.overdueActions ? <span className="text-down"> · {s.academy.overdueActions} проср.</span> : null}
        </dd>
      </dl>

      {s.lastNote && (
        <button type="button" onClick={() => onOpen("notes")} className="tile flex min-w-0 items-start gap-2 p-2 text-left text-xs">
          <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="line-clamp-2 min-w-0 text-muted-foreground"><span className="font-medium text-foreground">{s.lastNote.author}:</span> {s.lastNote.body}</span>
        </button>
      )}

      <footer className="mt-auto flex min-w-0 items-center gap-2 border-t border-[var(--glass-border)] pt-3">
        <StatusDot tone={tone} className="min-w-0 flex-1"><span className="text-sm text-foreground">{s.nextAction.label}</span></StatusDot>
        {s.nextAction.kind !== "none" && (
          <Button asChild size="sm" variant="ghost" className="shrink-0">
            <Link href={s.nextAction.href}>Открыть <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onOpen()}>Профиль</Button>
      </footer>
    </article>
  );
}

function pctOr(v: number | null) {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function Metric({ label, title, children }: { label: React.ReactNode; title?: string; children: React.ReactNode }) {
  return (
    <div className="tile flex min-w-0 flex-col gap-0.5 p-2" title={title}>
      <span className="truncate text-2xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const SEVERITY_TONE: Record<string, "down" | "warn" | "neutral"> = { high: "down", medium: "warn", low: "neutral" };

/** Top behaviour patterns (costliest first) from /api/behavior over the last 4 weeks. Optional — hidden on error. */
function PatternsLine({ trader }: { trader: string }) {
  const to = nyDate();
  const from = addDays(to, -28);
  const q = useBehaviorPatterns(trader, from, to, true);
  const top = (q.data?.patterns ?? [])
    .filter((p) => p.n > 0 && p.severity !== "none")
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))
    .slice(0, 2);
  if (q.isLoading) return <div className="skeleton h-5 w-2/3" aria-hidden="true" />;
  if (q.isError || !top.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-2xs text-muted-foreground">Паттерны:</span>
      {top.map((p) => (
        <Pill key={p.key} tone={SEVERITY_TONE[p.severity ?? ""] ?? "neutral"} title={p.cost != null ? `Стоимость за 4 недели: ${usd(p.cost)}` : undefined}>
          {p.title} · {p.n}
        </Pill>
      ))}
    </div>
  );
}
