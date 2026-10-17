/**
 * Тексты «почему это вредит» и конкретное правило-рекомендация для каждого поведенческого паттерна,
 * плюс действие для кнопки «Сделать правилом»:
 *   rule    — есть подходящий вид в правилах деска (lib/rulesEngine RULE_KINDS → POST /api/rules, сканер нарушений);
 *   trigger — личный триггер (lib/behaviorTriggers → POST /api/behavior/triggers), если вида правила нет.
 * Чистые функции; числа в рекомендации — из параметров/норм трейдера, а не константы.
 */
import type { PatternKey } from "./behaviorEngine";
import type { TriggerKind } from "./behaviorTriggers";
import { describeTrigger } from "./behaviorTriggers";

export type TriggerDraft = { kind: TriggerKind; params: Record<string, number>; name: string };
export type RuleDraft = { kind: string; threshold: Record<string, number>; name: string };

export type PatternInsight = {
  why: string;
  recommendation: string;
  /** Текст правила для копирования / напоминания. */
  ruleText: string;
  /** Подходящее правило деска (если есть вид). */
  rule: RuleDraft | null;
  /** Личный триггер (всегда есть — запасной путь, если правила нет). */
  trigger: TriggerDraft;
};

type InsightInput = {
  key: PatternKey;
  extra: Record<string, number | string | null>;
  opts: { revengeMin: number; martingaleRatio: number; euphoriaMin: number; morningEndMin: number };
};

const num = (v: number | string | null | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const fmtMin = (m: number) => (m < 60 ? `${Math.round(m)} мин` : `${Math.floor(m / 60)} ч ${Math.round(m % 60)} мин`);
const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

function trig(kind: TriggerKind, params: Record<string, number>): TriggerDraft {
  return { kind, params, name: describeTrigger(kind, params) };
}

export function insightFor({ key, extra, opts }: InsightInput): PatternInsight {
  switch (key) {
    case "revenge": {
      const pause = Math.max(10, Math.ceil(opts.revengeMin * 1.5 / 5) * 5);
      return {
        why: "После убытка решение принимает эмоция: вход без сетапа, часто тем же тикером и бóльшим размером — попытка «вернуть» деньги, а не торговля по плану.",
        recommendation: `Пауза не меньше ${pause} мин после каждой убыточной сделки: записать причину убытка, вернуться только по сетапу из плана.`,
        ruleText: `После убыточной сделки — пауза ${pause} мин. Следующий вход только по сетапу из плана.`,
        rule: null,
        trigger: trig("quick_after_loss", { minutes: pause }),
      };
    }
    case "martingale": {
      const r = opts.martingaleRatio;
      return {
        why: "Рост размера после убытка превращает обычную серию минусов в крупный дневной убыток: риск растёт именно тогда, когда качество решений хуже всего.",
        recommendation: "Размер после убытка — не больше предыдущего; после двух убытков подряд — половина обычного размера.",
        ruleText: "После убытка размер не увеличиваю. После 2 убытков подряд — половина обычного размера.",
        rule: null,
        trigger: trig("size_up_after_loss", { ratio: r }),
      };
    }
    case "overtrading": {
      const n = Math.max(1, Math.round(num(extra.norm, 10)));
      return {
        why: "Сделки сверх нормы — обычно не A+-сетапы, а скука или погоня за движением: средний результат хуже, а комиссии съедают остаток.",
        recommendation: `Лимит ${n} сделок в день (ваша медиана ${num(extra.medianPerDay, 0)}). После лимита — только разбор и план на завтра.`,
        ruleText: `Не больше ${n} сделок в день.`,
        rule: { kind: "max_trades_per_day", threshold: { n }, name: `Не больше ${n} сделок в день` },
        trigger: trig("max_trades_day", { n }),
      };
    }
    case "fatigue": {
      const cut = Math.max(2, Math.round(num(extra.cut, 5)));
      return {
        why: "К концу дня падает концентрация: поздние сделки берутся по инерции, без свежего анализа, и ухудшают итог дня.",
        recommendation: `После ${cut} сделок — перерыв 15 мин и пересмотр плана; дальше только A+-сетапы.`,
        ruleText: `После ${cut} сделок — перерыв 15 мин, дальше только A+.`,
        rule: null,
        trigger: trig("max_trades_day", { n: cut }),
      };
    }
    case "chase": {
      const usd = Math.max(1, Math.round(num(extra.threshold, 150)));
      return {
        why: "После красного утра появляется желание отыграться: частота и размер растут, а избирательность падает — минус утра превращается в минус дня.",
        recommendation: `Если к ${clock(opts.morningEndMin)} минус больше $${usd} — после ${clock(opts.morningEndMin)} только половинный размер или стоп на день.`,
        ruleText: `Утро в минусе больше $${usd} → после ${clock(opts.morningEndMin)} не торгую (или половинный размер).`,
        rule: null,
        trigger: trig("red_morning", { usd }),
      };
    }
    case "tilt":
      return {
        why: "Серия убытков ломает дисциплину: паузы между сделками сокращаются, входы становятся импульсивными — классический тильт.",
        recommendation: "После 3 убытков подряд — стоп минимум на 30 минут; если серия повторилась — стоп на день.",
        ruleText: "После 3 убытков подряд — стоп на 30 минут, при повторе — на день.",
        rule: { kind: "no_trade_after_n_losses", threshold: { n: 3 }, name: "Не торговать после 3 убытков подряд" },
        trigger: trig("loss_streak", { n: 3 }),
      };
    case "disposition": {
      const m = Math.max(1, Math.round(num(extra.medianHoldWinMin, 10) * 2));
      return {
        why: "Прибыль фиксируется рано, а убыток «пересиживается» в надежде на возврат — средний убыток растёт быстрее среднего выигрыша.",
        recommendation: `Тайм-стоп: если сделка в минусе дольше ${fmtMin(m)} (2 × медиана удержания прибыльных) — закрыть.`,
        ruleText: `Тайм-стоп: убыточную позицию закрываю через ${fmtMin(m)}.`,
        rule: null,
        trigger: trig("long_loser_hold", { minutes: m }),
      };
    }
    case "firstTrade":
      return {
        why: "Первая сделка задаёт тон дню: торопливый вход до формирования уровней даёт ранний минус и запускает реванш.",
        recommendation: "Первая сделка — только A+-сетап из плана, половинным размером и не раньше 9:35.",
        ruleText: "Первая сделка дня: только A+ из плана, половинный размер, не раньше 9:35.",
        rule: null,
        trigger: { kind: "custom", params: {}, name: "Первая сделка — только A+, половинный размер" },
      };
    case "euphoria": {
      const usd = Math.max(1, Math.round(num(extra.bigWinThreshold, 100)));
      return {
        why: "После крупного выигрыша растёт уверенность и падает избирательность: следующие сделки берутся «на кураже» и отдают часть прибыли.",
        recommendation: `После выигрыша ≥ $${usd} — пауза ${opts.euphoriaMin} мин, следующая сделка обычным размером.`,
        ruleText: `После выигрыша ≥ $${usd} — пауза ${opts.euphoriaMin} мин.`,
        rule: null,
        trigger: trig("after_big_win", { usd, minutes: opts.euphoriaMin }),
      };
    }
  }
}
