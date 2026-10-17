/**
 * Trade charts (chart-engine WsChart, trade card chart, sparklines): texts added with the full-day view and the
 * candle archive. The rest of chart-engine moves here in the translation wave.
 */
export default {
  view: {
    label: "Масштаб графика",
    day: "День",
    dayTitle: "Весь торговый день: премаркет 4:00 → постмаркет 20:00 ET — D",
    trade: "Сделка",
    tradeTitle: "Крупно: окно сделки — Z",
  },
  hotkeys: { day: "весь день", trade: "окно сделки крупно" },
  bars: {
    coarse: "Бары {tf}",
    coarseTitle: "Мельче баров за этот день нет: провайдер отдаёт 1-минутки только за последние 30 дней, 5-минутки — за 60. С сегодняшнего дня каждый день сделок сохраняется в 1-минутках навсегда.",
  },
} as const;
