/** Expected move on earnings (components/shared/expected-move/*): the calendar rows and the watchlist sheet. */
export default {
  em: "EM ±{value}",
  source: {
    implied: "опционы",
    impliedHint: "ATM-стрэддл ближайшей экспирации после отчёта (бесплатная цепочка с задержкой ~15 мин), снят перед отчётом",
    historical: "историческое · {count} отч.",
    historicalHint: "Среднее движение на прошлых отчётах из архива свечей — не ожидание рынка",
  },
  levels: "{up} / {down}",
  moved: "Факт {value}",
  broken: "EM пробит",
  held: "в пределах EM",
} as const;
