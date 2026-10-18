/**
 * `simOwn` — «Тренажёр» → «Мои дни» (/trainer): the trader replays one of their own losing trades (components/sim/own-*,
 * components/shared/replay-own-day.tsx). Terms: i18n/GLOSSARY.md («Simulator» section).
 */
export default {
  banner: {
    pill: "Твоя сделка · {ticker} · {date}",
    lead: "Бары идут к моменту твоего входа. Войти можно и раньше",
    decision: "Здесь ты вошёл. Реши заново: вход, размер, стоп — или пропусти",
    after: "Дальше день идёт, как шёл тогда",
  },
  chartEntry: "Твой вход",
  hudRiskUnit: "1R = {value} на акцию — как в реальной сделке",
  hudFee: "Комиссия твоей сделки: {value} за акцию",
  result: {
    title: "Как было и как сейчас",
    real: "Как было",
    sim: "В симуляторе",
    trade: "{side} {qty} · {entry} → {exit}",
    skipped: "Не входил",
    simTrades: { one: "{count} сделка", few: "{count} сделки", many: "{count} сделок", other: "{count} сделки" },
    diff: {
      better: "Лучше реальной сделки на {value}",
      worse: "Хуже реальной сделки на {value}",
      same: "Почти как в реальности ({value})",
      skipped: "Пропуск сберёг бы {value}",
    },
    risk: "1R = {value} · {source}",
    riskSource: { trade: "риск реальной сделки", stop: "по стопу реальной сделки", atr: "по ATR — у сделки не было риска" },
    mistakeTitle: "Что было не так в реальной сделке",
    noMistake: "Явной ошибки в реальной сделке не нашли",
    again: "Ещё один мой день",
    deskDay: "Как деск торговал этот день",
    toStart: "К выбору режима",
    legsTitle: "Твоя реальная сделка",
    cols: { role: "Действие", time: "Время ET", price: "Цена", qty: "Акций" },
    deskTitle: "Твои сделки по {ticker} в этот день",
  },
  progressLabel: "Мой день",
  /** Hint under «Игр»: own-day games are in «Последние игры» but not in the totals. */
  errors: {
    noBars: "Для этой сделки нет сохранённых минутных свечей",
    notReplayable: "Эту сделку нельзя переиграть: нужна своя убыточная интрадей-сделка со свечами того дня",
    noOwnTrades: "Пока нечего переигрывать: нет своих убыточных сделок со свечами",
  },
  sheet: {
    replay: "Переиграть этот день",
    replayHint: "Симулятор: дойти до момента входа и решить заново",
    continue: "Продолжить {ticker}",
    continueHint: "Игра по этому дню не закончена — продолжить с того же места",
  },
} as const;
