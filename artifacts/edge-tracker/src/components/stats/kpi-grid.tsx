import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { StatCard, StatGrid, toneOf, type Tone } from "@/components/ds";
import { fmtPct, fmtRatio, fmtValue, pluralRu, type Kpis, type Metric } from "./metrics";

type DeltaKind = "value" | "pct" | "count" | "ratio";

function Delta({ cur, prev, kind, metric }: {
  cur: number | null; prev: number | null; kind: DeltaKind; metric: Metric;
}) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const d = cur - prev;
  const text =
    kind === "pct" ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(Math.round(d * 100))} п.п.`
    : kind === "count" ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(Math.round(d))}`
    : kind === "ratio" ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(2)}`
    : d === 0 ? fmtValue(0, metric, { sign: false }) : fmtValue(d, metric);
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : null;
  return (
    <span className="inline-flex items-center gap-0.5" title="Изменение к предыдущему периоду">
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {text}
      <span className="sr-only"> к предыдущему периоду</span>
    </span>
  );
}

function deltaTone(cur: number | null, prev: number | null, higherBetter = true, neutral = false): Tone {
  if (neutral || cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || cur === prev) return "neutral";
  return (cur > prev) === higherBetter ? "up" : "down";
}

const finite = (v: number | null) => (v != null && Number.isFinite(v) ? v : null);

export function KpiGrid({ k, prev, metric }: { k: Kpis; prev: Kpis | null; metric: Metric }) {
  const p = prev && prev.total > 0 ? prev : null;
  const unit = metric === "r" ? "R" : "$";

  const cards: {
    key: string;
    label: string;
    title: string;
    value: string;
    tone: Tone;
    hint?: string;
    cur: number | null;
    prev: number | null;
    kind: DeltaKind;
    higherBetter?: boolean;
    neutralDelta?: boolean;
  }[] = [
    {
      key: "net", label: metric === "net" ? "Результат net, $" : metric === "usd" ? "Результат gross, $" : "Результат, R", title: "Сумма по закрытым сделкам с заполненным значением",
      value: fmtValue(k.net, metric), tone: toneOf(k.net),
      hint: k.missing > 0 ? `${k.missing} без ${unit}` : undefined,
      cur: k.net, prev: p?.net ?? null, kind: "value",
    },
    {
      key: "wr", label: "Win rate", title: "Доля прибыльных среди закрытых (BE считается как не-победа)",
      value: fmtPct(k.winRate), tone: k.winRate == null ? "neutral" : k.winRate >= 0.5 ? "up" : "down",
      hint: `${k.wins}W · ${k.losses}L${k.breakeven ? ` · ${k.breakeven}BE` : ""}`,
      cur: k.winRate, prev: p?.winRate ?? null, kind: "pct",
    },
    {
      key: "trades", label: "Сделок", title: "Все сделки за период, включая открытые",
      value: String(k.total), tone: "neutral",
      hint: k.open ? `${k.open} откр. · ${k.tradingDays} ${pluralRu(k.tradingDays, "день", "дня", "дней")}` : `${k.tradingDays} ${pluralRu(k.tradingDays, "торг. день", "торг. дня", "торг. дней")}`,
      cur: k.total, prev: p?.total ?? null, kind: "count", neutralDelta: true,
    },
    {
      key: "exp", label: metric === "r" ? "Матожидание (ср. R)" : "Матожидание", title: "Средний результат на закрытую сделку",
      value: fmtValue(k.expectancy, metric), tone: toneOf(k.expectancy),
      hint: "на сделку",
      cur: k.expectancy, prev: p?.expectancy ?? null, kind: "value",
    },
    {
      key: "pf", label: "Profit factor", title: "Сумма прибылей / сумма убытков. >1 — система в плюсе",
      value: fmtRatio(k.profitFactor),
      tone: k.profitFactor == null ? "neutral" : k.profitFactor >= 1 ? "up" : "down",
      hint: k.payoff != null ? `payoff ${k.payoff.toFixed(2)}` : undefined,
      cur: finite(k.profitFactor), prev: finite(p?.profitFactor ?? null), kind: "ratio",
    },
    {
      key: "avgwin", label: "Ср. прибыль", title: "Средний результат прибыльной сделки",
      value: fmtValue(k.avgWin, metric), tone: k.avgWin == null ? "neutral" : "up",
      hint: k.bestTrade != null && k.bestTrade > 0 ? `макс. ${fmtValue(k.bestTrade, metric)}` : undefined,
      cur: k.avgWin, prev: p?.avgWin ?? null, kind: "value",
    },
    {
      key: "avgloss", label: "Ср. убыток", title: "Средний результат убыточной сделки",
      value: fmtValue(k.avgLoss, metric), tone: k.avgLoss == null ? "neutral" : "down",
      hint: k.worstTrade != null && k.worstTrade < 0 ? `мин. ${fmtValue(k.worstTrade, metric)}` : undefined,
      cur: k.avgLoss, prev: p?.avgLoss ?? null, kind: "value",
    },
    {
      key: "dd", label: "Макс. просадка", title: "Наибольшее падение кривой результата от пика",
      value: k.maxDrawdown == null ? "—" : k.maxDrawdown === 0 ? fmtValue(0, metric, { sign: false }) : fmtValue(k.maxDrawdown, metric),
      tone: k.maxDrawdown != null && k.maxDrawdown < 0 ? "down" : "neutral",
      hint: k.tradingDays ? `${k.greenDays} зел. / ${k.redDays} красн. дн.` : undefined,
      cur: k.maxDrawdown, prev: p?.maxDrawdown ?? null, kind: "value",
    },
    {
      key: "wstreak", label: "Лучшая серия", title: "Максимум прибыльных сделок подряд",
      value: `${k.longestWin} ${pluralRu(k.longestWin, "победа", "победы", "побед")}`, tone: k.longestWin ? "up" : "neutral",
      hint: k.current.kind === "win" && k.current.len > 0 ? `сейчас ${k.current.len} подряд` : undefined,
      cur: k.longestWin, prev: p?.longestWin ?? null, kind: "count",
    },
    {
      key: "lstreak", label: "Худшая серия", title: "Максимум убыточных сделок подряд",
      value: `${k.longestLoss} ${pluralRu(k.longestLoss, "убыток", "убытка", "убытков")}`, tone: k.longestLoss ? "down" : "neutral",
      hint: k.current.kind === "loss" && k.current.len > 0 ? `сейчас ${k.current.len} подряд` : undefined,
      cur: k.longestLoss, prev: p?.longestLoss ?? null, kind: "count", higherBetter: false,
    },
  ];

  return (
    <StatGrid className="md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5">
      {cards.map((c) => {
        const delta = p ? <Delta cur={c.cur} prev={c.prev} kind={c.kind} metric={metric} /> : null;
        const hasDelta = p && c.cur != null && c.prev != null;
        return (
          <StatCard
            key={c.key}
            label={<span title={c.title}>{c.label}</span>}
            value={c.value}
            tone={c.tone}
            hint={c.hint}
            delta={hasDelta ? delta : undefined}
            deltaTone={deltaTone(c.cur, c.prev, c.higherBetter ?? true, c.neutralDelta)}
          />
        );
      })}
    </StatGrid>
  );
}

export function KpiGridSkeleton() {
  return (
    <StatGrid className="md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="glass-panel flex h-[104px] flex-col gap-2 rounded-2xl p-4">
          <div className="h-3 w-20 animate-pulse rounded-full bg-[var(--glass-hover-bg)]" />
          <div className="h-7 w-24 animate-pulse rounded-lg bg-[var(--glass-hover-bg)]" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-[var(--glass-hover-bg)]" />
        </div>
      ))}
    </StatGrid>
  );
}
