/**
 * Quote library UI: the dashboard card «Цитата дня» (daily-quote-card, components/quotes/*), the quote under the lock
 * clock (components/lock/lock-quote) and its Settings row. The quotes themselves are data (src/data/quotes) in four
 * languages, not dictionary entries.
 */
export default {
  title: "Цитата дня",
  loading: "Загрузка цитаты",
  loadFailed: "Не удалось загрузить библиотеку цитат",
  next: "Следующая цитата",
  nextShort: "Следующая",
  copy: "Скопировать цитату",
  copied: "Скопировано",
  share: "Картинка с цитатой",
  more: "Ещё: копировать, картинка, категории",
  favAdd: "В избранное",
  favRemove: "Убрать из избранного",
  langAria: "Язык цитаты",
  origShow: "Показать оригинал",
  origHide: "Скрыть оригинал",
  origAria: "Оригинал цитаты",
  library: {
    one: "В библиотеке {count} цитата",
    few: "В библиотеке {count} цитаты",
    many: "В библиотеке {count} цитат",
    other: "В библиотеке {count} цитаты",
  },
  rel: {
    verified: "Источник",
    verifiedHint: "Строка есть в указанном источнике, у этого говорящего",
    attributed: "Приписывается",
    attributedHint: "Традиционно приписывается — в источниках передано позднее или с чужих слов",
  },
  cat: {
    olympus: "Олимп",
    philosophy: "Философы",
    discipline: "Дисциплина",
    trading: "Трейдинг",
    psychology: "Психология",
  },
  cats: {
    label: "Какие цитаты показывать",
    hint: "На экране блокировки чаще Олимп и философы — независимо от этого выбора.",
    all: "Все",
    aria: "Категории цитат",
  },
  mood: {
    red: "После красного дня — о терпении",
    green: "Серия зелёных дней — о скромности",
  },
  history: {
    button: "История и избранное",
    tabHistory: "История",
    tabFavs: "Избранное",
    emptyHistory: "Здесь появятся показанные цитаты.",
    emptyFavs: "Отмечайте цитаты звёздочкой — они соберутся здесь.",
    onLock: "на экране блокировки",
    open: "Показать",
  },
  ai: {
    button: "Сгенерировать AI-цитату",
    title: "AI-цитата дня",
    back: "К библиотеке",
    hint: "Сгенерировано AI для всей команды — без проверенного источника.",
    failed: "AI-цитата недоступна",
    retry: "Повторить",
  },
  shareDialog: {
    title: "Картинка с цитатой",
    description: "Фон из «Олимпа», цитата, автор и источник — PNG 1080×1350.",
    previewAlt: "Картинка с цитатой: {author}",
    background: "Фон",
    drawing: "Рисуем…",
  },
  lock: {
    aria: "Цитата",
  },
  settings: {
    title: "Цитата на экране блокировки",
    hint: "Под часами — цитата из библиотеки, чаще Олимп и философы. Работает без запросов к серверу.",
    off: "Не показывать",
    everyMinute: "Каждую минуту",
    everyN: "Каждые {n} минут",
  },
} as const;
