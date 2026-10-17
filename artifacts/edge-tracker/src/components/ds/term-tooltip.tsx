/**
 * Desk glossary + <TermTooltip>: one short, consistent explanation for every trading term the app shows
 * (R, PF, MFE, expectancy…). Pages use it next to KPI labels and table headers instead of writing their own
 * `title=` hints, so the same term always means the same thing.
 *
 *   <TermTooltip term="pf" />                      → "PF" with a dotted underline + tooltip
 *   <TermTooltip term="pf">Профит-фактор</TermTooltip>
 *   <TermTooltip term="mfe" icon />                → small (i) icon after the label
 *   <StatCard label="PF" term="pf" … />             → StatCard renders the icon for you
 */
import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type GlossaryEntry = {
  /** Short label as shown in the UI. */
  label: string;
  /** Full name. */
  title: string;
  /** One or two plain sentences. */
  text: string;
  /** Optional formula line. */
  formula?: string;
};

export const GLOSSARY = {
  r: { label: "R", title: "R — единица риска", text: "Результат сделки в долях риска: +2R — заработали два запланированных риска, −1R — потеряли один.", formula: "R = P&L / риск на сделку" },
  avgR: { label: "Средний R", title: "Средний R", text: "Средний результат одной закрытой сделки в R.", formula: "ΣR / число сделок" },
  expectancy: { label: "Ожидание", title: "Математическое ожидание", text: "Сколько R в среднем приносит одна сделка с учётом винрейта и размера побед/потерь. > 0 — система в плюсе.", formula: "WR × ср. победа − (1 − WR) × ср. потеря" },
  pf: { label: "PF", title: "Профит-фактор", text: "Во сколько раз сумма прибыльных сделок больше суммы убыточных. > 1 — в плюсе, ≥ 2 — сильный результат.", formula: "ΣR⁺ / |ΣR⁻|" },
  winrate: { label: "Винрейт", title: "Винрейт (WR)", text: "Доля прибыльных сделок среди решённых; сделки в ноль не учитываются.", formula: "W / (W + L)" },
  payoff: { label: "Payoff", title: "Payoff ratio", text: "Средняя прибыльная сделка относительно средней убыточной. Показывает, хватает ли размера побед при текущем винрейте.", formula: "ср. победа / |ср. потеря|" },
  mfe: { label: "MFE", title: "MFE — макс. благоприятное движение", text: "Сколько максимум цена прошла в вашу сторону за время сделки. Показывает, сколько прибыли было доступно.", formula: "в R или $ от входа" },
  mae: { label: "MAE", title: "MAE — макс. неблагоприятное движение", text: "Насколько глубоко цена уходила против позиции до выхода. Помогает проверить, не слишком ли широкий или узкий стоп.", formula: "в R или $ от входа" },
  drawdown: { label: "Просадка", title: "Максимальная просадка", text: "Самое глубокое падение кривой капитала от предыдущего пика до минимума.", formula: "min(капитал − пик)" },
  net: { label: "Нетто", title: "P&L нетто", text: "Результат после всех комиссий и сборов брокера (comm, ECN, SEC, TAF). По умолчанию все денежные KPI — нетто.", formula: "брутто − комиссии" },
  gross: { label: "Брутто", title: "P&L брутто", text: "Результат по цене входа и выхода до вычета комиссий и сборов." },
  fees: { label: "Комиссии", title: "Комиссии и сборы", text: "Всё, что списал брокер: комиссия, ECN, SEC, TAF и прочие сборы." },
  openRisk: { label: "Открытый риск", title: "Открытый риск", text: "Сколько можно потерять прямо сейчас, если все открытые позиции выбьет по стопам." },
  bp: { label: "BP", title: "Buying power", text: "Покупательная способность: максимальный объём позиций, который фирма разрешает держать одновременно." },
  dailyLoss: { label: "Дневной лимит", title: "Дневной лимит убытка", text: "Максимальный убыток за день. При достижении — стоп торговли до следующей сессии (red day stop)." },
  gapRisk: { label: "Гэп-риск", title: "Гэп-риск", text: "Риск, что цена откроется за стопом после ночи или выходных, и убыток превысит плановый 1R." },
  inPlay: { label: "In play", title: "Бумага в игре", text: "Тикер с катализатором и повышенным объёмом сегодня — кандидат на торговлю." },
  catalyst: { label: "Катализатор", title: "Катализатор", text: "Событие, которое двигает бумагу: отчёт, гайденс, апгрейд, FDA, размещение, новость." },
  aPlus: { label: "A+", title: "A+ сетап", text: "Сетап, где совпали все пункты чек-листа плейбука. На нём допустим полный или увеличенный размер." },
  rvol: { label: "RVOL", title: "Относительный объём", text: "Объём сегодня относительно среднего за тот же отрезок времени. > 2 — бумага заметно активнее обычного.", formula: "объём / средний объём" },
  atr: { label: "ATR", title: "ATR — средний истинный диапазон", text: "Типичный дневной ход бумаги. Помогает ставить стопы и цели в масштабе волатильности." },
  vwap: { label: "VWAP", title: "VWAP", text: "Средняя цена дня, взвешенная по объёму. Ориентир «справедливой» цены внутри сессии." },
  float: { label: "Float", title: "Free float", text: "Число акций в свободном обращении. Маленький float — резкие движения и широкий спред." },
  si: { label: "SI", title: "Short interest", text: "Доля float в коротких позициях. Высокий SI повышает шанс шорт-сквиза." },
  premarket: { label: "Премаркет", title: "Премаркет", text: "Торги до открытия: 4:00–9:30 ET. Ликвидность ниже, спреды шире." },
  horizon: { label: "Горизонт", title: "Горизонт удержания", text: "Интрадей — закрыта до конца дня; овернайт — перенос через ночь; свинг — от нескольких дней." },
  streak: { label: "Серия", title: "Серия", text: "Сколько сделок или дней подряд в плюсе или в минусе." },
  sqn: { label: "SQN", title: "System Quality Number", text: "Качество системы по Ван Тарпу: ожидание, делённое на разброс результатов, с поправкой на число сделок. > 2 — хорошо.", formula: "√N × ср. R / σR" },
  rr: { label: "R:R", title: "Риск / прибыль", text: "Сколько планируете заработать на единицу риска до входа в сделку.", formula: "(цель − вход) / (вход − стоп)" },
  slippage: { label: "Проскальзывание", title: "Проскальзывание", text: "Разница между планируемой и фактической ценой исполнения." },
  beta: { label: "Beta", title: "Бета", text: "Насколько сильно бумага в среднем ходит вместе с рынком: 1 — как S&P 500, 2 — вдвое сильнее, < 1 — спокойнее рынка." },

  // Market regime
  vix: { label: "VIX", title: "VIX — индекс страха", text: "Ожидаемая волатильность S&P 500 на 30 дней вперёд. Ниже 15 — спокойный рынок и узкие диапазоны, 15–20 — норма, выше 25 — нервная лента и резкие развороты." },
  vixTerm: { label: "VIX / VIX3M", title: "Структура VIX", text: "Отношение 30-дневной волатильности к 3-месячной. Ниже 1 — страх отнесён в будущее, рынок спокоен. Выше 1 — страх «здесь и сейчас»: распродажи и паника.", formula: "VIX / VIX3M" },
  breadth: { label: "Широта", title: "Широта рынка", text: "Насколько широко участвует рынок: растёт большинство бумаг или рост держится на нескольких мегакапах. Узкий рынок — хуже для малых и средних бумаг.", formula: "RSP к SPY за 20 дн. или растущие / падающие" },

  // Dilution / offerings
  dilutionScore: { label: "Скор разводнения", title: "Скор разводнения", text: "Оценка 0–100, насколько сильно размещение может давить на цену: размер к капитализации и флоуту, дисконт, варранты, денежная позиция и история размещений." },
  dilution: { label: "Разводнение", title: "Разводнение", text: "Выпуск новых акций: доля каждого акционера уменьшается, а дополнительное предложение обычно давит на цену." },
  atm: { label: "ATM", title: "ATM-программа (at-the-market)", text: "Компания продаёт акции небольшими частями прямо в рынок по текущей цене. Без дисконта, но создаёт постоянный навес предложения на росте." },
  shelf: { label: "Шелф", title: "Шелф (S-3 / F-3)", text: "Заранее зарегистрированное право выпустить акции в течение 3 лет. Сам по себе не продажа, а навес: сделка с шелфа может выйти в любой день." },
  offerDiscount: { label: "Дисконт", title: "Дисконт размещения", text: "На сколько цена оффера ниже закрытия перед сделкой. Глубокий дисконт (−15% и ниже) часто тянет цену к офферу.", formula: "оффер / закрытие − 1" },
  warrants: { label: "Варранты", title: "Варранты", text: "Права купить акции по фиксированной цене в будущем. Добавляют скрытое разводнение и часто становятся потолком цены." },
  runway: { label: "Денег на", title: "Запас денег (runway)", text: "На сколько месяцев компании хватит кэша при текущем сжигании. Меньше 6 месяцев — высокий шанс нового размещения.", formula: "кэш / сжигание в месяц" },

  // Analyst actions
  pt: { label: "PT", title: "Целевая цена (price target)", text: "Цена, до которой аналитик ждёт бумагу через 12 месяцев. Большое изменение таргета само по себе бывает катализатором.", formula: "Δ PT = новый / старый − 1" },
  firmWeight: { label: "Вес", title: "Вес фирмы", text: "Во сколько раз в среднем движение в день реакции больше обычного дня бумаги после смены рейтинга этой фирмой. ×1 — рынок не замечает, ×2 и выше — фирма двигает бумаги. Показываем от 5 событий.", formula: "среднее |ход дня| / медиана |хода| за 20 сессий до" },
  reaction: { label: "Реакция", title: "Историческая реакция", text: "Как бумага в среднем двигалась в день реакции на такие же действия аналитиков за 2 года: гэп на открытии и итог дня к предыдущему закрытию.", formula: "день = close / prevClose − 1" },
  reactionDay: { label: "День реакции", title: "День реакции", text: "Первая сессия, в которой рынок может отыграть публикацию: до 16:00 ET — тот же день, после закрытия — следующий торговый день." },
  ratingHit: { label: "В сторону рейтинга", title: "В сторону рейтинга", text: "Доля случаев, когда день закрылся в направлении действия: рост после апгрейда, падение после даунгрейда.", formula: "sign(ход дня) = направление" },
  topFirm: { label: "Топ-фирма", title: "Топ-фирма", text: "Крупный банк или исследовательский дом (Goldman, Morgan Stanley, JPM, BofA и др.) либо фирма с весом ×1.8+ на 8+ событиях." },
  analystScore: { label: "Важность", title: "Важность для сессии", text: "Смена рейтинга важнее нового покрытия, покрытие — важнее таргета. Поднимают: позиция команды, ваш вотчлист и тикеры, которые вы торговали, топ-фирма, высокий вес, большой сдвиг PT, уже видимый гэп." },
} satisfies Record<string, GlossaryEntry>;

export type TermKey = keyof typeof GLOSSARY;

export function glossary(term: TermKey): GlossaryEntry {
  return GLOSSARY[term];
}

/** Plain-text labels (fundamentals rows, data-driven lists) that map onto a glossary term. */
const LABEL_TERMS: Record<string, TermKey> = {
  atr: "atr", rvol: "rvol", relvol: "rvol", "rel. volume": "rvol", float: "float", "short interest": "si",
  "short interest, %": "si", beta: "beta", vwap: "vwap", vix: "vix", "vix / vix3m": "vixTerm",
};

/** Term key for a plain UI label, if the glossary explains it. */
export function termForLabel(label: string): TermKey | undefined {
  return LABEL_TERMS[label.trim().toLowerCase()];
}

/** Renders `text` as a <TermTooltip> when it names a glossary term, otherwise as plain text. */
export function TermLabel({ text }: { text: string }) {
  const term = termForLabel(text);
  return term ? <TermTooltip term={term}>{text}</TermTooltip> : <>{text}</>;
}

/** Tooltip body (also usable inside custom popovers / chart legends). */
export function TermContent({ term }: { term: TermKey }) {
  const g: GlossaryEntry = GLOSSARY[term];
  return (
    <div className="flex max-w-[18rem] flex-col gap-1 py-0.5 text-left">
      <span className="text-xs font-semibold text-foreground">{g.title}</span>
      <span className="text-xs text-muted-foreground">{g.text}</span>
      {g.formula && <span className="font-mono text-2xs text-foreground/80">{g.formula}</span>}
    </div>
  );
}

/**
 * Term with an explanation on hover/focus. Keyboard-accessible (the trigger is focusable),
 * never relies on hover alone. Children default to the term's short label.
 */
export function TermTooltip({
  term,
  children,
  icon = false,
  side = "top",
  className,
}: {
  term: TermKey;
  children?: React.ReactNode;
  /** Show a small (i) icon instead of underlining the label. */
  icon?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const g: GlossaryEntry = GLOSSARY[term];
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
              className="inline-grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground/80 transition-colors duration-[var(--dur-1)] hover:text-foreground"
              onClick={(e) => e.preventDefault()}
            >
              <Info className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={cn(
              "inline cursor-help rounded-sm text-left text-inherit underline decoration-current/40 decoration-dotted underline-offset-[3px] hover:decoration-current/80",
              className,
            )}
            onClick={(e) => e.preventDefault()}
          >
            {label}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side={side}>
        <TermContent term={term} />
      </TooltipContent>
    </Tooltip>
  );
}
