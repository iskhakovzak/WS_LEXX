/**
 * `shareCard` — «Картинка сделки»: the share-card dialog (components/trades/share-card) and its buttons in the trade
 * sheet and the trades list. The text drawn ON the card stays English (Entry / Exit / Size / Return, trading convention).
 */
export default {
  button: "Картинка",
  buttonTitle: "Картинка сделки, чтобы поделиться с друзьями",
  rowAria: "Картинка сделки {ticker}",
  title: "Картинка сделки",
  description: "Карточка {ticker} для друзей. Рисуется в браузере и никуда не загружается.",
  previewAlt: "Превью картинки сделки {ticker}",
  drawing: "Рисуем…",
  themes: {
    label: "Фон",
    olymp: "Олимп",
    marble: "Мрамор",
    night: "Ночь",
    photo: "Своё фото",
  },
  art: {
    prev: "Предыдущая картина",
    next: "Следующая картина",
    position: "{n} из {total}",
    pick: "Картина: {credit}",
  },
  photo: {
    pick: "Выбрать фото",
    change: "Другое фото",
    hint: "Фото остаётся на этом устройстве и никуда не загружается.",
    failed: "Не удалось открыть это изображение",
  },
  result: {
    label: "Результат",
    usd: "Чистый P&L в $",
    r: "В R",
    pct: "% от позиции",
    rOnly: "На деске суммы в $ на картинках скрыты.",
  },
  toggles: {
    showName: "Показать имя",
    showPrices: "Показать цены",
  },
  chart: {
    fallback: "Нет минутных баров за этот день — на картинке прямая от входа к выходу.",
    none: "Нет баров и цен — картинка без графика.",
  },
  actions: {
    download: "Скачать PNG",
    copy: "Копировать",
    share: "Поделиться",
  },
  toast: {
    downloaded: "Картинка сохранена",
    copied: "Картинка скопирована — вставьте её в чат",
    copyUnsupported: "Этот браузер не умеет копировать картинки. Нажмите «Скачать PNG».",
    copyFailed: "Не удалось скопировать картинку",
    shareFailed: "Не удалось поделиться. Скачайте PNG и отправьте файлом.",
    renderFailed: "Не удалось нарисовать картинку",
  },
} as const;
