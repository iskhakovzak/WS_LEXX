import { Link } from "wouter";
import type { Trade } from "@workspace/api-client-react";
import { AlertTriangle, ArrowRight, Flame, Lightbulb, Target, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, Panel, type Tone, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { TradeLinkRow } from "./trade-link-row";
import { dayKey, fmtValue, groupBy, isClosed, valueOf, weekdayIdx, weekdayLabel, type Kpis, type Metric } from "./metrics";
import { fmtNum, fmtRate, pluralRu } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";

export type Insight = { id: string; tone: Tone; icon: LucideIcon; text: string; href?: string; cta?: string };

export function buildInsights(trades: Trade[], k: Kpis, metric: Metric): Insight[] {
  const out: Insight[] = [];
  const unit = metric === "r" ? "R" : "P&L";

  if (k.current.kind && k.current.len >= 2) {
    const win = k.current.kind === "win";
    out.push({
      id: "streak",
      tone: win ? "up" : "down",
      icon: Flame,
      text: win
        ? `Серия: ${k.current.len} ${pluralRu(k.current.len, "победа", "победы", "побед")} подряд — держите размер позиции, не разгоняйте риск.`
        : `Серия: ${k.current.len} ${pluralRu(k.current.len, "убыток", "убытка", "убытков")} подряд — время снизить размер и перечитать плейбук.`,
    });
  }

  if (k.payoff != null && k.winRate != null) {
    const need = 1 / (1 + k.payoff);
    out.push({
      id: "edge",
      tone: k.winRate >= need ? "up" : "down",
      icon: Target,
      text: `При payoff ${fmtNum(k.payoff)} безубыточный win rate — ${fmtRate(need)}; у вас ${fmtRate(k.winRate)}${k.winRate >= need ? " — есть запас." : " — пока ниже порога."}`,
    });
  }

  const closed = trades.filter(isClosed);
  const byDay = groupBy(closed, (t) => weekdayLabel(weekdayIdx(dayKey(t))), metric).filter((g) => g.valued >= 2 && g.value != null);
  if (byDay.length >= 2) {
    const best = byDay.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
    const worst = byDay.reduce((a, b) => ((b.value ?? 0) < (a.value ?? 0) ? b : a));
    if ((best.value ?? 0) > 0) out.push({ id: "bestday", tone: "up", icon: TrendingUp, text: `Лучший день недели — ${best.key}: ${fmtValue(best.value, metric)} за ${commonI18n.t("units.trades", { count: best.count })}.` });
    if ((worst.value ?? 0) < 0 && worst.key !== best.key) out.push({ id: "worstday", tone: "down", icon: TrendingDown, text: `Слабый день — ${worst.key}: ${fmtValue(worst.value, metric)}. Посмотрите, что мешает в этот день.` });
  }

  const bySetup = groupBy(closed, (t) => t.setup || t.eventType, metric).filter((g) => g.key !== "—" && g.valued >= 2 && g.value != null);
  if (bySetup.length) {
    const best = bySetup.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
    const worst = bySetup.reduce((a, b) => ((b.value ?? 0) < (a.value ?? 0) ? b : a));
    if ((best.value ?? 0) > 0) out.push({ id: "bestsetup", tone: "up", icon: Trophy, text: `Сильнейший сетап — «${best.key}»: ${fmtValue(best.value, metric)}, WR ${fmtRate(best.winRate)}.`, href: "/playbook", cta: "Плейбук" });
    if ((worst.value ?? 0) < 0 && worst.key !== best.key) out.push({ id: "worstsetup", tone: "down", icon: AlertTriangle, text: `Сетап «${worst.key}» в минусе: ${fmtValue(worst.value, metric)} за ${commonI18n.t("units.trades", { count: worst.count })}.`, href: "/analytics", cta: "Разобрать" });
  }

  if (k.missing > 0) {
    out.push({
      id: "missing",
      tone: "warn",
      icon: AlertTriangle,
      text: `${k.missing} ${pluralRu(k.missing, "закрытая сделка", "закрытые сделки", "закрытых сделок")} без ${unit} — заполните, чтобы отчёт был точным.`,
      href: "/trades",
      cta: "К сделкам",
    });
  }
  if (k.open > 0) {
    out.push({
      id: "open",
      tone: "accent",
      icon: Lightbulb,
      text: `${k.open} ${pluralRu(k.open, "открытая сделка", "открытые сделки", "открытых сделок")} не учитываются в результате и win rate.`,
      href: "/trades",
      cta: "Закрыть",
    });
  }
  return out;
}

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <Panel title="Выводы периода" icon={Lightbulb} description="Автоматически из ваших сделок">
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пока недостаточно данных для выводов — нужно хотя бы несколько закрытых сделок с {`R/P&L`}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {insights.map((i) => (
            <li key={i.id} className="flex items-start gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2.5">
              <i.icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneText(i.tone))} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-sm text-foreground">{i.text}</span>
              {i.href && (
                <Link href={i.href} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {i.cta ?? "Открыть"} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Best / worst trades of the period — each row opens the trade in the journal. */
export function ExtremesPanel({ trades, metric }: { trades: Trade[]; metric: Metric }) {
  const valued = trades.filter((t) => isClosed(t) && valueOf(t, metric) != null);
  const best = valued.filter((t) => valueOf(t, metric)! > 0).sort((a, b) => valueOf(b, metric)! - valueOf(a, metric)!).slice(0, 5);
  const worst = valued.filter((t) => valueOf(t, metric)! < 0).sort((a, b) => valueOf(a, metric)! - valueOf(b, metric)!).slice(0, 5);
  const unit = metric === "r" ? "R" : "P&L";

  const List = ({ title, icon: Icon, tone, items, empty }: { title: string; icon: LucideIcon; tone: Tone; items: Trade[]; empty: string }) => (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2 px-2">
        <Icon className={cn("h-4 w-4", toneText(tone))} aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {items.length ? (
        <ol className="flex flex-col">
          {items.map((t, i) => <TradeLinkRow key={t.id} trade={t} metric={metric} rank={i + 1} />)}
        </ol>
      ) : (
        <p className="px-2 py-4 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );

  return (
    <Panel title="Лучшие и худшие сделки" description={`Топ-5 по ${unit} — нажмите, чтобы открыть сделку в журнале`}>
      {valued.length === 0 ? (
        <EmptyState icon={Trophy} title={`Нет закрытых сделок с ${unit}`} description="Как только появятся результаты, здесь будут лидеры и аутсайдеры периода." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <List title="Лучшие" icon={Trophy} tone="up" items={best} empty="Нет прибыльных сделок за период" />
          <List title="Худшие" icon={AlertTriangle} tone="down" items={worst} empty="Нет убыточных сделок за период" />
        </div>
      )}
    </Panel>
  );
}
