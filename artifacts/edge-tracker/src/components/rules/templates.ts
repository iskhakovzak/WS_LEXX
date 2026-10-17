import type { BehaviorPattern, BehaviorResponse, RulesReportResponse } from "./types";

/** Draft for the rule dialog (create mode). */
export type RuleDraft = {
  name: string;
  kind: string;
  threshold: Record<string, unknown>;
  enabled?: boolean;
  note?: string | null;
};

type Stats = RulesReportResponse["stats"] | null | undefined;

const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

/**
 * Recommended starter rules with parameters taken from the trader's own history
 * (p90 trades/day, p90 loss per trade…), so the first preview is realistic, not generic.
 */
export function starterTemplates(stats: Stats): (RuleDraft & { why: string })[] {
  const p90Loss = stats?.p90Loss ?? null;
  const perTrade = p90Loss ? roundTo(p90Loss, 5) : 100;
  const dayLoss = p90Loss ? roundTo(p90Loss * 2.5, 25) : 300;
  const tradesDay = stats?.p90TradesPerDay ? Math.max(3, Math.round(stats.p90TradesPerDay)) : 8;
  return [
    { name: `Дневной лимит убытка $${dayLoss}`, kind: "max_daily_loss_usd", threshold: { usd: dayLoss }, why: "Остановиться, пока плохой день не стал катастрофой" },
    { name: "Стоп после 3 убытков подряд", kind: "no_trade_after_n_losses", threshold: { n: 3 }, why: "Тильт-стоп: после серии решения хуже" },
    { name: `Не больше ${tradesDay} сделок в день`, kind: "max_trades_per_day", threshold: { n: tradesDay }, why: "Порог по вашей истории (90-й перцентиль)" },
    { name: "Пауза 10 минут после убытка", kind: "min_pause_after_loss", threshold: { min: 10 }, why: "Против реванша сразу после стопа" },
    { name: `Убыток на сделку не больше $${perTrade}`, kind: "max_loss_per_trade_usd", threshold: { usd: perTrade }, why: "Работает без стопов: режет хвост крупных убытков" },
    { name: "Не торговать первые 5 минут", kind: "no_trade_first_minutes", threshold: { n: 5 }, why: "Открытие — самый шумный отрезок дня" },
  ];
}

/** Rule suggested for a behavior pattern (section «Поведение»). null — nothing sensible to suggest. */
export function ruleFromPattern(p: BehaviorPattern, beh: BehaviorResponse | null | undefined, stats: Stats): RuleDraft | null {
  const note = `Из паттерна «${p.title}»`;
  const norm = beh?.summary?.tradesPerDayNorm ?? null;
  const median = beh?.summary?.medianTradesPerDay ?? null;
  switch (p.key) {
    case "overtrading": {
      const n = Math.max(2, Math.round(norm ?? stats?.p90TradesPerDay ?? 10));
      return { name: `Не больше ${n} сделок в день`, kind: "max_trades_per_day", threshold: { n }, note };
    }
    case "fatigue": {
      const n = Math.max(2, Math.ceil(median ?? stats?.medianTradesPerDay ?? 5) + 2);
      return { name: `Не больше ${n} сделок в день`, kind: "max_trades_per_day", threshold: { n }, note };
    }
    case "revenge": {
      const min = Math.max(10, Math.round(beh?.options?.revengeMin ?? 10));
      return { name: `Пауза ${min} минут после убытка`, kind: "min_pause_after_loss", threshold: { min }, note };
    }
    case "martingale": {
      const factor = Math.max(1.1, Number(beh?.options?.martingaleRatio ?? 1.3));
      return { name: "Не увеличивать размер после убытка", kind: "no_size_up_after_loss", threshold: { factor }, note };
    }
    case "tilt":
      return { name: "Стоп после 3 убытков подряд", kind: "no_trade_after_n_losses", threshold: { n: 3 }, note };
    case "disposition": {
      const usd = stats?.p90Loss ? roundTo(stats.p90Loss, 5) : 100;
      return { name: `Убыток на сделку не больше $${usd}`, kind: "max_loss_per_trade_usd", threshold: { usd }, note };
    }
    case "firstTrade":
      return { name: "Первая сделка дня — только A+ сетап из плана", kind: "self_check", threshold: {}, note };
    case "euphoria":
      return { name: "После крупного выигрыша — пауза 30 минут", kind: "self_check", threshold: {}, note };
    case "chase":
      return { name: "После красного утра не отыгрываться", kind: "self_check", threshold: {}, note };
    default:
      return null;
  }
}

/** Auto name for a kind + threshold (used until the user types their own). */
export function autoName(label: string, kind: string, th: Record<string, unknown>): string {
  const n = (k: string) => (th[k] == null || th[k] === "" ? null : Number(th[k]));
  const hhmm = (v: unknown) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return String(v ?? "");
    return `${Math.floor(x / 100)}:${String(x % 100).padStart(2, "0")}`;
  };
  switch (kind) {
    case "max_trades_per_day": return n("n") ? `Не больше ${n("n")} сделок в день` : label;
    case "no_trade_after_n_losses": return n("n") ? `Стоп после ${n("n")} убытков подряд` : label;
    case "max_daily_loss_usd": return n("usd") ? `Дневной лимит убытка $${n("usd")}` : "Дневной лимит убытка (риск-деск)";
    case "max_loss_per_trade_usd": return n("usd") ? `Убыток на сделку не больше $${n("usd")}` : label;
    case "min_pause_after_loss": return n("min") ? `Пауза ${n("min")} минут после убытка` : label;
    case "no_trade_first_minutes": return n("n") ? `Не торговать первые ${n("n")} минут` : label;
    case "trading_window": return th.start != null && th.end != null ? `Торговать только ${hhmm(th.start)}–${hhmm(th.end)}` : label;
    case "min_hold_seconds": return n("sec") ? `Держать позицию не меньше ${n("sec")} сек` : label;
    case "max_position_shares": return n("qty") ? `Не больше ${n("qty")} акций в позиции` : label;
    case "max_trades_per_ticker_day": return n("n") ? `Не больше ${n("n")} входов в тикер за день` : label;
    case "max_consecutive_losses": return n("n") ? `Не больше ${n("n")} убытков подряд` : label;
    case "no_size_up_after_loss": return "Не увеличивать размер после убытка";
    default: return label;
  }
}
