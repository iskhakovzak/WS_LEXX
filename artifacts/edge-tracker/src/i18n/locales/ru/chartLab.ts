/**
 * `chartLab` — /chart-lab «График и разбор»: the trade picker and the start state (pages/chart-lab.tsx). The chart itself
 * is in `chart`; the training game is the «Тренажёр».
 */
export default {
  title: { page: "График и разбор" },
  result: { moveTitle: "Ход цены от входа до выхода", win: "плюс", loss: "минус", grossTitle: "Нетто. Брутто {gross}, комиссии {fees}" },
  picker: {
    aria: "Выбрать сделку",
    placeholder: "Тикер, день (2026-10-14) или оба",
    searchAria: "Поиск сделки",
    openTickerDay: "Открыть график {ticker} за {date} без сделки",
    loadFailed: "Не удалось загрузить: {message}",
    nothing: "Ничего не нашлось. Для графика без сделки введи тикер и день: AAPL 2026-10-14",
    noTrades: "Сделок нет.",
    long: "лонг",
    short: "шорт",
    othersInR: "Чужие сделки — в R, без долларов.",
    searching: "Ищу…",
    pick: "Выбрать сделку",
  },
  openInTrades: "Открыть в «Сделках»",
  openInTradesAria: "Открыть сделку в «Сделках»",
  dayReview: "Разбор этого дня",
  empty: {
    title: "Выбери сделку",
    description: "Найди сделку по тикеру или дню или открой график любого тикера за день: весь день на графике, реплей бар за баром, твои исполнения и уровни.",
    recent: "Последние сделки",
    trainer: "Потренироваться — в «Тренажёре»",
  },
  unavailable: "Сделка #{id} недоступна",
  notFound: "Не найдена",
} as const;
