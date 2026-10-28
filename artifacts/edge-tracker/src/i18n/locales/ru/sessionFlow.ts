/**
 * Session flow (components/shared/session-flow/*): re-entries, chases, the give-back from the peak, green-to-red,
 * the robust edge of a slice. All numbers come from PropReports fills.
 */
export default {
  panel: {
    title: "Повторные входы и поток дня",
    hint: "Считается само по исполнениям PropReports: какой по счёту вход в тикер и сторону за день, погоня после стопа, отдача с пика дня и разгон после ухода в минус.",
    loadFailed: "Не удалось загрузить поток дня",
    empty: "За период нет закрытых сделок.",
    col: { bucket: "Вход", trades: "Сделок", winRate: "Винрейт", perTrade: "На сделку", net: "Нетто" },
    bucket: { "1": "Первый вход", "2": "2-й (перезаход)", "3": "3-й", "4+": "4-й и дальше" },
    insight: "{bucket}: {net} за {trades} — после второго перезахода защита ставит мягкий стоп по тикеру.",
    allGood: "Перезаходы не стоят денег: держите правило «не больше {max} перезаходов».",
    chase: "Погоня после стопа (премаркет, открытие, афтермаркет): {trades}, нетто {net}",
    noChase: "Погони после стопа в этот период нет.",
    giveback: "Дней с отдачей с пика ≥ {threshold} стопа: {count}",
    givebackDay: "{day}: пик {peak}, закрыл {close} — отдал {amount} ({units})",
    stopsUnit: "{value} стопа",
    rUnit: "{value}R",
    greenToRed: "Дней, когда после ухода в минус вырос размер или темп: {count} из {cross}",
    greenToRedDay: "{day}: размер ×{size}, темп ×{pace} после перехода в минус",
    toRisk: "Лимиты и защита — «Мой риск»",
  },
  robust: {
    col: "Без топ-3",
    hint: "Нетто без трёх лучших сделок · медиана {median} · доля топ-3 {share}",
    outliers: "На выбросах",
    outliersHint: "Результат держится на трёх лучших сделках: без них {exTop3}. Это ещё не эдж.",
  },
} as const;
