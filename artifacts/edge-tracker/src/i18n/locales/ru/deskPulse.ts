/**
 * Desk pulse («что работает в сезоне»), easy money of the day, the season report. Every number comes from PropReports
 * trades and the candle archive; nothing here is typed in except the plan notes and the report's conclusions.
 */
export default {
  family: {
    gap_up_long: "Гэп вверх — лонг",
    gap_up_short: "Гэп вверх — шорт",
    gap_down_long: "Гэп вниз — лонг",
    gap_down_short: "Гэп вниз — шорт",
    flat_long: "Без гэпа — лонг",
    flat_short: "Без гэпа — шорт",
  },
  pulse: {
    title: "Пульс деска: что работает в сезоне",
    hint: "Все сделки деска за {days} дн. ({from} – {to}): семейство сетапа (гэп дня × сторона) × тайминг. Нетто без трёх лучших сделок и медиана — чтобы выбросы не вводили в заблуждение. Серые ячейки — меньше {trades} сделок или меньше {people} человек: их не оцениваем.",
    loadFailed: "Не удалось загрузить пульс деска",
    empty: "За окно на деске нет закрытых сделок с архивом дня.",
    line: "В этом сезоне: {works} — работает; {fails} — не работает.",
    lineWorks: "В этом сезоне работает: {works}.",
    lineFails: "В этом сезоне не работает: {fails}.",
    lineNone: "В этом сезоне ни одна ячейка ещё не набрала выборку.",
    cellName: "{family} · {timing}",
    family: "Семейство",
    cell: "{n} сд. · винрейт {wr}",
    exTop3: "без топ-3 {value}",
    medianR: "медиана {value}",
    thin: "Мало данных: {n} сд.",
    hidden: "Меньше {people} человек — цифры скрыты",
    works: "Работает",
    fails: "Не работает",
    mixed: "Смешанно",
    outliers: "На выбросах",
    unclassified: "Без семейства (нет архива дня или стороны): {count} из {total} сделок.",
    aria: "{family}, {timing}",
  },
} as const;
