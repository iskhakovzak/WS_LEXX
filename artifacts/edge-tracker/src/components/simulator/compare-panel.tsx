import { ArrowRight } from "lucide-react";
import { Pill, TermTooltip, type TermKey, type Tone, toneOf } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtPct, fmtPf, fmtSigned, fmtUsd, sdeal } from "@/components/analytics-page/metrics";
import { usd2 } from "./fees-tab";
import type { BootstrapSummary, Metrics } from "./api";

const TONE_CLASS: Record<string, string> = { up: "text-up", down: "text-down", neutral: "text-muted-foreground" };
function deltaOf(a: number | null, b: number | null) {
  return a != null && b != null ? b - a : null;
}
function toneFor(d: number | null, invert = false): Tone {
  if (d == null || Math.abs(d) < 1e-9) return "neutral";
  return toneOf(invert ? -d : d);
}

const fmtRsum = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}R`;

/**
 * Result first: «было → стало» in $ and in R (when the trades have R), the difference big, and a plain-language
 * reliability verdict. Without a scenario it shows the period as it was and a prompt to ask a question.
 */
export function DeltaHeadline({ baseline, scenario, hasScenario, bootstrap }: { baseline: Metrics; scenario: Metrics; hasScenario: boolean; bootstrap: BootstrapSummary | null }) {
  const d = scenario.net - baseline.net;
  const rA = baseline.totalR ?? null, rB = scenario.totalR ?? null;
  const showR = rA != null && (baseline.rCount ?? 0) >= 3;
  const dR = showR && rB != null ? rB - rA : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Как было</p>
          <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", TONE_CLASS[toneOf(baseline.net)])}>{fmtUsd(baseline.net)}</p>
          {showR && <p className={cn("text-sm tabular-nums", TONE_CLASS[toneOf(rA)])}>{fmtRsum(rA)}</p>}
        </div>
        <ArrowRight className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-xs text-muted-foreground">Как стало бы</p>
          <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", hasScenario ? TONE_CLASS[toneOf(scenario.net)] : "text-muted-foreground")}>{hasScenario ? fmtUsd(scenario.net) : "—"}</p>
          {showR && <p className={cn("text-sm tabular-nums", hasScenario && rB != null ? TONE_CLASS[toneOf(rB)] : "text-muted-foreground")}>{hasScenario && rB != null ? fmtRsum(rB) : "—"}</p>}
        </div>
        {hasScenario ? (
          <div className="rounded-2xl bg-[hsl(var(--muted-foreground)/0.08)] px-4 py-2">
            <p className="text-xs text-muted-foreground">Разница за период</p>
            <p className={cn("text-4xl font-semibold leading-tight tabular-nums tracking-tight", TONE_CLASS[toneOf(d)])}>{fmtUsd(d)}</p>
            {dR != null && <p className={cn("text-sm font-medium tabular-nums", TONE_CLASS[toneOf(dR)])}>{fmtRsum(dR)} · {sdeal(scenario.trades)} из {baseline.trades}</p>}
            {dR == null && <p className="text-sm tabular-nums text-muted-foreground">{sdeal(scenario.trades)} из {baseline.trades}</p>}
          </div>
        ) : (
          <p className="max-w-xs pb-1 text-sm text-muted-foreground">Выбери вопрос выше или подсказку ниже — здесь появится, сколько бы это дало.</p>
        )}
      </div>
      {hasScenario && <Reliability b={bootstrap} />}
    </div>
  );
}

function Reliability({ b }: { b: BootstrapSummary | null }) {
  if (!b) return <Pill tone="neutral">мало дней для оценки надёжности</Pill>;
  const { lo, hi, mean } = b.diffTotal;
  const robust = b.significant;
  const tone: Tone = robust ? (mean > 0 ? "up" : "down") : "warn";
  const text = robust ? (mean > 0 ? "устойчиво лучше" : "устойчиво хуже") : "может быть случайностью";
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Pill tone={tone}>{text}{b.smallSample ? " · мало дней" : ""}</Pill>
      <span className="text-xs text-muted-foreground tabular-nums" title="95% интервал разницы, если перемешать торговые дни (бутстреп по дням)">
        с вероятностью 95% от {fmtUsd(lo)} до {fmtUsd(hi)}
      </span>
    </div>
  );
}

type KeyDef = { label: string; term?: TermKey; a: number | null; b: number | null; fmt: (v: number | null) => string; delta: (d: number) => string; invert?: boolean };

/** Strip of key metrics «факт → сценарий» (6 numbers, always the same height). */
export function KeyMetrics({ baseline, scenario, hasScenario }: { baseline: Metrics; scenario: Metrics; hasScenario: boolean }) {
  const usd = (v: number | null) => (v == null ? "—" : fmtUsd(v));
  const items: KeyDef[] = [
    { label: "Нетто", term: "net", a: baseline.net, b: scenario.net, fmt: usd, delta: (d) => fmtUsd(d) },
    { label: "Комиссии", term: "fees", a: baseline.fees, b: scenario.fees, fmt: (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`), delta: (d) => fmtUsd(d), invert: true },
    { label: "Сделок", a: baseline.trades, b: scenario.trades, fmt: (v) => (v == null ? "—" : String(v)), delta: (d) => fmtSigned(d, 0) },
    { label: "Винрейт", term: "winrate", a: baseline.winRate, b: scenario.winRate, fmt: (v) => fmtPct(v, 1), delta: (d) => `${fmtSigned(d * 100, 1)} п.п.` },
    { label: "PF", term: "pf", a: baseline.profitFactor, b: scenario.profitFactor, fmt: fmtPf, delta: (d) => fmtSigned(d, 2) },
    { label: "Макс. просадка", term: "drawdown", a: baseline.maxDrawdown, b: scenario.maxDrawdown, fmt: usd, delta: (d) => fmtUsd(d) },
  ];
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
      {items.map((it) => {
        const d = hasScenario ? deltaOf(it.a, it.b) : null;
        const tone = toneFor(d, it.invert);
        return (
          <div key={it.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {it.term ? <TermTooltip term={it.term}>{it.label}</TermTooltip> : it.label}
            </dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums">
              <span className={cn("text-sm", hasScenario ? "text-muted-foreground" : "font-semibold text-foreground")}>{it.fmt(it.a)}</span>
              {hasScenario && (
                <>
                  <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" aria-label="стало" />
                  <span className="text-sm font-semibold text-foreground">{it.fmt(it.b)}</span>
                </>
              )}
            </dd>
            <span className={cn("min-h-4 text-xs tabular-nums", TONE_CLASS[tone])}>{d == null ? " " : Math.abs(d) < 1e-9 ? "без изменений" : it.delta(d)}</span>
          </div>
        );
      })}
    </dl>
  );
}

type RowDef = { label: string; a: number | null; b: number | null; fmt: (v: number | null) => string; delta?: (d: number) => string; invert?: boolean; hint?: string };

/** Full side-by-side table (inside «Все показатели»). */
export function MetricsTable({ baseline, scenario, hasScenario }: { baseline: Metrics; scenario: Metrics; hasScenario: boolean }) {
  const rows: RowDef[] = [
    { label: "Нетто", a: baseline.net, b: scenario.net, fmt: fmtUsd, hint: "P&L − |комиссии|" },
    { label: "Брутто", a: baseline.gross, b: scenario.gross, fmt: fmtUsd },
    { label: "Комиссии", a: baseline.fees, b: scenario.fees, fmt: (v) => (v == null ? "—" : usd2(v)), invert: true },
    { label: "Сделок", a: baseline.trades, b: scenario.trades, fmt: (v) => (v == null ? "—" : String(v)), delta: (d) => fmtSigned(d, 0) },
    { label: "Винрейт", a: baseline.winRate, b: scenario.winRate, fmt: (v) => fmtPct(v, 1), delta: (d) => `${fmtSigned(d * 100, 1)} п.п.`, hint: "W / (W + L), по нетто" },
    { label: "Профит-фактор", a: baseline.profitFactor, b: scenario.profitFactor, fmt: fmtPf, delta: (d) => fmtSigned(d, 2), hint: "Σ нетто⁺ / |Σ нетто⁻|" },
    { label: "Среднее на сделку", a: baseline.expectancy, b: scenario.expectancy, fmt: fmtUsd },
    { label: "Средний плюс", a: baseline.avgWin, b: scenario.avgWin, fmt: fmtUsd },
    { label: "Средний минус", a: baseline.avgLoss, b: scenario.avgLoss, fmt: fmtUsd },
    { label: "Макс. просадка", a: baseline.maxDrawdown, b: scenario.maxDrawdown, fmt: fmtUsd, hint: "по кривой нетто, сделка за сделкой" },
    { label: "Худший день", a: baseline.worstDay?.net ?? null, b: scenario.worstDay?.net ?? null, fmt: fmtUsd },
    { label: "Лучший день", a: baseline.bestDay?.net ?? null, b: scenario.bestDay?.net ?? null, fmt: fmtUsd },
    { label: "Убытков подряд (макс.)", a: baseline.maxLossStreak, b: scenario.maxLossStreak, fmt: (v) => (v == null ? "—" : String(v)), delta: (d) => fmtSigned(d, 0), invert: true },
    { label: "Торговых дней", a: baseline.days, b: scenario.days, fmt: (v) => (v == null ? "—" : String(v)), delta: (d) => fmtSigned(d, 0) },
  ];
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1.5 text-left font-medium">Показатель</th>
          <th className="py-1.5 text-right font-medium">{hasScenario ? "Как было" : "Значение"}</th>
          {hasScenario && <th className="py-1.5 text-right font-medium">Как стало</th>}
          {hasScenario && <th className="py-1.5 text-right font-medium">Разница</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const d = hasScenario ? deltaOf(r.a, r.b) : null;
          const tone = toneFor(d, r.invert);
          return (
            <tr key={r.label} className="border-t border-border/50">
              <td className="py-1.5" title={r.hint}>{r.label}</td>
              <td className={cn("py-1.5 text-right", hasScenario ? "text-muted-foreground" : "font-medium")}>{r.fmt(r.a)}</td>
              {hasScenario && <td className="py-1.5 text-right font-medium">{r.fmt(r.b)}</td>}
              {hasScenario && <td className={cn("py-1.5 text-right", TONE_CLASS[tone])}>{d == null ? "—" : r.delta ? r.delta(d) : fmtUsd(d)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Bootstrap details in plain words (inside «Все показатели»). */
export function BootstrapDetails({ b }: { b: BootstrapSummary | null }) {
  if (!b) return <p className="text-sm text-muted-foreground">Слишком мало торговых дней, чтобы оценить надёжность (нужно хотя бы 2).</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-[var(--glass-bg)] p-3">
          <p className="text-xs text-muted-foreground">Разница за период</p>
          <p className={cn("text-lg font-semibold tabular-nums", TONE_CLASS[b.significant ? toneOf(b.diffTotal.mean) : "neutral"])}>{fmtUsd(b.diffTotal.mean)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">95%: от {fmtUsd(b.diffTotal.lo)} до {fmtUsd(b.diffTotal.hi)}</p>
        </div>
        <div className="rounded-xl bg-[var(--glass-bg)] p-3">
          <p className="text-xs text-muted-foreground">В среднем за день</p>
          <p className="text-sm tabular-nums"><span className="text-muted-foreground">было </span>{fmtUsd(b.dailyExpectancy.base.mean)} <span className="text-xs text-muted-foreground">({fmtUsd(b.dailyExpectancy.base.lo)} … {fmtUsd(b.dailyExpectancy.base.hi)})</span></p>
          <p className="text-sm tabular-nums"><span className="text-muted-foreground">стало </span>{fmtUsd(b.dailyExpectancy.scenario.mean)} <span className="text-xs text-muted-foreground">({fmtUsd(b.dailyExpectancy.scenario.lo)} … {fmtUsd(b.dailyExpectancy.scenario.hi)})</span></p>
        </div>
        <div className="rounded-xl bg-[var(--glass-bg)] p-3">
          <p className="text-xs text-muted-foreground">Типичный месяц (21 торговый день)</p>
          <p className="text-sm tabular-nums">стало: медиана {fmtUsd(b.month.p50)}, в плюсе в {Math.round(b.month.probPositive * 100)}% случаев</p>
          <p className="text-xs text-muted-foreground tabular-nums">было: медиана {fmtUsd(b.monthBase.p50)}, в плюсе в {Math.round(b.monthBase.probPositive * 100)}%</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Как считаем: {b.iters} раз случайно пересобираем {b.days} торговых дней (один и тот же день — в «было» и «стало») и смотрим разброс разницы.
        Это история на твоих сделках, а не прогноз: без убранных сделок ты мог бы взять другие.
      </p>
    </div>
  );
}

export function tradesHint(m: Metrics) {
  return `${sdeal(m.trades)} · ${m.days} дн.`;
}
