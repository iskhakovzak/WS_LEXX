/**
 * Server `newsChannel` (lib/newsChannel/render.ts): the WS_NEWS Telegram channel briefs. The channel is Russian, so
 * only `ru` is posted; en / uz exist for the admin preview parity. Tickers ($AAPL), %, RVOL, ET stay as is.
 */
export default {
  title: {
    premarket: "Премаркет",
    open: "От открытия",
    close: "Итоги дня",
  },
  section: {
    gapUp: "Гэпы вверх",
    gapDown: "Гэпы вниз",
    leaders: "Темы: лидеры",
    laggards: "Темы: отстающие",
    earnings: "Отчёты сегодня",
    macro: "Макро сегодня",
    movers: "Сильнее всех от открытия",
    afterHours: "Афтермаркет",
  },
  earnings: {
    bmo: "До открытия",
    amc: "После закрытия",
    more: "и ещё {count}",
  },
  label: {
    rvol: "RVOL {value}",
    float: "флоат {value}",
  },
  footer: "Темы рынка на сайте",
};
