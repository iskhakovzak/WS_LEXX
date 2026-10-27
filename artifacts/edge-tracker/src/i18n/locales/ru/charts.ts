/**
 * `charts` — shared chart pieces (components/shared/charts): the P&L heat calendar legend, cell / week tooltips and
 * keyboard help. Area-specific chart words stay in their own namespaces.
 */
export default {
  tip: {
    day: "За день",
  },
  heat: {
    noTrades: "Нет сделок",
    flat: "В ноль",
    loss: "Убыток",
    profit: "Прибыль",
    scale: "Насыщенность — размер дня относительно месяца",
    week: "Неделя",
    weekTotal: "Итог недели",
    keys: "Стрелки — по дням и неделям, Home / End — начало и конец недели, Enter — открыть день",
    trades: "Сделок",
    result: "Итог",
    winLoss: "Плюс / минус",
  },
} as const;
