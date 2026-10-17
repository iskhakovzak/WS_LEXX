/**
 * Indicator library for a prop desk (RU). Extends the base list in `@/data/indicators`
 * (ids/tags kept so trade matching stays compatible) with desk usage, horizons, settings,
 * signals, pitfalls and a sparkline kind. A few desk-specific tools are added on top.
 */
import { INDICATORS as BASE } from "@/data/indicators";
import type { Tone } from "@/components/ds";

export type LibCategory = "trend" | "momentum" | "volume" | "volatility" | "levels" | "pattern";
export type Horizon = "intraday" | "overnight" | "swing";
export type HorizonFit = Record<Horizon, 0 | 1 | 2 | 3>;

export type SparkKind =
  | "ma" | "ema" | "osc" | "macd" | "vwap" | "avwap" | "bands" | "atr" | "vprofile" | "fib" | "levels"
  | "volume" | "obv" | "rvol" | "rs" | "hammer" | "engulfing" | "doji" | "hs" | "dtdb" | "flag" | "gap" | "orb" | "pm";

export interface LibIndicator {
  id: string;
  shortName: string;
  name: string;
  enName: string;
  category: LibCategory;
  strength: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  timeframe: string;
  horizons: HorizonFit;
  summary: string;
  deskUse: string;
  settings: { label: string; value: string }[];
  signals: { long: string; short: string; avoid: string };
  pitfalls: string[];
  combos: string[];
  spark: SparkKind;
  playbookQuery: string;
}

export const CATEGORY_META: Record<LibCategory, { label: string; tone: Tone }> = {
  trend: { label: "Тренд", tone: "accent" },
  momentum: { label: "Моментум", tone: "purple" },
  volume: { label: "Объём", tone: "up" },
  volatility: { label: "Волатильность", tone: "warn" },
  levels: { label: "Уровни", tone: "neutral" },
  pattern: { label: "Паттерны", tone: "down" },
};
export const CATEGORY_ORDER: LibCategory[] = ["trend", "momentum", "volume", "volatility", "levels", "pattern"];

export const HORIZON_META: Record<Horizon, { label: string; short: string; hint: string }> = {
  intraday: { label: "Интрадей", short: "ИД", hint: "флэт к закрытию" },
  overnight: { label: "Овернайт", short: "ON", hint: "перенос через ночь, гэп-риск" },
  swing: { label: "Свинг", short: "SW", hint: "дни–недели" },
};
export const HORIZONS: Horizon[] = ["intraday", "overnight", "swing"];

type Entry = Omit<LibIndicator, "tags" | "enName" | "strength"> & { tags?: string[]; enName?: string; strength?: LibIndicator["strength"] };

const ENTRIES: Entry[] = [
  {
    id: "vwap", shortName: "VWAP", name: "Средневзвешенная по объёму цена", category: "volume", spark: "vwap", playbookQuery: "VWAP",
    timeframe: "1–5 мин, только текущая сессия",
    horizons: { intraday: 3, overnight: 1, swing: 0 },
    summary: "Линия «справедливой цены» дня — по ней алгоритмы и институционалы оценивают исполнение.",
    deskUse: "Главный ориентир интрадея: лонги держим выше VWAP, шорты — ниже. Первый откат к VWAP после сильного открытия в бумаге in play — классический A+ вход с коротким стопом за линию. Флип VWAP с объёмом сигналит смену контроля.",
    settings: [{ label: "Источник", value: "HLC3" }, { label: "Якорь", value: "сессия, с премаркетом и без" }, { label: "Полосы", value: "±1σ / ±2σ" }],
    signals: { long: "Удержание VWAP на откате + рост объёма на отскоке", short: "Отказ от VWAP снизу после слабого открытия", avoid: "Цена пилит VWAP туда-обратно — чоп, размер вниз или вне рынка" },
    pitfalls: ["Использовать VWAP на дневках и в свинге — он обнуляется каждую сессию", "Входить в первое касание без подтверждения ленты/объёма", "Ставить стоп ровно на линии — выбьют шумом"],
    combos: ["rvol", "ema", "orb"],
  },
  {
    id: "avwap", shortName: "AVWAP", name: "Anchored VWAP", enName: "Anchored VWAP", category: "volume", spark: "avwap", playbookQuery: "AVWAP", strength: 4,
    tags: ["avwap", "anchored vwap", "anchored"],
    timeframe: "5 мин – дневки, якорь от события",
    horizons: { intraday: 2, overnight: 3, swing: 3 },
    summary: "VWAP от выбранной точки: отчёт, гэп, хай/лоу — показывает среднюю цену участников события.",
    deskUse: "Для переноса позиций: якорим от дня отчёта или гэпа и держим, пока цена выше AVWAP. Хороший трейлинг-стоп для овернайта и свинга — понятный уровень, где «в среднем в нуле» те, кто купил на новости.",
    settings: [{ label: "Якорь", value: "день отчёта / гэп / swing low" }, { label: "Таймфрейм", value: "5 мин для ИД, дневка для свинга" }],
    signals: { long: "Откат к AVWAP от катализатора и удержание", short: "Потеря AVWAP от гэпа вверх — гэп закрывается", avoid: "Много якорей сразу — каша из линий" },
    pitfalls: ["Якорь от случайной свечи без события", "Игнорировать, что AVWAP от далёкого якоря почти плоский и ничего не значит"],
    combos: ["vwap", "gap", "volume-profile"],
  },
  {
    id: "rvol", shortName: "RVOL", name: "Относительный объём", category: "volume", spark: "rvol", playbookQuery: "RVOL",
    timeframe: "Премаркет и первые 30 минут",
    horizons: { intraday: 3, overnight: 2, swing: 1 },
    summary: "Текущий объём против среднего за то же время — фильтр «в игре» бумага или нет.",
    deskUse: "Первый фильтр утреннего гейм-плана: в список in play попадают только бумаги с RVOL ≥ 2 и катализатором. Без относительного объёма даже идеальный сетап — ловушка ликвидности. Size up — только при RVOL ≥ 3.",
    settings: [{ label: "База", value: "среднее за 10–20 дней" }, { label: "Сравнение", value: "по времени дня (time-of-day)" }, { label: "Порог in play", value: "≥ 2× (A+ — ≥ 3×)" }],
    signals: { long: "RVOL ≥ 3 + катализатор + удержание премаркет-хая", short: "RVOL высокий, но цена не может обновить хай — distribution", avoid: "RVOL < 1.5 — бумага не в игре, пропуск" },
    pitfalls: ["Считать RVOL по дневному среднему без поправки на время", "Путать высокий RVOL в неликвиде с реальным интересом"],
    combos: ["gap", "pm", "vwap"],
  },
  {
    id: "pm", shortName: "PM H/L", name: "Хай и лоу премаркета", enName: "Premarket High / Low", category: "levels", spark: "pm", playbookQuery: "премаркет", strength: 4,
    tags: ["pm", "premarket", "premarket high", "pmh", "pml", "премаркет"],
    timeframe: "1–5 мин, первые 60 минут",
    horizons: { intraday: 3, overnight: 1, swing: 0 },
    summary: "Ключевые уровни утра: пробой PMH на объёме — продолжение гэпа, потеря PML — слабость.",
    deskUse: "Основа gap & go: отмечаем PMH/PML в гейм-плане до открытия. Лонг на пробое и ретесте PMH с объёмом, стоп под уровнем. Если гэпер теряет PML в первые минуты — шорт на возврате к уровню.",
    settings: [{ label: "Окно", value: "04:00–09:30 ET" }, { label: "Подтверждение", value: "закрытие 1–2 мин свечи за уровнем" }],
    signals: { long: "Пробой PMH + ретест + RVOL > 3", short: "Отказ от PMH и потеря VWAP", avoid: "Тонкий премаркет (< 100k акций) — уровни ненадёжны" },
    pitfalls: ["Покупать первый пробой без ретеста в бумаге с широким спредом", "Не учитывать уровни с дневки поверх PMH"],
    combos: ["rvol", "orb", "gap"],
  },
  {
    id: "orb", shortName: "ORB", name: "Пробой диапазона открытия", enName: "Opening Range Breakout", category: "levels", spark: "orb", playbookQuery: "ORB", strength: 4,
    tags: ["orb", "opening range", "opening range breakout"],
    timeframe: "Диапазон 1/5/15 минут",
    horizons: { intraday: 3, overnight: 0, swing: 0 },
    summary: "Хай/лоу первых N минут — пробой задаёт направление дня в бумагах in play.",
    deskUse: "Механический вход для утренних бумаг: ждём формирования 5-минутного диапазона, входим на пробое по направлению гэпа, стоп за середину или противоположную границу. Риск в R задан шириной диапазона — удобно планировать размер.",
    settings: [{ label: "Диапазон", value: "5 мин (агрессивно — 1 мин, консервативно — 15)" }, { label: "Стоп", value: "середина диапазона" }, { label: "Цель", value: "2R или до следующего уровня" }],
    signals: { long: "Пробой хая диапазона по направлению гэпа + выше VWAP", short: "Пробой лоу диапазона против гэпа (gap fade)", avoid: "Диапазон шире дневного ATR × 0.5 — R слишком дорогой" },
    pitfalls: ["Торговать ORB в бумагах без катализатора", "Игнорировать, что широкий диапазон съедает R"],
    combos: ["pm", "vwap", "rvol"],
  },
  {
    id: "rs", shortName: "RS", name: "Относительная сила к SPY/QQQ", enName: "Relative Strength vs index", category: "momentum", spark: "rs", playbookQuery: "relative strength", strength: 4,
    tags: ["rs", "relative strength", "rs vs spy", "rs/rw"],
    timeframe: "5 мин для ИД, дневка для свинга",
    horizons: { intraday: 3, overnight: 2, swing: 3 },
    summary: "Бумага сильнее или слабее рынка — лонгуем лидеров, шортим отстающих.",
    deskUse: "При откате рынка смотрим, кто держится: бумага, обновляющая хай, пока SPY делает лоу, — первая в лонг при развороте индекса. Для свинга — сравнение с сектором (XLK, XLF…) за 1–3 месяца.",
    settings: [{ label: "Бенчмарк", value: "SPY / QQQ / сектор ETF" }, { label: "Расчёт", value: "% изменения бумаги − % бенчмарка" }, { label: "Окно", value: "с открытия / 20 дней" }],
    signals: { long: "Держит хай на откате SPY + выше VWAP", short: "Слабее рынка на отскоке индекса", avoid: "Бумага ходит 1:1 с индексом — нет собственной истории" },
    pitfalls: ["Сравнивать с SPY бумагу, которая ходит за своим сектором", "Путать RS-индикатор с RSI"],
    combos: ["vwap", "ema", "ma"],
  },
  {
    id: "ema", shortName: "EMA", name: "Экспоненциальная средняя", category: "trend", spark: "ema", playbookQuery: "EMA",
    timeframe: "1–15 мин для ИД, дневки для свинга",
    horizons: { intraday: 3, overnight: 2, swing: 2 },
    summary: "Быстрая средняя: 9/20 EMA — «рельсы» трендового дня.",
    deskUse: "В трендовый день бумага in play откатывает к 9 EMA на 1–2 мин — это точки добавки. Закрытие ниже 20 EMA на 5 мин — сигнал сократить размер. В свинге 10/21 EMA на дневке держат моментум-лидеров.",
    settings: [{ label: "ИД", value: "9 и 20 EMA (1–5 мин)" }, { label: "Свинг", value: "10 и 21 EMA (дневка)" }, { label: "Источник", value: "Close" }],
    signals: { long: "9 > 20, оба растут, откат к 9 EMA удержан", short: "9 < 20, отскок к 20 EMA отбит", avoid: "Средние переплетены и плоские — боковик" },
    pitfalls: ["Входить на каждом пересечении в чопе", "Не учитывать, что на 1 мин EMA — шум без контекста"],
    combos: ["vwap", "rvol", "atr"],
  },
  {
    id: "ma", shortName: "SMA", name: "Простая скользящая средняя", category: "trend", spark: "ma", playbookQuery: "SMA",
    timeframe: "Дневки и 4H; 50/200 — для свинга",
    horizons: { intraday: 1, overnight: 2, swing: 3 },
    summary: "50/200 SMA на дневке — уровни, которые видит весь рынок.",
    deskUse: "Для свинга и переноса: бумаги выше растущей 50 SMA — кандидаты в лонг, откаты к 50/200 SMA дают понятный стоп. Интрадей важна дневная 200 SMA рядом с ценой — частый магнит и уровень реакции.",
    settings: [{ label: "Периоды", value: "20 / 50 / 200" }, { label: "Таймфрейм", value: "Daily" }],
    signals: { long: "Цена выше 50 SMA, 50 > 200, откат к 20/50 удержан", short: "Цена под 200 SMA, отскок к ней отбит", avoid: "Цена петляет вокруг плоской 50 SMA" },
    pitfalls: ["Ждать golden cross как входа — сигнал запаздывает", "Использовать SMA на минутках вместо EMA"],
    combos: ["rs", "atr", "volume-profile"],
  },
  {
    id: "rsi", shortName: "RSI", name: "Индекс относительной силы", category: "momentum", spark: "osc", playbookQuery: "RSI",
    timeframe: "5–60 мин для ИД, дневка для свинга",
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: "Осциллятор перекупленности/перепроданности и дивергенций.",
    deskUse: "На деске RSI — не сигнал входа, а фильтр растяжения: в бумаге с RSI(2) < 5 после 3+ дней падения ищем mean-reversion отскок к уровню. Дивергенция на 5 мин у хая дня — повод зафиксировать часть.",
    settings: [{ label: "Период", value: "14 (свинг), 2–5 (mean reversion)" }, { label: "Уровни", value: "30 / 70, в тренде 40 / 80" }],
    signals: { long: "RSI < 30 и разворот вверх у уровня поддержки", short: "Медвежья дивергенция у HOD + потеря VWAP", avoid: "RSI 40–60 — нет растяжения, нет преимущества" },
    pitfalls: ["Шортить «перекупленность» в сильном тренде — RSI держится > 70 днями", "Торговать дивергенцию без подтверждения структурой"],
    combos: ["bollinger", "support-resistance", "volume"],
  },
  {
    id: "macd", shortName: "MACD", name: "Схождение–расхождение средних", category: "momentum", spark: "macd", playbookQuery: "MACD",
    timeframe: "1H–4H для свинга, 5–15 мин для ИД",
    horizons: { intraday: 1, overnight: 2, swing: 2 },
    summary: "Импульс тренда: гистограмма показывает ускорение и затухание.",
    deskUse: "Используем как подтверждение, не как триггер: затухание гистограммы на 15 мин у цели — повод частично выйти. На дневке пересечение над нулём после базы — кандидат в свинг-вотчлист.",
    settings: [{ label: "Параметры", value: "12 / 26 / 9" }, { label: "Режим", value: "гистограмма + линии" }],
    signals: { long: "Пересечение вверх выше нуля после консолидации", short: "Пересечение вниз ниже нуля на отскоке", avoid: "Линии около нуля и переплетены" },
    pitfalls: ["Входить по пересечению на минутках — сильное запаздывание", "Не смотреть на структуру цены"],
    combos: ["rsi", "ema", "volume"],
  },
  {
    id: "bollinger", shortName: "BB", name: "Полосы Боллинджера", category: "volatility", spark: "bands", playbookQuery: "Bollinger",
    timeframe: "15 мин – дневка",
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: "Канал ±2σ: сжатие предупреждает о выходе волатильности.",
    deskUse: "Squeeze на дневке (самая узкая ширина за 6 месяцев) — бумага в свинг-вотчлист перед отчётом или катализатором. Интрадей: проход за полосу с RVOL — продолжение, а не разворот.",
    settings: [{ label: "Период", value: "20" }, { label: "Отклонение", value: "2σ" }, { label: "Squeeze", value: "BB внутри Keltner 1.5 ATR" }],
    signals: { long: "Выход из сжатия вверх с объёмом", short: "Отказ от верхней полосы + дивергенция RSI", avoid: "Широкие полосы после импульса — волатильность уже вышла" },
    pitfalls: ["Продавать каждое касание верхней полосы в тренде", "Путать направление выхода из сжатия заранее"],
    combos: ["rsi", "atr", "rvol"],
  },
  {
    id: "atr", shortName: "ATR", name: "Средний истинный диапазон", category: "volatility", spark: "atr", playbookQuery: "ATR",
    timeframe: "Дневка для размера, 5 мин для стопов",
    horizons: { intraday: 3, overnight: 3, swing: 3 },
    summary: "Мера хода бумаги — основа размера позиции, стопов и гэп-риска.",
    deskUse: "Риск-менеджмент деска: стоп = 0.5–1 ATR(5 мин) для ИД, 1–2 ATR(дневка) для свинга. Размер = риск в $ / дистанция стопа. Для овернайта: если дневной ATR × позиция > лимита овернайт-экспозиции — режем до переноса.",
    settings: [{ label: "Период", value: "14" }, { label: "Дневка", value: "размер свинга и гэп-риск" }, { label: "5 мин", value: "стопы и цели интрадея" }],
    signals: { long: "Расширение ATR на пробое — тренд набирает силу", short: "Расширение ATR на продажах", avoid: "Бумага уже прошла > 1.5 ATR за день — мало хода, догонять поздно" },
    pitfalls: ["Одинаковый размер позиции в бумагах с разным ATR", "Забыть пересчитать стоп после отчёта — ATR вырос"],
    combos: ["bollinger", "vwap", "gap"],
  },
  {
    id: "volume-profile", shortName: "VP", name: "Профиль объёма", category: "volume", spark: "vprofile", playbookQuery: "volume profile",
    timeframe: "Сессия для ИД, неделя/месяц для свинга",
    horizons: { intraday: 2, overnight: 2, swing: 3 },
    summary: "Где проторговался объём: POC, value area, «пустоты» для быстрых проходов.",
    deskUse: "Цели и стопы по объёму: через low-volume node цена проходит быстро — там ставим цели, за high-volume node — стопы. Для переноса — позиция выше value area прошлых дней безопаснее.",
    settings: [{ label: "Тип", value: "сессионный / фиксированный диапазон" }, { label: "Value area", value: "70%" }, { label: "Шаг", value: "авто по тику" }],
    signals: { long: "Принятие выше VAH + удержание POC на ретесте", short: "Отказ от VAH и возврат в value area", avoid: "Цена внутри value area — ротация" },
    pitfalls: ["Строить профиль по слишком короткому диапазону", "Игнорировать объём премаркета"],
    combos: ["avwap", "support-resistance", "vwap"],
  },
  {
    id: "stochastic", shortName: "Stoch", name: "Стохастик", category: "momentum", spark: "osc", playbookQuery: "Stochastic",
    timeframe: "15 мин – дневка",
    horizons: { intraday: 1, overnight: 1, swing: 2 },
    summary: "Положение закрытия в диапазоне — тайминг откатов в тренде.",
    deskUse: "Вторичный инструмент: в устойчивом тренде на дневке выход %K из зоны < 20 даёт тайминг добавки к свинг-позиции. На минутках деск его почти не использует — слишком шумный.",
    settings: [{ label: "Параметры", value: "14 / 3 / 3" }, { label: "Уровни", value: "20 / 80" }],
    signals: { long: "%K пересекает %D вверх из зоны < 20 в аптренде", short: "%K пересекает %D вниз из зоны > 80 в даунтренде", avoid: "Зона 40–60 и боковик" },
    pitfalls: ["Торговать против тренда по «перекупленности»", "Использовать на 1 мин"],
    combos: ["ema", "support-resistance", "rsi"],
  },
  {
    id: "fibonacci", shortName: "Fib", name: "Уровни Фибоначчи", category: "levels", spark: "fib", playbookQuery: "Fibonacci",
    timeframe: "4H–дневка для свинга, 5–15 мин для ИД",
    horizons: { intraday: 1, overnight: 2, swing: 2 },
    summary: "Глубина отката от импульса: 38.2 / 50 / 61.8%.",
    deskUse: "Только в связке с другими уровнями: откат к 50–61.8% от утреннего импульса, совпадающий с VWAP или дневным уровнем, — зона для входа. Отдельно Fib на деске не считается причиной сделки.",
    settings: [{ label: "Уровни", value: "38.2 / 50 / 61.8 / 78.6" }, { label: "Растяжения", value: "127.2 / 161.8 для целей" }],
    signals: { long: "Отскок от 50–61.8% с объёмом и совпадением с VWAP", short: "Отказ от 38.2–50% на отскоке в даунтренде", avoid: "Сетка по неочевидному импульсу" },
    pitfalls: ["Подгонять импульс под нужный уровень", "Ставить стоп ровно на уровень"],
    combos: ["vwap", "support-resistance", "volume"],
  },
  {
    id: "support-resistance", shortName: "S/R", name: "Поддержка и сопротивление", category: "levels", spark: "levels", playbookQuery: "уровень",
    timeframe: "Все таймфреймы, старшие — весомее",
    horizons: { intraday: 3, overnight: 3, swing: 3 },
    summary: "Уровни, где раньше разворачивалась цена: дневные хаи/лоу, круглые числа.",
    deskUse: "Каркас гейм-плана: на каждую бумагу in play 2–4 уровня с дневки + PDH/PDL. Вход у уровня даёт короткий стоп и понятный R. Для переноса стоп ставим за дневной уровень, а не за минутный.",
    settings: [{ label: "Источник", value: "PDH/PDL, хаи/лоу 20–60 дней, круглые" }, { label: "Зона", value: "±0.1–0.2 ATR вокруг уровня" }],
    signals: { long: "Ретест пробитого сопротивления как поддержки", short: "Ложный пробой хая и возврат под уровень", avoid: "Цена в середине между уровнями — плохой R" },
    pitfalls: ["Рисовать слишком много уровней", "Считать уровень линией, а не зоной"],
    combos: ["volume-profile", "pm", "atr"],
  },
  {
    id: "volume", shortName: "Vol", name: "Объём", enName: "Volume", category: "volume", spark: "volume", playbookQuery: "объём", strength: 4,
    tags: ["volume", "vol", "объём"],
    timeframe: "Все таймфреймы",
    horizons: { intraday: 3, overnight: 2, swing: 3 },
    summary: "Подтверждение любого движения: пробой без объёма — подозрителен.",
    deskUse: "Объём на пробое ≥ 2× среднего по свечам — условие A+ сетапа. Затухание объёма на откате и рост на возобновлении — классика продолжения. Климактический объём на экстремуме — признак истощения.",
    settings: [{ label: "Средняя", value: "20 свечей" }, { label: "Подсветка", value: "> 2× средней" }],
    signals: { long: "Рост объёма на росте, затухание на откате", short: "Климактический объём на хае + длинная тень", avoid: "Объём ниже среднего — нет интереса" },
    pitfalls: ["Сравнивать объём утренних свечей с дневными", "Не отличать объём на открытии от реального интереса"],
    combos: ["vwap", "rvol", "flag-pennant"],
  },
  {
    id: "obv", shortName: "OBV", name: "Балансовый объём", category: "volume", spark: "obv", playbookQuery: "OBV",
    timeframe: "Дневка для свинга, 1H для ИД",
    horizons: { intraday: 1, overnight: 1, swing: 2 },
    summary: "Накопленный объём: дивергенция с ценой — ранний сигнал.",
    deskUse: "Свинг-фильтр: OBV на новом хае раньше цены — накопление, бумага в вотчлист. Для интрадея малополезен.",
    settings: [{ label: "Таймфрейм", value: "Daily" }, { label: "Сглаживание", value: "20 EMA по OBV" }],
    signals: { long: "OBV обновляет хай раньше цены", short: "Цена растёт, OBV падает", avoid: "OBV плоский" },
    pitfalls: ["Смотреть на абсолютное значение OBV", "Использовать на минутках"],
    combos: ["ma", "rs", "volume-profile"],
  },
  {
    id: "gap", shortName: "Gap", name: "Гэп", category: "pattern", spark: "gap", playbookQuery: "gap",
    timeframe: "1–5 мин на открытии, дневка для контекста",
    horizons: { intraday: 3, overnight: 3, swing: 2 },
    summary: "Разрыв цены на открытии: gap & go или gap fill — главная история утра.",
    deskUse: "Утренний сканер: гэп ≥ 4% + катализатор + RVOL. Gap & go — удержание PMH и VWAP; gap fade — отказ у дневного сопротивления. Для овернайта гэп — это риск: размер переносимой позиции режем до лимита гэп-риска.",
    settings: [{ label: "Порог", value: "≥ 4% (крупняк ≥ 2%)" }, { label: "Фильтр", value: "катализатор + RVOL ≥ 2" }, { label: "Гэп-риск", value: "≈ 1–2 дневных ATR на отчёте" }],
    signals: { long: "Гэп вверх на новости, удержание PMH и VWAP", short: "Гэп в дневное сопротивление, потеря VWAP — fade", avoid: "Гэп без новости и объёма" },
    pitfalls: ["Шортить гэп с сильным катализатором в первые минуты", "Переносить через отчёт полный размер"],
    combos: ["rvol", "pm", "atr"],
  },
  {
    id: "flag-pennant", shortName: "Flag", name: "Флаг и вымпел", category: "pattern", spark: "flag", playbookQuery: "flag",
    timeframe: "1–5 мин для ИД, дневка для свинга",
    horizons: { intraday: 3, overnight: 1, swing: 3 },
    summary: "Пауза после импульса — продолжение по направлению флагштока.",
    deskUse: "Bull flag на 1–2 мин после утреннего импульса — самый частый моментум-вход: стоп под флагом, цель — длина флагштока. В свинге — high tight flag у лидеров роста.",
    settings: [{ label: "Флагшток", value: "≥ 2 ATR(5 мин)" }, { label: "Откат", value: "≤ 50% флагштока" }, { label: "Объём", value: "затухает во флаге" }],
    signals: { long: "Пробой верхней границы флага с объёмом выше VWAP", short: "Bear flag под VWAP, пробой вниз", avoid: "Откат глубже 50% — флаг сломан" },
    pitfalls: ["Принимать за флаг любую паузу без импульса", "Входить до пробоя"],
    combos: ["volume", "ema", "vwap"],
  },
  {
    id: "hammer", shortName: "Hammer", name: "Молот / падающая звезда", category: "pattern", spark: "hammer", playbookQuery: "hammer",
    timeframe: "5–15 мин для ИД, дневка для свинга",
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: "Длинная нижняя тень на уровне — отказ продавцов.",
    deskUse: "Сигнал только у уровня: молот на дневной поддержке или VWAP с объёмом — вход над хаем свечи, стоп под тенью. Без уровня — просто свеча.",
    settings: [{ label: "Тень", value: "≥ 2× тела" }, { label: "Контекст", value: "после снижения, у уровня" }],
    signals: { long: "Молот на поддержке + пробой хая свечи", short: "Падающая звезда у сопротивления + пробой лоу", avoid: "Свеча в середине диапазона" },
    pitfalls: ["Торговать свечу без уровня и объёма", "Стоп внутри тени"],
    combos: ["support-resistance", "volume", "vwap"],
  },
  {
    id: "engulfing", shortName: "Engulf", name: "Поглощение", category: "pattern", spark: "engulfing", playbookQuery: "engulfing",
    timeframe: "15 мин – дневка",
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: "Тело свечи перекрывает предыдущую — смена контроля.",
    deskUse: "На дневке бычье поглощение у 50 SMA после отката — свинг-вход со стопом под паттерном. Интрадей полезно на 15 мин у HOD/LOD.",
    settings: [{ label: "Условие", value: "тело перекрывает тело предыдущей" }, { label: "Объём", value: "выше среднего" }],
    signals: { long: "Бычье поглощение на LOD/поддержке", short: "Медвежье поглощение на HOD/сопротивлении", avoid: "Поглощение внутри боковика" },
    pitfalls: ["Игнорировать размер свечи относительно ATR", "Входить до закрытия свечи"],
    combos: ["support-resistance", "volume", "ma"],
  },
  {
    id: "doji", shortName: "Doji", name: "Доджи", category: "pattern", spark: "doji", playbookQuery: "doji",
    timeframe: "5 мин – дневка",
    horizons: { intraday: 1, overnight: 1, swing: 1 },
    summary: "Нерешительность: открытие ≈ закрытие.",
    deskUse: "На деске — предупреждение, а не вход: доджи на экстремуме после растяжения — повод подтянуть стоп или взять частичную прибыль.",
    settings: [{ label: "Тело", value: "≤ 10% диапазона" }],
    signals: { long: "Доджи на поддержке + бычья свеча следом", short: "Доджи на сопротивлении + медвежья свеча следом", avoid: "Доджи в середине движения" },
    pitfalls: ["Торговать доджи как самостоятельный сигнал"],
    combos: ["support-resistance", "rsi", "volume"],
  },
  {
    id: "head-shoulders", shortName: "H&S", name: "Голова и плечи", category: "pattern", spark: "hs", playbookQuery: "head and shoulders",
    timeframe: "1H – дневка",
    horizons: { intraday: 1, overnight: 2, swing: 3 },
    summary: "Разворот после тренда: пробой линии шеи.",
    deskUse: "Свинг-шорт после пробоя шеи и неудачного ретеста. Интрадей встречается на 5 мин после дня-растяжки, но надёжность ниже.",
    settings: [{ label: "Цель", value: "высота головы от шеи" }, { label: "Подтверждение", value: "закрытие под шеей с объёмом" }],
    signals: { long: "Перевёрнутая H&S + пробой шеи", short: "H&S + пробой шеи вниз и ретест", avoid: "Формирование не завершено" },
    pitfalls: ["Входить до пробоя шеи", "Видеть паттерн везде"],
    combos: ["volume", "support-resistance", "ma"],
  },
  {
    id: "double-top-bottom", shortName: "DT/DB", name: "Двойная вершина / дно", category: "pattern", spark: "dtdb", playbookQuery: "double",
    timeframe: "15 мин – дневка",
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: "Два теста экстремума — отказ продолжить тренд.",
    deskUse: "Интрадей: второй тест HOD на меньшем объёме + потеря VWAP — шорт. Двойное дно на дневке у уровня — свинг-лонг.",
    settings: [{ label: "Допуск", value: "вершины в пределах 0.2 ATR" }, { label: "Подтверждение", value: "пробой середины" }],
    signals: { long: "Двойное дно + пробой середины", short: "Двойная вершина + потеря VWAP", avoid: "Второй тест на большем объёме — может пробить" },
    pitfalls: ["Шортить второй тест до подтверждения"],
    combos: ["volume", "vwap", "rsi"],
  },
];

const BASE_BY_ID = new Map(BASE.map((b) => [b.id, b]));

export const LIBRARY: LibIndicator[] = ENTRIES.map((e) => {
  const base = BASE_BY_ID.get(e.id);
  const tags = Array.from(new Set([...(base?.tags ?? []), ...(e.tags ?? []), e.shortName.toLowerCase()]));
  return {
    ...e,
    enName: e.enName ?? base?.name ?? e.shortName,
    strength: e.strength ?? base?.signalStrength ?? 3,
    tags,
  };
});

// Base entries without a RU profile are still shown (never drop data).
for (const b of BASE) {
  if (LIBRARY.some((l) => l.id === b.id)) continue;
  LIBRARY.push({
    id: b.id, shortName: b.shortName, name: b.name, enName: b.name,
    category: b.category === "pattern" ? "pattern" : b.category,
    strength: b.signalStrength, tags: b.tags, timeframe: b.bestTimeframe,
    horizons: { intraday: 2, overnight: 1, swing: 2 },
    summary: b.description, deskUse: b.description, settings: [],
    signals: { long: b.useCases[0] ?? "—", short: b.useCases[1] ?? "—", avoid: b.commonMistakes[0] ?? "—" },
    pitfalls: b.commonMistakes, combos: [], spark: "ma", playbookQuery: b.shortName,
  });
}

export const LIB_BY_ID = new Map(LIBRARY.map((l) => [l.id, l]));

/** Ready-made desk presets that can be merged into "Мой набор". */
export const DESK_PRESETS: { id: string; label: string; horizon: Horizon; description: string; ids: string[] }[] = [
  { id: "gap-go", label: "Gap & Go", horizon: "intraday", description: "Утро: гэперы с катализатором", ids: ["rvol", "pm", "vwap", "orb", "ema"] },
  { id: "overnight", label: "Перенос на ночь", horizon: "overnight", description: "Удержание после катализатора", ids: ["atr", "avwap", "gap", "support-resistance", "volume-profile"] },
  { id: "swing", label: "Свинг-лидеры", horizon: "swing", description: "Моментум на дневке", ids: ["ma", "rs", "atr", "flag-pennant", "volume"] },
];
