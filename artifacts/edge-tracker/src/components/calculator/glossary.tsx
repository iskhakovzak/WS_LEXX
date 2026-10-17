/**
 * Options glossary for the calculator: the same (i)-tooltip look as <TermTooltip> from the design system,
 * with option-specific terms (greeks, IV, ITM/OTM…). TODO(ds): these entries can move into GLOSSARY
 * (components/ds/term-tooltip.tsx) — then swap <OptTerm> for <TermTooltip>.
 */
import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Entry = { label: string; title: string; text: string; formula?: string };

export const OPTION_TERMS = {
  call: { label: "Call", title: "Call — опцион на покупку", text: "Право купить 100 акций по страйку до экспирации. Покупают под рост: прибыль растёт вместе с ценой акции." },
  put: { label: "Put", title: "Put — опцион на продажу", text: "Право продать 100 акций по страйку. Покупают под падение или как страховку для лонга." },
  spot: { label: "Спот", title: "Спот", text: "Текущая цена акции. Все расчёты строятся от неё." },
  strike: { label: "Страйк", title: "Страйк", text: "Цена исполнения из контракта: по ней можно купить (call) или продать (put) акции." },
  dte: { label: "Дней", title: "Дней до экспирации", text: "Сколько календарных дней осталось до истечения опциона. Меньше дней — быстрее тает временная стоимость." },
  iv: { label: "IV", title: "Implied volatility", text: "Ожидаемая рынком годовая волатильность, заложенная в цену опциона. Выше IV — дороже опционы. Перед отчётом IV растёт, после — падает (IV crush).", formula: "обычно 20–80% для акций США" },
  rate: { label: "Ставка", title: "Безрисковая ставка", text: "Доходность казначейских облигаций США. На цену краткосрочных опционов влияет слабо." },
  premium: { label: "Премия", title: "Премия", text: "Цена опциона за одну акцию. Платите (покупка) или получаете (продажа) премия × 100 × контрактов." },
  contract: { label: "Контракт", title: "Контракт", text: "Один опционный контракт = 100 акций. Цена в стакане указана за акцию." },
  delta: { label: "Δ Delta", title: "Дельта", text: "На сколько изменится цена опциона, если акция сдвинется на $1. Ещё — грубая оценка шанса закончить в деньгах.", formula: "call 0…1 · put −1…0" },
  gamma: { label: "Γ Gamma", title: "Гамма", text: "Как быстро меняется дельта при движении акции на $1. Высокая гамма у близких к экспирации опционов около страйка." },
  theta: { label: "Θ Theta", title: "Тета", text: "Сколько позиция теряет (или зарабатывает, если продали) за один день просто от хода времени, при неизменной цене." },
  vega: { label: "ν Vega", title: "Вега", text: "Как изменится позиция, если IV вырастет на 1 процентный пункт. Купленные опционы выигрывают от роста IV, проданные — от падения." },
  rho: { label: "ρ Rho", title: "Ро", text: "Чувствительность к процентной ставке (+1 п.п.). Для интрадея и коротких сроков почти не важна." },
  itm: { label: "ITM / OTM", title: "В деньгах / вне денег", text: "ITM — опцион уже имеет внутреннюю стоимость (call: спот выше страйка). OTM — нет, вся цена — время и волатильность. ATM — страйк около спота." },
  breakeven: { label: "Безубыток", title: "Точка безубытка", text: "Цена акции на экспирации, при которой позиция в нуле с учётом уплаченной или полученной премии.", formula: "call: страйк + премия · put: страйк − премия" },
  intrinsic: { label: "Внутренняя стоимость", title: "Внутренняя стоимость", text: "Сколько опцион стоил бы, если исполнить его прямо сейчас.", formula: "call: max(0, спот − страйк)" },
  timeValue: { label: "Временная стоимость", title: "Временная стоимость", text: "Часть премии сверх внутренней стоимости — плата за время и волатильность. К экспирации сгорает до нуля." },
  probProfit: { label: "Вероятность прибыли", title: "Вероятность прибыли", text: "Шанс, что на экспирацию позиция будет в плюсе. Считается по лог-нормальной модели из текущей IV — это оценка, а не прогноз." },
  maxLoss: { label: "Макс. убыток", title: "Максимальный убыток", text: "Худший результат позиции на экспирацию. У купленного опциона — уплаченная премия; у проданного может быть не ограничен." },
  debit: { label: "Дебет / кредит", title: "Дебет и кредит", text: "Дебет — за стратегию платите (покупка дороже продажи). Кредит — получаете премию сразу, но берёте на себя обязательство." },
  payoff: { label: "Диаграмма выплат", title: "Диаграмма выплат", text: "P&L позиции при разной цене акции. Сплошная линия — на экспирацию, пунктир — сегодня по модели Black-Scholes." },
} satisfies Record<string, Entry>;

export type OptTermKey = keyof typeof OPTION_TERMS;

/** Label with an (i) icon (or an underlined label) explaining an options term. Keyboard-focusable. */
export function OptTerm({ term, children, icon = true, className }: { term: OptTermKey; children?: React.ReactNode; icon?: boolean; className?: string }) {
  const g: Entry = OPTION_TERMS[term];
  const label = children ?? g.label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {icon ? (
          <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
            {children != null && <span className="truncate">{label}</span>}
            <button
              type="button"
              aria-label={`Что такое ${g.label}?`}
              className="inline-grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-1)] hover:text-foreground focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={(e) => e.preventDefault()}
            >
              <Info className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={cn("inline cursor-help rounded-sm text-inherit underline decoration-current/40 decoration-dotted underline-offset-[3px] hover:decoration-current/80", className)}
            onClick={(e) => e.preventDefault()}
          >
            {label}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-[18rem]">
        <div className="flex flex-col gap-1 py-0.5 text-left">
          <span className="text-xs font-semibold text-foreground">{g.title}</span>
          <span className="text-xs text-muted-foreground">{g.text}</span>
          {g.formula && <span className="font-mono text-2xs text-foreground/80">{g.formula}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
